import { z } from 'zod';
import { MediaKindSchema } from './media.js';

export const CREATOR_INBOX_PATH = '/v1/creator/inbox';
export const INBOX_PAGE_DEFAULT = 30;
export const INBOX_PAGE_MAX = 50;
export const INBOX_FILTERS = ['all', 'unread'] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

/** Keyset paging over `(last_message_at, id)`. Anything unknown is a 400. */
export const InboxQuerySchema = z
  .object({
    filter: z.enum(INBOX_FILTERS).default('all'),
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(INBOX_PAGE_MAX).default(INBOX_PAGE_DEFAULT),
  })
  .strict();
export type InboxQuery = z.infer<typeof InboxQuerySchema>;

/** One conversation row. No Telegram id, username or customer user id, by design. */
export const InboxItemSchema = z.strictObject({
  conversation_id: z.string().uuid(),
  customer: z.strictObject({
    display_name: z.string(),
    avatar_url: z.string().nullable(),
  }),
  /** Empty for a message that is only a photo or video. */
  preview: z.string(),
  /** What the last message carries, so the row can say "Foto" / "Video" (US-036). */
  preview_media_kind: MediaKindSchema.nullable(),
  last_message_at: z.string(),
  unread_count: z.number().int().min(0),
  access_active: z.boolean(),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;

export const InboxResponseSchema = z.strictObject({
  items: z.array(InboxItemSchema),
  next_cursor: z.string().nullable(),
  /** Conversations with unread messages (the "Belum Dibaca n" chip), whatever the filter. */
  unread_conversations: z.number().int().min(0),
});
export type InboxResponse = z.infer<typeof InboxResponseSchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opaque cursor: base64url of `<ISO time>|<conversation id>`. */
export function encodeInboxCursor(at: Date, id: string): string {
  return btoa(`${at.toISOString()}|${id}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The cursor's parts, or null for anything that is not exactly what `encodeInboxCursor` makes. */
export function decodeInboxCursor(cursor: string): { at: Date; id: string } | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  let text: string;
  try {
    const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    text = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  } catch {
    return null;
  }
  const [iso, id, ...rest] = text.split('|');
  if (rest.length > 0 || !iso || !id || !UUID.test(id)) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || at.toISOString() !== iso) return null;
  return { at, id: id.toLowerCase() };
}
