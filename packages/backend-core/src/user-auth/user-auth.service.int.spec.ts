import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedWindowLimiter, RateLimiterUnavailableError } from './rate-limiter.js';
import { buildSignedInitData } from './telegram-init-data.js';
import { UserAuthService, type UserLoginOutcome } from './user-auth.service.js';

loadRootEnv();

const BOT = '123456:TEST-bot-token-not-real';
const SECRET = 'user-session-secret-'.padEnd(48, 's');
const START = Date.parse('2026-11-15T10:00:00Z');

let prisma: PrismaClient;
let redis: Redis;
let prefix: string;
let clockMs: number;
let service: UserAuthService;

const clock = () => new Date(clockMs);

function build(overrides: Partial<{ redis: Redis; attempts: number; invalid: number }> = {}) {
  return new UserAuthService({
    prisma,
    limiter: new FixedWindowLimiter(overrides.redis ?? redis, prefix),
    config: {
      botToken: BOT,
      sessionSecret: SECRET,
      maxAgeSeconds: 86_400,
      ...(overrides.attempts ? { attemptsPerWindow: overrides.attempts } : {}),
      ...(overrides.invalid ? { invalidPerWindow: overrides.invalid } : {}),
    },
    clock,
  });
}

function initData(
  user: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
  },
  authDate = new Date(clockMs),
): string {
  return buildSignedInitData({ botToken: BOT, user, authDate });
}

const nadia = {
  id: 424242,
  first_name: 'Nadia',
  last_name: 'Putri',
  username: 'nadia',
  photo_url: 'https://t.me/i/userpic/320/nadia.jpg',
};

async function login(data: string, ip = '10.0.0.1'): Promise<UserLoginOutcome> {
  return service.loginWithTelegram({ initData: data }, { requestId: 'req-1', ip });
}

async function loginOk(data: string) {
  const outcome = await login(data);
  if (outcome.kind !== 'ok') throw new Error(`login failed: ${outcome.kind}`);
  return outcome;
}

beforeAll(() => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 1 });
});

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  prefix = `test:${randomUUID()}:userlogin`;
  clockMs = START;
  service = build();
});

describe('loginWithTelegram', () => {
  it('creates a USER / ACTIVE account from Telegram name and photo on first login', async () => {
    const outcome = await loginOk(initData(nadia));
    expect(outcome.user).toMatchObject({
      telegram_id: '424242',
      role: 'USER',
      status: 'ACTIVE',
      display_name: 'Nadia Putri',
      telegram_username: 'nadia',
      avatar_url: 'https://t.me/i/userpic/320/nadia.jpg',
    });
    expect(typeof outcome.user.telegram_id).toBe('string');
    expect(outcome.expiresIn).toBe(3600);
    const rows = await prisma.user.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('USER');
    const audit = await prisma.auditLog.findMany({ where: { action: 'user.account.created' } });
    expect(audit).toHaveLength(1);
  });

  it('issues a token that authenticates and a session row that records session_version', async () => {
    const outcome = await loginOk(initData(nadia));
    const session = await prisma.session.findFirstOrThrow({ where: { userId: outcome.user.id } });
    expect(session.sessionVersion).toBe(1);
    expect(session.refreshTokenHash).toBeNull();
    expect(session.adminId).toBeNull();
    const authed = await service.authenticate(outcome.accessToken);
    expect(authed?.user.id).toBe(outcome.user.id);
    expect(authed?.role).toBe('USER');
  });

  it('does not overwrite profile edits on later logins and identifies by telegram_id', async () => {
    const first = await loginOk(initData(nadia));
    await prisma.user.update({
      where: { id: first.user.id },
      data: { displayName: 'Nadia Edit', bio: 'hello', avatarUrl: 'https://cdn.example/a.png' },
    });
    const second = await loginOk(
      initData({
        id: 424242,
        first_name: 'Changed',
        username: 'new_handle',
        photo_url: 'https://x.test/p.jpg',
      }),
    );
    expect(second.user.id).toBe(first.user.id);
    expect(second.user.display_name).toBe('Nadia Edit');
    expect(second.user.avatar_url).toBe('https://cdn.example/a.png');
    expect(second.user.telegram_username).toBe('new_handle');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: first.user.id } });
    expect(row.bio).toBe('hello');
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'user.account.created' } })).toBe(1);
  });

  it('drops a photo that is not an https URL', async () => {
    const outcome = await loginOk(initData({ ...nadia, photo_url: 'javascript:alert(1)' }));
    expect(outcome.user.avatar_url).toBeNull();
  });

  it('keeps a CREATOR a CREATOR on login and reports the database role', async () => {
    const first = await loginOk(initData(nadia));
    await prisma.user.update({ where: { id: first.user.id }, data: { role: 'CREATOR' } });
    const second = await loginOk(initData(nadia));
    expect(second.user.role).toBe('CREATOR');
  });

  it('creates exactly one user when two first logins race', async () => {
    const data = initData({ id: 555001, first_name: 'Race' });
    const results = await Promise.all([login(data), login(data), login(data)]);
    expect(results.every((r) => r.kind === 'ok')).toBe(true);
    expect(await prisma.user.count({ where: { telegramId: 555001n } })).toBe(1);
    expect(await prisma.session.count()).toBe(3);
  });

  it('rejects forged, tampered, malformed and empty data without creating or changing users', async () => {
    await loginOk(initData(nadia));
    const before = await prisma.user.findMany();
    const forged = new URLSearchParams(initData({ id: 111, first_name: 'Mallory' }));
    forged.set('hash', 'b'.repeat(64));
    const tampered = new URLSearchParams(initData(nadia));
    tampered.set('user', JSON.stringify({ ...nadia, id: 999 }));
    for (const bad of [forged.toString(), tampered.toString(), 'nonsense', '']) {
      expect((await login(bad, `10.1.${Math.random()}`)).kind).toBe('invalid');
    }
    expect(await prisma.user.findMany()).toEqual(before);
    expect(await prisma.user.count({ where: { telegramId: 111n } })).toBe(0);
  });

  it('reports expired data as expired and creates nothing', async () => {
    const old = initData(nadia, new Date(clockMs - 86_401_000));
    expect((await login(old)).kind).toBe('expired');
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.session.count()).toBe(0);
  });

  it('issues no session for a BLOCKED account and audits it', async () => {
    const first = await loginOk(initData(nadia));
    await prisma.session.deleteMany();
    await prisma.user.update({ where: { id: first.user.id }, data: { status: 'BLOCKED' } });
    expect((await login(initData(nadia))).kind).toBe('blocked');
    expect(await prisma.session.count()).toBe(0);
    const audit = await prisma.auditLog.findMany({ where: { action: 'user.login.blocked' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(first.user.id);
  });

  it('never writes raw initData, tokens or the bot token to the audit log', async () => {
    const data = initData(nadia);
    const outcome = await loginOk(data);
    await prisma.user.update({ where: { id: outcome.user.id }, data: { status: 'BLOCKED' } });
    await login(data);
    const dump = JSON.stringify(await prisma.auditLog.findMany());
    expect(dump).not.toContain(BOT);
    expect(dump).not.toContain(outcome.accessToken);
    expect(dump).not.toContain('hash=');
    expect(dump).not.toContain(new URLSearchParams(data).get('hash') ?? 'x');
  });
});

describe('rate limiting', () => {
  it('limits all attempts per IP and reports a retry time', async () => {
    service = build({ attempts: 3 });
    const data = initData(nadia);
    for (let i = 0; i < 3; i++) expect((await login(data, '10.9.9.9')).kind).toBe('ok');
    const blocked = await login(data, '10.9.9.9');
    expect(blocked).toMatchObject({ kind: 'rate_limited' });
    expect((await login(data, '10.9.9.8')).kind).toBe('ok');
  });

  it('blocks an IP that keeps sending invalid data, but not expired data', async () => {
    service = build({ invalid: 2 });
    const expired = initData(nadia, new Date(clockMs - 86_401_000));
    for (let i = 0; i < 4; i++) expect((await login(expired, '10.8.8.8')).kind).toBe('expired');
    expect((await login('bad', '10.8.8.8')).kind).toBe('invalid');
    expect((await login('bad', '10.8.8.8')).kind).toBe('invalid');
    expect((await login(initData(nadia), '10.8.8.8')).kind).toBe('rate_limited');
  });

  it('fails closed when Redis is unreachable', async () => {
    const dead = new Redis({
      host: '127.0.0.1',
      port: 1,
      maxRetriesPerRequest: 0,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    service = build({ redis: dead });
    await expect(login(initData(nadia))).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    expect(await prisma.user.count()).toBe(0);
    dead.disconnect();
  });
});

describe('authenticate', () => {
  it('rejects garbage, a revoked session and an expired session', async () => {
    const outcome = await loginOk(initData(nadia));
    expect(await service.authenticate('garbage')).toBeNull();
    clockMs = START + 3601_000;
    expect(await service.authenticate(outcome.accessToken)).toBeNull();
    clockMs = START;
    expect(await service.authenticate(outcome.accessToken)).not.toBeNull();
    await prisma.session.updateMany({ data: { revokedAt: new Date(clockMs) } });
    expect(await service.authenticate(outcome.accessToken)).toBeNull();
  });

  it('rejects the old session after session_version is bumped (role change or block)', async () => {
    const outcome = await loginOk(initData(nadia));
    await prisma.user.update({
      where: { id: outcome.user.id },
      data: { role: 'CREATOR', sessionVersion: { increment: 1 } },
    });
    expect(await service.authenticate(outcome.accessToken)).toBeNull();
    const fresh = await loginOk(initData(nadia));
    expect((await service.authenticate(fresh.accessToken))?.role).toBe('CREATOR');
  });

  it('rejects a BLOCKED user even with an otherwise valid session', async () => {
    const outcome = await loginOk(initData(nadia));
    await prisma.user.update({ where: { id: outcome.user.id }, data: { status: 'BLOCKED' } });
    expect(await service.authenticate(outcome.accessToken)).toBeNull();
  });

  it('rejects a token whose session belongs to another user', async () => {
    const a = await loginOk(initData(nadia));
    const b = await loginOk(initData({ id: 777, first_name: 'Other' }));
    const sessionB = await prisma.session.findFirstOrThrow({ where: { userId: b.user.id } });
    const sessionA = await prisma.session.findFirstOrThrow({ where: { userId: a.user.id } });
    await prisma.session.update({ where: { id: sessionA.id }, data: { userId: b.user.id } });
    expect(await service.authenticate(a.accessToken)).toBeNull();
    expect(sessionB.userId).toBe(b.user.id);
  });

  it('rejects an unknown session id', async () => {
    const outcome = await loginOk(initData(nadia));
    await prisma.session.deleteMany();
    expect(await service.authenticate(outcome.accessToken)).toBeNull();
  });
});
