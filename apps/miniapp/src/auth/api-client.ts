import {
  CreatorLinkResponseSchema,
  creatorByCodePath,
  ErrorResponseSchema,
  MeResponseSchema,
  TelegramLoginResponseSchema,
  USER_AUTH_PATH,
  type CreatorLinkResponse,
  type ErrorCode,
  type UserProfile,
} from '@creatorchat/contracts';

/** The request never produced an HTTP response (offline, DNS, refused, CORS, aborted). */
export class NetworkError extends Error {
  constructor(options?: ErrorOptions) {
    super('Network request failed', options);
    this.name = 'NetworkError';
  }
}

/** The API answered with an error status. */
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

/** Why a session could not be renewed. `expired` also covers data Telegram no longer vouches for. */
export type SessionLossReason = 'expired' | 'blocked' | 'unavailable';

export interface MiniappApi {
  /** Exchanges Telegram initData for a session (kept in memory) and returns the profile. */
  loginWithTelegram(initData: string): Promise<UserProfile>;
  /** The current account as the server sees it (role and status come from here). */
  me(): Promise<UserProfile>;
  /** Resolves a creator deep-link code. 404 CREATOR_NOT_FOUND / 403 FORBIDDEN_ROLE arrive as ApiError. */
  resolveCreator(publicCode: string): Promise<CreatorLinkResponse>;
  /** Called when the session could not be renewed. Returns an unsubscribe function. */
  onSessionLost(listener: (reason: SessionLossReason) => void): () => void;
  /** Called after a silent re-exchange succeeded, with the account as the server now sees it (the role may have changed). */
  onSessionRenewed(listener: (user: UserProfile) => void): () => void;
}

export interface MiniappApiOptions {
  baseUrl: string;
  /** Where to find initData again when the token expires; `null` outside Telegram. */
  getInitData: () => string | null;
  fetchImpl?: typeof fetch;
}

export function lossReasonFor(error: unknown): SessionLossReason {
  if (error instanceof ApiError) {
    if (error.code === 'ACCOUNT_BLOCKED') return 'blocked';
    if (error.code === 'TELEGRAM_AUTH_EXPIRED' || error.code === 'TELEGRAM_AUTH_INVALID') {
      return 'expired';
    }
  }
  return 'unavailable';
}

/**
 * Small fetch client for the Mini App. The access token lives only in this closure (no storage).
 * A 401 on an authorized call triggers one silent re-exchange of initData (single-flight) and a
 * retry; if Telegram's data is no longer accepted the session is reported lost.
 */
export function createMiniappApi(options: MiniappApiOptions): MiniappApi {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const listeners = new Set<(reason: SessionLossReason) => void>();
  const renewedListeners = new Set<(user: UserProfile) => void>();
  let token: string | null = null;
  let renewing: Promise<boolean> | null = null;

  async function send(
    method: string,
    path: string,
    init: { body?: unknown; authorize: boolean },
  ): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.authorize && token) headers.authorization = `Bearer ${token}`;
    try {
      const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
      return await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        // The session is a Bearer token held in memory; no cookies are involved.
        credentials: 'omit',
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
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

  async function exchange(initData: string): Promise<UserProfile> {
    const response = await send('POST', `${USER_AUTH_PATH}/telegram`, {
      body: { init_data: initData },
      authorize: false,
    });
    if (!response.ok) throw await toApiError(response);
    const body = TelegramLoginResponseSchema.parse(await response.json());
    token = body.access_token;
    return body.user;
  }

  /** True: a fresh token is in place. False: Telegram's data is no longer accepted (listeners told). */
  function renew(): Promise<boolean> {
    renewing ??= (async () => {
      const initData = options.getInitData();
      if (!initData) {
        listeners.forEach((listener) => listener('expired'));
        return false;
      }
      try {
        const user = await exchange(initData);
        renewedListeners.forEach((listener) => listener(user));
        return true;
      } catch (error) {
        if (error instanceof NetworkError) throw error;
        listeners.forEach((listener) => listener(lossReasonFor(error)));
        return false;
      }
    })().finally(() => {
      renewing = null;
    });
    return renewing;
  }

  async function authorized(method: string, path: string, retried = false): Promise<Response> {
    const response = await send(method, path, { authorize: true });
    if (response.ok) return response;
    if (response.status === 401 && !retried && (await renew())) {
      return authorized(method, path, true);
    }
    throw await toApiError(response);
  }

  return {
    loginWithTelegram: exchange,
    async me() {
      return MeResponseSchema.parse(await (await authorized('GET', '/v1/me')).json());
    },
    async resolveCreator(publicCode) {
      const response = await authorized('GET', creatorByCodePath(publicCode));
      return CreatorLinkResponseSchema.parse(await response.json());
    },
    onSessionRenewed(listener) {
      renewedListeners.add(listener);
      return () => {
        renewedListeners.delete(listener);
      };
    },
    onSessionLost(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
