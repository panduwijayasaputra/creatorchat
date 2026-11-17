import { describe, expect, it } from 'vitest';
import {
  InboxItemSchema,
  InboxQuerySchema,
  decodeInboxCursor,
  encodeInboxCursor,
} from './creator-inbox.js';

const ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';

describe('InboxQuerySchema', () => {
  it('defaults', () => {
    expect(InboxQuerySchema.parse({})).toEqual({ filter: 'all', limit: 30 });
    expect(InboxQuerySchema.parse({ filter: 'unread', limit: '5' })).toEqual({
      filter: 'unread',
      limit: 5,
    });
  });
  it.each([
    { limit: '0' },
    { limit: '51' },
    { filter: 'manual' },
    { x: '1' },
    { cursor: 'a'.repeat(201) },
    { cursor: '' },
  ])('refuses %j', (q) => expect(InboxQuerySchema.safeParse(q).success).toBe(false));
});

describe('cursor', () => {
  it('round-trips', () => {
    const at = new Date('2026-11-17T02:05:00.123Z');
    expect(decodeInboxCursor(encodeInboxCursor(at, ID))).toEqual({ at, id: ID });
  });
  it.each([
    '',
    '!!!',
    'abc',
    btoa('nope'),
    btoa(`2026-13-45T00:00:00.000Z|${ID}`),
    btoa(`2026-11-17T02:05:00.000Z|x`),
    btoa(`2026-11-17|${ID}`),
    btoa(`2026-11-17T02:05:00.000Z|${ID}|extra`),
  ])('rejects %j', (c) => expect(decodeInboxCursor(c)).toBeNull());
});

describe('InboxItemSchema', () => {
  const item = {
    conversation_id: ID,
    customer: { display_name: 'Rani', avatar_url: null },
    preview: 'Oke',
    preview_media_kind: null,
    last_message_at: '2026-11-17T02:05:00.000Z',
    unread_count: 2,
    access_active: true,
  };
  it('accepts the sample and refuses private fields', () => {
    expect(InboxItemSchema.safeParse(item).success).toBe(true);
    expect(InboxItemSchema.safeParse({ ...item, telegram_id: '1' }).success).toBe(false);
    expect(
      InboxItemSchema.safeParse({ ...item, customer: { ...item.customer, username: 'x' } }).success,
    ).toBe(false);
  });
});
