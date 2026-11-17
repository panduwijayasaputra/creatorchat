import { z } from 'zod';
import { MediaKindSchema, MediaOriginalSchema } from './media.js';

/** Longest chat text, counted in Unicode code points after trimming (US-026). */
export const CHAT_TEXT_MAX = 2000;
export const CHAT_PAGE_DEFAULT = 30;
export const CHAT_PAGE_MAX = 50;

const codePoints = (s: string) => [...s].length;

export const SendMessageBodySchema = z
  .object({
    client_message_id: z.string().uuid(),
    body: z
      .string()
      .transform((s) => s.trim())
      .refine((s) => codePoints(s) >= 1, 'Pesan tidak boleh kosong.')
      .refine((s) => codePoints(s) <= CHAT_TEXT_MAX, `Pesan maksimal ${CHAT_TEXT_MAX} karakter.`),
  })
  .strict();
export type SendMessageBody = z.infer<typeof SendMessageBodySchema>;

export const ChatHistoryQuerySchema = z
  .object({
    before: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(CHAT_PAGE_MAX).default(CHAT_PAGE_DEFAULT),
  })
  .strict();
export type ChatHistoryQuery = z.infer<typeof ChatHistoryQuerySchema>;

/** A photo or video in a message (US-036). Ids and a short-lived thumbnail link only: never a storage key. */
export const ChatAttachmentSchema = z.strictObject({
  id: z.uuid(),
  kind: MediaKindSchema,
  duration_seconds: z.int().nonnegative().nullable(),
  thumbnail_url: z.url(),
});
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

/** A TEXT message has a body and no attachment; a MEDIA message has an attachment and maybe a body. */
export const messageShapeOk = (m: {
  type: 'TEXT' | 'MEDIA';
  body: string | null;
  attachments: unknown[];
}): boolean =>
  m.type === 'TEXT' ? m.body !== null && m.attachments.length === 0 : m.attachments.length >= 1;

export const ChatMessageSchema = z
  .object({
    id: z.string().uuid(),
    client_message_id: z.string().uuid(),
    seq: z.number().int(),
    sender: z.enum(['ME', 'CREATOR']),
    type: z.enum(['TEXT', 'MEDIA']),
    body: z.string().nullable(),
    attachments: z.array(ChatAttachmentSchema),
    created_at: z.string(),
  })
  .refine(messageShapeOk, 'A TEXT message has a body and no attachment; a MEDIA message has one.');
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const CHAT_ACCESS_STATES = ['ACTIVE', 'EXPIRED', 'CREATOR_BLOCKED'] as const;
export type ChatAccessState = (typeof CHAT_ACCESS_STATES)[number];

export const ChatHistoryResponseSchema = z.object({
  conversation: z.object({
    id: z.string().uuid(),
    creator: z.object({
      public_code: z.string(),
      display_name: z.string(),
      avatar_url: z.string().nullable(),
    }),
    access: z.object({
      state: z.enum(CHAT_ACCESS_STATES),
      ends_at: z.string().nullable(),
      ended_at: z.string().nullable(),
    }),
    /** The creator's read cursor (US-030): my messages with `seq` up to it are "Dibaca". 0 = nothing read. */
    peer_read_seq: z.number().int().min(0),
  }),
  /** Newest first. */
  items: z.array(ChatMessageSchema),
  next_before: z.number().int().nullable(),
});
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>;

export const SendMessageResponseSchema = z.object({ message: ChatMessageSchema });
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;

/** `GET` (history) and `POST` (send) share this path. */
export const chatMessagesPath = (conversationId: string): string =>
  `/v1/chats/${encodeURIComponent(conversationId)}/messages`;

/** The chat list (US-027): `Chats`. Customers only; every row is the viewer's own conversation. */
export const CHAT_LIST_PAGE_SIZES = [10, 20, 50] as const;
export const CHAT_LIST_DEFAULT = 20;
/** The preview is cut on the server so the list never ships a whole message. */
export const CHAT_PREVIEW_MAX = 120;
export const CHAT_CURSOR_MAX = 200;

export const CHAT_LIST_PATH = '/v1/chats';
export const CHAT_UNREAD_PATH = '/v1/chats/unread';

/** Strict, snake_case: an unknown or repeated key, or a limit outside the allowlist, is a 400. */
export const ChatListQuerySchema = z.strictObject({
  /** Opaque keyset cursor; the service validates its content. */
  cursor: z.string().min(1).max(CHAT_CURSOR_MAX).optional(),
  limit: z
    .enum(['10', '20', '50'])
    .transform(Number)
    .optional()
    .transform((value) => value ?? CHAT_LIST_DEFAULT),
});
export type ChatListQuery = z.output<typeof ChatListQuerySchema>;

/**
 * One row of `Chats`. No creator id, status words, message ids, media or full body: the preview is
 * at most 120 characters and `access` is the same rule the chat screen uses.
 */
export const ChatListItemSchema = z.strictObject({
  conversation_id: z.uuid(),
  public_code: z.string(),
  display_name: z.string(),
  avatar_url: z
    .string()
    .regex(/^https:\/\//)
    .nullable(),
  last_message: z
    .strictObject({
      /** Empty for a message that is only a photo or video. */
      preview: z.string().max(CHAT_PREVIEW_MAX),
      at: z.string(),
      /** What the last message carries, so the list can say "Foto" / "Video" (US-036). */
      media_kind: MediaKindSchema.nullable(),
    })
    .nullable(),
  unread_count: z.number().int().min(0),
  access: z.enum(CHAT_ACCESS_STATES),
});
export type ChatListItem = z.infer<typeof ChatListItemSchema>;

/** Newest activity first; `next_cursor` is null on the last page. */
export const ChatListResponseSchema = z.strictObject({
  items: z.array(ChatListItemSchema),
  next_cursor: z.string().max(CHAT_CURSOR_MAX).nullable(),
});
export type ChatListResponse = z.infer<typeof ChatListResponseSchema>;

/** `GET /v1/chats/unread`: the bottom-nav badge. */
export const ChatUnreadResponseSchema = z.strictObject({
  unread_total: z.number().int().min(0),
});
export type ChatUnreadResponse = z.infer<typeof ChatUnreadResponseSchema>;

/** The files of one conversation, for the customer's media viewer (US-037). Ids are attachment ids, never asset ids. */
export const ChatMediaItemSchema = z.strictObject({
  id: z.uuid(),
  kind: MediaKindSchema,
  duration_seconds: z.int().nonnegative().nullable(),
  thumbnail_url: z.url(),
});
export type ChatMediaItem = z.infer<typeof ChatMediaItemSchema>;

/** Oldest first, at most 500. */
export const ChatMediaListResponseSchema = z.strictObject({ items: z.array(ChatMediaItemSchema) });
export type ChatMediaListResponse = z.infer<typeof ChatMediaListResponseSchema>;

export const ChatMediaDetailSchema = z.strictObject({
  item: ChatMediaItemSchema,
  /** A 5-minute link to the file. */
  original: MediaOriginalSchema,
  message: z.strictObject({ body: z.string().nullable(), created_at: z.iso.datetime() }),
  creator: z.strictObject({ display_name: z.string() }),
  /** 1 = the oldest file of the conversation. */
  position: z.int().positive(),
  total: z.int().positive(),
  previous_id: z.uuid().nullable(),
  next_id: z.uuid().nullable(),
});
export type ChatMediaDetail = z.infer<typeof ChatMediaDetailSchema>;

export const chatMediaPath = (conversationId: string): string =>
  `/v1/chats/${encodeURIComponent(conversationId)}/media`;
export const chatMediaItemPath = (conversationId: string, attachmentId: string): string =>
  `${chatMediaPath(conversationId)}/${encodeURIComponent(attachmentId)}`;
