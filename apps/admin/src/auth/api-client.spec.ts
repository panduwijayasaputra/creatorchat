import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, createAdminApi } from './api-client';

const ADMIN = {
  id: '3f2b8c1e-5d4a-4b7e-9c1a-2d3e4f5a6b7c',
  username: 'nadia.admin',
  role: 'Administrator',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = () => json(200, { admin: ADMIN });
const error = (status: number, code: string, details?: unknown) =>
  json(status, { code, message: 'x', request_id: 'req-1', ...(details ? { details } : {}) });

type Call = { method: string; url: string; headers: Record<string, string>; body?: string };

function setup(
  responses: Array<Response | Error | (() => Response | Promise<Response>)>,
  csrf: string | null = 'csrf-123',
) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    });
    expect(init?.credentials).toBe('same-origin');
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra request');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  }) as unknown as typeof fetch;
  const api = createAdminApi({
    fetchImpl,
    readCookie: (name) => (name === 'cc_admin_csrf' ? (csrf ?? undefined) : undefined),
  });
  return { api, calls };
}

afterEach(() => vi.restoreAllMocks());

describe('admin API client', () => {
  it('logs in with a JSON body, the CSRF header from the cookie, and returns the admin', async () => {
    const { api, calls } = setup([ok()]);
    await expect(api.login({ username: 'nadia.admin', password: 'secret-pass' })).resolves.toEqual(
      ADMIN,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      body: JSON.stringify({ username: 'nadia.admin', password: 'secret-pass' }),
    });
    expect(calls[0]?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-123',
    });
  });

  it('sends no CSRF header on GET and none when the cookie is absent', async () => {
    const { api, calls } = setup([ok()]);
    await api.me();
    expect(calls[0]?.headers['x-csrf-token']).toBeUndefined();
    const second = setup([ok()], null);
    await second.api.login({ username: 'a', password: 'b' });
    expect(second.calls[0]?.headers['x-csrf-token']).toBeUndefined();
  });

  it('surfaces wrong credentials as ApiError with details, without refreshing or losing the session', async () => {
    const { api, calls } = setup([error(401, 'INVALID_CREDENTIALS', { attempts: 2, max: 5 })]);
    const lost = vi.fn();
    api.onSessionLost(lost);
    const failure = await api.login({ username: 'a', password: 'b' }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      details: { attempts: 2, max: 5 },
    });
    expect(calls).toHaveLength(1);
    expect(lost).not.toHaveBeenCalled();
  });

  it('turns a failed fetch into NetworkError', async () => {
    const { api } = setup([new TypeError('Failed to fetch')]);
    await expect(api.login({ username: 'a', password: 'b' })).rejects.toBeInstanceOf(NetworkError);
  });

  it('refreshes once on 401 and retries the original request', async () => {
    const { api, calls } = setup([
      error(401, 'UNAUTHENTICATED'),
      json(200, { admin: ADMIN }),
      ok(),
    ]);
    await expect(api.me()).resolves.toEqual(ADMIN);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /v1/admin/auth/me',
      'POST /v1/admin/auth/refresh',
      'GET /v1/admin/auth/me',
    ]);
  });

  it('shares one refresh between parallel requests that all got 401', async () => {
    const { api, calls } = setup([
      error(401, 'UNAUTHENTICATED'),
      error(401, 'UNAUTHENTICATED'),
      ok(), // the single refresh
      ok(),
      ok(),
    ]);
    await Promise.all([api.me(), api.me()]);
    expect(calls.filter((c) => c.url.endsWith('/refresh'))).toHaveLength(1);
  });

  it('retries the refresh once to cover another tab that just rotated the token', async () => {
    const { api, calls } = setup([
      error(401, 'UNAUTHENTICATED'),
      error(401, 'UNAUTHENTICATED'),
      ok(),
      ok(),
    ]);
    await expect(api.me()).resolves.toEqual(ADMIN);
    expect(calls.filter((c) => c.url.endsWith('/refresh'))).toHaveLength(2);
  });

  it('reports a lost session and throws the original 401 when refresh is denied', async () => {
    const { api } = setup([
      error(401, 'UNAUTHENTICATED'),
      error(401, 'UNAUTHENTICATED'),
      error(401, 'UNAUTHENTICATED'),
    ]);
    const lost = vi.fn();
    api.onSessionLost(lost);
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('does not report a lost session when refresh fails for a server reason', async () => {
    const { api } = setup([error(401, 'UNAUTHENTICATED'), error(503, 'SERVICE_UNAVAILABLE')]);
    const lost = vi.fn();
    api.onSessionLost(lost);
    await expect(api.me()).rejects.toMatchObject({ status: 503 });
    expect(lost).not.toHaveBeenCalled();
  });

  it('never loops: a 401 right after a successful refresh is final', async () => {
    const { api, calls } = setup([
      error(401, 'UNAUTHENTICATED'),
      ok(),
      error(401, 'UNAUTHENTICATED'),
    ]);
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(3);
  });

  it('logs out with the CSRF header and does not try to refresh on 401', async () => {
    const ok204 = new Response(null, { status: 204 });
    const { api, calls } = setup([ok204]);
    await api.logout();
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/v1/admin/auth/logout' });
    expect(calls[0]?.headers['x-csrf-token']).toBe('csrf-123');

    const denied = setup([error(401, 'UNAUTHENTICATED')]);
    await expect(denied.api.logout()).rejects.toMatchObject({ status: 401 });
    expect(denied.calls).toHaveLength(1);
  });

  it('maps a non-contract error body to a generic ApiError', async () => {
    const { api } = setup([new Response('<html>bad gateway</html>', { status: 502 })]);
    await expect(api.login({ username: 'a', password: 'b' })).rejects.toMatchObject({
      status: 502,
      code: 'INTERNAL_ERROR',
    });
  });

  it('never touches web storage', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const { api } = setup([ok(), error(401, 'UNAUTHENTICATED'), ok(), ok()]);
    await api.login({ username: 'a', password: 'b' });
    await api.me();
    expect(set).not.toHaveBeenCalled();
  });
});
