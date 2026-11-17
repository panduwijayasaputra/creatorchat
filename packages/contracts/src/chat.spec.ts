import { describe, expect, it } from 'vitest';
import { ErrorCode, ErrorCodeSchema } from './errors.js';
import {
  CHAT_PREVIEW_MAX,
  CHAT_TEXT_MAX,
  ChatHistoryQuerySchema,
  ChatMediaDetailSchema,
  ChatMediaListResponseSchema,
  ChatMessageSchema,
  chatMediaItemPath,
  ChatListItemSchema,
  ChatListQuerySchema,
  ChatListResponseSchema,
  ChatUnreadResponseSchema,
  SendMessageBodySchema,
} from './chat.js';

const id = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
const body = (b: unknown, extra: object = {}) =>
  SendMessageBodySchema.safeParse({ client_message_id: id, body: b, ...extra });

describe('SendMessageBodySchema', () => {
  it('trims the text', () => {
    const r = body('  halo  ');
    expect(r.success && r.data.body).toBe('halo');
  });
  it('refuses empty and whitespace-only text', () => {
    expect(body('').success).toBe(false);
    expect(body(' \n\t ').success).toBe(false);
  });
  it('allows 2000 and refuses 2001 characters', () => {
    expect(body('a'.repeat(CHAT_TEXT_MAX)).success).toBe(true);
    expect(body('a'.repeat(CHAT_TEXT_MAX + 1)).success).toBe(false);
  });
  it('counts code points, not UTF-16 units', () => {
    expect(body('😀'.repeat(CHAT_TEXT_MAX)).success).toBe(true);
    expect(body('😀'.repeat(CHAT_TEXT_MAX + 1)).success).toBe(false);
  });
  it('refuses a bad id and unknown keys', () => {
    expect(SendMessageBodySchema.safeParse({ client_message_id: 'x', body: 'a' }).success).toBe(
      false,
    );
    expect(body('a', { sender: 'CREATOR' }).success).toBe(false);
  });
});

describe('ChatHistoryQuerySchema', () => {
  it('defaults the limit', () => {
    expect(ChatHistoryQuerySchema.parse({})).toEqual({ limit: 30 });
    expect(ChatHistoryQuerySchema.parse({ before: '12', limit: '5' })).toEqual({
      before: 12,
      limit: 5,
    });
  });
  it.each([{ limit: '0' }, { limit: '51' }, { before: '0' }, { before: 'abc' }, { extra: '1' }])(
    'refuses %j',
    (q) => expect(ChatHistoryQuerySchema.safeParse(q).success).toBe(false),
  );
});

describe('chat error codes', () => {
  it('parse through ErrorCodeSchema', () => {
    for (const c of [
      'CHAT_ACCESS_EXPIRED',
      'CHAT_CREATOR_BLOCKED',
      'IDEMPOTENCY_CONFLICT',
    ] as const)
      expect(ErrorCodeSchema.parse(ErrorCode[c])).toBe(c);
  });
});

describe('chat list contracts (US-027)', () => {
  const id = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
  const row = {
    conversation_id: id,
    public_code: 'salsa234',
    display_name: 'Salsa Maheswari',
    avatar_url: null,
    last_message: {
      preview: 'Gagal pertama itu wajar kok.',
      at: '2026-11-17T02:14:00.000Z',
      media_kind: null,
    },
    unread_count: 2,
    access: 'ACTIVE',
  };

  it('defaults the query and allowlists the limit', () => {
    expect(ChatListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(ChatListQuerySchema.parse({ limit: '50', cursor: 'abc' })).toEqual({
      limit: 50,
      cursor: 'abc',
    });
    for (const bad of [
      { limit: '0' },
      { limit: '15' },
      { limit: '51' },
      { limit: 'abc' },
      { limit: ['10', '20'] },
      { cursor: '' },
      { cursor: 'x'.repeat(201) },
      { page: '1' },
      { user_id: id },
    ]) {
      expect(ChatListQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('accepts the exact row, with or without a last message', () => {
    expect(ChatListItemSchema.safeParse(row).success).toBe(true);
    expect(ChatListItemSchema.safeParse({ ...row, last_message: null }).success).toBe(true);
    for (const access of ['EXPIRED', 'CREATOR_BLOCKED']) {
      expect(ChatListItemSchema.safeParse({ ...row, access }).success).toBe(true);
    }
    expect(ChatListItemSchema.safeParse({ ...row, access: 'GUEST' }).success).toBe(false);
  });

  it('refuses leaked keys, a long preview, a non-https avatar and a bad count or id', () => {
    for (const extra of [
      'creator_id',
      'customer_id',
      'status',
      'message_id',
      'media',
      'body',
      'mode',
    ]) {
      expect(ChatListItemSchema.safeParse({ ...row, [extra]: 1 }).success, extra).toBe(false);
    }
    expect(
      ChatListItemSchema.safeParse({
        ...row,
        last_message: {
          preview: 'x'.repeat(CHAT_PREVIEW_MAX + 1),
          at: row.last_message.at,
          media_kind: null,
        },
      }).success,
    ).toBe(false);
    expect(
      ChatListItemSchema.safeParse({ ...row, last_message: { ...row.last_message, body: 'x' } })
        .success,
    ).toBe(false);
    expect(ChatListItemSchema.safeParse({ ...row, avatar_url: 'http://x/y.png' }).success).toBe(
      false,
    );
    expect(ChatListItemSchema.safeParse({ ...row, avatar_url: 'https://x/y.png' }).success).toBe(
      true,
    );
    expect(ChatListItemSchema.safeParse({ ...row, unread_count: -1 }).success).toBe(false);
    expect(ChatListItemSchema.safeParse({ ...row, conversation_id: 'nope' }).success).toBe(false);
  });

  it('wraps rows with a nullable next_cursor and refuses extras', () => {
    expect(ChatListResponseSchema.safeParse({ items: [row], next_cursor: null }).success).toBe(
      true,
    );
    expect(ChatListResponseSchema.safeParse({ items: [], next_cursor: 'abc' }).success).toBe(true);
    expect(ChatListResponseSchema.safeParse({ items: [row] }).success).toBe(false);
    expect(
      ChatListResponseSchema.safeParse({ items: [], next_cursor: null, total: 1 }).success,
    ).toBe(false);
  });

  it('answers the unread total with a non-negative integer only', () => {
    expect(ChatUnreadResponseSchema.safeParse({ unread_total: 0 }).success).toBe(true);
    expect(ChatUnreadResponseSchema.safeParse({ unread_total: 120 }).success).toBe(true);
    for (const bad of [{ unread_total: -1 }, { unread_total: 1.5 }, { unread_total: 1, id }, {}]) {
      expect(ChatUnreadResponseSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('chat messages with media (US-036)', () => {
  const base = {
    id,
    client_message_id: id,
    seq: 3,
    sender: 'CREATOR',
    created_at: '2026-11-18T10:00:00.000Z',
  };
  const attachment = {
    id,
    kind: 'VIDEO',
    duration_seconds: 48,
    thumbnail_url: 'http://localhost:3000/v1/dev-storage/m/t?s=1',
  };

  it('accepts a text message, a media message with and without text', () => {
    expect(
      ChatMessageSchema.safeParse({ ...base, type: 'TEXT', body: 'hi', attachments: [] }).success,
    ).toBe(true);
    expect(
      ChatMessageSchema.safeParse({ ...base, type: 'MEDIA', body: null, attachments: [attachment] })
        .success,
    ).toBe(true);
    expect(
      ChatMessageSchema.safeParse({
        ...base,
        type: 'MEDIA',
        body: 'lihat',
        attachments: [attachment],
      }).success,
    ).toBe(true);
  });

  it.each([
    ['a TEXT message with an attachment', { type: 'TEXT', body: 'hi', attachments: [attachment] }],
    ['a TEXT message without a body', { type: 'TEXT', body: null, attachments: [] }],
    ['a MEDIA message without an attachment', { type: 'MEDIA', body: 'x', attachments: [] }],
    [
      'an attachment with a storage key',
      { type: 'MEDIA', body: null, attachments: [{ ...attachment, object_key: 'm/x' }] },
    ],
    [
      'an attachment without a thumbnail',
      { type: 'MEDIA', body: null, attachments: [{ ...attachment, thumbnail_url: null }] },
    ],
  ])('rejects %s', (_name, patch) => {
    expect(ChatMessageSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });

  it('the customer still sends text only', () => {
    expect(
      SendMessageBodySchema.safeParse({
        client_message_id: id,
        body: 'a',
        attachment: { asset_id: id },
      }).success,
    ).toBe(false);
  });
});

describe('chat media contracts (US-037)', () => {
  const item = {
    id,
    kind: 'VIDEO',
    duration_seconds: 42,
    thumbnail_url: 'http://localhost:3000/v1/dev-storage/m/t?s=1',
  };
  const detail = {
    item,
    original: { url: item.thumbnail_url, expires_at: '2026-11-18T10:00:00.000Z' },
    message: {
      body: 'Latihan menguleni adonan roti sobek.',
      created_at: '2026-11-18T09:16:00.000Z',
    },
    creator: { display_name: 'Salsa Maheswari' },
    position: 2,
    total: 2,
    previous_id: id,
    next_id: null,
  };

  it('accepts a list and a detail, and a message without text', () => {
    expect(ChatMediaListResponseSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(ChatMediaDetailSchema.safeParse(detail).success).toBe(true);
    expect(
      ChatMediaDetailSchema.safeParse({ ...detail, message: { ...detail.message, body: null } })
        .success,
    ).toBe(true);
  });

  it('refuses asset ids, storage keys and bad positions', () => {
    expect(
      ChatMediaListResponseSchema.safeParse({ items: [{ ...item, asset_id: id }] }).success,
    ).toBe(false);
    expect(ChatMediaDetailSchema.safeParse({ ...detail, object_key: 'm/x' }).success).toBe(false);
    expect(ChatMediaDetailSchema.safeParse({ ...detail, position: 0 }).success).toBe(false);
    expect(
      ChatMediaDetailSchema.safeParse({ ...detail, item: { ...item, thumbnail_url: null } })
        .success,
    ).toBe(false);
  });

  it('encodes both path parts', () => {
    expect(chatMediaItemPath('a/b', 'c d')).toBe('/v1/chats/a%2Fb/media/c%20d');
  });
});
