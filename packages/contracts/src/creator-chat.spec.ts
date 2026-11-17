import { describe, expect, it } from 'vitest';
import {
  CreatorChatHistoryQuerySchema,
  CreatorChatMessageSchema,
  CreatorCustomerDetailResponseSchema,
  CreatorSendMessageBodySchema,
  creatorChatMessagesPath,
} from './creator-chat.js';

const id = '8f14e45f-ceea-4f67-a1b2-0123456789ab';
const message = {
  id,
  client_message_id: id,
  seq: 1,
  sender: 'ME',
  type: 'TEXT',
  body: 'hi',
  attachments: [],
  origin: 'MANUAL',
  created_at: '2026-11-17T00:00:00.000Z',
};

describe('creator chat contracts', () => {
  it('applies the query defaults and limits', () => {
    expect(CreatorChatHistoryQuerySchema.parse({}).limit).toBe(30);
    for (const bad of [{ limit: '0' }, { limit: '51' }, { before: '0' }, { x: '1' }]) {
      expect(CreatorChatHistoryQuerySchema.safeParse(bad).success).toBe(false);
    }
  });

  it('accepts a message and rejects the customer-side sender, an unknown origin and extra keys', () => {
    expect(CreatorChatMessageSchema.safeParse(message).success).toBe(true);
    expect(CreatorChatMessageSchema.safeParse({ ...message, sender: 'CREATOR' }).success).toBe(
      false,
    );
    expect(CreatorChatMessageSchema.safeParse({ ...message, origin: 'BOT' }).success).toBe(false);
    expect(CreatorChatMessageSchema.safeParse({ ...message, customer_id: id }).success).toBe(false);
  });

  it('keeps ids out of the customer detail', () => {
    const ok = {
      customer: { display_name: 'Rani', avatar_url: null, username: null },
      access: { state: 'EXPIRED', ends_at: null, ended_at: null },
    };
    expect(CreatorCustomerDetailResponseSchema.safeParse(ok).success).toBe(true);
    const withId = { ...ok, customer: { ...ok.customer, telegram_id: '1' } };
    expect(CreatorCustomerDetailResponseSchema.safeParse(withId).success).toBe(false);
  });

  it('builds an escaped path', () => {
    expect(creatorChatMessagesPath('a/b')).toBe('/v1/creator/conversations/a%2Fb/messages');
  });
});

describe('CreatorSendMessageBodySchema (US-036)', () => {
  const send = (extra: object) =>
    CreatorSendMessageBodySchema.safeParse({ client_message_id: id, ...extra });

  it('accepts text, an attachment, or both, and trims the text', () => {
    expect(send({ body: ' halo ' }).success).toBe(true);
    expect(send({ attachment: { asset_id: id } }).success).toBe(true);
    const both = send({ body: ' lihat ', attachment: { asset_id: id } });
    expect(both.success && both.data.body).toBe('lihat');
  });

  it.each([
    ['neither text nor attachment', {}],
    ['an empty text without attachment', { body: '   ' }],
    ['a too long text', { body: 'a'.repeat(2001) }],
    ['a non-uuid asset id', { attachment: { asset_id: 'abc' } }],
    ['extra keys in the attachment', { attachment: { asset_id: id, object_key: 'm/x' } }],
    ['extra keys', { body: 'a', origin: 'AI' }],
  ])('rejects %s', (_name, extra) => {
    expect(send(extra).success).toBe(false);
  });

  it('a media message in the creator history needs an attachment', () => {
    const media = { ...message, type: 'MEDIA', body: null };
    expect(CreatorChatMessageSchema.safeParse(media).success).toBe(false);
    expect(
      CreatorChatMessageSchema.safeParse({
        ...media,
        attachments: [
          { id, kind: 'PHOTO', duration_seconds: null, thumbnail_url: 'http://localhost:3000/t' },
        ],
      }).success,
    ).toBe(true);
  });
});
