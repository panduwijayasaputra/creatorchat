import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CreatorLinkService } from './creator-link.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const service = new CreatorLinkService(prisma);

let n = 1000n;
async function makeCreator(
  code: string,
  opts: { creatorBlocked?: boolean; userBlocked?: boolean } = {},
) {
  const user = await prisma.user.create({
    data: {
      telegramId: n++,
      displayName: 'Salsa',
      role: 'CREATOR',
      avatarUrl: 'https://example.test/a.jpg',
      status: opts.userBlocked ? 'BLOCKED' : 'ACTIVE',
    },
  });
  await prisma.creator.create({
    data: { userId: user.id, publicCode: code, status: opts.creatorBlocked ? 'BLOCKED' : 'ACTIVE' },
  });
  return user;
}

beforeEach(async () => {
  await resetDatabase(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('CreatorLinkService.resolve', () => {
  it('resolves an active creator with only the three public fields', async () => {
    await makeCreator('k4m5x2qa');
    const result = await service.resolve({ code: 'k4m5x2qa' });
    expect(result).toEqual({
      kind: 'ok',
      creator: {
        publicCode: 'k4m5x2qa',
        displayName: 'Salsa',
        avatarUrl: 'https://example.test/a.jpg',
      },
    });
  });

  it('answers not_found identically for unknown, malformed, blocked creator and blocked account', async () => {
    await makeCreator('bbbbbbbb', { creatorBlocked: true });
    await makeCreator('cccccccc', { userBlocked: true });
    for (const code of ['aaaaaaaa', 'ABCDEFGH', 'abc', '../etc', 'bbbbbbbb', 'cccccccc']) {
      expect(await service.resolve({ code })).toEqual({ kind: 'not_found' });
    }
  });

  it('writes nothing', async () => {
    await makeCreator('ffffffff');
    const counts = async () => [
      await prisma.user.count(),
      await prisma.session.count(),
      await prisma.creator.count(),
      await prisma.auditLog.count(),
    ];
    const before = await counts();
    await service.resolve({ code: 'ffffffff' });
    expect(await counts()).toEqual(before);
  });
});
