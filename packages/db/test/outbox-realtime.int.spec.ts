import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const AGG = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

const add = (type: string, key: string) =>
  prisma.outboxEvent.create({
    data: { type, aggregateType: 'x', aggregateId: AGG, payload: {}, dedupeKey: key },
  });

describe('outbox_events.realtime_published_at', () => {
  it('is NULL for new rows', async () => {
    expect((await add('message.created', 'a')).realtimePublishedAt).toBeNull();
  });

  it('the migration backfill stamps message and read rows only', async () => {
    await add('message.created', 'a');
    await add('read.updated', 'b');
    await add('subscription.granted', 'c');
    const sql = readFileSync(
      new URL('../prisma/migrations/20261129010000_outbox_realtime/migration.sql', import.meta.url),
      'utf8',
    );
    const update = sql.match(/UPDATE[\s\S]*?;/)?.[0];
    expect(update).toBeTruthy();
    await prisma.$executeRawUnsafe(update as string);
    const rows = await prisma.outboxEvent.findMany({ orderBy: { dedupeKey: 'asc' } });
    expect(rows.map((r) => r.realtimePublishedAt !== null)).toEqual([true, true, false]);
  });

  it('has the partial index for pending message / read rows', async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'outbox_events_realtime_pending_idx'`;
    expect(rows[0]?.indexdef).toContain('realtime_published_at IS NULL');
  });
});
