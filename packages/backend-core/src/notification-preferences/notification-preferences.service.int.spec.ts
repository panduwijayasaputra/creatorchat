import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationPreferencesService } from './notification-preferences.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const service = new NotificationPreferencesService(prisma);

let n = 78_000n;
let codeNo = 0;
beforeEach(async () => {
  codeNo = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

const makeUser = (data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: n++, displayName: 'U', ...data } });

async function makeCreator(status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') {
  const user = await makeUser({ role: 'CREATOR' });
  const creator = await prisma.creator.create({
    data: { userId: user.id, publicCode: `mmmmmmm${'abcdefgh'[codeNo++]}`, status },
  });
  return { user, creator };
}

/** A customer with a conversation with a fresh creator. */
async function related(status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') {
  const customer = await makeUser();
  const c = await makeCreator(status);
  await prisma.conversation.create({ data: { customerId: customer.id, creatorId: c.creator.id } });
  return { customer, ...c };
}

describe('preferences', () => {
  it('are the defaults without a row, and reading writes nothing', async () => {
    const u = await makeUser();
    expect(await service.get(u.id)).toEqual({ messagesEnabled: true, showContent: false });
    expect(await prisma.notificationPreference.count()).toBe(0);
  });

  it('change only the given switch, and the first write keeps the default of the other', async () => {
    const u = await makeUser();
    expect(await service.update(u.id, { showContent: true })).toEqual({
      messagesEnabled: true,
      showContent: true,
    });
    expect(await service.update(u.id, { messagesEnabled: false })).toEqual({
      messagesEnabled: false,
      showContent: true,
    });
    expect(await service.get(u.id)).toEqual({ messagesEnabled: false, showContent: true });
    expect(await prisma.notificationPreference.count()).toBe(1);
  });

  it('an empty patch changes nothing', async () => {
    const u = await makeUser();
    await service.update(u.id, { showContent: true });
    expect(await service.update(u.id, {})).toEqual({ messagesEnabled: true, showContent: true });
  });

  it('two quick toggles of different switches, even as the very first write, keep both', async () => {
    const u = await makeUser();
    await Promise.all([
      service.update(u.id, { messagesEnabled: false }),
      service.update(u.id, { showContent: true }),
    ]);
    expect(await service.get(u.id)).toEqual({ messagesEnabled: false, showContent: true });
    expect(await prisma.notificationPreference.count()).toBe(1);
  });

  it('many toggles of one switch end in the last value that was sent', async () => {
    const u = await makeUser();
    for (const value of [true, false, true, false]) {
      await service.update(u.id, { messagesEnabled: value });
    }
    expect((await service.get(u.id)).messagesEnabled).toBe(false);
  });

  it("never read or write another user's row", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await service.update(a.id, { showContent: true });
    expect(await service.get(b.id)).toEqual({ messagesEnabled: true, showContent: false });
    await service.update(b.id, { messagesEnabled: false });
    expect(await service.get(a.id)).toEqual({ messagesEnabled: true, showContent: true });
  });
});

describe('mute', () => {
  it('mutes a creator the customer has a conversation with, once, and unmutes', async () => {
    const r = await related();
    expect(await service.mute(r.customer.id, r.creator.publicCode)).toBe('ok');
    expect(await service.mute(r.customer.id, r.creator.publicCode)).toBe('ok');
    expect(await prisma.creatorMute.count()).toBe(1);
    expect(await service.unmute(r.customer.id, r.creator.publicCode)).toBe('ok');
    expect(await service.unmute(r.customer.id, r.creator.publicCode)).toBe('ok');
    expect(await prisma.creatorMute.count()).toBe(0);
  });

  it('answers the same not_found for an unrelated, a blocked, an unknown and a malformed creator, and stores nothing', async () => {
    const customer = await makeUser();
    const stranger = await makeCreator(); // no conversation with this customer
    const blocked = await related('BLOCKED');
    const own = await related();
    const codes = [stranger.creator.publicCode, 'zzzzzzzz', 'bad', '', '../etc', 'SALSA234'];
    for (const code of codes) {
      expect(await service.mute(customer.id, code), code).toBe('not_found');
      expect(await service.unmute(customer.id, code), code).toBe('not_found');
    }
    expect(await service.mute(blocked.customer.id, blocked.creator.publicCode)).toBe('not_found');
    // another customer's creator is a stranger to me
    expect(await service.mute(customer.id, own.creator.publicCode)).toBe('not_found');
    expect(await prisma.creatorMute.count()).toBe(0);
  });

  it('a creator whose account is blocked cannot be muted either', async () => {
    const r = await related();
    await prisma.user.update({ where: { id: r.user.id }, data: { status: 'BLOCKED' } });
    expect(await service.mute(r.customer.id, r.creator.publicCode)).toBe('not_found');
  });

  it('a creator blocked after the mute can still be unmuted', async () => {
    const r = await related();
    await service.mute(r.customer.id, r.creator.publicCode);
    await prisma.creator.update({ where: { id: r.creator.id }, data: { status: 'BLOCKED' } });
    expect(await service.unmute(r.customer.id, r.creator.publicCode)).toBe('ok');
    expect(await prisma.creatorMute.count()).toBe(0);
  });

  it("one customer's mute does not touch another's", async () => {
    const r = await related();
    const other = await makeUser();
    await prisma.conversation.create({ data: { customerId: other.id, creatorId: r.creator.id } });
    await service.mute(r.customer.id, r.creator.publicCode);
    await service.mute(other.id, r.creator.publicCode);
    await service.unmute(r.customer.id, r.creator.publicCode);
    const left = await prisma.creatorMute.findMany();
    expect(left.map((m) => m.userId)).toEqual([other.id]);
  });
});
