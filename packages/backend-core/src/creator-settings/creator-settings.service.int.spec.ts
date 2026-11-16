import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CreatorSettingsService } from './creator-settings.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const service = new CreatorSettingsService(prisma);

let n = 9000n;
let code = 0;
const make = async (
  opts: {
    role?: 'USER' | 'CREATOR';
    userBlocked?: boolean;
    row?: 'ACTIVE' | 'BLOCKED' | null;
  } = {},
) => {
  const user = await prisma.user.create({
    data: {
      telegramId: n++,
      displayName: 'Salsa',
      role: opts.role ?? 'CREATOR',
      status: opts.userBlocked ? 'BLOCKED' : 'ACTIVE',
    },
  });
  if (opts.row !== null) {
    await prisma.creator.create({
      data: {
        userId: user.id,
        publicCode: 'k4m5x2q' + String(++code + 1),
        status: opts.row ?? 'ACTIVE',
      },
    });
  }
  return user;
};

beforeEach(async () => {
  await resetDatabase(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('CreatorSettingsService.get', () => {
  it("returns the caller's own profile and public code", async () => {
    const user = await make();
    const result = await service.get(user.id);
    expect(result?.publicCode).toMatch(/^k4m5x2q[2-7]$/);
    expect(result?.profile).toMatchObject({ id: user.id, role: 'CREATOR', display_name: 'Salsa' });
  });

  it('is null without an ACTIVE creator row, for a blocked account, or for a USER', async () => {
    expect(await service.get((await make({ row: null })).id)).toBeNull();
    expect(await service.get((await make({ row: 'BLOCKED' })).id)).toBeNull();
    expect(await service.get((await make({ userBlocked: true })).id)).toBeNull();
    expect(await service.get((await make({ role: 'USER' })).id)).toBeNull();
  });
});
