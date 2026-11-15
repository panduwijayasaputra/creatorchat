import { loadEnv } from '@creatorchat/backend-core';
import { ADMIN_COOKIE, AdminSessionResponseSchema } from '@creatorchat/contracts';
import { hashPassword, type PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers.js';

loadRootEnv();

/**
 * One full session over a real listening socket and real HTTP (not `inject`): login, `me`, refresh,
 * logout, replay of the old cookies. A tiny cookie jar plays the browser, honouring Path.
 */
const ORIGIN = 'http://localhost:5174';
const PASSWORD = 'a long enough password';

let t: TestApp;
let base: string;
let prisma: PrismaClient;
let redis: Redis;

interface StoredCookie {
  value: string;
  path: string;
}

class Browser {
  jar = new Map<string, StoredCookie>();

  private header(path: string): string {
    return [...this.jar.entries()]
      .filter(([, c]) => path.startsWith(c.path))
      .map(([name, c]) => `${name}=${c.value}`)
      .join('; ');
  }

  async fetch(method: string, path: string, body?: unknown, csrf = true): Promise<Response> {
    const headers: Record<string, string> = { origin: ORIGIN };
    const cookie = this.header(path);
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const token = this.jar.get(ADMIN_COOKIE.csrf)?.value;
    if (csrf && token && method !== 'GET') headers['x-csrf-token'] = token;
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair = '', ...attrs] = line.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const pathAttr = attrs.find((a) => a.toLowerCase().startsWith('path='))?.slice(5) ?? '/';
      if (value === '') this.jar.delete(name);
      else this.jar.set(name, { value, path: pathAttr });
    }
    return response;
  }
}

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
  await resetDatabase(prisma);
  const keys = await redis.keys('test:admin:login:*');
  if (keys.length > 0) await redis.del(...keys);
  await prisma.adminAccount.create({
    data: { username: 'e2e.admin', passwordHash: await hashPassword(PASSWORD) },
  });
  t = await buildTestApp(
    loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL_TEST,
      REDIS_URL: process.env.REDIS_URL,
      ALLOWED_ORIGINS: ORIGIN,
      ADMIN_ACCESS_TOKEN_SECRET: 'e2e-access-secret-'.padEnd(48, 'a'),
      ADMIN_REFRESH_TOKEN_SECRET: 'e2e-refresh-secret-'.padEnd(48, 'r'),
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

describe('admin session over real HTTP', () => {
  it('logs in, reads me, refreshes, logs out, and the old cookies stop working', async () => {
    const browser = new Browser();

    const login = await browser.fetch(
      'POST',
      '/v1/admin/auth/login',
      { username: 'e2e.admin', password: PASSWORD },
      false,
    );
    expect(login.status).toBe(200);
    expect(AdminSessionResponseSchema.parse(await login.json()).admin.username).toBe('e2e.admin');
    expect([...browser.jar.keys()].sort()).toEqual(
      [ADMIN_COOKIE.access, ADMIN_COOKIE.csrf, ADMIN_COOKIE.refresh].sort(),
    );

    expect((await browser.fetch('GET', '/v1/admin/auth/me')).status).toBe(200);

    const before = browser.jar.get(ADMIN_COOKIE.refresh)?.value;
    expect((await browser.fetch('POST', '/v1/admin/auth/refresh')).status).toBe(200);
    expect(browser.jar.get(ADMIN_COOKIE.refresh)?.value).not.toBe(before);
    expect((await browser.fetch('GET', '/v1/admin/auth/me')).status).toBe(200);

    // What an attacker who copied the cookies would hold.
    const stolen = new Map(browser.jar);

    expect((await browser.fetch('POST', '/v1/admin/auth/logout')).status).toBe(204);
    expect(browser.jar.size).toBe(0);
    expect((await browser.fetch('GET', '/v1/admin/auth/me')).status).toBe(401);

    const replay = new Browser();
    replay.jar = stolen;
    expect((await replay.fetch('GET', '/v1/admin/auth/me')).status).toBe(401);
    expect((await replay.fetch('POST', '/v1/admin/auth/refresh')).status).toBe(401);
  });

  it('only sends the refresh cookie to the auth routes', async () => {
    const browser = new Browser();
    await browser.fetch(
      'POST',
      '/v1/admin/auth/login',
      { username: 'e2e.admin', password: PASSWORD },
      false,
    );
    const refresh = browser.jar.get(ADMIN_COOKIE.refresh);
    expect(refresh?.path).toBe('/v1/admin/auth');
    expect(browser.jar.get(ADMIN_COOKIE.access)?.path).toBe('/v1/admin');
    // The helper applies Path matching like a browser: a non-auth admin path would not carry it.
    expect('/v1/admin/creators'.startsWith(refresh?.path ?? '')).toBe(false);
  });
});
