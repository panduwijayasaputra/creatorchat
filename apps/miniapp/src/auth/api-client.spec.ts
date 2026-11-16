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
  bio: null,
  telegram_avatar_url: null,
  timezone: 'Asia/Jakarta',
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

describe('createMiniappApi.resolveCreator', () => {
  const creator = { public_code: 'k4m5x2qa', display_name: 'Salsa', bio: null, avatar_url: null };

  it('sends the Bearer token to the encoded by-code path and parses the public fields', async () => {
    const { api, calls } = setup((url) =>
      url.endsWith('/v1/auth/telegram') ? json(200, loginBody('tok-1')) : json(200, creator),
    );
    await api.loginWithTelegram('a=1&hash=2');
    expect((await api.resolveCreator('k4m5x2qa')).display_name).toBe('Salsa');
    expect(calls[1]?.url).toBe('http://api.test/v1/creators/by-code/k4m5x2qa');
    expect(authHeader(calls[1]?.init ?? {})).toBe('Bearer tok-1');
    await api.resolveCreator('../x?y').catch(() => undefined);
    expect(calls[2]?.url).toBe('http://api.test/v1/creators/by-code/..%2Fx%3Fy');
  });

  it('surfaces 404 and 403 as ApiError with the server code', async () => {
    const { api } = setup((url) => {
      if (url.endsWith('/v1/auth/telegram')) return json(200, loginBody('tok-1'));
      return url.includes('zzzzzzzz')
        ? json(404, errorBody('CREATOR_NOT_FOUND'))
        : json(403, errorBody('FORBIDDEN_ROLE'));
    });
    await api.loginWithTelegram('a=1&hash=2');
    await expect(api.resolveCreator('zzzzzzzz')).rejects.toMatchObject({
      code: 'CREATOR_NOT_FOUND',
      status: 404,
    });
    await expect(api.resolveCreator('aaaaaaaa')).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
      status: 403,
    });
  });

  it('rejects a response with extra fields', async () => {
    const { api } = setup((url) =>
      url.endsWith('/v1/auth/telegram')
        ? json(200, loginBody('t'))
        : json(200, { ...creator, id: 'x' }),
    );
    await api.loginWithTelegram('a=1&hash=2');
    await expect(api.resolveCreator('k4m5x2qa')).rejects.toThrow();
  });
});

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

  it('tells listeners the account after a silent re-exchange (the role may have changed)', async () => {
    let logins = 0;
    const { api } = setup((url, init) => {
      if (url.endsWith('/v1/auth/telegram')) {
        logins += 1;
        const body = loginBody('tok-' + logins);
        return json(200, logins === 1 ? body : { ...body, user: { ...profile, role: 'CREATOR' } });
      }
      return authHeader(init) === 'Bearer tok-2'
        ? json(200, profile)
        : json(401, errorBody('UNAUTHENTICATED'));
    });
    const renewed = vi.fn();
    const unsubscribe = api.onSessionRenewed(renewed);
    await api.loginWithTelegram('x');
    expect(renewed).not.toHaveBeenCalled(); // the first login is not a renewal
    await api.me();
    expect(renewed).toHaveBeenCalledTimes(1);
    expect(renewed.mock.calls[0]?.[0]).toMatchObject({ role: 'CREATOR' });
    unsubscribe();
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

describe('createMiniappApi.updateProfile', () => {
  const saved = { ...profile, display_name: 'Maya L', bio: 'halo' };

  it('PATCHes the JSON body with the Bearer token and parses the saved account', async () => {
    const { api, calls } = setup((url) =>
      url.endsWith('/v1/auth/telegram') ? json(200, loginBody('tok-1')) : json(200, saved),
    );
    await api.loginWithTelegram('a=1&hash=2');
    const result = await api.updateProfile({ display_name: 'Maya L', bio: 'halo' });
    expect(result.display_name).toBe('Maya L');
    expect(calls[1]?.url).toBe('http://api.test/v1/me/profile');
    expect(calls[1]?.init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      display_name: 'Maya L',
      bio: 'halo',
    });
    expect(authHeader(calls[1]?.init ?? {})).toBe('Bearer tok-1');
  });

  it('re-exchanges once on a 401 and retries with the same body', async () => {
    let patches = 0;
    let logins = 0;
    const { api, calls } = setup((url) => {
      if (url.endsWith('/v1/auth/telegram')) return json(200, loginBody(`tok-${++logins}`));
      return ++patches === 1 ? json(401, errorBody('UNAUTHENTICATED')) : json(200, saved);
    });
    await api.loginWithTelegram('a=1&hash=2');
    await api.updateProfile({ display_name: 'Maya L', reset_avatar: true });
    const patchCalls = calls.filter((c) => c.init.method === 'PATCH');
    expect(patchCalls).toHaveLength(2);
    expect(patchCalls[1]?.init.body).toBe(patchCalls[0]?.init.body);
    expect(authHeader(patchCalls[1]?.init ?? {})).toBe('Bearer tok-2');
  });

  it('surfaces a validation error as ApiError and a dead connection as NetworkError', async () => {
    const { api } = setup((url) =>
      url.endsWith('/v1/auth/telegram')
        ? json(200, loginBody('tok-1'))
        : json(400, errorBody('VALIDATION_FAILED')),
    );
    await api.loginWithTelegram('a=1&hash=2');
    await expect(api.updateProfile({ display_name: '' })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    const offline = createMiniappApi({
      baseUrl: 'http://api.test',
      getInitData: () => null,
      fetchImpl: (() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch,
    });
    await expect(offline.updateProfile({ display_name: 'x' })).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('createMiniappApi creator calls', () => {
  const settings = {
    profile: { ...profile, role: 'CREATOR' },
    public_code: 'k4m5x2qa',
    bio_link: 'https://t.me/TestBot?start=c_k4m5x2qa',
  };

  it('reads the settings and PATCHes the creator profile with the Bearer token', async () => {
    const { api, calls } = setup((url) => {
      if (url.endsWith('/v1/auth/telegram')) return json(200, loginBody('tok-1'));
      return url.endsWith('/v1/creator/settings')
        ? json(200, settings)
        : json(200, settings.profile);
    });
    await api.loginWithTelegram('a=1&hash=2');
    expect((await api.getCreatorSettings()).public_code).toBe('k4m5x2qa');
    await api.updateCreatorProfile({ display_name: 'Salsa', bio: 'halo' });
    expect(calls[1]?.url).toBe('http://api.test/v1/creator/settings');
    expect(calls[2]?.url).toBe('http://api.test/v1/creator/profile');
    expect(calls[2]?.init.method).toBe('PATCH');
    expect(authHeader(calls[2]?.init ?? {})).toBe('Bearer tok-1');
  });

  it('turns a 403 into an ApiError and rejects a malformed body', async () => {
    const { api } = setup((url) => {
      if (url.endsWith('/v1/auth/telegram')) return json(200, loginBody('tok-1'));
      return json(403, errorBody('FORBIDDEN_ROLE'));
    });
    await api.loginWithTelegram('a=1&hash=2');
    await expect(api.getCreatorSettings()).rejects.toMatchObject({ status: 403 });
    const bad = setup((url) =>
      url.endsWith('/v1/auth/telegram')
        ? json(200, loginBody('tok-1'))
        : json(200, { ...settings, extra: 1 }),
    );
    await bad.api.loginWithTelegram('a=1&hash=2');
    await expect(bad.api.getCreatorSettings()).rejects.toBeDefined();
  });
});

describe('createMiniappApi.updateCreatorTimezone', () => {
  it('PATCHes the zone with the Bearer token and parses the saved account', async () => {
    const { api, calls } = setup((url) =>
      url.endsWith('/v1/auth/telegram')
        ? json(200, loginBody('tok-1'))
        : json(200, { ...profile, role: 'CREATOR', timezone: 'Asia/Makassar' }),
    );
    await api.loginWithTelegram('a=1&hash=2');
    const saved = await api.updateCreatorTimezone('Asia/Makassar');
    expect(saved.timezone).toBe('Asia/Makassar');
    expect(calls[1]?.url).toBe('http://api.test/v1/creator/timezone');
    expect(calls[1]?.init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ timezone: 'Asia/Makassar' });
    expect(authHeader(calls[1]?.init ?? {})).toBe('Bearer tok-1');
  });

  it('surfaces a validation error as ApiError', async () => {
    const { api } = setup((url) =>
      url.endsWith('/v1/auth/telegram')
        ? json(200, loginBody('tok-1'))
        : json(400, errorBody('VALIDATION_FAILED')),
    );
    await api.loginWithTelegram('a=1&hash=2');
    await expect(api.updateCreatorTimezone('Asia/Makassar')).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('createMiniappApi creator request calls', () => {
  const request = {
    id: '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33',
    status: 'PENDING',
    creator_name: 'Maya',
    instagram_url: 'https://instagram.com/maya',
    creator_type: 'HUMAN',
    description: 'Resep',
    created_at: '2026-11-16T05:00:00.000Z',
    reviewed_at: null,
    review_reason: null,
  };
  const body = {
    creator_name: 'Maya',
    instagram_url: 'https://instagram.com/maya',
    creator_type: 'HUMAN' as const,
    description: 'Resep',
    rights_confirmed: true as const,
  };

  it('GETs the state with the Bearer token and parses it', async () => {
    const { api, calls } = setup((url) =>
      url.endsWith('/v1/auth/telegram')
        ? json(200, loginBody('tok-1'))
        : json(200, {
            request: null,
            blocked: { creator_name: 'Salsa', ends_at: '2026-11-27T00:00:00.000Z' },
          }),
    );
    await api.loginWithTelegram('a=1&hash=2');
    const state = await api.getCreatorRequestState();
    expect(state.blocked?.creator_name).toBe('Salsa');
    expect(calls[1]?.url).toBe('http://api.test/v1/me/creator-request');
    expect(calls[1]?.init.method).toBe('GET');
    expect(authHeader(calls[1]?.init ?? {})).toBe('Bearer tok-1');
  });

  it('POSTs the form and parses the stored request', async () => {
    const { api, calls } = setup((url) =>
      url.endsWith('/v1/auth/telegram') ? json(200, loginBody('tok-1')) : json(200, { request }),
    );
    await api.loginWithTelegram('a=1&hash=2');
    const saved = await api.submitCreatorRequest(body);
    expect(saved.request.status).toBe('PENDING');
    expect(calls[1]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual(body);
  });

  it('keeps the details of a 409 so the screen can show who blocks the request', async () => {
    const details = { creator_name: 'Salsa', ends_at: '2026-11-27T00:00:00.000Z' };
    const { api } = setup((url) =>
      url.endsWith('/v1/auth/telegram')
        ? json(200, loginBody('tok-1'))
        : json(409, { ...errorBody('CREATOR_REQUEST_BLOCKED'), details }),
    );
    await api.loginWithTelegram('a=1&hash=2');
    await expect(api.submitCreatorRequest(body)).rejects.toMatchObject({
      status: 409,
      code: 'CREATOR_REQUEST_BLOCKED',
      details,
    });
  });
});
