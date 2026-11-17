import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxEventType, OutboxService, UnsafeOutboxPayloadError } from './outbox.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const outbox = new OutboxService();
const ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
const USER = '5b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e11';

const event = (over: Partial<Parameters<OutboxService['add']>[1]> = {}) => ({
  type: OutboxEventType.CREATOR_APPLICATION_APPROVED,
  aggregateType: 'creator_application',
  aggregateId: ID,
  payload: { application_id: ID, user_id: USER, decision: 'approved' },
  dedupeKey: `creator_application:${ID}:decision`,
  ...over,
});

beforeEach(async () => {
  await resetDatabase(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('OutboxService.add', () => {
  it('writes a PENDING event with the payload', async () => {
    expect(await outbox.add(prisma, event())).toEqual({ created: true });
    const rows = await prisma.outboxEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'creator_application.approved',
      aggregateType: 'creator_application',
      aggregateId: ID,
      status: 'PENDING',
      attempts: 0,
      processedAt: null,
      payload: { application_id: ID, user_id: USER, decision: 'approved' },
    });
  });

  it('ignores a repeat with the same dedupe key and reports it', async () => {
    await outbox.add(prisma, event());
    expect(await outbox.add(prisma, event())).toEqual({ created: false });
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('leaves one row when written twice at the same time', async () => {
    const results = await Promise.all([outbox.add(prisma, event()), outbox.add(prisma, event())]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('commits with the surrounding transaction, or not at all', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await outbox.add(tx, event());
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await prisma.outboxEvent.count()).toBe(0);

    await prisma.$transaction((tx) => outbox.add(tx, event()));
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('refuses a free-text payload entry without echoing the text', async () => {
    const secret = 'Link Instagram belum bisa diverifikasi';
    const attempt = outbox.add(prisma, event({ payload: { reason: secret } }));
    await expect(attempt).rejects.toBeInstanceOf(UnsafeOutboxPayloadError);
    await expect(attempt).rejects.not.toThrow(secret);
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('refuses unsafe keys and non-finite numbers', async () => {
    await expect(outbox.add(prisma, event({ payload: { 'a b': 'x' } }))).rejects.toBeInstanceOf(
      UnsafeOutboxPayloadError,
    );
    await expect(outbox.add(prisma, event({ payload: { n: Number.NaN } }))).rejects.toBeInstanceOf(
      UnsafeOutboxPayloadError,
    );
  });
});
