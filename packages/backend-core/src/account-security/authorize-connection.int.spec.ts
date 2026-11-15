import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../admin-auth/index.js';
import { buildSignedInitData, FixedWindowLimiter, UserAuthService } from '../user-auth/index.js';
import { signUserToken } from '../user-auth/user-tokens.js';
import { AccountSecurityService } from './account-security.service.js';
import { authorizeConnection } from './authorize-connection.js';

loadRootEnv();

const BOT = '123456:TEST-bot-token-not-real';
const SECRET = 'user-session-secret-'.padEnd(48, 's');
const ADMIN_SECRET = 'access-secret-'.padEnd(48, 'a');

let prisma: PrismaClient;
let redis: Redis;
let auth: UserAuthService;
let security: AccountSecurityService;
let nextId = 70_000;

beforeAll(() => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 1 });
  auth = new UserAuthService({
    prisma,
    limiter: new FixedWindowLimiter(redis, `test:conn:${process.pid}`),
    config: {
      botToken: BOT,
      sessionSecret: SECRET,
      maxAgeSeconds: 86_400,
      attemptsPerWindow: 1000,
    },
  });
  security = new AccountSecurityService(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
});

async function login() {
  const id = nextId++;
  const out = await auth.loginWithTelegram({
    initData: buildSignedInitData({
      botToken: BOT,
      user: { id, first_name: 'Maya' },
      authDate: new Date(),
    }),
  });
  if (out.kind !== 'ok') throw new Error(`login failed: ${out.kind}`);
  return { token: out.accessToken, userId: out.user.id };
}

const USER_ONLY = { roles: ['USER'] } as const;
const REJECTED = { ok: false, reason: 'unauthenticated' };

describe('authorizeConnection', () => {
  it('accepts a live session whose role is allowed', async () => {
    const { token, userId } = await login();
    const decision = await authorizeConnection(auth, token, USER_ONLY);
    expect(decision.ok && decision.user.user.id).toBe(userId);
  });

  it('rejects a CREATOR where only USER is allowed, using the live role', async () => {
    const { token, userId } = await login();
    await prisma.user.update({ where: { id: userId }, data: { role: 'CREATOR' } });
    expect(await authorizeConnection(auth, token, USER_ONLY)).toEqual({
      ok: false,
      reason: 'forbidden_role',
    });
    expect((await authorizeConnection(auth, token, { roles: ['USER', 'CREATOR'] })).ok).toBe(true);
  });

  it('rejects garbage, tampered and wrong-secret tokens', async () => {
    const { token, userId } = await login();
    const forged = await signUserToken(
      'some-other-secret-'.padEnd(48, 'x'),
      { userId, sessionId: '00000000-0000-4000-8000-000000000000', sessionVersion: 1 },
      new Date(),
      600,
    );
    for (const bad of ['', 'abc', 'a.b.c', `${token}x`, forged]) {
      expect(await authorizeConnection(auth, bad, USER_ONLY)).toEqual(REJECTED);
    }
  });

  it('rejects a revoked session and an expired token', async () => {
    const { token, userId } = await login();
    await prisma.session.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
    expect((await authorizeConnection(auth, token, USER_ONLY)).ok).toBe(false);

    const old = new Date(Date.now() - 7_200_000);
    const session = await prisma.session.create({
      data: { userId, sessionVersion: 1, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const expired = await signUserToken(
      SECRET,
      { userId, sessionId: session.id, sessionVersion: 1 },
      old,
      60,
    );
    expect((await authorizeConnection(auth, expired, USER_ONLY)).ok).toBe(false);
  });

  it('rejects a stale session after a role change and after a block', async () => {
    const a = await login();
    await security.changeRole(a.userId, 'CREATOR');
    expect(await authorizeConnection(auth, a.token, { roles: ['USER', 'CREATOR'] })).toEqual(
      REJECTED,
    );

    const b = await login();
    expect((await authorizeConnection(auth, b.token, USER_ONLY)).ok).toBe(true);
    await security.blockUser(b.userId);
    expect(await authorizeConnection(auth, b.token, USER_ONLY)).toEqual(REJECTED);
  });

  it('rejects a blocked account even if its session row is still live', async () => {
    const { token, userId } = await login();
    await prisma.user.update({ where: { id: userId }, data: { status: 'BLOCKED' } });
    expect((await authorizeConnection(auth, token, USER_ONLY)).ok).toBe(false);
  });

  it('rejects an admin access token', async () => {
    const admin = await prisma.adminAccount.create({
      data: { username: 'conn.admin', passwordHash: 'unused' },
    });
    const session = await prisma.session.create({
      data: { adminId: admin.id, refreshTokenHash: 'h', expiresAt: new Date(Date.now() + 1e9) },
    });
    const adminToken = await signAccessToken(
      ADMIN_SECRET,
      { adminId: admin.id, sessionId: session.id },
      new Date(),
      900,
    );
    expect(await authorizeConnection(auth, adminToken, USER_ONLY)).toEqual(REJECTED);
  });
});
