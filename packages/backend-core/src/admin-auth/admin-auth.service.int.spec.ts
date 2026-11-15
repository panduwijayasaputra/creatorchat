import { randomUUID } from 'node:crypto';
import { hashPassword, type PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdminAuthService, type IssuedTokens } from './admin-auth.service.js';
import { LoginLimiter, LoginLimiterUnavailableError } from './login-limiter.js';
import { signAccessToken } from './tokens.js';

loadRootEnv();

const ACCESS = 'access-secret-'.padEnd(48, 'a');
const REFRESH = 'refresh-secret-'.padEnd(48, 'r');
const PASSWORD = 'correct horse battery';

let prisma: PrismaClient;
let redis: Redis;
let prefix: string;
let clockMs: number;
let service: AdminAuthService;
let passwordHash: string;

const clock = () => new Date(clockMs);

function build(): AdminAuthService {
  return new AdminAuthService({
    prisma,
    limiter: new LoginLimiter(redis, prefix),
    config: { accessSecret: ACCESS, refreshSecret: REFRESH },
    clock,
  });
}

async function newAdmin(username = 'nadia.admin', status: 'ACTIVE' | 'DISABLED' = 'ACTIVE') {
  return prisma.adminAccount.create({ data: { username, passwordHash, status } });
}

async function loginOk(username = 'nadia.admin'): Promise<IssuedTokens> {
  const result = await service.login({ username, password: PASSWORD }, { requestId: 'req-login' });
  if (!result.ok) throw new Error(`login failed: ${result.reason}`);
  return result.tokens;
}

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 1 });
  passwordHash = await hashPassword(PASSWORD);
});

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  prefix = `test:${randomUUID()}:login`;
  clockMs = Date.parse('2026-11-15T10:00:00Z');
  service = build();
});

describe('login', () => {
  it('returns the admin profile and tokens, and stores only a hash of the refresh token', async () => {
    const admin = await newAdmin();
    const result = await service.login({ username: ' Nadia.Admin ', password: PASSWORD });
    if (!result.ok) throw new Error('expected success');
    expect(result.admin).toEqual({ id: admin.id, username: 'nadia.admin', role: 'Administrator' });
    const session = await prisma.session.findUniqueOrThrow({
      where: { id: result.tokens.sessionId },
    });
    expect(session.adminId).toBe(admin.id);
    expect(session.userId).toBeNull();
    expect(session.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(session)).not.toContain(result.tokens.refreshToken);
    expect(session.expiresAt.getTime()).toBe(clockMs + 7 * 86400 * 1000);
  });

  it('counts wrong passwords 1..4 and locks on the 5th, and a locked account rejects the right password', async () => {
    await newAdmin();
    const attempts = [];
    for (let i = 0; i < 4; i += 1) {
      attempts.push(await service.login({ username: 'nadia.admin', password: 'wrong' }));
    }
    expect(attempts).toEqual(
      [1, 2, 3, 4].map((n) => ({ ok: false, reason: 'invalid', attempts: n })),
    );
    expect(await service.login({ username: 'nadia.admin', password: 'wrong' })).toEqual({
      ok: false,
      reason: 'locked',
      retryAfterSeconds: 900,
    });
    const locked = await service.login({ username: 'nadia.admin', password: PASSWORD });
    expect(locked).toMatchObject({ ok: false, reason: 'locked' });
    expect(await prisma.session.count()).toBe(0);
  });

  it('a successful login resets the failure counter', async () => {
    await newAdmin();
    await service.login({ username: 'nadia.admin', password: 'wrong' });
    await service.login({ username: 'nadia.admin', password: 'wrong' });
    await loginOk();
    expect(await service.login({ username: 'nadia.admin', password: 'wrong' })).toMatchObject({
      reason: 'invalid',
      attempts: 1,
    });
  });

  it('treats an unknown username exactly like a wrong password, including the lock', async () => {
    await newAdmin();
    const known = [];
    const unknown = [];
    for (let i = 0; i < 5; i += 1) {
      known.push(await service.login({ username: 'nadia.admin', password: 'wrong' }));
      unknown.push(await service.login({ username: 'nobody.here', password: 'wrong' }));
    }
    expect(unknown).toEqual(known);
  });

  it('does not let a disabled admin in, even with the right password, and shows the same failure', async () => {
    await newAdmin('off.admin', 'DISABLED');
    const result = await service.login({ username: 'off.admin', password: PASSWORD });
    expect(result).toEqual({ ok: false, reason: 'invalid', attempts: 1 });
    expect(await prisma.session.count()).toBe(0);
  });

  it('keeps counters per username', async () => {
    await newAdmin('one.admin');
    await newAdmin('two.admin');
    for (let i = 0; i < 5; i += 1) await service.login({ username: 'one.admin', password: 'x' });
    const other = await service.login({ username: 'two.admin', password: PASSWORD });
    expect(other.ok).toBe(true);
  });

  it('rate-limits one IP that fails across many usernames', async () => {
    await newAdmin();
    for (let i = 0; i < 30; i += 1) {
      await service.login({ username: `ghost${i}`, password: 'x' }, { ip: '10.0.0.7' });
    }
    const blocked = await service.login(
      { username: 'nadia.admin', password: PASSWORD },
      { ip: '10.0.0.7' },
    );
    expect(blocked).toMatchObject({ ok: false, reason: 'rate_limited' });
    const elsewhere = await service.login(
      { username: 'nadia.admin', password: PASSWORD },
      { ip: '10.0.0.8' },
    );
    expect(elsewhere.ok).toBe(true);
  });

  it('fails closed when Redis is unreachable', async () => {
    await newAdmin();
    const dead = new Redis('redis://127.0.0.1:1', {
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    dead.on('error', () => undefined);
    const blind = new AdminAuthService({
      prisma,
      limiter: new LoginLimiter(dead, prefix),
      config: { accessSecret: ACCESS, refreshSecret: REFRESH },
      clock,
    });
    await expect(
      blind.login({ username: 'nadia.admin', password: PASSWORD }),
    ).rejects.toBeInstanceOf(LoginLimiterUnavailableError);
    dead.disconnect();
    expect(await prisma.session.count()).toBe(0);
  });

  it('refuses to start with missing, short or identical secrets', () => {
    const base = { prisma, limiter: new LoginLimiter(redis, prefix) };
    expect(
      () =>
        new AdminAuthService({
          ...base,
          config: { accessSecret: 'short', refreshSecret: REFRESH },
        }),
    ).toThrow();
    expect(
      () =>
        new AdminAuthService({ ...base, config: { accessSecret: ACCESS, refreshSecret: ACCESS } }),
    ).toThrow();
  });
});

describe('refresh', () => {
  it('rotates the token, keeps the same session and returns a working access token', async () => {
    await newAdmin();
    const first = await loginOk();
    clockMs += 60_000;
    const result = await service.refresh(first.refreshToken);
    if (!result.ok) throw new Error('expected success');
    expect(result.tokens.sessionId).toBe(first.sessionId);
    expect(result.tokens.refreshToken).not.toBe(first.refreshToken);
    expect(await service.authenticate(result.tokens.accessToken)).toMatchObject({
      sessionId: first.sessionId,
    });
    const row = await prisma.session.findUniqueOrThrow({ where: { id: first.sessionId } });
    expect(row.previousRefreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.rotatedAt?.getTime()).toBe(clockMs);
  });

  it('treats the previous token inside the grace window as a race and leaves the session alive', async () => {
    await newAdmin();
    const first = await loginOk();
    const second = await service.refresh(first.refreshToken);
    if (!second.ok) throw new Error('expected success');
    clockMs += 5_000;
    expect(await service.refresh(first.refreshToken)).toEqual({ ok: false, reason: 'race' });
    expect((await service.refresh(second.tokens.refreshToken)).ok).toBe(true);
  });

  it('revokes the session when a rotated token is reused after the grace window', async () => {
    await newAdmin();
    const first = await loginOk();
    const second = await service.refresh(first.refreshToken);
    if (!second.ok) throw new Error('expected success');
    clockMs += 11_000;
    expect(await service.refresh(first.refreshToken, { requestId: 'req-reuse' })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    // The legitimate holder of the newest token is cut off too.
    expect(await service.refresh(second.tokens.refreshToken)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(await service.authenticate(second.tokens.accessToken)).toBeNull();
    const audit = await prisma.auditLog.findMany({
      where: { action: 'admin.refresh.reuse_detected' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.requestId).toBe('req-reuse');
  });

  it('lets exactly one of two concurrent refreshes with the same token win', async () => {
    await newAdmin();
    const first = await loginOk();
    const results = await Promise.all([
      service.refresh(first.refreshToken),
      service.refresh(first.refreshToken),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it('rejects an unknown token', async () => {
    await newAdmin();
    expect(await service.refresh('x'.repeat(43))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects an idle-expired session', async () => {
    await newAdmin();
    const first = await loginOk();
    clockMs += 7 * 86400 * 1000 + 1000;
    expect(await service.refresh(first.refreshToken)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('stops renewing at the 30-day absolute cap even when used every few days', async () => {
    await newAdmin();
    let token = (await loginOk()).refreshToken;
    for (let day = 5; day <= 25; day += 5) {
      clockMs = Date.parse('2026-11-15T10:00:00Z') + day * 86400 * 1000;
      const r = await service.refresh(token);
      if (!r.ok) throw new Error(`day ${day} should refresh`);
      token = r.tokens.refreshToken;
    }
    clockMs = Date.parse('2026-11-15T10:00:00Z') + 29 * 86400 * 1000;
    const nearCap = await service.refresh(token);
    if (!nearCap.ok) throw new Error('day 29 should refresh');
    // Idle expiry is clamped to the absolute cap (day 30).
    expect(nearCap.tokens.refreshExpiresAt.getTime()).toBe(
      Date.parse('2026-11-15T10:00:00Z') + 30 * 86400 * 1000,
    );
    clockMs = Date.parse('2026-11-15T10:00:00Z') + 30 * 86400 * 1000 + 1000;
    expect(await service.refresh(nearCap.tokens.refreshToken)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('refuses a disabled admin and closes the session', async () => {
    const admin = await newAdmin();
    const first = await loginOk();
    await prisma.adminAccount.update({ where: { id: admin.id }, data: { status: 'DISABLED' } });
    expect(await service.refresh(first.refreshToken)).toEqual({ ok: false, reason: 'invalid' });
    const row = await prisma.session.findUniqueOrThrow({ where: { id: first.sessionId } });
    expect(row.revokedAt).not.toBeNull();
  });
});

describe('authenticate', () => {
  it('accepts a live session and rejects once it is logged out', async () => {
    const admin = await newAdmin();
    const tokens = await loginOk();
    expect(await service.authenticate(tokens.accessToken)).toEqual({
      admin: { id: admin.id, username: 'nadia.admin', role: 'Administrator' },
      sessionId: tokens.sessionId,
    });
    await service.logout({ sessionId: tokens.sessionId });
    expect(await service.authenticate(tokens.accessToken)).toBeNull();
  });

  it('rejects after the access TTL', async () => {
    await newAdmin();
    const tokens = await loginOk();
    clockMs += 15 * 60 * 1000 + 1000;
    expect(await service.authenticate(tokens.accessToken)).toBeNull();
  });

  it('rejects a valid token as soon as the admin is disabled', async () => {
    const admin = await newAdmin();
    const tokens = await loginOk();
    await prisma.adminAccount.update({ where: { id: admin.id }, data: { status: 'DISABLED' } });
    expect(await service.authenticate(tokens.accessToken)).toBeNull();
  });

  it('rejects a token signed with another secret', async () => {
    const admin = await newAdmin();
    const tokens = await loginOk();
    const forged = await signAccessToken(
      'user-session-secret-'.padEnd(48, 'u'),
      { adminId: admin.id, sessionId: tokens.sessionId },
      clock(),
      900,
    );
    expect(await service.authenticate(forged)).toBeNull();
  });

  it('rejects a token whose session belongs to a Telegram user', async () => {
    const admin = await newAdmin();
    const user = await prisma.user.create({ data: { telegramId: 777n, displayName: 'Citra' } });
    const userSession = await prisma.session.create({
      data: {
        userId: user.id,
        sessionVersion: 1,
        refreshTokenHash: 'user-hash',
        expiresAt: new Date(clockMs + 1e9),
      },
    });
    // Even signed with the admin secret, a token pointing at a user's session must not pass.
    const forgedForUser = await signAccessToken(
      ACCESS,
      { adminId: admin.id, sessionId: userSession.id },
      clock(),
      900,
    );
    expect(await service.authenticate(forgedForUser)).toBeNull();
  });

  it('rejects a token whose session belongs to a different admin', async () => {
    const one = await newAdmin('one.admin');
    await newAdmin('two.admin');
    const two = await loginOk('two.admin');
    const forged = await signAccessToken(
      ACCESS,
      { adminId: one.id, sessionId: two.sessionId },
      clock(),
      900,
    );
    expect(await service.authenticate(forged)).toBeNull();
  });
});

describe('logout', () => {
  it('revokes by session id, is idempotent and audits once', async () => {
    await newAdmin();
    const tokens = await loginOk();
    await service.logout({ sessionId: tokens.sessionId }, { requestId: 'req-out' });
    await service.logout({ sessionId: tokens.sessionId }, { requestId: 'req-out-2' });
    expect(await prisma.auditLog.count({ where: { action: 'admin.logout' } })).toBe(1);
    expect(await service.refresh(tokens.refreshToken)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('can log out with only the refresh token (access token already expired)', async () => {
    await newAdmin();
    const tokens = await loginOk();
    await service.logout({ refreshToken: tokens.refreshToken });
    const row = await prisma.session.findUniqueOrThrow({ where: { id: tokens.sessionId } });
    expect(row.revokedAt).not.toBeNull();
  });

  it('ignores unknown tokens and never touches a Telegram user session', async () => {
    await newAdmin();
    const user = await prisma.user.create({ data: { telegramId: 778n, displayName: 'Raka' } });
    const userSession = await prisma.session.create({
      data: {
        userId: user.id,
        sessionVersion: 1,
        refreshTokenHash: 'uh',
        expiresAt: new Date(clockMs + 1e9),
      },
    });
    await service.logout({ refreshToken: 'nope' });
    await service.logout({ sessionId: userSession.id });
    const row = await prisma.session.findUniqueOrThrow({ where: { id: userSession.id } });
    expect(row.revokedAt).toBeNull();
  });
});

describe('audit trail', () => {
  it('records success, failure, lock and logout without secrets or the raw unknown username', async () => {
    await newAdmin();
    const tokens = await loginOk();
    await service.logout({ sessionId: tokens.sessionId });
    for (let i = 0; i < 5; i += 1) {
      await service.login(
        { username: 'nadia.admin', password: 'WrongPass-123' },
        { requestId: 'req-x' },
      );
    }
    await service.login({ username: 'secret.ghost', password: 'GhostPass-456' });

    const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'admin.login.succeeded',
        'admin.logout',
        'admin.login.failed',
        'admin.login.locked',
      ]),
    );
    const text = JSON.stringify(rows);
    for (const secret of [
      PASSWORD,
      'WrongPass-123',
      'GhostPass-456',
      tokens.refreshToken,
      tokens.accessToken,
      'secret.ghost',
    ]) {
      expect(text).not.toContain(secret);
    }
    const failed = rows.find((r) => r.action === 'admin.login.failed');
    expect(failed?.requestId).toBe('req-x');
    expect(failed?.changes).toMatchObject({ attempt: 1 });
  });
});
