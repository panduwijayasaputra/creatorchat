import type {
  ChatMediaDetail,
  CreatorGalleryItemDetail,
  CustomerGalleryItemDetail,
  CustomerGalleryResponse,
  PublicMediaItem,
  CreatorGalleryResponse,
  MediaAssetResponse,
  MediaAssetView,
  MediaLimits,
  MediaUploadInitBody,
  MediaUploadInitResponse,
  CreatorUnreadResponse,
  ReadResponse,
  CreatorChatHistoryResponse,
  CreatorChatMessage,
  CreatorCustomerDetailResponse,
  CreatorSendMessageResponse,
  CreatorSendMessageBody,
  ChatListResponse,
  ChatUnreadResponse,
  InboxFilter,
  InboxItem,
  InboxResponse,
  ChatHistoryResponse,
  ChatMessage,
  SendMessageBody,
  SendMessageResponse,
  SubscriptionsResponse,
  SubmitAccessRequestResponse,
  CreatorApplication,
  CreatorProfileResponse,
  ExploreQuery,
  ExploreResponse,
  CreatorRequestStateResponse,
  CreatorSettingsResponse,
  SubmitCreatorRequest,
  SubmitCreatorRequestResponse,
  UpdateProfileRequest,
  UserProfile,
} from '@creatorchat/contracts';
import type { SeenFlag } from '../src/auth/AuthProvider';
import {
  ApiError,
  NetworkError,
  type MiniappApi,
  type SessionLossReason,
} from '../src/auth/api-client';
import type { TelegramEnv } from '../src/telegram/webapp';

export const nadia: UserProfile = {
  id: '5b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e11',
  telegram_id: '424242',
  role: 'USER',
  status: 'ACTIVE',
  display_name: 'Nadia Putri',
  telegram_username: 'nadia',
  avatar_url: null,
  bio: null,
  telegram_avatar_url: null,
  timezone: 'Asia/Jakarta',
};

export const maya: UserProfile = {
  ...nadia,
  id: '9c1f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e22',
  role: 'CREATOR',
};

/** The two rows of the `Chats` board: Salsa with 2 unread, Kirana with ended access. */
export const BOARD_CHATS: ChatListResponse = {
  items: [
    {
      conversation_id: '44444444-0000-4000-8000-000000000001',
      public_code: 'salsa234',
      display_name: 'Salsa Maheswari',
      avatar_url: null,
      last_message: {
        preview: 'Gagal pertama itu wajar kok. Mulai dari adonan yang agak basah dulu.',
        at: '2026-11-17T02:14:00.000Z',
        media_kind: null,
      },
      unread_count: 2,
      access: 'ACTIVE',
    },
    {
      conversation_id: '44444444-0000-4000-8000-000000000002',
      public_code: 'kirana23',
      display_name: 'Kirana Larasati',
      avatar_url: null,
      last_message: {
        preview: 'Sampai ketemu di sesi berikutnya ya.',
        at: '2026-11-06T09:32:00.000Z',
        media_kind: null,
      },
      unread_count: 0,
      access: 'EXPIRED',
    },
  ],
  next_cursor: null,
};

/** The three cards of the `Subscriptions` board: Salsa Aktif, Dinda Menunggu, Kirana Berakhir. */
export const BOARD_SUBSCRIPTIONS: SubscriptionsResponse = {
  items: [
    {
      public_code: 'salsa234',
      display_name: 'Salsa Maheswari',
      avatar_url: null,
      access: { state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' },
      creator_available: true,
      conversation_id: '44444444-0000-4000-8000-000000000001',
    },
    {
      public_code: 'dinda234',
      display_name: 'Dinda Prameswari',
      avatar_url: null,
      access: { state: 'PENDING', requested_at: '2026-11-13T03:42:00.000Z', request_type: 'TRIAL' },
      creator_available: true,
      conversation_id: null,
    },
    {
      public_code: 'kirana23',
      display_name: 'Kirana Larasati',
      avatar_url: null,
      access: { state: 'EXPIRED', ended_at: '2026-11-06T16:59:59.000Z', revoked: false },
      creator_available: true,
      conversation_id: '44444444-0000-4000-8000-000000000002',
    },
  ],
};

export interface FakeMiniappApi extends MiniappApi {
  loginCalls: string[];
  meCalls: number;
  /** Next outcomes, consumed in order; default is success. */
  loginResults: (UserProfile | Error)[];
  meResults: (UserProfile | Error)[];
  loseSession(reason: SessionLossReason): void;
  /** Simulates a silent re-exchange that succeeded and returned this account. */
  renewSession(user: UserProfile): void;
  resolveCalls: string[];
  /** Next outcomes for resolveCreator, consumed in order; default is a creator named Salsa. */
  resolveResults: (CreatorProfileResponse | Error)[];
  /** Codes sent to requestAccess, and its next outcomes (default: a TRIAL request just made). */
  requestAccessCalls: string[];
  requestAccessResults: (SubmitAccessRequestResponse | Error)[];
  /** Next outcomes for listSubscriptions; default is the three cards of the Subscriptions board. */
  subscriptionsResults: (SubscriptionsResponse | Error)[];
  subscriptionCalls: number;
  exploreCalls: ExploreQuery[];
  /** Next outcomes for listCreators; default is one creator named Salsa with no relation. */
  exploreResults: (ExploreResponse | Error)[];
  updateProfileCalls: UpdateProfileRequest[];
  /** Next outcomes for getCreatorSettings; default is `maya` with a bot link. */
  creatorSettingsResults: (CreatorSettingsResponse | Error)[];
  creatorSettingsCalls: number;
  /** Inputs that went through the creator endpoint (also recorded in `updateProfileCalls`). */
  updateCreatorCalls: UpdateProfileRequest[];
  /** Zones sent to updateCreatorTimezone. */
  timezoneCalls: string[];
  /** Next outcomes for updateCreatorTimezone; default echoes the zone onto `maya`. */
  timezoneResults: (UserProfile | Error)[];
  /** Next outcomes for getCreatorRequestState; default is no request and no block. */
  creatorRequestStateResults: (CreatorRequestStateResponse | Error)[];
  creatorRequestStateCalls: number;
  /** Bodies sent to submitCreatorRequest, and its next outcomes (default: a PENDING request echoing the input). */
  submitRequestCalls: SubmitCreatorRequest[];
  submitRequestResults: (SubmitCreatorRequestResponse | Error)[];
  /** Next outcomes for updateProfile; default echoes the input onto `nadia`. */
  updateProfileResults: (UserProfile | Error)[];
  /** getChatHistory calls, and its next outcomes (default: an empty chat with active access). */
  chatHistoryCalls: { conversationId: string; before?: number; limit?: number }[];
  chatHistoryResults: (ChatHistoryResponse | Error | Promise<ChatHistoryResponse>)[];
  /** sendChatMessage calls, and its next outcomes (default: stores the text as the next message). A Promise lets a test hold the answer back. */
  chatSendCalls: SendMessageBody[];
  chatSendResults: (SendMessageResponse | Error | Promise<SendMessageResponse>)[];
  /** listChats calls, and its next outcomes (default: the two rows of the `Chats` board). */
  chatListCalls: { cursor?: string | undefined; limit: number }[];
  chatListResults: (ChatListResponse | Error | Promise<ChatListResponse>)[];
  /** getChatUnread calls, and its next outcomes (default: the board's 2). */
  chatUnreadCalls: number;
  chatUnreadResults: (ChatUnreadResponse | Error)[];
  /** markChatRead calls, and its next outcomes (default: the cursor moves to what was asked). */
  chatReadCalls: { conversationId: string; throughSeq: number }[];
  chatReadResults: (ReadResponse | Error | Promise<ReadResponse>)[];
  /** markCreatorRead calls and next outcomes (default: the cursor moves to what was asked). */
  creatorReadCalls: { conversationId: string; throughSeq: number }[];
  creatorReadResults: (ReadResponse | Error | Promise<ReadResponse>)[];
  /** getCreatorUnread calls, and its next outcomes (default: the board's 2). */
  creatorUnreadCalls: number;
  creatorUnreadResults: (CreatorUnreadResponse | Error)[];
  /** The token `getAccessToken` returns, `renewAccessToken` calls and its next outcomes (a token, null for a lost session, or an Error). */
  accessToken: string | null;
  renewCalls: number;
  renewResults: (string | null | Error)[];
  /** Creator chat: calls and next outcomes (defaults: an empty active chat; a send stores the text; a customer named Rani). */
  creatorChatHistoryCalls: { conversationId: string; before?: number; limit?: number }[];
  creatorChatHistoryResults: (
    CreatorChatHistoryResponse | Error | Promise<CreatorChatHistoryResponse>
  )[];
  creatorChatSendCalls: CreatorSendMessageBody[];
  creatorChatSendResults: (
    CreatorSendMessageResponse | Error | Promise<CreatorSendMessageResponse>
  )[];
  creatorCustomerCalls: string[];
  creatorCustomerResults: (CreatorCustomerDetailResponse | Error)[];
  /** getCreatorInbox calls, and its next outcomes (default: an empty inbox). */
  inboxCalls: { filter: InboxFilter; cursor?: string | null; limit?: number }[];
  inboxResults: (InboxResponse | Error | Promise<InboxResponse>)[];
  /** Creator media (US-032). Defaults: board limits; init makes a PENDING asset with an upload link; complete answers PROCESSING; getMedia answers READY; an empty gallery. */
  mediaLimitsResult: MediaLimits | Error;
  mediaInitCalls: MediaUploadInitBody[];
  mediaInitResults: (MediaUploadInitResponse | Error)[];
  mediaCompleteCalls: string[];
  mediaCompleteResults: (MediaAssetResponse | Error)[];
  mediaGetCalls: string[];
  mediaGetResults: (MediaAssetResponse | Error)[];
  galleryCalls: { cursor?: string | null; limit?: number }[];
  galleryResults: (CreatorGalleryResponse | Error | Promise<CreatorGalleryResponse>)[];
  galleryItemCalls: string[];
  galleryItemResults: (CreatorGalleryItemDetail | Error)[];
  /** A customer's view of a creator's gallery (US-034): default is an empty gallery. */
  customerGalleryCalls: { code: string; cursor?: string | null; limit?: number }[];
  customerGalleryResults: (CustomerGalleryResponse | Error | Promise<CustomerGalleryResponse>)[];
  customerGalleryItemCalls: { code: string; assetId: string }[];
  customerGalleryItemResults: (CustomerGalleryItemDetail | Error)[];
  /** A customer's chat files (US-037): calls and next outcomes (default: one photo). */
  chatMediaCalls: { conversationId: string; attachmentId: string }[];
  chatMediaResults: (ChatMediaDetail | Error)[];
}

/** A media asset as the API describes it (a READY photo unless given). */
export const mediaAsset = (n: number, over: Partial<MediaAssetView> = {}): MediaAssetView => ({
  id: `44444444-0000-4000-8000-${String(n).padStart(12, '0')}`,
  kind: 'PHOTO',
  state: 'READY',
  failure: null,
  duration_seconds: null,
  thumbnail_url: `http://localhost:3000/v1/dev-storage/m/t${n}?s=x`,
  created_at: '2026-11-18T03:00:00.000Z',
  ...over,
});

/** The viewer's answer for one item (alone in the gallery unless given). */
export const galleryDetail = (
  asset: MediaAssetView,
  over: Partial<CreatorGalleryItemDetail> = {},
): CreatorGalleryItemDetail => ({
  asset,
  original: {
    url: `http://localhost:3000/v1/dev-storage/m/o-${asset.id}?s=x`,
    expires_at: '2026-11-18T03:05:00.000Z',
  },
  uploaded_at: '2026-11-12T23:41:00.000Z',
  position: 1,
  total: 1,
  previous_id: null,
  next_id: null,
  ...over,
});

/** The viewer's answer for one file of a chat (alone in the conversation unless given). */
export const chatMediaDetail = (
  attachmentId: string,
  over: Partial<ChatMediaDetail> = {},
): ChatMediaDetail => ({
  item: {
    id: attachmentId,
    kind: 'PHOTO',
    duration_seconds: null,
    thumbnail_url: `http://localhost:3000/v1/dev-storage/m/t-${attachmentId}?s=x`,
  },
  original: {
    url: `http://localhost:3000/v1/dev-storage/m/o-${attachmentId}?s=x`,
    expires_at: '2026-11-17T05:05:00.000Z',
  },
  message: { body: 'Versi pedas buat akhir pekan ini.', created_at: '2026-11-17T02:16:00.000Z' },
  creator: { display_name: 'Salsa Maheswari' },
  position: 1,
  total: 1,
  previous_id: null,
  next_id: null,
  ...over,
});

/** What a subscriber sees of one item. */
export const publicItem = (n: number, over: Partial<PublicMediaItem> = {}): PublicMediaItem => ({
  id: `44444444-0000-4000-8000-${String(n).padStart(12, '0')}`,
  kind: 'PHOTO',
  duration_seconds: null,
  thumbnail_url: `http://localhost:3000/v1/dev-storage/m/t${n}?s=x`,
  ...over,
});

export const customerGalleryPage = (
  items: PublicMediaItem[],
  over: { total?: number; next_cursor?: string | null } = {},
): CustomerGalleryResponse => ({
  items,
  total: over.total ?? items.length,
  next_cursor: over.next_cursor ?? null,
});

export const customerDetail = (
  item: PublicMediaItem,
  over: Partial<CustomerGalleryItemDetail> = {},
): CustomerGalleryItemDetail => ({
  item,
  original: {
    url: `http://localhost:3000/v1/dev-storage/m/o-${item.id}?s=x`,
    expires_at: '2026-11-18T03:05:00.000Z',
  },
  uploaded_at: '2026-11-11T23:41:00.000Z',
  position: 1,
  total: 1,
  previous_id: null,
  next_id: null,
  ...over,
});

export const galleryPage = (
  assets: MediaAssetView[],
  over: { total?: number; next_cursor?: string | null } = {},
): CreatorGalleryResponse => ({
  items: assets.map((asset) => ({ asset, added_at: asset.created_at })),
  total: over.total ?? assets.length,
  next_cursor: over.next_cursor ?? null,
});

/** One inbox row (customer Rani, active access, no unread unless given). */
export const inboxItem = (n: number, over: Partial<InboxItem> = {}): InboxItem => ({
  conversation_id: `33333333-0000-4000-8000-${String(n).padStart(12, '0')}`,
  customer: { display_name: `Pelanggan ${n}`, avatar_url: null },
  preview: `Pesan ${n}`,
  preview_media_kind: null,
  last_message_at: '2026-11-17T02:20:00.000Z',
  unread_count: 0,
  access_active: true,
  ...over,
});

export const inboxPage = (
  items: InboxItem[],
  over: { next_cursor?: string | null; unread_conversations?: number } = {},
): InboxResponse => ({
  items,
  next_cursor: over.next_cursor ?? null,
  unread_conversations: over.unread_conversations ?? items.filter((i) => i.unread_count > 0).length,
});

/** One chat message as the API returns it (sender ME unless given). */
export const chatMessage = (seq: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
  client_message_id: `11111111-0000-4000-8000-${String(seq).padStart(12, '0')}`,
  seq,
  sender: 'CREATOR',
  type: 'TEXT',
  body: `pesan ${seq}`,
  attachments: [],
  created_at: '2026-11-17T02:05:00.000Z',
  ...over,
});

export const chatHistory = (
  items: ChatMessage[],
  over: {
    state?: 'ACTIVE' | 'EXPIRED' | 'CREATOR_BLOCKED';
    next_before?: number | null;
    name?: string;
    peer_read_seq?: number;
  } = {},
): ChatHistoryResponse => {
  const state = over.state ?? 'ACTIVE';
  return {
    conversation: {
      id: '22222222-0000-4000-8000-000000000001',
      creator: {
        public_code: 'salsa234',
        display_name: over.name ?? 'Salsa Maheswari',
        avatar_url: null,
      },
      access: {
        state,
        ends_at: state === 'ACTIVE' ? '2026-11-27T16:59:59.000Z' : null,
        ended_at: state === 'EXPIRED' ? '2026-11-06T16:59:59.000Z' : null,
      },
      peer_read_seq: over.peer_read_seq ?? 0,
    },
    items,
    next_before: over.next_before ?? null,
  };
};

export const creatorChatMessage = (
  seq: number,
  over: Partial<CreatorChatMessage> = {},
): CreatorChatMessage => ({
  id: `44444444-0000-4000-8000-${String(seq).padStart(12, '0')}`,
  client_message_id: `55555555-0000-4000-8000-${String(seq).padStart(12, '0')}`,
  seq,
  sender: 'CUSTOMER',
  type: 'TEXT',
  body: `pesan ${seq}`,
  attachments: [],
  origin: 'MANUAL',
  created_at: '2026-11-17T02:05:00.000Z',
  ...over,
});

export const creatorChatHistory = (
  items: CreatorChatMessage[],
  over: {
    state?: 'ACTIVE' | 'EXPIRED';
    next_before?: number | null;
    name?: string;
    ended_at?: string | null;
  } = {},
): CreatorChatHistoryResponse => {
  const state = over.state ?? 'ACTIVE';
  return {
    conversation: {
      id: '66666666-0000-4000-8000-000000000001',
      customer: { display_name: over.name ?? 'Rani Anggraini', avatar_url: null },
      access: {
        state,
        ends_at: state === 'ACTIVE' ? '2026-11-27T16:59:59.000Z' : null,
        ended_at: state === 'EXPIRED' ? (over.ended_at ?? '2026-11-06T16:59:59.000Z') : null,
      },
    },
    items,
    next_before: over.next_before ?? null,
  };
};

export const creatorCustomer = (
  over: Partial<CreatorCustomerDetailResponse['customer']> = {},
  access: CreatorCustomerDetailResponse['access'] = {
    state: 'ACTIVE',
    ends_at: '2026-11-27T16:59:59.000Z',
    ended_at: null,
  },
): CreatorCustomerDetailResponse => ({
  customer: {
    display_name: 'Rani Anggraini',
    avatar_url: null,
    username: 'rani.anggraini',
    ...over,
  },
  access,
});

/**
 * In-memory API double. `login` answers with `loginResults` and `me` with `meResults`; `me` is the
 * source of the role, so tests can make the login body and `/me` disagree.
 */
export function createFakeMiniappApi(
  options: {
    login?: (UserProfile | Error)[];
    me?: (UserProfile | Error)[];
    resolve?: (CreatorProfileResponse | Error)[];
    explore?: (ExploreResponse | Error)[];
    subscriptions?: (SubscriptionsResponse | Error)[];
    requestAccess?: (SubmitAccessRequestResponse | Error)[];
    updateProfile?: (UserProfile | Error)[];
    creatorSettings?: (CreatorSettingsResponse | Error)[];
    timezone?: (UserProfile | Error)[];
    creatorRequestState?: (CreatorRequestStateResponse | Error)[];
    submitRequest?: (SubmitCreatorRequestResponse | Error)[];
    chatHistory?: (ChatHistoryResponse | Error | Promise<ChatHistoryResponse>)[];
    chatSend?: (SendMessageResponse | Error | Promise<SendMessageResponse>)[];
    creatorChatHistory?: (
      CreatorChatHistoryResponse | Error | Promise<CreatorChatHistoryResponse>
    )[];
    creatorChatSend?: (CreatorSendMessageResponse | Error | Promise<CreatorSendMessageResponse>)[];
    creatorCustomer?: (CreatorCustomerDetailResponse | Error)[];
    chatList?: (ChatListResponse | Error | Promise<ChatListResponse>)[];
    chatUnread?: (ChatUnreadResponse | Error)[];
    chatRead?: (ReadResponse | Error | Promise<ReadResponse>)[];
    creatorRead?: (ReadResponse | Error | Promise<ReadResponse>)[];
    creatorUnread?: (CreatorUnreadResponse | Error)[];
    inbox?: (InboxResponse | Error | Promise<InboxResponse>)[];
    mediaInit?: (MediaUploadInitResponse | Error)[];
    mediaComplete?: (MediaAssetResponse | Error)[];
    mediaGet?: (MediaAssetResponse | Error)[];
    gallery?: (CreatorGalleryResponse | Error | Promise<CreatorGalleryResponse>)[];
    galleryItem?: (CreatorGalleryItemDetail | Error)[];
    customerGallery?: (CustomerGalleryResponse | Error | Promise<CustomerGalleryResponse>)[];
    customerGalleryItem?: (CustomerGalleryItemDetail | Error)[];
    chatMedia?: (ChatMediaDetail | Error)[];
  } = {},
): FakeMiniappApi {
  const listeners = new Set<(reason: SessionLossReason) => void>();
  const renewed = new Set<(user: UserProfile) => void>();
  let submitted: CreatorApplication | null = null;
  const api: FakeMiniappApi = {
    loginCalls: [],
    meCalls: 0,
    loginResults: [...(options.login ?? [])],
    meResults: [...(options.me ?? [])],
    resolveCalls: [],
    resolveResults: [...(options.resolve ?? [])],
    exploreCalls: [],
    subscriptionsResults: [...(options.subscriptions ?? [])],
    subscriptionCalls: 0,
    chatListCalls: [],
    chatListResults: [...(options.chatList ?? [])],
    chatUnreadCalls: 0,
    chatReadCalls: [],
    chatReadResults: [...(options.chatRead ?? [])],
    creatorReadCalls: [],
    creatorReadResults: [...(options.creatorRead ?? [])],
    creatorUnreadCalls: 0,
    creatorUnreadResults: [...(options.creatorUnread ?? [])],
    chatUnreadResults: [...(options.chatUnread ?? [])],
    chatHistoryCalls: [],
    chatHistoryResults: [...(options.chatHistory ?? [])],
    chatSendCalls: [],
    accessToken: 'token-0',
    renewCalls: 0,
    renewResults: [],
    creatorChatHistoryCalls: [],
    creatorChatHistoryResults: [...(options.creatorChatHistory ?? [])],
    creatorChatSendCalls: [],
    creatorChatSendResults: [...(options.creatorChatSend ?? [])],
    creatorCustomerCalls: [],
    creatorCustomerResults: [...(options.creatorCustomer ?? [])],
    inboxCalls: [],
    inboxResults: [...(options.inbox ?? [])],
    mediaLimitsResult: {
      photo_max_bytes: 10_485_760,
      video_max_bytes: 209_715_200,
      video_max_seconds: 300,
    },
    mediaInitCalls: [],
    mediaInitResults: [...(options.mediaInit ?? [])],
    mediaCompleteCalls: [],
    mediaCompleteResults: [...(options.mediaComplete ?? [])],
    mediaGetCalls: [],
    mediaGetResults: [...(options.mediaGet ?? [])],
    galleryCalls: [],
    galleryResults: [...(options.gallery ?? [])],
    galleryItemCalls: [],
    galleryItemResults: [...(options.galleryItem ?? [])],
    customerGalleryCalls: [],
    customerGalleryResults: [...(options.customerGallery ?? [])],
    customerGalleryItemCalls: [],
    customerGalleryItemResults: [...(options.customerGalleryItem ?? [])],
    chatMediaCalls: [],
    chatMediaResults: [...(options.chatMedia ?? [])],
    chatSendResults: [...(options.chatSend ?? [])],
    requestAccessCalls: [],
    requestAccessResults: [...(options.requestAccess ?? [])],
    exploreResults: [...(options.explore ?? [])],
    updateProfileCalls: [],
    updateProfileResults: [...(options.updateProfile ?? [])],
    creatorSettingsResults: [...(options.creatorSettings ?? [])],
    creatorSettingsCalls: 0,
    updateCreatorCalls: [],
    timezoneCalls: [],
    timezoneResults: [...(options.timezone ?? [])],
    creatorRequestStateResults: [...(options.creatorRequestState ?? [])],
    creatorRequestStateCalls: 0,
    submitRequestCalls: [],
    submitRequestResults: [...(options.submitRequest ?? [])],
    async getCreatorRequestState() {
      api.creatorRequestStateCalls += 1;
      // Like the server: once a request was stored, it is the latest one.
      const next = api.creatorRequestStateResults.shift() ?? {
        request: submitted,
        blocked: null,
      };
      if (next instanceof Error) throw next;
      return next;
    },
    async submitCreatorRequest(input) {
      api.submitRequestCalls.push(input);
      const next = api.submitRequestResults.shift() ?? {
        request: {
          id: '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33',
          status: 'PENDING' as const,
          creator_name: input.creator_name.trim(),
          instagram_url: input.instagram_url.trim(),
          creator_type: input.creator_type,
          description: input.description.trim(),
          created_at: '2026-11-16T05:00:00.000Z',
          reviewed_at: null,
          review_reason: null,
        },
      };
      if (next instanceof Error) throw next;
      submitted = next.request;
      return next;
    },
    async updateCreatorTimezone(timezone) {
      api.timezoneCalls.push(timezone);
      const next = api.timezoneResults.shift() ?? { ...maya, timezone };
      if (next instanceof Error) throw next;
      return next;
    },
    async getCreatorSettings() {
      api.creatorSettingsCalls += 1;
      const next = api.creatorSettingsResults.shift() ?? {
        profile: maya,
        public_code: 'salsa234',
        bio_link: 'https://t.me/TestBot?start=c_salsa234',
      };
      if (next instanceof Error) throw next;
      return next;
    },
    async updateCreatorProfile(input) {
      api.updateCreatorCalls.push(input);
      api.updateProfileCalls.push(input);
      const next = api.updateProfileResults.shift() ?? {
        ...maya,
        display_name: input.display_name.trim(),
        bio: input.bio?.trim() || null,
      };
      if (next instanceof Error) throw next;
      return next;
    },
    async updateProfile(input) {
      api.updateProfileCalls.push(input);
      const next = api.updateProfileResults.shift() ?? {
        ...nadia,
        display_name: input.display_name.trim(),
        bio: input.bio?.trim() || null,
      };
      if (next instanceof Error) throw next;
      return next;
    },
    async resolveCreator(code) {
      api.resolveCalls.push(code);
      const next = api.resolveResults.shift() ?? {
        public_code: code,
        display_name: 'Salsa',
        bio: null,
        avatar_url: null,
        conversation_id: null,
        access: { state: 'GUEST' as const },
      };
      if (next instanceof Error) throw next;
      return next;
    },
    async requestAccess(code) {
      api.requestAccessCalls.push(code);
      const next = api.requestAccessResults.shift() ?? {
        request_type: 'TRIAL' as const,
        requested_at: '2026-11-17T03:00:00.000Z',
      };
      if (next instanceof Error) throw next;
      return next;
    },
    async getChatHistory(conversationId, query = {}) {
      api.chatHistoryCalls.push({ conversationId, ...query });
      const next = api.chatHistoryResults.shift() ?? chatHistory([]);
      if (next instanceof Error) throw next;
      return next;
    },
    async sendChatMessage(_conversationId, input) {
      api.chatSendCalls.push(input);
      const next = api.chatSendResults.shift() ?? {
        message: chatMessage(api.chatSendCalls.length, {
          sender: 'ME',
          body: input.body,
          client_message_id: input.client_message_id,
        }),
      };
      if (next instanceof Error) throw next;
      return next;
    },
    async getCreatorChatHistory(conversationId, query = {}) {
      api.creatorChatHistoryCalls.push({ conversationId, ...query });
      const next = api.creatorChatHistoryResults.shift() ?? creatorChatHistory([]);
      if (next instanceof Error) throw next;
      return next;
    },
    async sendCreatorChatMessage(_conversationId, input) {
      api.creatorChatSendCalls.push(input);
      const next = api.creatorChatSendResults.shift() ?? {
        message: creatorChatMessage(api.creatorChatSendCalls.length, {
          sender: 'ME',
          body: input.body ?? null,
          client_message_id: input.client_message_id,
          ...(input.attachment
            ? {
                type: 'MEDIA' as const,
                attachments: [
                  {
                    id: input.attachment.asset_id,
                    kind: 'PHOTO' as const,
                    duration_seconds: null,
                    thumbnail_url: 'http://localhost:3000/v1/dev-storage/m/sent?s=x',
                  },
                ],
              }
            : {}),
        }),
      };
      if (next instanceof Error) throw next;
      return next;
    },
    async getCreatorCustomer(conversationId) {
      api.creatorCustomerCalls.push(conversationId);
      const next = api.creatorCustomerResults.shift() ?? creatorCustomer();
      if (next instanceof Error) throw next;
      return next;
    },
    async getMediaLimits() {
      if (api.mediaLimitsResult instanceof Error) throw api.mediaLimitsResult;
      return api.mediaLimitsResult;
    },
    async initMediaUpload(body) {
      api.mediaInitCalls.push(body);
      const next = api.mediaInitResults.shift();
      if (next instanceof Error) throw next;
      return (
        next ?? {
          asset: mediaAsset(900, {
            state: 'PENDING',
            kind: body.kind,
            thumbnail_url: null,
          }),
          upload: {
            url: 'http://localhost:3000/v1/dev-storage/m/x?s=y',
            method: 'PUT',
            headers: { 'Content-Type': body.content_type },
            expires_at: '2026-11-18T03:15:00.000Z',
          },
        }
      );
    },
    async completeMediaUpload(assetId) {
      api.mediaCompleteCalls.push(assetId);
      const next = api.mediaCompleteResults.shift();
      if (next instanceof Error) throw next;
      return (
        next ?? {
          asset: mediaAsset(900, { id: assetId, state: 'PROCESSING', thumbnail_url: null }),
        }
      );
    },
    async getMedia(assetId) {
      api.mediaGetCalls.push(assetId);
      const next = api.mediaGetResults.shift();
      if (next instanceof Error) throw next;
      return next ?? { asset: mediaAsset(900, { id: assetId }) };
    },
    async getChatMediaItem(conversationId, attachmentId) {
      api.chatMediaCalls.push({ conversationId, attachmentId });
      const next = api.chatMediaResults.shift();
      if (next instanceof Error) throw next;
      return next ?? chatMediaDetail(attachmentId);
    },
    async getCustomerGallery(code, query = {}) {
      api.customerGalleryCalls.push({ code, ...query });
      const next = api.customerGalleryResults.shift() ?? customerGalleryPage([]);
      if (next instanceof Error) throw next;
      return next;
    },
    async getCustomerGalleryItem(code, assetId) {
      api.customerGalleryItemCalls.push({ code, assetId });
      const next = api.customerGalleryItemResults.shift();
      if (next instanceof Error) throw next;
      return next ?? customerDetail(publicItem(1, { id: assetId }));
    },
    async getGalleryItem(assetId) {
      api.galleryItemCalls.push(assetId);
      const next = api.galleryItemResults.shift();
      if (next instanceof Error) throw next;
      return next ?? galleryDetail(mediaAsset(1, { id: assetId }));
    },
    async getGallery(query = {}) {
      api.galleryCalls.push(query);
      const next = api.galleryResults.shift() ?? galleryPage([]);
      if (next instanceof Error) throw next;
      return next;
    },
    async getCreatorInbox(query) {
      api.inboxCalls.push(query);
      const next = api.inboxResults.shift() ?? inboxPage([]);
      if (next instanceof Error) throw next;
      return next;
    },
    async listChats(query) {
      api.chatListCalls.push({ cursor: query.cursor, limit: query.limit });
      const next = api.chatListResults.shift() ?? BOARD_CHATS;
      if (next instanceof Error) throw next;
      return next;
    },
    async markChatRead(conversationId, throughSeq) {
      api.chatReadCalls.push({ conversationId, throughSeq });
      const next = api.chatReadResults.shift() ?? { last_read_seq: throughSeq };
      if (next instanceof Error) throw next;
      return next;
    },
    async markCreatorRead(conversationId, throughSeq) {
      api.creatorReadCalls.push({ conversationId, throughSeq });
      const next = api.creatorReadResults.shift() ?? { last_read_seq: throughSeq };
      if (next instanceof Error) throw next;
      return next;
    },
    async getCreatorUnread() {
      api.creatorUnreadCalls += 1;
      const next = api.creatorUnreadResults.shift() ?? { unread_conversations: 2 };
      if (next instanceof Error) throw next;
      return next;
    },
    async getChatUnread() {
      api.chatUnreadCalls += 1;
      const next = api.chatUnreadResults.shift() ?? { unread_total: 2 };
      if (next instanceof Error) throw next;
      return next;
    },
    async listSubscriptions() {
      api.subscriptionCalls += 1;
      const next = api.subscriptionsResults.shift() ?? BOARD_SUBSCRIPTIONS;
      if (next instanceof Error) throw next;
      return next;
    },
    async listCreators(query) {
      api.exploreCalls.push(query);
      const next = api.exploreResults.shift() ?? {
        items: [
          {
            public_code: 'salsa234',
            display_name: 'Salsa',
            bio: null,
            avatar_url: null,
            access: null,
          },
        ],
        total: 1,
        page: query.page,
        page_size: query.page_size as 10 | 20 | 50,
      };
      if (next instanceof Error) throw next;
      return next;
    },
    async loginWithTelegram(initData) {
      api.loginCalls.push(initData);
      const next = api.loginResults.shift() ?? nadia;
      if (next instanceof Error) throw next;
      return next;
    },
    async me() {
      api.meCalls += 1;
      const next = api.meResults.shift() ?? nadia;
      if (next instanceof Error) throw next;
      return next;
    },
    getAccessToken: () => api.accessToken,
    async renewAccessToken() {
      api.renewCalls += 1;
      const next =
        api.renewResults.length > 0 ? api.renewResults.shift() : `token-${api.renewCalls}`;
      if (next instanceof Error) throw next;
      if (next) api.accessToken = next;
      return next ?? null;
    },
    onSessionLost(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onSessionRenewed(listener) {
      renewed.add(listener);
      return () => {
        renewed.delete(listener);
      };
    },
    renewSession(user) {
      renewed.forEach((listener) => listener(user));
    },
    loseSession(reason) {
      listeners.forEach((listener) => listener(reason));
    },
  };
  return api;
}

export const apiError = (status: number, code: ApiError['code']) =>
  new ApiError(status, code, 'error');
export const networkError = () => new NetworkError();

export function fakeTelegram(initData: string | null): TelegramEnv & { readyCalls: number } {
  const env = {
    readyCalls: 0,
    getInitData: () => initData,
    signalReady: () => {
      env.readyCalls += 1;
    },
  };
  return env;
}

export function fakeSeen(initial = false): SeenFlag & { value: boolean } {
  const flag = {
    value: initial,
    get: () => flag.value,
    set: () => {
      flag.value = true;
    },
  };
  return flag;
}
