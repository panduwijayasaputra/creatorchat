import { z } from 'zod';
import {
  CHAT_TEXT_MAX,
  ChatAttachmentSchema,
  ChatHistoryQuerySchema,
  messageShapeOk,
} from './chat.js';

/** The creator side of a private chat (US-029). Creators only; every id is the creator's own conversation. */
export const creatorChatMessagesPath = (conversationId: string): string =>
  `/v1/creator/conversations/${encodeURIComponent(conversationId)}/messages`;
export const creatorCustomerPath = (conversationId: string): string =>
  `/v1/creator/conversations/${encodeURIComponent(conversationId)}/customer`;

/** Same paging and body rules as the customer chat. */
export const CreatorChatHistoryQuerySchema = ChatHistoryQuerySchema;
export type CreatorChatHistoryQuery = z.infer<typeof CreatorChatHistoryQuerySchema>;
const codePoints = (s: string) => [...s].length;

/**
 * The creator sends text, a photo or video (one attachment, US-036), or both. The attachment names an
 * asset of the creator's own gallery or a chat upload made for this conversation; the server checks it.
 */
export const CreatorSendMessageBodySchema = z
  .strictObject({
    client_message_id: z.uuid(),
    body: z
      .string()
      .transform((s) => s.trim())
      .refine((s) => codePoints(s) >= 1, 'Pesan tidak boleh kosong.')
      .refine((s) => codePoints(s) <= CHAT_TEXT_MAX, `Pesan maksimal ${CHAT_TEXT_MAX} karakter.`)
      .optional(),
    attachment: z.strictObject({ asset_id: z.uuid() }).optional(),
  })
  .refine((b) => b.body !== undefined || b.attachment !== undefined, {
    path: ['body'],
    message: 'Kirim teks atau media.',
  });
export type CreatorSendMessageBody = z.infer<typeof CreatorSendMessageBodySchema>;

export const MESSAGE_ORIGINS = ['MANUAL', 'AI'] as const;

export const CreatorChatMessageSchema = z
  .strictObject({
    id: z.uuid(),
    client_message_id: z.uuid(),
    seq: z.number().int().min(1),
    sender: z.enum(['ME', 'CUSTOMER']),
    type: z.enum(['TEXT', 'MEDIA']),
    body: z.string().nullable(),
    attachments: z.array(ChatAttachmentSchema),
    origin: z.enum(MESSAGE_ORIGINS),
    created_at: z.string(),
  })
  .refine(messageShapeOk, 'A TEXT message has a body and no attachment; a MEDIA message has one.');
export type CreatorChatMessage = z.infer<typeof CreatorChatMessageSchema>;

/** ACTIVE carries `ends_at`; EXPIRED carries `ended_at` when there ever was access. */
export const CreatorChatAccessSchema = z.strictObject({
  state: z.enum(['ACTIVE', 'EXPIRED']),
  ends_at: z.string().nullable(),
  ended_at: z.string().nullable(),
});
export type CreatorChatAccess = z.infer<typeof CreatorChatAccessSchema>;

const httpsOrNull = z
  .string()
  .regex(/^https:\/\//)
  .nullable();

export const CreatorChatHistoryResponseSchema = z.strictObject({
  conversation: z.strictObject({
    id: z.uuid(),
    customer: z.strictObject({ display_name: z.string(), avatar_url: httpsOrNull }),
    access: CreatorChatAccessSchema,
  }),
  /** Newest first. */
  items: z.array(CreatorChatMessageSchema),
  next_before: z.number().int().nullable(),
});
export type CreatorChatHistoryResponse = z.infer<typeof CreatorChatHistoryResponseSchema>;

export const CreatorSendMessageResponseSchema = z.strictObject({
  message: CreatorChatMessageSchema,
});
export type CreatorSendMessageResponse = z.infer<typeof CreatorSendMessageResponseSchema>;

/** `CrCustomer`: no Telegram numeric id, no user id. */
export const CreatorCustomerDetailResponseSchema = z.strictObject({
  customer: z.strictObject({
    display_name: z.string(),
    avatar_url: httpsOrNull,
    username: z.string().nullable(),
  }),
  access: CreatorChatAccessSchema,
});
export type CreatorCustomerDetailResponse = z.infer<typeof CreatorCustomerDetailResponseSchema>;
