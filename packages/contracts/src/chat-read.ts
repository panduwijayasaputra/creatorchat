import { z } from 'zod';

/** `POST` — the caller's own read cursor moves up to `through_seq` (never down, clamped to the newest message). */
export const chatReadPath = (conversationId: string): string =>
  `/v1/chats/${encodeURIComponent(conversationId)}/read`;
export const creatorReadPath = (conversationId: string): string =>
  `/v1/creator/inbox/${encodeURIComponent(conversationId)}/read`;
export const CREATOR_UNREAD_PATH = '/v1/creator/inbox/unread';

/** Strict: a user or conversation id in the body is a 400; the caller and the conversation come from the session and the path. */
export const ReadBodySchema = z.strictObject({
  through_seq: z.number().int().min(0),
});
export type ReadBody = z.infer<typeof ReadBodySchema>;

/** The cursor after the call (clamped and monotonic). */
export const ReadResponseSchema = z.strictObject({
  last_read_seq: z.number().int().min(0),
});
export type ReadResponse = z.infer<typeof ReadResponseSchema>;

/** `GET /v1/creator/inbox/unread`: the creator's bottom-nav badge (conversations, not messages). */
export const CreatorUnreadResponseSchema = z.strictObject({
  unread_conversations: z.number().int().min(0),
});
export type CreatorUnreadResponse = z.infer<typeof CreatorUnreadResponseSchema>;
