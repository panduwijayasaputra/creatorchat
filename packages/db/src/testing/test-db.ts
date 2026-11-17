import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createPrismaClient } from '../client.js';
import type { PrismaClient } from '../generated/client.js';
import { assertSafeTestDatabase, UnsafeTestDatabaseError } from './safe-database.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = resolve(packageDir, '../..');

/** Loads the repo-root `.env` into `process.env` (existing variables win). */
export function loadRootEnv(): void {
  const file = resolve(repoRoot, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

function requireTestUrl(): string {
  const testUrl = process.env.DATABASE_URL_TEST;
  assertSafeTestDatabase(testUrl, process.env.DATABASE_URL);
  return testUrl as string;
}

/** Creates the test database if it does not exist (connects to the `postgres` maintenance DB). */
export async function ensureTestDatabase(testUrl: string = requireTestUrl()): Promise<void> {
  const { database } = assertSafeTestDatabase(testUrl, process.env.DATABASE_URL);
  const maintenance = new URL(testUrl);
  maintenance.pathname = '/postgres';
  const client = new pg.Client({ connectionString: maintenance.toString() });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Cannot connect to PostgreSQL for tests (${(error as Error).message}). ` +
        'Is it running, and do the credentials in DATABASE_URL_TEST work? See README.',
      { cause: error },
    );
  }
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (exists.rowCount === 0) {
      // Identifier is validated to end with _test; quote defensively.
      await client.query(`CREATE DATABASE "${database.replaceAll('"', '""')}"`);
    }
  } finally {
    await client.end();
  }
}

/** Applies committed migrations to the test database only (`prisma migrate deploy`). */
export function migrateTestDatabase(testUrl: string = requireTestUrl()): void {
  assertSafeTestDatabase(testUrl, process.env.DATABASE_URL);
  const require = createRequire(import.meta.url);
  const prismaCli = resolve(dirname(require.resolve('prisma/package.json')), 'build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: packageDir,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
}

/** Full test-database preparation used by vitest global setup. */
export async function prepareTestDatabase(): Promise<void> {
  loadRootEnv();
  const testUrl = requireTestUrl();
  await ensureTestDatabase(testUrl);
  migrateTestDatabase(testUrl);
}

export function createTestPrisma(): PrismaClient {
  return createPrismaClient(requireTestUrl());
}

const APP_TABLES = [
  'sessions',
  'creator_applications',
  'access_requests',
  'subscription_events',
  'conversations',
  'subscriptions',
  'creators',
  'users',
  'admin_accounts',
  'audit_logs',
  'outbox_events',
  'notification_deliveries',
] as const;

/**
 * Empties every application table. Re-checks that the connected database is a `_test` database
 * before truncating, so it cannot wipe dev data even if called with the wrong client.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const db = rows[0]?.db ?? '';
  if (!db.endsWith('_test')) {
    throw new UnsafeTestDatabaseError(`connected database "${db}" does not end with "_test"`);
  }
  const list = APP_TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
