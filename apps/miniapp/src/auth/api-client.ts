import {
  WELCOME_MESSAGE_PATH,
  WelcomeMessageResponseSchema,
  type SaveWelcomeMessageBody,
  type WelcomeMessageResponse,
  NOTIFICATION_PREFERENCES_PATH,
  NotificationPreferencesResponseSchema,
  type NotificationPreferencesResponse,
  type UpdateNotificationPreferencesBody,
  BroadcastSchema,
  CREATOR_GALLERY_PATH,
  creatorBroadcastsPath,
  type BroadcastView,
  type CreateBroadcastBody,
  CREATOR_MEDIA_LIMITS_PATH,
  CREATOR_MEDIA_UPLOADS_PATH,
  CreatorGalleryResponseSchema,
  MediaAssetResponseSchema,
  MediaLimitsSchema,
  MediaUploadInitResponseSchema,
  ChatMediaDetailSchema,
  chatMediaItemPath,
  CreatorGalleryItemDetailSchema,
  creatorGalleryItemPath,
  creatorMediaCompletePath,
  CustomerGalleryItemDetailSchema,
  CustomerGalleryResponseSchema,
  customerGalleryItemPath,
  customerGalleryPath,
  creatorMediaPath,
  CREATOR_INBOX_PATH,
  CREATOR_UNREAD_PATH,
  CreatorUnreadResponseSchema,
  ReadResponseSchema,
  chatReadPath,
  creatorReadPath,
  type CreatorUnreadResponse,
  type ReadResponse,
  InboxResponseSchema,
  type InboxFilter,
  type InboxResponse,
  CREATOR_REQUEST_PATH,
  ChatHistoryResponseSchema,
  CreatorChatHistoryResponseSchema,
  CreatorCustomerDetailResponseSchema,
  CreatorSendMessageResponseSchema,
  creatorChatMessagesPath,
  creatorCustomerPath,
  type CreatorChatHistoryResponse,
  type CreatorCustomerDetailResponse,
  type CreatorSendMessageBody,
  type CreatorSendMessageResponse,
  SendMessageResponseSchema,
  chatMessagesPath,
  type ChatHistoryResponse,
  type SendMessageBody,
  type SendMessageResponse,
  CreatorProfileResponseSchema,
  EXPLORE_PATH,
  ExploreResponseSchema,
  CreatorRequestStateResponseSchema,
  SubmitCreatorRequestResponseSchema,
  accessRequestPath,
  creatorByCodePath,
  SubmitAccessRequestResponseSchema,
  SUBSCRIPTIONS_PATH,
  CHAT_LIST_PATH,
  CHAT_UNREAD_PATH,
  ChatListResponseSchema,
  ChatUnreadResponseSchema,
  type ChatListQuery,
  type ChatListResponse,
  type ChatUnreadResponse,
  SubscriptionsResponseSchema,
  type SubscriptionsResponse,
  CREATOR_PROFILE_PATH,
  CREATOR_TIMEZONE_PATH,
  CREATOR_SETTINGS_PATH,
  CreatorSettingsResponseSchema,
  ErrorResponseSchema,
  MeResponseSchema,
  PROFILE_PATH,
  TelegramLoginResponseSchema,
  UpdateProfileResponseSchema,
  USER_AUTH_PATH,
  type CreatorProfileResponse,
  type ExploreQuery,
  type ExploreResponse,
  type CreatorRequestStateResponse,
  type CreatorSettingsResponse,
  type SubmitAccessRequestResponse,
  type SubmitCreatorRequest,
  type SubmitCreatorRequestResponse,
  type ErrorCode,
  type TimezoneId,
  type UpdateProfileRequest,
  type UserProfile,
  type ChatMediaDetail,
  type CreatorGalleryItemDetail,
  type CreatorGalleryResponse,
  type CustomerGalleryItemDetail,
  type CustomerGalleryResponse,
  type MediaAssetResponse,
  type MediaLimits,
  type MediaUploadInitBody,
  type MediaUploadInitResponse,
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
  /** Resolves a creator code to the profile and the viewer's access state. 404 CREATOR_NOT_FOUND / 403 FORBIDDEN_ROLE arrive as ApiError. */
  resolveCreator(publicCode: string): Promise<CreatorProfileResponse>;
  /** USER only: asks for trial / renewal access to this creator (idempotent while pending). 409 ACCESS_ALREADY_ACTIVE / 404 CREATOR_NOT_FOUND arrive as ApiError. */
  requestAccess(publicCode: string): Promise<SubmitAccessRequestResponse>;
  /** USER only: my conversations, newest activity first, one page by keyset cursor. */
  listChats(query: {
    cursor?: string | undefined;
    limit: ChatListQuery['limit'];
  }): Promise<ChatListResponse>;
  /** USER only: my total unread count (the bottom-nav badge). */
  getChatUnread(): Promise<ChatUnreadResponse>;
  /** USER only: the customer's own creators for Langganan, ordered by the server. */
  listSubscriptions(): Promise<SubscriptionsResponse>;
  /** USER only: the creators to explore, one page, each with the viewer's own access chip. */
  listCreators(query: ExploreQuery): Promise<ExploreResponse>;
  /** Saves the caller's own profile (full desired values); returns the account as saved. */
  updateProfile(input: UpdateProfileRequest): Promise<UserProfile>;
  /** Creator only: own profile, public code and the bio link (403 for anyone else). */
  getCreatorSettings(): Promise<CreatorSettingsResponse>;
  /** Creator only: same as `updateProfile`, for the creator's public profile. */
  updateCreatorProfile(input: UpdateProfileRequest): Promise<UserProfile>;
  /** Creator only: sets the display timezone (display only); returns the account as saved. */
  updateCreatorTimezone(timezone: TimezoneId): Promise<UserProfile>;
  /** CREATOR only: my welcome message (off and empty before it was ever saved). */
  getWelcomeMessage(): Promise<WelcomeMessageResponse>;
  /** CREATOR only: replaces the whole welcome message; the same body twice changes nothing. 404 MEDIA_NOT_FOUND, 409 MEDIA_NOT_READY arrive as ApiError. */
  saveWelcomeMessage(body: SaveWelcomeMessageBody): Promise<WelcomeMessageResponse>;
  /** USER only: my Telegram notification choices (the defaults when I never changed them). */
  getNotificationPreferences(): Promise<NotificationPreferencesResponse>;
  /** USER only: changes only the named switches; answers the whole new state. */
  updateNotificationPreferences(
    body: UpdateNotificationPreferencesBody,
  ): Promise<NotificationPreferencesResponse>;
  /** USER only: the latest creator request and, if any, the subscription that blocks a new one. */
  getCreatorRequestState(): Promise<CreatorRequestStateResponse>;
  /** USER only: submits the request (idempotent while one is pending). 409 CREATOR_REQUEST_BLOCKED arrives as ApiError. */
  submitCreatorRequest(input: SubmitCreatorRequest): Promise<SubmitCreatorRequestResponse>;
  /** USER only: one page of the chat history, newest first. 404 NOT_FOUND arrives as ApiError. */
  getChatHistory(
    conversationId: string,
    query?: { before?: number; limit?: number },
  ): Promise<ChatHistoryResponse>;
  /** USER only: sends text; the same `client_message_id` returns the same message. 403 CHAT_ACCESS_EXPIRED / CHAT_CREATOR_BLOCKED, 409 IDEMPOTENCY_CONFLICT arrive as ApiError. */
  sendChatMessage(conversationId: string, input: SendMessageBody): Promise<SendMessageResponse>;
  /** CREATOR only: one page of a conversation of mine, newest first. 404 NOT_FOUND arrives as ApiError. */
  getCreatorChatHistory(
    conversationId: string,
    query?: { before?: number; limit?: number },
  ): Promise<CreatorChatHistoryResponse>;
  /** CREATOR only: sends text; the same `client_message_id` returns the same message. 403 CHAT_ACCESS_EXPIRED, 409 IDEMPOTENCY_CONFLICT arrive as ApiError. */
  sendCreatorChatMessage(
    conversationId: string,
    input: CreatorSendMessageBody,
  ): Promise<CreatorSendMessageResponse>;
  /** CREATOR only: the customer of one of my conversations and their access. 404 NOT_FOUND arrives as ApiError. */
  getCreatorCustomer(conversationId: string): Promise<CreatorCustomerDetailResponse>;
  /** CREATOR only: one page of the inbox (newest activity first). 403 FORBIDDEN_ROLE arrives as ApiError. */
  getCreatorInbox(query: {
    filter: InboxFilter;
    cursor?: string | null;
    limit?: number;
  }): Promise<InboxResponse>;
  /** CREATOR only: sends a photo or video (+ optional text) to every active subscriber; the same `client_broadcast_id` returns the same broadcast. 409 NO_ACTIVE_SUBSCRIBERS / MEDIA_NOT_READY / IDEMPOTENCY_CONFLICT, 404 MEDIA_NOT_FOUND, 429 RATE_LIMITED arrive as ApiError. */
  createBroadcast(body: CreateBroadcastBody): Promise<BroadcastView>;
  /** CREATOR only: upload limits (bytes, seconds). */
  getMediaLimits(): Promise<MediaLimits>;
  /** CREATOR only: starts an upload; the same `client_upload_id` returns the same asset with a fresh link. 400 MEDIA_TYPE_NOT_ALLOWED / MEDIA_TOO_LARGE, 429 MEDIA_RATE_LIMITED arrive as ApiError. */
  initMediaUpload(body: MediaUploadInitBody): Promise<MediaUploadInitResponse>;
  /** CREATOR only: tells the server the file was uploaded. 409 MEDIA_UPLOAD_INCOMPLETE means upload it again. */
  completeMediaUpload(assetId: string): Promise<MediaAssetResponse>;
  /** CREATOR only: one of my assets (poll while it is processed). 404 MEDIA_NOT_FOUND arrives as ApiError. */
  getMedia(assetId: string): Promise<MediaAssetResponse>;
  /** CREATOR only: my gallery, newest first. */
  getGallery(query?: { cursor?: string | null; limit?: number }): Promise<CreatorGalleryResponse>;
  /** CREATOR only: one gallery item for the viewer (5-minute file link, position, neighbours). 404 MEDIA_NOT_FOUND arrives as ApiError. */
  getGalleryItem(assetId: string): Promise<CreatorGalleryItemDetail>;
  /** USER only: a creator's gallery, only with active access. 403 GALLERY_ACCESS_REQUIRED, 404 CREATOR_NOT_FOUND arrive as ApiError. */
  getCustomerGallery(
    publicCode: string,
    query?: { cursor?: string | null; limit?: number },
  ): Promise<CustomerGalleryResponse>;
  /** USER only: one item for the viewer. 403 GALLERY_ACCESS_REQUIRED, 404 MEDIA_NOT_FOUND arrive as ApiError. */
  getCustomerGalleryItem(publicCode: string, assetId: string): Promise<CustomerGalleryItemDetail>;
  /** USER only: one file of my conversation with a 5-minute link, its place and neighbours. Opens after the access ended too. 404 NOT_FOUND arrives as ApiError. */
  getChatMediaItem(conversationId: string, attachmentId: string): Promise<ChatMediaDetail>;
  /** USER only: moves my read cursor in a chat up to `throughSeq` (never down). 404 NOT_FOUND arrives as ApiError. */
  markChatRead(conversationId: string, throughSeq: number): Promise<ReadResponse>;
  /** CREATOR only: moves my read cursor in one of my conversations up to `throughSeq`. */
  markCreatorRead(conversationId: string, throughSeq: number): Promise<ReadResponse>;
  /** CREATOR only: conversations with unread customer messages (the Inbox tab badge). */
  getCreatorUnread(): Promise<CreatorUnreadResponse>;
  /** The in-memory access token (null before login); the realtime socket reads it at every connect. */
  getAccessToken(): string | null;
  /** Re-exchanges Telegram's data for a fresh token. Null when the session is lost (listeners are told); a NetworkError is thrown when offline. */
  renewAccessToken(): Promise<string | null>;
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

  async function authorized(
    method: string,
    path: string,
    body?: unknown,
    retried = false,
  ): Promise<Response> {
    const response = await send(method, path, { authorize: true, body });
    if (response.ok) return response;
    if (response.status === 401 && !retried && (await renew())) {
      return authorized(method, path, body, true);
    }
    throw await toApiError(response);
  }

  return {
    loginWithTelegram: exchange,
    getAccessToken: () => token,
    async renewAccessToken() {
      return (await renew()) ? token : null;
    },
    async me() {
      return MeResponseSchema.parse(await (await authorized('GET', '/v1/me')).json());
    },
    async resolveCreator(publicCode) {
      const response = await authorized('GET', creatorByCodePath(publicCode));
      return CreatorProfileResponseSchema.parse(await response.json());
    },
    async requestAccess(publicCode) {
      const response = await authorized('POST', accessRequestPath(publicCode));
      return SubmitAccessRequestResponseSchema.parse(await response.json());
    },
    async listChats(query) {
      const params = new URLSearchParams({ limit: String(query.limit) });
      if (query.cursor) params.set('cursor', query.cursor);
      const response = await authorized('GET', `${CHAT_LIST_PATH}?${params.toString()}`);
      return ChatListResponseSchema.parse(await response.json());
    },
    async markChatRead(conversationId, throughSeq) {
      const response = await authorized('POST', chatReadPath(conversationId), {
        through_seq: throughSeq,
      });
      return ReadResponseSchema.parse(await response.json());
    },
    async markCreatorRead(conversationId, throughSeq) {
      const response = await authorized('POST', creatorReadPath(conversationId), {
        through_seq: throughSeq,
      });
      return ReadResponseSchema.parse(await response.json());
    },
    async getCreatorUnread() {
      const response = await authorized('GET', CREATOR_UNREAD_PATH);
      return CreatorUnreadResponseSchema.parse(await response.json());
    },
    async getChatUnread() {
      const response = await authorized('GET', CHAT_UNREAD_PATH);
      return ChatUnreadResponseSchema.parse(await response.json());
    },
    async listSubscriptions() {
      const response = await authorized('GET', SUBSCRIPTIONS_PATH);
      return SubscriptionsResponseSchema.parse(await response.json());
    },
    async listCreators(query) {
      const params = new URLSearchParams({
        page: String(query.page),
        page_size: String(query.page_size),
      });
      const response = await authorized('GET', `${EXPLORE_PATH}?${params.toString()}`);
      return ExploreResponseSchema.parse(await response.json());
    },
    async updateProfile(input) {
      const response = await authorized('PATCH', PROFILE_PATH, input);
      return UpdateProfileResponseSchema.parse(await response.json());
    },
    async getWelcomeMessage() {
      const response = await authorized('GET', WELCOME_MESSAGE_PATH);
      return WelcomeMessageResponseSchema.parse(await response.json());
    },
    async saveWelcomeMessage(body) {
      const response = await authorized('PUT', WELCOME_MESSAGE_PATH, body);
      return WelcomeMessageResponseSchema.parse(await response.json());
    },
    async getNotificationPreferences() {
      const response = await authorized('GET', NOTIFICATION_PREFERENCES_PATH);
      return NotificationPreferencesResponseSchema.parse(await response.json());
    },
    async updateNotificationPreferences(body) {
      const response = await authorized('PATCH', NOTIFICATION_PREFERENCES_PATH, body);
      return NotificationPreferencesResponseSchema.parse(await response.json());
    },
    async getCreatorSettings() {
      const response = await authorized('GET', CREATOR_SETTINGS_PATH);
      return CreatorSettingsResponseSchema.parse(await response.json());
    },
    async updateCreatorProfile(input) {
      const response = await authorized('PATCH', CREATOR_PROFILE_PATH, input);
      return UpdateProfileResponseSchema.parse(await response.json());
    },
    async updateCreatorTimezone(timezone) {
      const response = await authorized('PATCH', CREATOR_TIMEZONE_PATH, { timezone });
      return UpdateProfileResponseSchema.parse(await response.json());
    },
    async getCreatorRequestState() {
      const response = await authorized('GET', CREATOR_REQUEST_PATH);
      return CreatorRequestStateResponseSchema.parse(await response.json());
    },
    async submitCreatorRequest(input) {
      const response = await authorized('POST', CREATOR_REQUEST_PATH, input);
      return SubmitCreatorRequestResponseSchema.parse(await response.json());
    },
    async getChatHistory(conversationId, query = {}) {
      const params = new URLSearchParams();
      if (query.before !== undefined) params.set('before', String(query.before));
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      const qs = params.size > 0 ? `?${params.toString()}` : '';
      const response = await authorized('GET', `${chatMessagesPath(conversationId)}${qs}`);
      return ChatHistoryResponseSchema.parse(await response.json());
    },
    async sendChatMessage(conversationId, input) {
      const response = await authorized('POST', chatMessagesPath(conversationId), input);
      return SendMessageResponseSchema.parse(await response.json());
    },
    async getCreatorChatHistory(conversationId, query = {}) {
      const params = new URLSearchParams();
      if (query.before !== undefined) params.set('before', String(query.before));
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      const qs = params.size > 0 ? `?${params.toString()}` : '';
      const response = await authorized('GET', `${creatorChatMessagesPath(conversationId)}${qs}`);
      return CreatorChatHistoryResponseSchema.parse(await response.json());
    },
    async sendCreatorChatMessage(conversationId, input) {
      const response = await authorized('POST', creatorChatMessagesPath(conversationId), input);
      return CreatorSendMessageResponseSchema.parse(await response.json());
    },
    async getCreatorCustomer(conversationId) {
      const response = await authorized('GET', creatorCustomerPath(conversationId));
      return CreatorCustomerDetailResponseSchema.parse(await response.json());
    },
    async createBroadcast(body) {
      const response = await authorized('POST', creatorBroadcastsPath, body);
      return BroadcastSchema.parse(await response.json());
    },
    async getMediaLimits() {
      const response = await authorized('GET', CREATOR_MEDIA_LIMITS_PATH);
      return MediaLimitsSchema.parse(await response.json());
    },
    async initMediaUpload(body) {
      const response = await authorized('POST', CREATOR_MEDIA_UPLOADS_PATH, body);
      return MediaUploadInitResponseSchema.parse(await response.json());
    },
    async completeMediaUpload(assetId) {
      const response = await authorized('POST', creatorMediaCompletePath(assetId));
      return MediaAssetResponseSchema.parse(await response.json());
    },
    async getMedia(assetId) {
      const response = await authorized('GET', creatorMediaPath(assetId));
      return MediaAssetResponseSchema.parse(await response.json());
    },
    async getGallery(query = {}) {
      const params = new URLSearchParams();
      if (query.cursor) params.set('cursor', query.cursor);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      const qs = params.toString();
      const response = await authorized('GET', `${CREATOR_GALLERY_PATH}${qs ? `?${qs}` : ''}`);
      return CreatorGalleryResponseSchema.parse(await response.json());
    },
    async getGalleryItem(assetId) {
      const response = await authorized('GET', creatorGalleryItemPath(assetId));
      return CreatorGalleryItemDetailSchema.parse(await response.json());
    },
    async getCustomerGallery(publicCode, query = {}) {
      const params = new URLSearchParams();
      if (query.cursor) params.set('cursor', query.cursor);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      const qs = params.toString();
      const response = await authorized(
        'GET',
        `${customerGalleryPath(publicCode)}${qs ? `?${qs}` : ''}`,
      );
      return CustomerGalleryResponseSchema.parse(await response.json());
    },
    async getCustomerGalleryItem(publicCode, assetId) {
      const response = await authorized('GET', customerGalleryItemPath(publicCode, assetId));
      return CustomerGalleryItemDetailSchema.parse(await response.json());
    },
    async getChatMediaItem(conversationId, attachmentId) {
      const response = await authorized('GET', chatMediaItemPath(conversationId, attachmentId));
      return ChatMediaDetailSchema.parse(await response.json());
    },
    async getCreatorInbox(query) {
      const params = new URLSearchParams({ filter: query.filter });
      if (query.cursor) params.set('cursor', query.cursor);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      const response = await authorized('GET', `${CREATOR_INBOX_PATH}?${params.toString()}`);
      return InboxResponseSchema.parse(await response.json());
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
