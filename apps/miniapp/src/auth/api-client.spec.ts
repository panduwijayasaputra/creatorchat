import { describe, expect, it, vi } from 'vitest';
import { ApiError, createMiniappApi, NetworkError, type SessionLossReason } from './api-client';

const profile = {
  id: '5b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e11',
  telegram_id: '424242',
  role: 'USER',
  status: 'ACTIVE',
  display_name: 'Nadia',
  telegram_username: null,
  avatar_url: null,
};

const loginBody = (token: string) => ({
  access_token: token,
  token_type: 'Bearer',
  expires_in: 3600,
  user: profile,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const errorBody = (code: string) => ({ code, message: 'x', request_id: 'req-12345678' });

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function setup(handler: Handler, initData: string | null = 'query_id=x&hash=y') {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  }) as unknown as typeof fetch;
  const api = createMiniappApi({
    baseUrl: 'http://api.test/',
    getInitData: () => initData,
    fetchImpl,
  });
  return { api, calls };
}

const authHeader = (init: RequestInit) => (init.headers as Record<string, string>).authorization;

describe('createMiniappApi', () => {
  it('posts only init_data, parses the response and keeps the token for /me', async () => {
    const { api, calls } = setup((url) =>
      url.endsWith('/v1/auth/telegram') ? json(200, loginBody('tok-1')) : json(200, profile),
    );
    expect((await api.loginWithTelegram('abc=1&hash=2')).telegram_id).toBe('424242');
    expect(calls[0]?.url).toBe('http://api.test/v1/auth/telegram');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ init_data: 'abc=1&hash=2' });
    expect(authHeader(calls[0]?.init ?? {})).toBeUndefined();
    expect(calls[0]?.init.credentials).toBe('omit');

    await api.me();
    expect(calls[1]?.url).toBe('http://api.test/v1/me');
    expect(authHeader(calls[1]?.init ?? {})).toBe('Bearer tok-1');
  });

  it('turns a failed fetch into NetworkError and an error body into ApiError', async () => {
    const offline = setup(() => {
      throw new TypeError('offline');
    });
    await expect(offline.api.loginWithTelegram('x')).rejects.toBeInstanceOf(NetworkError);

    const denied = setup(() => json(401, errorBody('TELEGRAM_AUTH_EXPIRED')));
    await expect(denied.api.loginWithTelegram('x')).rejects.toMatchObject({
      status: 401,
      code: 'TELEGRAM_AUTH_EXPIRED',
    });
    const odd = setup(() => new Response('<html>', { status: 502 }));
    await expect(odd.api.loginWithTelegram('x')).rejects.toBeInstanceOf(ApiError);
  });

  it('re-exchanges initData once on a 401 and retries the call', async () => {
    let tokens = 0;
    const { api, calls } = setup((url, init) => {
      if (url.endsWith('/v1/auth/telegram')) return json(200, loginBody(`tok-${++tokens}`));
      return authHeader(init) === 'Bearer tok-2'
        ? json(200, profile)
        : json(401, errorBody('UNAUTHENTICATED'));
    });
    await api.loginWithTelegram('x');
    expect((await api.me()).id).toBe(profile.id);
    expect(calls.filter((c) => c.url.endsWith('/v1/auth/telegram'))).toHaveLength(2);
  });

  it('shares one re-exchange between concurrent 401s', async () => {
    let logins = 0;
    const { api, calls } = setup(async (url, init) => {
      if (url.endsWith('/v1/auth/telegram')) {
        logins += 1;
        await new Promise((r) => setTimeout(r, 5));
        return json(200, loginBody(`tok-${logins}`));
      }
      return authHeader(init) === 'Bearer tok-2'
        ? json(200, profile)
        : json(401, errorBody('UNAUTHENTICATED'));
    });
    await api.loginWithTelegram('x');
    await Promise.all([api.me(), api.me(), api.me()]);
    expect(calls.filter((c) => c.url.endsWith('/v1/auth/telegram'))).toHaveLength(2);
  });

  it.each([
    ['TELEGRAM_AUTH_EXPIRED', 401, 'expired'],
    ['ACCOUNT_BLOCKED', 403, 'blocked'],
    ['SERVICE_UNAVAILABLE', 503, 'unavailable'],
  ] as [string, number, SessionLossReason][])(
    'reports the session lost (%s) when the re-exchange is refused',
    async (code, status, reason) => {
      let first = true;
      const { api } = setup((url) => {
        if (url.endsWith('/v1/auth/telegram')) {
          if (first) {
            first = false;
            return json(200, loginBody('tok-1'));
          }
          return json(status, errorBody(code));
        }
        return json(401, errorBody('UNAUTHENTICATED'));
      });
      const lost = vi.fn();
      api.onSessionLost(lost);
      await api.loginWithTelegram('x');
      await expect(api.me()).rejects.toMatchObject({ status: 401 });
      expect(lost).toHaveBeenCalledWith(reason);
    },
  );

  it('reports the session lost when initData is no longer available', async () => {
    const { api } = setup(() => json(401, errorBody('UNAUTHENTICATED')), null);
    const lost = vi.fn();
    api.onSessionLost(lost);
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledWith('expired');
  });

  it('never persists the token', async () => {
    const { api } = setup((url) =>
      url.endsWith('/v1/auth/telegram') ? json(200, loginBody('tok-secret')) : json(200, profile),
    );
    await api.loginWithTelegram('x');
    await api.me();
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('tok-secret');
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('tok-secret');
  });
});
