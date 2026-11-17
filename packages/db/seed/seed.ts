import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrismaClient } from '../src/client.js';
import { parseDatabaseUrl } from '../src/testing/safe-database.js';
import { runSeed } from './run-seed.js';

// Explicit fixtures only. Never runs in production; never overwrites an existing admin password.
async function main(): Promise<void> {
  const rootEnv = resolve(import.meta.dirname, '../../../.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: NODE_ENV is production.');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');

  const target = parseDatabaseUrl(url);
  if (target.database.endsWith('_test') && !process.argv.includes('--allow-test')) {
    throw new Error(
      `Refusing to seed test database "${target.database}". Tests manage their own data (use --allow-test to override).`,
    );
  }
  // Host and database name only; credentials are never printed.
  console.log(`Seeding database "${target.database}" on ${target.host}:${target.port} ...`);

  const prisma = createPrismaClient(url);
  try {
    const result = await runSeed(prisma, {
      adminUsername: process.env.SEED_ADMIN_USERNAME,
      adminPassword: process.env.SEED_ADMIN_PASSWORD,
    });
    console.log(
      `Fixture users: ${result.usersCreated} created, ${result.usersExisting} already existed.`,
    );
    console.log(`Fixture subscriptions created: ${result.subscriptionsCreated}.`);
    console.log(`Fixture creator requests created: ${result.applicationsCreated}.`);
    console.log(`Fixture access requests created: ${result.accessRequestsCreated}.`);
    console.log(`Fixture chat messages created: ${result.chatMessagesCreated}.`);
    if (!result.adminCreated) {
      console.log(`Admin "${result.adminUsername}" already exists; password unchanged.`);
    } else if (result.generatedPassword) {
      console.log(`Admin "${result.adminUsername}" created.`);
      console.log('');
      console.log(`  Generated admin password: ${result.generatedPassword}`);
      console.log('  Store it now. It is shown only once and cannot be recovered.');
      console.log('');
    } else {
      console.log(
        `Admin "${result.adminUsername}" created with the password from SEED_ADMIN_PASSWORD.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed failed');
  process.exit(1);
});
