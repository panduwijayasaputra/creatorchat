import {
  Controller,
  Get,
  Module,
  Post,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { loadEnv } from '@creatorchat/backend-core';
import {
  ADMIN_COOKIE,
  AdminSessionResponseSchema,
  ErrorResponseSchema,
} from '@creatorchat/contracts';
import { hashPassword, type PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdminAuthModule } from '../src/admin/admin-auth/admin-auth.module.js';
import { AdminJwtGuard } from '../src/common/auth/admin-jwt.guard.js';
import { CsrfGuard } from '../src/common/auth/csrf.guard.js';
import { buildTestApp, type TestApp } from './helpers.js';

loadRootEnv();

const ORIGIN = 'http://localhost:5174';
const PASSWORD = 'correct horse battery';
const ACCESS = 'access-secret-'.padEnd(48, 'a');
const REFRESH = 'refresh-secret-'.padEnd(48, 'r');

/** Throwaway admin-scoped routes: proves the guards protect any /v1/admin/* controller. */
@Controller('admin/probe')
@UseGuards(CsrfGuard, AdminJwtGuard)
class ProbeController {
  @Get()
  read() {
    return { ok: true };
  }
  @Post()
  write() {
    return { ok: true };
  }
}
@Module({ imports: [AdminAuthModule], controllers: [ProbeController] })
class ProbeModule {}

/** Stand-in for the future Telegram user guard: it verifies against a different secret. */
class StubUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest<{ headers: Record<string, string> }>()
      .headers.authorization;
    return header === 'Bearer valid-user-session';
  }
}
@Controller('user-stub')
@UseGuards(StubUserGuard)
class UserStubController {
  @Get()
  read() {
    return { ok: true };
  }
}
@Module({ controllers: [UserStubController] })
class UserStubModule {}

function envWith(overrides: Record<string, string> = {}) {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL_TEST,
    REDIS_URL: process.env.REDIS_URL,
    ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`,
    ADMIN_ACCESS_TOKEN_SECRET: ACCESS,
    ADMIN_REFRESH_TOKEN_SECRET: REFRESH,
    COOKIE_SECURE: 'false',
    COOKIE_SAMESITE: 'lax',
    ...overrides,
  });
}

let t: TestApp;
let prisma: PrismaClient;
let redis: Redis;
let passwordHash: string;

interface Cookie {
  name: string;
  value: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  expires?: Date;
  maxAge?: number;
}

type Jar = Record<string, string>;

function jarFrom(cookies: Cookie[], into: Jar = {}): Jar {
  for (const c of cookies) {
    if (c.value === '') delete into[c.name];
    else into[c.name] = c.value;
  }
  return into;
}

const cookieHeader = (jar: Jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

function inject(
  method: 'GET' | 'POST',
  url: string,
  opts: {
    jar?: Jar;
    body?: unknown;
    origin?: string | null;
    csrf?: string | null;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = { ...opts.headers };
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.origin = origin;
  const csrf = opts.csrf === undefined ? opts.jar?.[ADMIN_COOKIE.csrf] : opts.csrf;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (opts.jar && Object.keys(opts.jar).length > 0) headers.cookie = cookieHeader(opts.jar);
  return t.app.inject({
    method,
    url,
    headers,
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
}

const login = (username = 'nadia.admin', password = PASSWORD, origin?: string | null) =>
  inject('POST', '/v1/admin/auth/login', { body: { username, password }, origin });

async function signIn(): Promise<Jar> {
  const res = await login();
  expect(res.statusCode).toBe(200);
  return jarFrom(res.cookies as Cookie[]);
}

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
  passwordHash = await hashPassword(PASSWORD);
  t = await buildTestApp(envWith(), [ProbeModule, UserStubModule]);
});

afterAll(async () => {
  await t.app.close();
  await prisma.$disconnect();
  redis.disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  const keys = await redis.keys('test:admin:login:*');
  if (keys.length > 0) await redis.del(...keys);
  await prisma.adminAccount.create({ data: { username: 'nadia.admin', passwordHash } });
});

describe('POST /v1/admin/auth/login', () => {
  it('signs in, returns only the admin profile and sets three correctly scoped cookies', async () => {
    const res = await login();
    expect(res.statusCode).toBe(200);
    const body = AdminSessionResponseSchema.parse(res.json());
    expect(body.admin).toMatchObject({ username: 'nadia.admin', role: 'Administrator' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBeTruthy();

    const cookies = res.cookies as Cookie[];
    const at = cookies.find((c) => c.name === ADMIN_COOKIE.access);
    const rt = cookies.find((c) => c.name === ADMIN_COOKIE.refresh);
    const csrf = cookies.find((c) => c.name === ADMIN_COOKIE.csrf);
    expect(at).toMatchObject({ path: '/v1/admin', httpOnly: true, sameSite: 'Lax' });
    expect(rt).toMatchObject({ path: '/v1/admin/auth', httpOnly: true, sameSite: 'Lax' });
    expect(csrf?.path).toBe('/');
    expect(csrf?.httpOnly).toBeFalsy();
    expect(at?.secure).toBeFalsy(); // COOKIE_SECURE=false in this env
    expect(res.body).not.toContain(at?.value as string);
    expect(res.body).not.toContain(rt?.value as string);
    expect(res.body.toLowerCase()).not.toContain('hash');
  });

  it('marks cookies Secure and keeps the configured SameSite when the env says so', async () => {
    const strict = await buildTestApp(
      envWith({ COOKIE_SECURE: 'true', COOKIE_SAMESITE: 'strict' }),
    );
    const res = await strict.app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      headers: { origin: ORIGIN },
      payload: { username: 'nadia.admin', password: PASSWORD },
    });
    for (const c of res.cookies as Cookie[]) {
      expect(c.secure).toBe(true);
      expect(c.sameSite).toBe('Strict');
    }
    await strict.app.close();
  });

  it('answers wrong password and unknown username with the same body shape, counting attempts', async () => {
    const wrong = await login('nadia.admin', 'nope');
    const unknown = await login('ghost.user', 'nope');
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    const strip = (r: typeof wrong) => {
      const { request_id: _id, ...rest } = ErrorResponseSchema.parse(r.json());
      return rest;
    };
    expect(strip(wrong)).toEqual(strip(unknown));
    expect(strip(wrong)).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      details: { attempts: 1, max: 5 },
    });
    expect(wrong.cookies).toHaveLength(0);
  });

  it('locks after 5 failures with Retry-After, and the correct password no longer works', async () => {
    for (let i = 1; i <= 4; i += 1) {
      const r = await login('nadia.admin', 'nope');
      expect(r.json().details.attempts).toBe(i);
    }
    const fifth = await login('nadia.admin', 'nope');
    expect(fifth.statusCode).toBe(429);
    expect(fifth.json()).toMatchObject({
      code: 'LOGIN_LOCKED',
      details: { retry_after_seconds: 900 },
    });
    expect(fifth.headers['retry-after']).toBe('900');

    const correct = await login();
    expect(correct.statusCode).toBe(429);
    expect(correct.cookies).toHaveLength(0);
    expect(await prisma.session.count()).toBe(0);
  });

  it('validates the body with the designed messages', async () => {
    const res = await inject('POST', '/v1/admin/auth/login', {
      body: { username: '', password: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().details).toEqual([
      { path: 'username', message: 'Username wajib diisi.' },
      { path: 'password', message: 'Password wajib diisi.' },
    ]);
  });

  it('rejects a login from a foreign or missing Origin before looking at credentials', async () => {
    for (const origin of ['https://evil.example', null]) {
      const res = await login('nadia.admin', PASSWORD, origin);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('CSRF_FAILED');
    }
    expect(await prisma.session.count()).toBe(0);
  });

  it('answers 503 and keeps the API up when the admin secrets are not configured', async () => {
    const bare = await buildTestApp(
      envWith({ ADMIN_ACCESS_TOKEN_SECRET: '', ADMIN_REFRESH_TOKEN_SECRET: '' }),
    );
    const res = await bare.app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      headers: { origin: ORIGIN },
      payload: { username: 'nadia.admin', password: PASSWORD },
    });
    expect(res.statusCode).toBe(503);
    const health = await bare.app.inject({ method: 'GET', url: '/v1/health' });
    expect(health.statusCode).toBe(200);
    await bare.app.close();
  });

  it('fails closed with 503 when Redis is unreachable', async () => {
    const blind = await buildTestApp(envWith({ REDIS_URL: 'redis://127.0.0.1:1' }));
    const res = await blind.app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      headers: { origin: ORIGIN },
      payload: { username: 'nadia.admin', password: PASSWORD },
    });
    expect(res.statusCode).toBe(503);
    expect(res.cookies).toHaveLength(0);
    await blind.app.close();
  });

  it('does not log the password or tokens', async () => {
    const jar = await signIn();
    await login('nadia.admin', 'a-wrong-password-9');
    const logs = t.rawLogs();
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toContain('a-wrong-password-9');
    for (const value of Object.values(jar)) expect(logs).not.toContain(value);
  });
});

describe('GET /v1/admin/auth/me and the guard', () => {
  it('returns the admin loaded from the database for a signed-in session', async () => {
    const jar = await signIn();
    const res = await inject('GET', '/v1/admin/auth/me', { jar });
    expect(res.statusCode).toBe(200);
    expect(AdminSessionResponseSchema.parse(res.json()).admin.username).toBe('nadia.admin');
  });

  it('rejects requests without a session, with a garbage token, and with a bearer header', async () => {
    expect((await inject('GET', '/v1/admin/auth/me')).statusCode).toBe(401);
    expect(
      (await inject('GET', '/v1/admin/auth/me', { jar: { [ADMIN_COOKIE.access]: 'garbage' } }))
        .statusCode,
    ).toBe(401);
    const jar = await signIn();
    const viaHeader = await inject('GET', '/v1/admin/auth/me', {
      headers: { authorization: `Bearer ${jar[ADMIN_COOKIE.access]}` },
    });
    expect(viaHeader.statusCode).toBe(401);
  });

  it('protects any controller mounted under /v1/admin and keeps unknown paths a plain 404', async () => {
    expect((await inject('GET', '/v1/admin/probe')).statusCode).toBe(401);
    const jar = await signIn();
    expect((await inject('GET', '/v1/admin/probe', { jar })).statusCode).toBe(200);
    expect((await inject('GET', '/v1/admin/nothing-here')).statusCode).toBe(404);
    expect((await inject('GET', '/v1/admin/nothing-here', { jar })).statusCode).toBe(404);
  });

  it('has no registration or account-creation route', async () => {
    const jar = await signIn();
    for (const url of ['/v1/admin/auth/register', '/v1/admin/accounts', '/v1/admin/auth/signup']) {
      const res = await inject('POST', url, {
        jar,
        body: { username: 'new.admin', password: 'x' },
      });
      expect(res.statusCode).toBe(404);
    }
    expect(await prisma.adminAccount.count()).toBe(1);
  });

  it('rejects a token for a session that was disabled in the meantime', async () => {
    const jar = await signIn();
    await prisma.adminAccount.updateMany({ data: { status: 'DISABLED' } });
    expect((await inject('GET', '/v1/admin/auth/me', { jar })).statusCode).toBe(401);
    expect((await inject('POST', '/v1/admin/auth/refresh', { jar })).statusCode).toBe(401);
    expect((await login()).statusCode).toBe(401);
  });
});

describe('CSRF protection', () => {
  it('rejects unsafe requests without the token, with a wrong token, or from a foreign origin', async () => {
    const jar = await signIn();
    const cases = [
      { csrf: null, origin: ORIGIN },
      { csrf: 'wrong-token', origin: ORIGIN },
      { csrf: jar[ADMIN_COOKIE.csrf], origin: 'https://evil.example' },
      { csrf: jar[ADMIN_COOKIE.csrf], origin: null },
    ];
    for (const c of cases) {
      const res = await inject('POST', '/v1/admin/probe', { jar, csrf: c.csrf, origin: c.origin });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('CSRF_FAILED');
    }
    const ok = await inject('POST', '/v1/admin/probe', { jar });
    expect(ok.statusCode).toBe(201);
  });

  it('does not require the token for safe methods', async () => {
    const jar = await signIn();
    expect(
      (await inject('GET', '/v1/admin/probe', { jar, csrf: null, origin: null })).statusCode,
    ).toBe(200);
  });

  it('protects refresh and logout the same way', async () => {
    const jar = await signIn();
    expect((await inject('POST', '/v1/admin/auth/refresh', { jar, csrf: null })).statusCode).toBe(
      403,
    );
    expect((await inject('POST', '/v1/admin/auth/logout', { jar, csrf: null })).statusCode).toBe(
      403,
    );
    // A failed CSRF check never revokes anything.
    expect((await inject('GET', '/v1/admin/auth/me', { jar })).statusCode).toBe(200);
  });
});

describe('POST /v1/admin/auth/refresh', () => {
  it('rotates cookies and the old refresh token stops working', async () => {
    const first = await signIn();
    const res = await inject('POST', '/v1/admin/auth/refresh', { jar: first });
    expect(res.statusCode).toBe(200);
    const second = jarFrom(res.cookies as Cookie[], { ...first });
    expect(second[ADMIN_COOKIE.refresh]).not.toBe(first[ADMIN_COOKIE.refresh]);
    expect((await inject('GET', '/v1/admin/auth/me', { jar: second })).statusCode).toBe(200);

    // The browser dropped the access cookie when it expired; refresh then restores it.
    const withoutAccess = { ...second };
    delete withoutAccess[ADMIN_COOKIE.access];
    expect((await inject('GET', '/v1/admin/auth/me', { jar: withoutAccess })).statusCode).toBe(401);
    const again = await inject('POST', '/v1/admin/auth/refresh', { jar: withoutAccess });
    expect(again.statusCode).toBe(200);
  });

  it('leaves the cookies alone for a racing tab, and revokes everything on later reuse', async () => {
    const first = await signIn();
    const rotated = await inject('POST', '/v1/admin/auth/refresh', { jar: first });
    const second = jarFrom(rotated.cookies as Cookie[], { ...first });

    const race = await inject('POST', '/v1/admin/auth/refresh', { jar: first });
    expect(race.statusCode).toBe(401);
    expect(race.cookies).toHaveLength(0);

    // Pretend the rotation happened a minute ago, then present the old token again.
    await prisma.session.updateMany({ data: { rotatedAt: new Date(Date.now() - 60_000) } });
    const reuse = await inject('POST', '/v1/admin/auth/refresh', { jar: first });
    expect(reuse.statusCode).toBe(401);
    expect((reuse.cookies as Cookie[]).map((c) => c.name).sort()).toEqual(
      [ADMIN_COOKIE.access, ADMIN_COOKIE.csrf, ADMIN_COOKIE.refresh].sort(),
    );
    expect((await inject('GET', '/v1/admin/auth/me', { jar: second })).statusCode).toBe(401);
    expect((await inject('POST', '/v1/admin/auth/refresh', { jar: second })).statusCode).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'admin.refresh.reuse_detected' } })).toBe(
      1,
    );
  });

  it('answers 401 and clears cookies when the refresh cookie is missing', async () => {
    const jar = await signIn();
    delete jar[ADMIN_COOKIE.refresh];
    const res = await inject('POST', '/v1/admin/auth/refresh', { jar });
    expect(res.statusCode).toBe(401);
    expect(res.cookies).toHaveLength(3);
  });
});

describe('POST /v1/admin/auth/logout', () => {
  it('revokes the session, clears the cookies and kills the old tokens', async () => {
    const jar = await signIn();
    const res = await inject('POST', '/v1/admin/auth/logout', { jar });
    expect(res.statusCode).toBe(204);
    expect((res.cookies as Cookie[]).map((c) => c.name).sort()).toEqual(
      [ADMIN_COOKIE.access, ADMIN_COOKIE.csrf, ADMIN_COOKIE.refresh].sort(),
    );
    for (const c of res.cookies as Cookie[]) {
      expect(c.value).toBe('');
      expect(c.expires && c.expires.getTime() <= Date.now()).toBe(true);
    }
    // The old cookies, replayed by someone who copied them:
    expect((await inject('GET', '/v1/admin/auth/me', { jar })).statusCode).toBe(401);
    expect((await inject('GET', '/v1/admin/probe', { jar })).statusCode).toBe(401);
    expect((await inject('POST', '/v1/admin/auth/refresh', { jar })).statusCode).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'admin.logout' } })).toBe(1);
  });

  it('works with only the refresh cookie (access token already expired) and is idempotent', async () => {
    const jar = await signIn();
    delete jar[ADMIN_COOKIE.access];
    expect((await inject('POST', '/v1/admin/auth/logout', { jar })).statusCode).toBe(204);
    expect((await inject('POST', '/v1/admin/auth/logout', { jar })).statusCode).toBe(204);
    expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'admin.logout' } })).toBe(1);
  });

  it("only closes the caller's own session", async () => {
    const mine = await signIn();
    const other = await signIn();
    await inject('POST', '/v1/admin/auth/logout', { jar: mine });
    expect((await inject('GET', '/v1/admin/auth/me', { jar: other })).statusCode).toBe(200);
  });
});

describe('admin / Telegram-user separation', () => {
  it('does not accept a token signed with another secret, or one pointing at a user session', async () => {
    const jar = await signIn();
    const { SignJWT } = await import('jose');
    const admin = await prisma.adminAccount.findFirstOrThrow();
    const user = await prisma.user.create({ data: { telegramId: 4242n, displayName: 'Citra' } });
    const userSession = await prisma.session.create({
      data: {
        userId: user.id,
        sessionVersion: 1,
        refreshTokenHash: 'user-session-hash',
        expiresAt: new Date(Date.now() + 1e9),
      },
    });
    const sign = (secret: string, sid: string) =>
      new SignJWT({ sid, typ: 'admin' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(admin.id)
        .setIssuer('creatorchat')
        .setAudience('admin-api')
        .setExpirationTime('10m')
        .sign(new TextEncoder().encode(secret));

    const userSecretToken = await sign('user-session-secret-'.padEnd(48, 'u'), userSession.id);
    const adminSecretUserSession = await sign(ACCESS, userSession.id);
    for (const token of [userSecretToken, adminSecretUserSession]) {
      const res = await inject('GET', '/v1/admin/probe', {
        jar: { ...jar, [ADMIN_COOKIE.access]: token },
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('an admin access token cannot act as a Telegram user', async () => {
    const jar = await signIn();
    const res = await inject('GET', '/v1/user-stub', {
      headers: { authorization: `Bearer ${jar[ADMIN_COOKIE.access]}` },
    });
    expect(res.statusCode).toBe(403); // the stub guard refuses it (Nest maps a false guard to 403)
    const asCookie = await inject('GET', '/v1/user-stub', { jar });
    expect(asCookie.statusCode).toBe(403);
  });
});

describe('audit trail over HTTP', () => {
  it('writes login, failure, lock and logout rows with the request id and no secrets', async () => {
    const ok = await inject('POST', '/v1/admin/auth/login', {
      body: { username: 'nadia.admin', password: PASSWORD },
      headers: { 'x-request-id': 'req-audit-login-1' },
    });
    const jar = jarFrom(ok.cookies as Cookie[]);
    await inject('POST', '/v1/admin/auth/logout', { jar });
    for (let i = 0; i < 5; i += 1) await login('nadia.admin', 'Wrong-Password-77');

    const rows = await prisma.auditLog.findMany();
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'admin.login.succeeded',
        'admin.logout',
        'admin.login.failed',
        'admin.login.locked',
      ]),
    );
    expect(rows.find((r) => r.action === 'admin.login.succeeded')?.requestId).toBe(
      'req-audit-login-1',
    );
    const text = JSON.stringify(rows);
    for (const secret of [PASSWORD, 'Wrong-Password-77', ...Object.values(jar)]) {
      expect(text).not.toContain(secret);
    }
  });
});
