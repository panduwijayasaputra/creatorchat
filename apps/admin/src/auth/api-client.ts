import {
  AdminGalleryResponseSchema,
  AdminMediaDetailSchema,
  adminCreatorGalleryPath,
  adminCreatorMediaPath,
  DEFAULT_ADMIN_GALLERY_QUERY,
  type AdminGalleryQuery,
  type AdminGalleryResponse,
  type AdminMediaDetail,
  AccessRequestsResponseSchema,
  RejectAccessRequestResponseSchema,
  rejectAccessRequestPath,
  userAccessRequestsPath,
  type AccessRequestsResponse,
  type RejectAccessRequestResponse,
  ADMIN_AUTH_PATH,
  ADMIN_COOKIE,
  ADMIN_AUDIT_LOGS_PATH,
  ADMIN_CREATORS_PATH,
  AuditLogDetailSchema,
  CreatorDetailResponseSchema,
  DEFAULT_HISTORY_QUERY,
  HistoryResponseSchema,
  ADMIN_CREATOR_REQUESTS_PATH,
  ADMIN_CSRF_HEADER,
  ADMIN_USERS_PATH,
  DEFAULT_USER_REQUESTS_QUERY,
  UserDetailResponseSchema,
  UserRequestDetailSchema,
  UserRequestsResponseSchema,
  DEFAULT_USER_LIST_QUERY,
  AdminSessionResponseSchema,
  ApproveCreatorRequestResponseSchema,
  BlockCreatorResponseSchema,
  CreatorBlockCheckResponseSchema,
  UnblockCreatorResponseSchema,
  CreatorListResponseSchema,
  UserListResponseSchema,
  BlockUserResponseSchema,
  UnblockUserResponseSchema,
  UserBlockCheckResponseSchema,
  CreatorSubscribersResponseSchema,
  DEFAULT_CREATOR_SUBSCRIBERS_QUERY,
  DEFAULT_SUBSCRIPTION_EVENTS_QUERY,
  DEFAULT_SUBSCRIPTION_LIST_QUERY,
  GrantableUsersResponseSchema,
  SubscriptionDetailResponseSchema,
  SubscriptionEventsResponseSchema,
  GrantableCreatorsResponseSchema,
  SubscriptionActionResponseSchema,
  SubscriptionListResponseSchema,
  CreatorRequestReviewResponseSchema,
  DEFAULT_CREATOR_LIST_QUERY,
  ErrorResponseSchema,
  RejectCreatorRequestResponseSchema,
  type AdminLoginRequest,
  type AdminProfile,
  type ApproveCreatorRequestResponse,
  type AuditLogDetail,
  type CreatorDetailResponse,
  type HistoryQuery,
  type HistoryResponse,
  type BlockUserResponse,
  type UnblockUserResponse,
  type UserBlockCheckResponse,
  type CreatorSubscribersQuery,
  type CreatorSubscribersResponse,
  type GrantableCreatorsResponse,
  type GrantableUsersResponse,
  type SubscriptionDetailResponse,
  type SubscriptionEventsQuery,
  type SubscriptionEventsResponse,
  type SubscriptionActionResponse,
  type SubscriptionListQuery,
  type SubscriptionListResponse,
  type BlockCreatorResponse,
  type CreatorBlockCheckResponse,
  type UnblockCreatorResponse,
  type CreatorListQuery,
  type CreatorListResponse,
  type UserDetailResponse,
  type UserListQuery,
  type UserRequestDetail,
  type UserRequestsQuery,
  type UserRequestsResponse,
  type UserListResponse,
  type CreatorRequestReviewResponse,
  type ErrorCode,
  type RejectCreatorRequestResponse,
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

/**
 * Reviewing creator requests (US-012). Errors are `ApiError`s that keep `code` and `details`, e.g.
 * 409 `CREATOR_APPROVAL_BLOCKED` with the subscription that stops an approval.
 */
export interface CreatorReviewApi {
  /** The request, its applicant and the approval pre-check. */
  getCreatorRequest(id: string): Promise<CreatorRequestReviewResponse>;
  approveCreatorRequest(id: string): Promise<ApproveCreatorRequestResponse>;
  rejectCreatorRequest(id: string, reason: string): Promise<RejectCreatorRequestResponse>;
}

/** The Creator list (US-014). A superseded call is cancelled through `signal`. */
export interface CreatorListApi {
  listCreators(query: CreatorListQuery, signal?: AbortSignal): Promise<CreatorListResponse>;
}

/** The query string for a list query: defaults are left out, so the URL stays short. */
export function creatorListSearch(query: CreatorListQuery): string {
  const d = DEFAULT_CREATOR_LIST_QUERY;
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status.join() !== d.status.join()) params.set('status', query.status.join(','));
  if (query.type !== d.type) params.set('type', query.type);
  if (query.range !== d.range) params.set('range', query.range);
  if (query.sort !== d.sort) params.set('sort', query.sort);
  if (query.dir !== d.dir) params.set('dir', query.dir);
  if (query.page !== d.page) params.set('page', String(query.page));
  if (query.page_size !== d.page_size) params.set('page_size', String(query.page_size));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** The User list (US-017). */
export interface UserListApi {
  listUsers(query: UserListQuery, signal?: AbortSignal): Promise<UserListResponse>;
}

/** Same rule as `creatorListSearch`: defaults are left out. */
export function userListSearch(query: UserListQuery): string {
  const d = DEFAULT_USER_LIST_QUERY;
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status.join() !== d.status.join()) params.set('status', query.status.join(','));
  if (query.request.join() !== d.request.join()) params.set('request', query.request.join(','));
  if (query.access !== d.access) params.set('access', query.access);
  if (query.range !== d.range) params.set('range', query.range);
  if (query.sort !== d.sort) params.set('sort', query.sort);
  if (query.dir !== d.dir) params.set('dir', query.dir);
  if (query.page !== d.page) params.set('page', String(query.page));
  if (query.page_size !== d.page_size) params.set('page_size', String(query.page_size));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Creator detail, a person's History and one audit entry (US-015). A 404 is an `ApiError`. */
export interface CreatorDetailApi {
  getCreatorDetail(id: string, signal?: AbortSignal): Promise<CreatorDetailResponse>;
  listCreatorHistory(
    id: string,
    query: HistoryQuery,
    signal?: AbortSignal,
  ): Promise<HistoryResponse>;
  getAuditLog(id: string, signal?: AbortSignal): Promise<AuditLogDetail>;
}

/** The History query string; defaults are left out. */
export function historySearch(query: HistoryQuery): string {
  const d = DEFAULT_HISTORY_QUERY;
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.type !== d.type) params.set('type', query.type);
  if (query.status !== d.status) params.set('status', query.status);
  if (query.sort !== d.sort) params.set('sort', query.sort);
  if (query.dir !== d.dir) params.set('dir', query.dir);
  if (query.page !== d.page) params.set('page', String(query.page));
  if (query.page_size !== d.page_size) params.set('page_size', String(query.page_size));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** User detail, the user's creator requests and History (US-018). A 404 is an `ApiError`. */
export interface UserDetailApi {
  getUserDetail(id: string, signal?: AbortSignal): Promise<UserDetailResponse>;
  listUserRequests(
    id: string,
    query: UserRequestsQuery,
    signal?: AbortSignal,
  ): Promise<UserRequestsResponse>;
  getUserRequest(id: string, requestId: string, signal?: AbortSignal): Promise<UserRequestDetail>;
  listUserHistory(id: string, query: HistoryQuery, signal?: AbortSignal): Promise<HistoryResponse>;
}

/** The request-table query string; defaults are left out. */
export function userRequestsSearch(query: UserRequestsQuery): string {
  const d = DEFAULT_USER_REQUESTS_QUERY;
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status !== d.status) params.set('status', query.status);
  if (query.sort !== d.sort) params.set('sort', query.sort);
  if (query.dir !== d.dir) params.set('dir', query.dir);
  if (query.page !== d.page) params.set('page', String(query.page));
  if (query.page_size !== d.page_size) params.set('page_size', String(query.page_size));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Blocking and unblocking a creator (US-016). A 409 is an `ApiError` `CREATOR_STATUS_CONFLICT`. */
export interface CreatorModerationApi {
  getBlockCheck(creatorId: string): Promise<CreatorBlockCheckResponse>;
  blockCreator(creatorId: string, reason: string): Promise<BlockCreatorResponse>;
  unblockCreator(creatorId: string, reason: string): Promise<UnblockCreatorResponse>;
}

/** Blocking and unblocking a USER account (US-019). A 409 is `USER_STATUS_CONFLICT` or `USER_ROLE_CONFLICT`. */
export interface UserModerationApi {
  getUserBlockCheck(userId: string): Promise<UserBlockCheckResponse>;
  blockUser(userId: string, reason: string): Promise<BlockUserResponse>;
  unblockUser(userId: string, reason: string): Promise<UnblockUserResponse>;
}

/** The user's access to creators (US-020). Conflicts are `ApiError`s that keep `code` and `details`. */
export interface UserSubscriptionsApi {
  listUserSubscriptions(
    userId: string,
    query: SubscriptionListQuery,
    signal?: AbortSignal,
  ): Promise<SubscriptionListResponse>;
  getGrantableCreators(userId: string, signal?: AbortSignal): Promise<GrantableCreatorsResponse>;
  /** Exactly one of `duration_days` / `end_date` (`YYYY-MM-DD`). */
  grantAccess(
    userId: string,
    body: {
      creator_id: string;
      duration_days?: number;
      end_date?: string;
      reason: string;
      /** US-024: the pending request this grant answers. */
      access_request_id?: string;
    },
  ): Promise<SubscriptionActionResponse>;
  /** The user's pending trial / renewal requests (US-024). */
  listAccessRequests(userId: string, signal?: AbortSignal): Promise<AccessRequestsResponse>;
  /** Tolak. 404 / 409 `ACCESS_REQUEST_ALREADY_REVIEWED` (`details.status`) arrive as `ApiError`. */
  rejectAccessRequest(
    userId: string,
    requestId: string,
    reason: string,
  ): Promise<RejectAccessRequestResponse>;
  extendAccess(
    userId: string,
    subscriptionId: string,
    body: { duration_days: number; reason: string },
  ): Promise<SubscriptionActionResponse>;
  revokeAccess(
    userId: string,
    subscriptionId: string,
    reason: string,
  ): Promise<SubscriptionActionResponse>;
}

/** The subscription-table query string; defaults are left out. */
export function subscriptionListSearch(query: SubscriptionListQuery): string {
  const d = DEFAULT_SUBSCRIPTION_LIST_QUERY;
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status !== d.status) params.set('status', query.status);
  if (query.ends !== d.ends) params.set('ends', query.ends);
  if (query.sort !== d.sort) params.set('sort', query.sort);
  if (query.dir !== d.dir) params.set('dir', query.dir);
  if (query.page !== d.page) params.set('page', String(query.page));
  if (query.page_size !== d.page_size) params.set('page_size', String(query.page_size));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** One subscription with its access history, and a creator's subscribers (US-021). A 404 is an `ApiError`. */
export interface SubscriptionDetailApi {
  getSubscription(
    userId: string,
    subscriptionId: string,
    signal?: AbortSignal,
  ): Promise<SubscriptionDetailResponse>;
  listSubscriptionEvents(
    userId: string,
    subscriptionId: string,
    query: SubscriptionEventsQuery,
    signal?: AbortSignal,
  ): Promise<SubscriptionEventsResponse>;
  listCreatorSubscribers(
    creatorId: string,
    query: CreatorSubscribersQuery,
    signal?: AbortSignal,
  ): Promise<CreatorSubscribersResponse>;
  listGrantableUsers(
    creatorId: string,
    q: string | null,
    signal?: AbortSignal,
  ): Promise<GrantableUsersResponse>;
}

/** Query strings of the US-021 reads; defaults are left out. */
export function subscriptionEventsSearch(query: SubscriptionEventsQuery): string {
  const d = DEFAULT_SUBSCRIPTION_EVENTS_QUERY;
  const params = new URLSearchParams();
  if (query.sort !== d.sort) params.set('sort', query.sort);
  if (query.dir !== d.dir) params.set('dir', query.dir);
  if (query.page !== d.page) params.set('page', String(query.page));
  if (query.page_size !== d.page_size) params.set('page_size', String(query.page_size));
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function creatorSubscribersSearch(query: CreatorSubscribersQuery): string {
  const d = DEFAULT_CREATOR_SUBSCRIBERS_QUERY;
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status !== d.status) params.set('status', query.status);
  if (query.ends !== d.ends) params.set('ends', query.ends);
  if (query.sort !== d.sort) params.set('sort', query.sort);
  if (query.dir !== d.dir) params.set('dir', query.dir);
  if (query.page !== d.page) params.set('page', String(query.page));
  if (query.page_size !== d.page_size) params.set('page_size', String(query.page_size));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** A creator's gallery for admins (US-035), read-only. */
export interface CreatorGalleryApi {
  listCreatorGallery(
    creatorId: string,
    query: AdminGalleryQuery,
    signal?: AbortSignal,
  ): Promise<AdminGalleryResponse>;
  /** 404 (`ApiError`) for an unknown creator, or media that is not one of that creator's gallery items. */
  getCreatorMedia(
    creatorId: string,
    assetId: string,
    signal?: AbortSignal,
  ): Promise<AdminMediaDetail>;
}

export function adminGallerySearch(query: AdminGalleryQuery): string {
  const d = DEFAULT_ADMIN_GALLERY_QUERY;
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.kind !== d.kind) params.set('kind', query.kind);
  if (query.uploaded !== d.uploaded) params.set('uploaded', query.uploaded);
  if (query.sort !== d.sort) params.set('sort', query.sort);
  if (query.dir !== d.dir) params.set('dir', query.dir);
  if (query.page !== d.page) params.set('page', String(query.page));
  if (query.page_size !== d.page_size) params.set('page_size', String(query.page_size));
  const text = params.toString();
  return text ? `?${text}` : '';
}

export interface AdminApi
  extends
    CreatorReviewApi,
    CreatorListApi,
    CreatorDetailApi,
    UserDetailApi,
    UserListApi,
    CreatorModerationApi,
    UserModerationApi,
    UserSubscriptionsApi,
    SubscriptionDetailApi,
    CreatorGalleryApi {
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

  async function send(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
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
        ...(signal ? { signal } : {}),
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
    signal?: AbortSignal,
  ): Promise<Response> {
    const response = await send(method, path, body, signal);
    if (response.ok) return response;
    const error = await toApiError(response);
    if (response.status === 401 && renewOn401) {
      if (await refreshSession()) return request(method, path, body, false, signal);
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
    async listCreators(query, signal) {
      const response = await request(
        'GET',
        `${ADMIN_CREATORS_PATH}${creatorListSearch(query)}`,
        undefined,
        true,
        signal,
      );
      return CreatorListResponseSchema.parse(await response.json());
    },
    async listUsers(query, signal) {
      const response = await request(
        'GET',
        `${ADMIN_USERS_PATH}${userListSearch(query)}`,
        undefined,
        true,
        signal,
      );
      return UserListResponseSchema.parse(await response.json());
    },
    async getCreatorRequest(id) {
      const response = await request(
        'GET',
        `${ADMIN_CREATOR_REQUESTS_PATH}/${encodeURIComponent(id)}`,
      );
      return CreatorRequestReviewResponseSchema.parse(await response.json());
    },
    async approveCreatorRequest(id) {
      const response = await request(
        'POST',
        `${ADMIN_CREATOR_REQUESTS_PATH}/${encodeURIComponent(id)}/approve`,
      );
      return ApproveCreatorRequestResponseSchema.parse(await response.json());
    },
    async rejectCreatorRequest(id, reason) {
      const response = await request(
        'POST',
        `${ADMIN_CREATOR_REQUESTS_PATH}/${encodeURIComponent(id)}/reject`,
        { reason },
      );
      return RejectCreatorRequestResponseSchema.parse(await response.json());
    },
    async getCreatorDetail(id, signal) {
      const response = await request(
        'GET',
        `${ADMIN_CREATORS_PATH}/${encodeURIComponent(id)}`,
        undefined,
        true,
        signal,
      );
      return CreatorDetailResponseSchema.parse(await response.json());
    },
    async listCreatorHistory(id, query, signal) {
      const response = await request(
        'GET',
        `${ADMIN_CREATORS_PATH}/${encodeURIComponent(id)}/history${historySearch(query)}`,
        undefined,
        true,
        signal,
      );
      return HistoryResponseSchema.parse(await response.json());
    },
    async getAuditLog(id, signal) {
      const response = await request(
        'GET',
        `${ADMIN_AUDIT_LOGS_PATH}/${encodeURIComponent(id)}`,
        undefined,
        true,
        signal,
      );
      return AuditLogDetailSchema.parse(await response.json());
    },
    async getUserDetail(id, signal) {
      const response = await request(
        'GET',
        `${ADMIN_USERS_PATH}/${encodeURIComponent(id)}`,
        undefined,
        true,
        signal,
      );
      return UserDetailResponseSchema.parse(await response.json());
    },
    async listUserRequests(id, query, signal) {
      const response = await request(
        'GET',
        `${ADMIN_USERS_PATH}/${encodeURIComponent(id)}/requests${userRequestsSearch(query)}`,
        undefined,
        true,
        signal,
      );
      return UserRequestsResponseSchema.parse(await response.json());
    },
    async getUserRequest(id, requestId, signal) {
      const response = await request(
        'GET',
        `${ADMIN_USERS_PATH}/${encodeURIComponent(id)}/requests/${encodeURIComponent(requestId)}`,
        undefined,
        true,
        signal,
      );
      return UserRequestDetailSchema.parse(await response.json());
    },
    async listUserHistory(id, query, signal) {
      const response = await request(
        'GET',
        `${ADMIN_USERS_PATH}/${encodeURIComponent(id)}/history${historySearch(query)}`,
        undefined,
        true,
        signal,
      );
      return HistoryResponseSchema.parse(await response.json());
    },
    async getBlockCheck(id) {
      const response = await request(
        'GET',
        `${ADMIN_CREATORS_PATH}/${encodeURIComponent(id)}/block-check`,
      );
      return CreatorBlockCheckResponseSchema.parse(await response.json());
    },
    async blockCreator(id, reason) {
      const response = await request(
        'POST',
        `${ADMIN_CREATORS_PATH}/${encodeURIComponent(id)}/block`,
        { reason },
      );
      return BlockCreatorResponseSchema.parse(await response.json());
    },
    async unblockCreator(id, reason) {
      const response = await request(
        'POST',
        `${ADMIN_CREATORS_PATH}/${encodeURIComponent(id)}/unblock`,
        { reason },
      );
      return UnblockCreatorResponseSchema.parse(await response.json());
    },
    async getUserBlockCheck(id) {
      const response = await request(
        'GET',
        `${ADMIN_USERS_PATH}/${encodeURIComponent(id)}/block-check`,
      );
      return UserBlockCheckResponseSchema.parse(await response.json());
    },
    async blockUser(id, reason) {
      const response = await request(
        'POST',
        `${ADMIN_USERS_PATH}/${encodeURIComponent(id)}/block`,
        { reason },
      );
      return BlockUserResponseSchema.parse(await response.json());
    },
    async unblockUser(id, reason) {
      const response = await request(
        'POST',
        `${ADMIN_USERS_PATH}/${encodeURIComponent(id)}/unblock`,
        { reason },
      );
      return UnblockUserResponseSchema.parse(await response.json());
    },
    async getSubscription(userId, subscriptionId, signal) {
      const response = await request(
        'GET',
        `${ADMIN_USERS_PATH}/${encodeURIComponent(userId)}/subscriptions/${encodeURIComponent(subscriptionId)}`,
        undefined,
        true,
        signal,
      );
      return SubscriptionDetailResponseSchema.parse(await response.json());
    },
    async listSubscriptionEvents(userId, subscriptionId, query, signal) {
      const response = await request(
        'GET',
        `${ADMIN_USERS_PATH}/${encodeURIComponent(userId)}/subscriptions/${encodeURIComponent(subscriptionId)}/events${subscriptionEventsSearch(query)}`,
        undefined,
        true,
        signal,
      );
      return SubscriptionEventsResponseSchema.parse(await response.json());
    },
    async listCreatorSubscribers(creatorId, query, signal) {
      const response = await request(
        'GET',
        `${ADMIN_CREATORS_PATH}/${encodeURIComponent(creatorId)}/subscribers${creatorSubscribersSearch(query)}`,
        undefined,
        true,
        signal,
      );
      return CreatorSubscribersResponseSchema.parse(await response.json());
    },
    async listCreatorGallery(creatorId, query, signal) {
      const response = await request(
        'GET',
        `${adminCreatorGalleryPath(creatorId)}${adminGallerySearch(query)}`,
        undefined,
        true,
        signal,
      );
      return AdminGalleryResponseSchema.parse(await response.json());
    },
    async getCreatorMedia(creatorId, assetId, signal) {
      const response = await request(
        'GET',
        adminCreatorMediaPath(creatorId, assetId),
        undefined,
        true,
        signal,
      );
      return AdminMediaDetailSchema.parse(await response.json());
    },
    async listGrantableUsers(creatorId, q, signal) {
      const search = q ? `?${new URLSearchParams({ q }).toString()}` : '';
      const response = await request(
        'GET',
        `${ADMIN_CREATORS_PATH}/${encodeURIComponent(creatorId)}/grantable-users${search}`,
        undefined,
        true,
        signal,
      );
      return GrantableUsersResponseSchema.parse(await response.json());
    },
    async listUserSubscriptions(userId, query, signal) {
      const response = await request(
        'GET',
        `${ADMIN_USERS_PATH}/${encodeURIComponent(userId)}/subscriptions${subscriptionListSearch(query)}`,
        undefined,
        true,
        signal,
      );
      return SubscriptionListResponseSchema.parse(await response.json());
    },
    async getGrantableCreators(userId, signal) {
      const response = await request(
        'GET',
        `${ADMIN_USERS_PATH}/${encodeURIComponent(userId)}/grantable-creators`,
        undefined,
        true,
        signal,
      );
      return GrantableCreatorsResponseSchema.parse(await response.json());
    },
    async grantAccess(userId, body) {
      const response = await request(
        'POST',
        `${ADMIN_USERS_PATH}/${encodeURIComponent(userId)}/subscriptions`,
        body,
      );
      return SubscriptionActionResponseSchema.parse(await response.json());
    },
    async listAccessRequests(userId, signal) {
      const response = await request(
        'GET',
        userAccessRequestsPath(userId),
        undefined,
        true,
        signal,
      );
      return AccessRequestsResponseSchema.parse(await response.json());
    },
    async rejectAccessRequest(userId, requestId, reason) {
      const response = await request('POST', rejectAccessRequestPath(userId, requestId), {
        reason,
      });
      return RejectAccessRequestResponseSchema.parse(await response.json());
    },
    async extendAccess(userId, subscriptionId, body) {
      const response = await request(
        'POST',
        `${ADMIN_USERS_PATH}/${encodeURIComponent(userId)}/subscriptions/${encodeURIComponent(subscriptionId)}/extend`,
        body,
      );
      return SubscriptionActionResponseSchema.parse(await response.json());
    },
    async revokeAccess(userId, subscriptionId, reason) {
      const response = await request(
        'POST',
        `${ADMIN_USERS_PATH}/${encodeURIComponent(userId)}/subscriptions/${encodeURIComponent(subscriptionId)}/revoke`,
        { reason },
      );
      return SubscriptionActionResponseSchema.parse(await response.json());
    },
    onSessionLost(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
