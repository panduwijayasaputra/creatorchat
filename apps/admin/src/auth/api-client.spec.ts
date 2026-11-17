import {
  DEFAULT_CREATOR_LIST_QUERY,
  DEFAULT_CREATOR_SUBSCRIBERS_QUERY,
  DEFAULT_SUBSCRIPTION_EVENTS_QUERY,
  DEFAULT_HISTORY_QUERY,
  DEFAULT_SUBSCRIPTION_LIST_QUERY,
  DEFAULT_USER_LIST_QUERY,
  DEFAULT_USER_REQUESTS_QUERY,
  type CreatorListQuery,
  type UserListQuery,
} from '@creatorchat/contracts';
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

describe('creator review calls (US-012)', () => {
  const ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
  const request = {
    id: ID,
    status: 'PENDING',
    creator_name: 'Maya Lestari',
    instagram_url: 'https://instagram.com/maya.lestari',
    creator_type: 'HUMAN',
    description: 'Resep',
    created_at: '2026-11-16T05:00:00.000Z',
    reviewed_at: null,
    review_reason: null,
    user: {
      id: '5b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e11',
      display_name: 'Maya Lestari',
      telegram_username: 'mayalestari',
      telegram_id: '582917403',
      role: 'USER',
      status: 'ACTIVE',
    },
  };

  it('loads the request with a GET and parses the pre-check', async () => {
    const { api, calls } = setup([
      json(200, { request, check: { block: null, checked_at: '2026-11-16T08:02:00.000Z' } }),
    ]);
    const view = await api.getCreatorRequest(ID);
    expect(view.request.creator_name).toBe('Maya Lestari');
    expect(view.check.block).toBeNull();
    expect(calls[0]).toMatchObject({ method: 'GET', url: `/v1/admin/creator-requests/${ID}` });
    expect(calls[0]?.headers['x-csrf-token']).toBeUndefined();
  });

  it('approves with a POST that carries the CSRF header and no id in the body', async () => {
    const { api, calls } = setup([
      json(200, {
        request: { ...request, status: 'APPROVED', reviewed_at: '2026-11-16T08:02:00.000Z' },
        creator: { id: ID, public_code: 'k4m5x2qa' },
      }),
    ]);
    const result = await api.approveCreatorRequest(ID);
    expect(result.creator.public_code).toBe('k4m5x2qa');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `/v1/admin/creator-requests/${ID}/approve`,
    });
    expect(calls[0]?.headers['x-csrf-token']).toBe('csrf-123');
    expect(calls[0]?.body).toBeUndefined();
  });

  it('rejects with the reason as the only body field', async () => {
    const { api, calls } = setup([
      json(200, {
        request: {
          ...request,
          status: 'REJECTED',
          reviewed_at: '2026-11-16T08:02:00.000Z',
          review_reason: 'Belum jelas.',
        },
      }),
    ]);
    await api.rejectCreatorRequest(ID, 'Belum jelas.');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `/v1/admin/creator-requests/${ID}/reject`,
      body: JSON.stringify({ reason: 'Belum jelas.' }),
    });
  });

  it('keeps the code and details of a 409 so the dialog can explain it', async () => {
    const block = {
      count: 1,
      creator_name: 'Salsa Maheswari',
      ends_at: '2026-11-27T00:00:00.000Z',
    };
    const { api } = setup([error(409, 'CREATOR_APPROVAL_BLOCKED', block)]);
    await expect(api.approveCreatorRequest(ID)).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'CREATOR_APPROVAL_BLOCKED',
      details: block,
    });
  });

  it('renews an expired session once and retries the decision', async () => {
    const { api, calls } = setup([
      error(401, 'UNAUTHENTICATED'),
      json(200, { admin: ADMIN }),
      json(200, {
        request: {
          ...request,
          status: 'REJECTED',
          reviewed_at: '2026-11-16T08:02:00.000Z',
          review_reason: 'x',
        },
      }),
    ]);
    await api.rejectCreatorRequest(ID, 'x');
    expect(calls.map((c) => c.url)).toEqual([
      `/v1/admin/creator-requests/${ID}/reject`,
      '/v1/admin/auth/refresh',
      `/v1/admin/creator-requests/${ID}/reject`,
    ]);
  });

  it('encodes the id into the path and never builds a different route from it', async () => {
    const { api, calls } = setup([error(404, 'NOT_FOUND')]);
    await expect(api.getCreatorRequest('../auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(calls[0]?.url).toBe('/v1/admin/creator-requests/..%2Fauth%2Fme');
  });

  it('turns a connection failure into a NetworkError', async () => {
    const { api } = setup([new TypeError('offline')]);
    await expect(api.approveCreatorRequest(ID)).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('creator list call (US-014)', () => {
  const page = (items: unknown[] = []) => ({
    items,
    total: items.length,
    page: 1,
    page_size: 10,
  });
  const query = (over: Partial<CreatorListQuery> = {}): CreatorListQuery => ({
    ...DEFAULT_CREATOR_LIST_QUERY,
    ...over,
  });

  it('sends a GET without CSRF or a body and leaves defaults out of the URL', async () => {
    const { api, calls } = setup([json(200, page())]);
    await api.listCreators(query());
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/v1/admin/creators' });
    expect(calls[0]?.headers).not.toHaveProperty('x-csrf-token');
    expect(calls[0]?.body).toBeUndefined();
  });

  it('encodes every non-default value', async () => {
    const { api, calls } = setup([json(200, page())]);
    await api.listCreators(
      query({
        q: 'maya & co',
        status: ['request', 'blocked'],
        type: 'ai_character',
        range: '30d',
        sort: 'name',
        dir: 'asc',
        page: 3,
        page_size: 50,
      }),
    );
    expect(calls[0]?.url).toBe(
      '/v1/admin/creators?q=maya+%26+co&status=request%2Cblocked&type=ai_character&range=30d&sort=name&dir=asc&page=3&page_size=50',
    );
  });

  it('validates the response', async () => {
    const { api } = setup([json(200, { items: [], total: 'x' })]);
    await expect(api.listCreators(query())).rejects.toThrow();
  });

  it('rejects an aborted call without a result', async () => {
    const controller = new AbortController();
    const { api } = setup([
      () => {
        throw new DOMException('aborted', 'AbortError');
      },
    ]);
    controller.abort();
    await expect(api.listCreators(query(), controller.signal)).rejects.toBeInstanceOf(NetworkError);
  });

  it('renews an expired session once and retries', async () => {
    const { api, calls } = setup([
      error(401, 'UNAUTHENTICATED'),
      json(200, { ok: true }),
      json(200, page()),
    ]);
    await expect(api.listCreators(query())).resolves.toMatchObject({ total: 0 });
    expect(calls.map((c) => c.url)).toEqual([
      '/v1/admin/creators',
      '/v1/admin/auth/refresh',
      '/v1/admin/creators',
    ]);
  });

  it('keeps the API error of a 400', async () => {
    const { api } = setup([error(400, 'VALIDATION_FAILED')]);
    await expect(api.listCreators(query())).rejects.toBeInstanceOf(ApiError);
  });
});

describe('user list call (US-017)', () => {
  const page = (items: unknown[] = []) => ({ items, total: items.length, page: 1, page_size: 10 });
  const query = (over: Partial<UserListQuery> = {}): UserListQuery => ({
    ...DEFAULT_USER_LIST_QUERY,
    ...over,
  });

  it('sends a GET without CSRF and leaves defaults out of the URL', async () => {
    const { api, calls } = setup([json(200, page())]);
    await api.listUsers(query());
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/v1/admin/users' });
    expect(calls[0]?.headers).not.toHaveProperty('x-csrf-token');
  });

  it('encodes every non-default value', async () => {
    const { api, calls } = setup([json(200, page())]);
    await api.listUsers(
      query({
        q: 'putri & co',
        status: ['blocked'],
        request: ['pending', 'rejected'],
        range: '30d',
        sort: 'subscriptions',
        dir: 'asc',
        page: 3,
        page_size: 50,
      }),
    );
    expect(calls[0]?.url).toBe(
      '/v1/admin/users?q=putri+%26+co&status=blocked&request=pending%2Crejected&range=30d&sort=subscriptions&dir=asc&page=3&page_size=50',
    );
  });

  it('sends access=pending only when it is not the default (US-024)', async () => {
    const { api, calls } = setup([json(200, page()), json(200, page())]);
    await api.listUsers(query({ access: 'pending' }));
    await api.listUsers(query());
    expect(calls[0]?.url).toBe('/v1/admin/users?access=pending');
    expect(calls[1]?.url).toBe('/v1/admin/users');
  });

  it('validates the response', async () => {
    const { api } = setup([json(200, { items: [], total: 'x' })]);
    await expect(api.listUsers(query())).rejects.toThrow();
  });

  it('renews an expired session once and retries', async () => {
    const { api, calls } = setup([
      error(401, 'UNAUTHENTICATED'),
      json(200, { ok: true }),
      json(200, page()),
    ]);
    await expect(api.listUsers(query())).resolves.toMatchObject({ total: 0 });
    expect(calls.map((c) => c.url)).toEqual([
      '/v1/admin/users',
      '/v1/admin/auth/refresh',
      '/v1/admin/users',
    ]);
  });

  it('keeps the API error of a 400', async () => {
    const { api } = setup([error(400, 'VALIDATION_FAILED')]);
    await expect(api.listUsers(query())).rejects.toBeInstanceOf(ApiError);
  });
});

describe('user moderation calls (US-019)', () => {
  const ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';

  it('reads the pre-check with a GET and no CSRF header', async () => {
    const { api, calls } = setup([
      json(200, {
        user_status: 'ACTIVE',
        role: 'USER',
        active_subscriptions: 1,
        checked_at: '2026-11-16T08:00:00.000Z',
      }),
    ]);
    await expect(api.getUserBlockCheck(ID)).resolves.toMatchObject({ active_subscriptions: 1 });
    expect(calls[0]).toMatchObject({ method: 'GET', url: `/v1/admin/users/${ID}/block-check` });
    expect(calls[0]?.headers).not.toHaveProperty('x-csrf-token');
  });

  it('blocks and unblocks with the CSRF header and the reason as the only body field', async () => {
    const { api, calls } = setup([
      json(200, { user: { id: ID, status: 'BLOCKED' } }),
      json(200, { user: { id: ID, status: 'ACTIVE' } }),
    ]);
    await api.blockUser(ID, 'Spam');
    await api.unblockUser(ID, 'Banding');
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', `/v1/admin/users/${ID}/block`, '{"reason":"Spam"}'],
      ['POST', `/v1/admin/users/${ID}/unblock`, '{"reason":"Banding"}'],
    ]);
    expect(calls[0]?.headers['x-csrf-token']).toBe('csrf-123');
  });

  it('keeps code and details of a 409', async () => {
    const { api } = setup([error(409, 'USER_STATUS_CONFLICT', { status: 'BLOCKED' })]);
    await expect(api.blockUser(ID, 'x')).rejects.toMatchObject({
      status: 409,
      code: 'USER_STATUS_CONFLICT',
      details: { status: 'BLOCKED' },
    });
  });

  it('encodes the id so it cannot build another route', async () => {
    const { api, calls } = setup([json(200, { user: { id: ID, status: 'BLOCKED' } })]);
    await api.blockUser('../x/y', 'r');
    expect(calls[0]?.url).toBe('/v1/admin/users/..%2Fx%2Fy/block');
  });
});

describe('creator detail calls (US-015)', () => {
  const ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
  const page = { items: [], total: 0, page: 1, page_size: 10 };

  it('builds the detail, history and audit URLs; defaults are left out; ids are encoded', async () => {
    const { api, calls } = setup([
      json(200, { bad: true }),
      json(200, page),
      json(200, page),
      json(200, { bad: true }),
    ]);
    await expect(api.getCreatorDetail(ID)).rejects.toThrow();
    await api.listCreatorHistory(ID, { ...DEFAULT_HISTORY_QUERY });
    await api.listCreatorHistory(ID, {
      q: 'a & b',
      type: 'access',
      status: 'failed',
      sort: 'actor',
      dir: 'asc',
      page: 2,
      page_size: 25,
    });
    await expect(api.getAuditLog('a/b')).rejects.toThrow();
    expect(calls.map((c) => c.url)).toEqual([
      `/v1/admin/creators/${ID}`,
      `/v1/admin/creators/${ID}/history`,
      `/v1/admin/creators/${ID}/history?q=a+%26+b&type=access&status=failed&sort=actor&dir=asc&page=2&page_size=25`,
      '/v1/admin/audit-logs/a%2Fb',
    ]);
    expect(calls.every((c) => c.method === 'GET' && !('x-csrf-token' in (c.headers ?? {})))).toBe(
      true,
    );
  });

  it('keeps the API error of a 404 and renews once', async () => {
    const { api, calls } = setup([
      error(404, 'NOT_FOUND'),
      error(401, 'UNAUTHENTICATED'),
      json(200, { ok: true }),
      json(200, page),
    ]);
    await expect(api.getCreatorDetail(ID)).rejects.toBeInstanceOf(ApiError);
    await expect(api.listCreatorHistory(ID, { ...DEFAULT_HISTORY_QUERY })).resolves.toMatchObject({
      total: 0,
    });
    expect(calls.map((c) => c.url).slice(1)).toEqual([
      `/v1/admin/creators/${ID}/history`,
      '/v1/admin/auth/refresh',
      `/v1/admin/creators/${ID}/history`,
    ]);
  });
});

describe('user detail calls (US-018)', () => {
  const ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
  const page = { items: [], total: 0, page: 1, page_size: 10, pending: null };

  it('builds the URLs; defaults are left out; ids are encoded', async () => {
    const { api, calls } = setup([
      json(200, { bad: true }),
      json(200, page),
      json(200, page),
      json(200, { bad: true }),
      json(200, { items: [], total: 0, page: 1, page_size: 10 }),
    ]);
    await expect(api.getUserDetail(ID)).rejects.toThrow();
    await api.listUserRequests(ID, { ...DEFAULT_USER_REQUESTS_QUERY });
    await api.listUserRequests(ID, {
      q: 'a & b',
      status: 'rejected',
      sort: 'status',
      dir: 'asc',
      page: 2,
      page_size: 25,
    });
    await expect(api.getUserRequest(ID, 'a/b')).rejects.toThrow();
    await api.listUserHistory(ID, { ...DEFAULT_HISTORY_QUERY, type: 'access' });
    expect(calls.map((c) => c.url)).toEqual([
      `/v1/admin/users/${ID}`,
      `/v1/admin/users/${ID}/requests`,
      `/v1/admin/users/${ID}/requests?q=a+%26+b&status=rejected&sort=status&dir=asc&page=2&page_size=25`,
      `/v1/admin/users/${ID}/requests/a%2Fb`,
      `/v1/admin/users/${ID}/history?type=access`,
    ]);
    expect(calls.every((c) => c.method === 'GET' && !('x-csrf-token' in (c.headers ?? {})))).toBe(
      true,
    );
  });

  it('keeps the API error of a 404 and renews once', async () => {
    const { api, calls } = setup([
      error(404, 'NOT_FOUND'),
      error(401, 'UNAUTHENTICATED'),
      json(200, { ok: true }),
      json(200, page),
    ]);
    await expect(api.getUserDetail(ID)).rejects.toBeInstanceOf(ApiError);
    await expect(
      api.listUserRequests(ID, { ...DEFAULT_USER_REQUESTS_QUERY }),
    ).resolves.toMatchObject({ total: 0 });
    expect(calls.map((c) => c.url).slice(1)).toEqual([
      `/v1/admin/users/${ID}/requests`,
      '/v1/admin/auth/refresh',
      `/v1/admin/users/${ID}/requests`,
    ]);
  });
});

describe('user subscription calls (US-020)', () => {
  const ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
  const SUB = '5c1a9e33-7f0c-4a53-9d0c-0d9b6f0e2b3b';
  const CREATOR = '7f0c4a53-9d0c-4a53-9d0c-0d9b6f0e2b3b';
  const action = {
    subscription: {
      id: SUB,
      creator_id: CREATOR,
      status: 'ACTIVE',
      starts_at: '2026-11-16T05:00:00.000Z',
      ends_at: '2026-12-16T16:59:59.000Z',
      revoked_at: null,
    },
  };
  const page = { items: [], total: 0, page: 1, page_size: 10 };

  it('builds the list URL (defaults left out, ids encoded) with a GET and no CSRF header', async () => {
    const { api, calls } = setup([json(200, page), json(200, page), json(200, { items: [] })]);
    await api.listUserSubscriptions(ID, { ...DEFAULT_SUBSCRIPTION_LIST_QUERY });
    await api.listUserSubscriptions('a/b', {
      q: 'sal & kir',
      status: 'active',
      ends: 'next7',
      sort: 'creator',
      dir: 'asc',
      page: 2,
      page_size: 25,
    });
    await api.getGrantableCreators(ID);
    expect(calls.map((c) => c.url)).toEqual([
      `/v1/admin/users/${ID}/subscriptions`,
      '/v1/admin/users/a%2Fb/subscriptions?q=sal+%26+kir&status=active&ends=next7&sort=creator&dir=asc&page=2&page_size=25',
      `/v1/admin/users/${ID}/grantable-creators`,
    ]);
    expect(calls.every((c) => c.method === 'GET' && !('x-csrf-token' in c.headers))).toBe(true);
  });

  it('grants, extends and revokes with the CSRF header and only the documented body', async () => {
    const { api, calls } = setup([json(201, action), json(200, action), json(200, action)]);
    await api.grantAccess(ID, { creator_id: CREATOR, duration_days: 30, reason: 'a' });
    await api.extendAccess(ID, SUB, { duration_days: 7, reason: 'b' });
    await api.revokeAccess(ID, SUB, 'c');
    expect(calls.map((c) => [c.method, c.url, c.body, c.headers['x-csrf-token']])).toEqual([
      [
        'POST',
        `/v1/admin/users/${ID}/subscriptions`,
        JSON.stringify({ creator_id: CREATOR, duration_days: 30, reason: 'a' }),
        'csrf-123',
      ],
      [
        'POST',
        `/v1/admin/users/${ID}/subscriptions/${SUB}/extend`,
        JSON.stringify({ duration_days: 7, reason: 'b' }),
        'csrf-123',
      ],
      [
        'POST',
        `/v1/admin/users/${ID}/subscriptions/${SUB}/revoke`,
        JSON.stringify({ reason: 'c' }),
        'csrf-123',
      ],
    ]);
  });

  it('keeps code and details of a 409, validates responses, and renews once', async () => {
    const { api, calls } = setup([
      error(409, 'SUBSCRIPTION_ACTIVE'),
      json(200, { subscription: { id: 'nope' } }),
      error(401, 'UNAUTHENTICATED'),
      json(200, { ok: true }),
      json(200, page),
    ]);
    await expect(
      api.grantAccess(ID, { creator_id: CREATOR, duration_days: 30, reason: 'a' }),
    ).rejects.toMatchObject({ status: 409, code: 'SUBSCRIPTION_ACTIVE' });
    await expect(api.revokeAccess(ID, SUB, 'x')).rejects.toThrow();
    await expect(
      api.listUserSubscriptions(ID, { ...DEFAULT_SUBSCRIPTION_LIST_QUERY }),
    ).resolves.toMatchObject({ total: 0 });
    expect(calls.map((c) => c.url).slice(2)).toEqual([
      `/v1/admin/users/${ID}/subscriptions`,
      '/v1/admin/auth/refresh',
      `/v1/admin/users/${ID}/subscriptions`,
    ]);
  });
});

describe('subscription detail calls (US-021)', () => {
  const ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
  const SUB = '1b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e44';
  const page = { items: [], total: 0, page: 1, page_size: 10 };
  const grantable = { creator_status: 'ACTIVE', items: [] };

  it('builds the URLs; defaults are left out; ids and q are encoded', async () => {
    const { api, calls } = setup([
      json(200, { bad: true }),
      json(200, page),
      json(200, page),
      json(200, page),
      json(200, grantable),
      json(200, grantable),
    ]);
    await expect(api.getSubscription(ID, SUB)).rejects.toThrow();
    await api.listSubscriptionEvents(ID, SUB, { ...DEFAULT_SUBSCRIPTION_EVENTS_QUERY });
    await api.listSubscriptionEvents(ID, SUB, {
      sort: 'actor',
      dir: 'asc',
      page: 2,
      page_size: 25,
    });
    await api.listCreatorSubscribers(ID, {
      ...DEFAULT_CREATOR_SUBSCRIBERS_QUERY,
      q: 'a & b',
      status: 'expired',
      ends: 'past',
      sort: 'telegram',
      dir: 'asc',
      page: 3,
      page_size: 50,
    });
    await api.listGrantableUsers(ID, null);
    await api.listGrantableUsers(ID, 'ra ka');
    expect(calls.map((c) => c.url)).toEqual([
      `/v1/admin/users/${ID}/subscriptions/${SUB}`,
      `/v1/admin/users/${ID}/subscriptions/${SUB}/events`,
      `/v1/admin/users/${ID}/subscriptions/${SUB}/events?sort=actor&dir=asc&page=2&page_size=25`,
      `/v1/admin/creators/${ID}/subscribers?q=a+%26+b&status=expired&ends=past&sort=telegram&dir=asc&page=3&page_size=50`,
      `/v1/admin/creators/${ID}/grantable-users`,
      `/v1/admin/creators/${ID}/grantable-users?q=ra+ka`,
    ]);
    expect(calls.every((c) => c.method === 'GET' && !('x-csrf-token' in (c.headers ?? {})))).toBe(
      true,
    );
  });

  it('keeps the API error of a 404 and renews once', async () => {
    const { api, calls } = setup([
      error(404, 'NOT_FOUND'),
      error(401, 'UNAUTHENTICATED'),
      json(200, { ok: true }),
      json(200, page),
    ]);
    await expect(api.getSubscription(ID, SUB)).rejects.toBeInstanceOf(ApiError);
    await expect(
      api.listCreatorSubscribers(ID, { ...DEFAULT_CREATOR_SUBSCRIBERS_QUERY }),
    ).resolves.toMatchObject({ total: 0 });
    expect(calls.map((c) => c.url).slice(1)).toEqual([
      `/v1/admin/creators/${ID}/subscribers`,
      '/v1/admin/auth/refresh',
      `/v1/admin/creators/${ID}/subscribers`,
    ]);
  });
});

describe('access request review calls (US-024)', () => {
  const USER = '10000000-0000-4000-8000-000000000009';
  const REQ = '7a000000-0000-4000-8000-000000000001';

  it('lists the pending requests with a GET and validates the answer', async () => {
    const item = {
      id: REQ,
      creator: { id: USER, display_name: 'Dinda' },
      type: 'TRIAL',
      requested_at: '2026-11-13T03:42:00.000Z',
    };
    const { api, calls } = setup([
      json(200, { items: [item] }),
      json(200, { items: [{ ...item, id: 1 }] }),
    ]);
    expect((await api.listAccessRequests(USER)).items).toEqual([item]);
    expect(calls[0]).toMatchObject({
      method: 'GET',
      url: `/v1/admin/users/${USER}/access-requests`,
    });
    expect(calls[0]?.headers).not.toHaveProperty('x-csrf-token');
    await expect(api.listAccessRequests(USER)).rejects.toThrow();
  });

  it('rejects with a POST that carries the CSRF token and only the reason', async () => {
    const { api, calls } = setup([json(200, { request: { id: REQ, status: 'REJECTED' } })]);
    await api.rejectAccessRequest(USER, REQ, 'Belum sesuai.');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `/v1/admin/users/${USER}/access-requests/${REQ}/reject`,
    });
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ reason: 'Belum sesuai.' });
    expect(calls[0]?.headers).toHaveProperty('x-csrf-token');
  });

  it('keeps the code and details of a 409', async () => {
    const { api } = setup([error(409, 'ACCESS_REQUEST_ALREADY_REVIEWED', { status: 'APPROVED' })]);
    await expect(api.rejectAccessRequest(USER, REQ, 'x')).rejects.toMatchObject({
      status: 409,
      code: 'ACCESS_REQUEST_ALREADY_REVIEWED',
      details: { status: 'APPROVED' },
    });
  });

  it('grant forwards access_request_id', async () => {
    const { api, calls } = setup([
      json(201, {
        subscription: {
          id: REQ,
          creator_id: USER,
          status: 'ACTIVE',
          starts_at: '2026-11-17T00:00:00.000Z',
          ends_at: '2026-12-17T00:00:00.000Z',
          revoked_at: null,
        },
      }),
    ]);
    await api.grantAccess(USER, {
      creator_id: USER,
      duration_days: 30,
      reason: 'x',
      access_request_id: REQ,
    });
    expect(JSON.parse(String(calls[0]?.body))).toMatchObject({ access_request_id: REQ });
  });
});
