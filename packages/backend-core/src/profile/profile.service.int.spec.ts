import type { UpdateProfileData } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ProfileAccountNotActiveError, ProfileService } from './profile.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const service = new ProfileService(prisma);

let n = 7000n;
const make = (data: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: {
      telegramId: n++,
      displayName: 'Maya Lestari',
      telegramUsername: 'maya',
      avatarUrl: 'https://cdn.example/app.png',
      telegramAvatarUrl: 'https://t.me/i/userpic/maya.jpg',
      ...data,
    },
  });
const input = (over: Partial<UpdateProfileData> = {}): UpdateProfileData => ({
  display_name: 'Maya L',
  bio: 'Pecinta masak',
  ...over,
});

beforeEach(async () => {
  await resetDatabase(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('ProfileService.updateOwnProfile', () => {
  it('updates name and bio and returns the contract shape', async () => {
    const user = await make();
    const result = await service.updateOwnProfile(user.id, input());
    expect(result).toMatchObject({
      id: user.id,
      display_name: 'Maya L',
      bio: 'Pecinta masak',
      avatar_url: 'https://cdn.example/app.png',
      telegram_username: 'maya',
    });
  });

  it('clears the bio with null and is idempotent when saved twice', async () => {
    const user = await make({ bio: 'lama' });
    const first = await service.updateOwnProfile(user.id, input({ bio: null }));
    const second = await service.updateOwnProfile(user.id, input({ bio: null }));
    expect(first).toEqual(second);
    expect(second.bio).toBeNull();
  });

  it('resets the app photo to the Telegram photo only when asked', async () => {
    const user = await make();
    const kept = await service.updateOwnProfile(user.id, input());
    expect(kept.avatar_url).toBe('https://cdn.example/app.png');
    const reset = await service.updateOwnProfile(user.id, input({ reset_avatar: true }));
    expect(reset.avatar_url).toBe('https://t.me/i/userpic/maya.jpg');
    expect(reset.telegram_avatar_url).toBe('https://t.me/i/userpic/maya.jpg');
  });

  it('reset gives no photo when Telegram has none', async () => {
    const user = await make({ telegramAvatarUrl: null });
    const reset = await service.updateOwnProfile(user.id, input({ reset_avatar: true }));
    expect(reset.avatar_url).toBeNull();
  });

  it('never touches role, status, telegram fields or session_version', async () => {
    const user = await make();
    await service.updateOwnProfile(user.id, input({ reset_avatar: true }));
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({
      role: 'USER',
      status: 'ACTIVE',
      telegramId: user.telegramId,
      telegramUsername: 'maya',
      telegramAvatarUrl: 'https://t.me/i/userpic/maya.jpg',
      sessionVersion: user.sessionVersion,
    });
  });

  it('rejects a BLOCKED account and writes nothing', async () => {
    const user = await make({ status: 'BLOCKED' });
    await expect(
      service.updateOwnProfile(user.id, input({ reset_avatar: true })),
    ).rejects.toBeInstanceOf(ProfileAccountNotActiveError);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.displayName).toBe('Maya Lestari');
    expect(row.avatarUrl).toBe('https://cdn.example/app.png');
  });

  it('rejects an unknown id', async () => {
    await expect(
      service.updateOwnProfile('00000000-0000-4000-8000-000000000000', input()),
    ).rejects.toBeInstanceOf(ProfileAccountNotActiveError);
  });

  it('changes only the row of the caller', async () => {
    const a = await make();
    const b = await make();
    await service.updateOwnProfile(a.id, input({ display_name: 'Only A' }));
    const other = await prisma.user.findUniqueOrThrow({ where: { id: b.id } });
    expect(other.displayName).toBe('Maya Lestari');
  });

  it('never writes after a concurrent block: the save lands first or is rejected', async () => {
    const user = await make();
    const results = await Promise.allSettled([
      service.updateOwnProfile(user.id, input({ display_name: 'Racing' })),
      prisma.user.update({ where: { id: user.id }, data: { status: 'BLOCKED' } }),
    ]);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.status).toBe('BLOCKED');
    expect(results[1].status).toBe('fulfilled');
    if (results[0].status === 'rejected') {
      expect(results[0].reason).toBeInstanceOf(ProfileAccountNotActiveError);
      expect(row.displayName).toBe('Maya Lestari');
    } else {
      expect(row.displayName).toBe('Racing');
    }
  });
});

describe('ProfileService.updateOwnProfile as CREATOR', () => {
  let code = 0;
  const makeCreator = async (creatorStatus: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') => {
    const user = await make({ role: 'CREATOR' });
    await prisma.creator.create({
      data: {
        userId: user.id,
        publicCode: 'abcdef2' + String((++code % 8) + 2),
        status: creatorStatus,
      },
    });
    return user;
  };

  it('updates an ACTIVE creator, including the photo reset', async () => {
    const user = await makeCreator();
    const result = await service.updateOwnProfile(
      user.id,
      input({ reset_avatar: true }),
      'CREATOR',
    );
    expect(result).toMatchObject({
      display_name: 'Maya L',
      avatar_url: 'https://t.me/i/userpic/maya.jpg',
    });
  });

  it('rejects a BLOCKED creators row without writing', async () => {
    const user = await makeCreator('BLOCKED');
    await expect(service.updateOwnProfile(user.id, input(), 'CREATOR')).rejects.toBeInstanceOf(
      ProfileAccountNotActiveError,
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).displayName).toBe(
      'Maya Lestari',
    );
  });

  it('rejects a CREATOR role without a creators row, and a role mismatch either way', async () => {
    const noRow = await make({ role: 'CREATOR' });
    await expect(service.updateOwnProfile(noRow.id, input(), 'CREATOR')).rejects.toBeInstanceOf(
      ProfileAccountNotActiveError,
    );
    const creator = await makeCreator();
    await expect(service.updateOwnProfile(creator.id, input())).rejects.toBeInstanceOf(
      ProfileAccountNotActiveError,
    );
    const customer = await make();
    await expect(service.updateOwnProfile(customer.id, input(), 'CREATOR')).rejects.toBeInstanceOf(
      ProfileAccountNotActiveError,
    );
  });
});

describe('ProfileService.updateOwnTimezone', () => {
  let code = 0;
  const makeCreator = async (creatorStatus: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') => {
    const user = await make({ role: 'CREATOR' });
    await prisma.creator.create({
      data: {
        userId: user.id,
        publicCode: 'abcdef3' + String.fromCharCode(97 + code++),
        status: creatorStatus,
      },
    });
    return user;
  };
  const zoneOf = async (id: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id } })).timezone;

  it('changes only the timezone of an ACTIVE creator and is harmless twice', async () => {
    const user = await makeCreator();
    const first = await service.updateOwnTimezone(user.id, 'Asia/Makassar');
    const second = await service.updateOwnTimezone(user.id, 'Asia/Makassar');
    expect(first.timezone).toBe('Asia/Makassar');
    expect(second).toEqual(first);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({
      displayName: 'Maya Lestari',
      role: 'CREATOR',
      status: 'ACTIVE',
      avatarUrl: 'https://cdn.example/app.png',
    });
  });

  it('new accounts default to Asia/Jakarta', async () => {
    expect(await zoneOf((await make()).id)).toBe('Asia/Jakarta');
  });

  it('never touches another account', async () => {
    const a = await makeCreator();
    const b = await makeCreator();
    const customer = await make();
    await service.updateOwnTimezone(a.id, 'Australia/Sydney');
    expect(await zoneOf(b.id)).toBe('Asia/Jakarta');
    expect(await zoneOf(customer.id)).toBe('Asia/Jakarta');
  });

  it('rejects a blocked user, a blocked or missing creators row and a role mismatch without writing', async () => {
    const blockedRow = await makeCreator('BLOCKED');
    const noRow = await make({ role: 'CREATOR' });
    const blockedUser = await makeCreator();
    await prisma.user.update({ where: { id: blockedUser.id }, data: { status: 'BLOCKED' } });
    const customer = await make();
    for (const id of [blockedRow.id, noRow.id, blockedUser.id, customer.id]) {
      await expect(service.updateOwnTimezone(id, 'Asia/Jayapura')).rejects.toBeInstanceOf(
        ProfileAccountNotActiveError,
      );
      expect(await zoneOf(id)).toBe('Asia/Jakarta');
    }
    const creator = await makeCreator();
    await expect(
      service.updateOwnTimezone(creator.id, 'Asia/Jayapura', 'USER'),
    ).rejects.toBeInstanceOf(ProfileAccountNotActiveError);
  });
});
