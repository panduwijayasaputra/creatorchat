import {
  ADMIN_AUTH_PATH,
  ADMIN_COOKIE,
  ADMIN_CSRF_HEADER,
  AdminSessionResponseSchema,
  ErrorResponseSchema,
  type AdminLoginRequest,
  type AdminProfile,
  type ErrorCode,
} from '@creatorchat/contracts';

/** The request never produced an HTTP response (offline, DNS, refused, CORS, aborted). */
export class NetworkError extends Error {
  constructor(options?: ErrorOptions) {
    super('Network request failed', options);
    this.name = 'NetworkError';
  }
}

/** The API answered with an error status. `details` is whatever the error contract carried. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface AdminApi {
  login(input: AdminLoginRequest): Promise<AdminProfile>;
  /** Current admin, or throws `ApiError` 401 when there is no (refreshable) session. */
  me(): Promise<AdminProfile>;
  logout(): Promise<void>;
  /** Called when the session can no longer be renewed. Returns an unsubscribe function. */
  onSessionLost(listener: () => void): () => void;
}

export interface AdminApiOptions {
  /** Defaults to the page's own origin: in dev the Vite server proxies `/v1` to the API. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Reads the readable CSRF cookie; injectable for tests. */
  readCookie?: (name: string) => string | undefined;
}

function documentCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const part of document.cookie.split('; ')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index) === name) {
      return decodeURIComponent(part.slice(index + 1));
    }
  }
  return undefined;
}

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/**
 * Small fetch client for the admin API. Tokens live only in HttpOnly cookies: this code never sees
 * or stores them. It echoes the CSRF cookie in a header on unsafe requests, renews an expired
 * access cookie once (single-flight), and reports a lost session to its listeners.
 */
export function createAdminApi(options: AdminApiOptions = {}): AdminApi {
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
  const readCookie = options.readCookie ?? documentCookie;
  const listeners = new Set<() => void>();
  let refreshing: Promise<boolean> | null = null;

  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (!SAFE_METHODS.has(method)) {
      const csrf = readCookie(ADMIN_COOKIE.csrf);
      if (csrf) headers[ADMIN_CSRF_HEADER] = csrf;
    }
    try {
      const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
      return await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        credentials: 'same-origin',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      throw new NetworkError({ cause: error });
    }
  }

  async function toApiError(response: Response): Promise<ApiError> {
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    const parsed = ErrorResponseSchema.safeParse(json);
    return parsed.success
      ? new ApiError(response.status, parsed.data.code, parsed.data.message, parsed.data.details)
      : new ApiError(response.status, 'INTERNAL_ERROR', 'Unexpected response from the server.');
  }

  /** True: new cookies are in place. False: the server denied the refresh (session is gone). */
  function refreshSession(): Promise<boolean> {
    refreshing ??= (async () => {
      // A second try covers another tab that rotated the token a moment earlier: the browser
      // now holds that tab's fresh cookie and the retry succeeds with it.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await send('POST', `${ADMIN_AUTH_PATH}/refresh`);
        if (response.ok) return true;
        if (response.status !== 401) throw await toApiError(response);
      }
      return false;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function request(
    method: string,
    path: string,
    body?: unknown,
    renewOn401 = true,
  ): Promise<Response> {
    const response = await send(method, path, body);
    if (response.ok) return response;
    const error = await toApiError(response);
    if (response.status === 401 && renewOn401) {
      if (await refreshSession()) return request(method, path, body, false);
      listeners.forEach((listener) => listener());
    }
    throw error;
  }

  async function profile(response: Response): Promise<AdminProfile> {
    return AdminSessionResponseSchema.parse(await response.json()).admin;
  }

  return {
    async login(input) {
      // A 401 here means wrong credentials, not an expired session: never refresh or report loss.
      return profile(await request('POST', `${ADMIN_AUTH_PATH}/login`, input, false));
    },
    async me() {
      return profile(await request('GET', `${ADMIN_AUTH_PATH}/me`));
    },
    async logout() {
      await request('POST', `${ADMIN_AUTH_PATH}/logout`, undefined, false);
    },
    onSessionLost(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
