import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

/**
 * Creates a Prisma client over a `pg` connection pool (Prisma 7 driver adapter).
 * The caller owns the client and must `$disconnect()` it on shutdown.
 */
export function createPrismaClient(connectionString: string = requireDatabaseUrl()): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}
