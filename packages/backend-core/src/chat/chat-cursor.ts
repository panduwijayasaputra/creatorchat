/**
 * The keyset cursor of the chat list (US-027): the activity time and id of the last row of a page,
 * as an opaque base64url string. Parsed strictly: anything that is not exactly `<ISO>|<uuid>` is
 * refused, so the value can only ever be a comparison boundary inside the viewer's own rows.
 */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ChatCursor {
  at: Date;
  id: string;
}

export function encodeChatCursor(cursor: ChatCursor): string {
  return Buffer.from(`${cursor.at.toISOString()}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeChatCursor(value: string): ChatCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const text = Buffer.from(value, 'base64url').toString('utf8');
  const [iso, id, ...rest] = text.split('|');
  if (rest.length > 0 || !iso || !id || !ISO.test(iso) || !UUID.test(id)) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || at.toISOString() !== iso) return null;
  // The decode must round-trip, so padding or alternate encodings are refused too.
  return encodeChatCursor({ at, id }) === value ? { at, id } : null;
}
