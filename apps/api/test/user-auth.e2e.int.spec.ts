import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  landingPathForRole,
  MeResponseSchema,
  TelegramLoginResponseSchema,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers.js';

loadRootEnv();

/**
 * The Mini App's whole session over a real listening socket and real HTTP (not `inject`), the way
 * a browser on another origin would do it: CORS preflight, login, `/me`, a stale session after an
 * account change, and a fresh login. Identity is built exactly as Telegram signs it.
 */
const ORIGIN = 'http://localhost:5173';
const BOT = '123456:E2E-bot-token-not-real';

let t: TestApp;
let base: string;
let prisma: PrismaClient;
let redis: Redis;

const signed = (id: number, firstName: string) =>
  buildSignedInitData({
    botToken: BOT,
    user: { id, first_name: firstName },
    authDate: new Date(),
  });

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const get = (path: string, token: string) =>
  fetch(`${base}${path}`, { headers: { origin: ORIGIN, authorization: `Bearer ${token}` } });

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
  await resetDatabase(prisma);
  const keys = await redis.keys('test:user:login:*');
  if (keys.length > 0) await redis.del(...keys);
  t = await buildTestApp(
    loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL_TEST,
      REDIS_URL: process.env.REDIS_URL,
      ALLOWED_ORIGINS: ORIGIN,
      TELEGRAM_BOT_TOKEN: BOT,
      USER_SESSION_SECRET: 'e2e-user-secret-'.padEnd(48, 'u'),
    }),
  );
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = (await t.app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await t.app.close();
  await prisma.$disconnect();
  redis.disconnect();
});

describe('Mini App session over real HTTP', () => {
  it('logs in cross-origin, reads /me, loses the session on a role change, and signs in again', async () => {
    const preflight = await fetch(`${base}/v1/auth/telegram`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(preflight.status).toBeLessThan(300);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ORIGIN);

    const login = await post('/v1/auth/telegram', { init_data: signed(7001, 'Nadia') });
    expect(login.status).toBe(200);
    expect(login.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(login.headers.get('set-cookie')).toBeNull(); // a Bearer session: no cookies involved
    const session = TelegramLoginResponseSchema.parse(await login.json());
    expect(session.user.role).toBe('USER');

    const me = await get('/v1/me', session.access_token);
    expect(me.status).toBe(200);
    const profile = MeResponseSchema.parse(await me.json());
    expect(landingPathForRole(profile.role)).toBe('/chats');
    expect(profile.telegram_id).toBe('7001');

    // An admin approves the account as a creator: the role changes and old sessions are invalidated.
    await prisma.user.update({
      where: { id: profile.id },
      data: { role: 'CREATOR', sessionVersion: { increment: 1 } },
    });
    const stale = await get('/v1/me', session.access_token);
    expect(stale.status).toBe(401);
    expect(((await stale.json()) as { code: string }).code).toBe('UNAUTHENTICATED');

    // The Mini App re-exchanges initData and now lands on the creator inbox.
    const again = await post('/v1/auth/telegram', { init_data: signed(7001, 'Nadia') });
    const fresh = TelegramLoginResponseSchema.parse(await again.json());
    const meAgain = MeResponseSchema.parse(await (await get('/v1/me', fresh.access_token)).json());
    expect(meAgain.role).toBe('CREATOR');
    expect(landingPathForRole(meAgain.role)).toBe('/inbox');
    expect(meAgain.id).toBe(profile.id);
    expect(await prisma.user.count()).toBe(1);
  });

  it('rejects forged data from a foreign origin and never leaks the token in an error', async () => {
    const forged = new URLSearchParams(signed(7002, 'Mallory'));
    forged.set('hash', 'd'.repeat(64));
    const res = await post('/v1/auth/telegram', { init_data: forged.toString() });
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain(BOT);
    expect(text).not.toContain(forged.toString());
    expect(await prisma.user.count({ where: { telegramId: 7002n } })).toBe(0);
  });
});
