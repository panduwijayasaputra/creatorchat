import { describe, expect, it } from 'vitest';
import { ChatHistoryResponseSchema } from './chat.js';
import {
  CreatorUnreadResponseSchema,
  ReadBodySchema,
  ReadResponseSchema,
  chatReadPath,
  creatorReadPath,
} from './chat-read.js';

describe('ReadBodySchema', () => {
  it.each([0, 1, 2_000_000])('accepts %s', (n) =>
    expect(ReadBodySchema.safeParse({ through_seq: n }).success).toBe(true),
  );
  it.each([-1, 1.5, '3', null, undefined])('refuses %j', (n) =>
    expect(ReadBodySchema.safeParse({ through_seq: n }).success).toBe(false),
  );
  it('refuses a user or conversation id in the body', () => {
    expect(ReadBodySchema.safeParse({ through_seq: 1, user_id: 'x' }).success).toBe(false);
    expect(ReadBodySchema.safeParse({ through_seq: 1, conversation_id: 'x' }).success).toBe(false);
  });
});

describe('responses and paths', () => {
  it('are strict', () => {
    expect(ReadResponseSchema.safeParse({ last_read_seq: 3 }).success).toBe(true);
    expect(ReadResponseSchema.safeParse({ last_read_seq: 3, x: 1 }).success).toBe(false);
    expect(CreatorUnreadResponseSchema.safeParse({ unread_conversations: 2 }).success).toBe(true);
    expect(CreatorUnreadResponseSchema.safeParse({ unread_conversations: -1 }).success).toBe(false);
  });
  it('encode the id', () => {
    expect(chatReadPath('a/b')).toBe('/v1/chats/a%2Fb/read');
    expect(creatorReadPath('x')).toBe('/v1/creator/inbox/x/read');
  });
});

describe('customer history carries the creator cursor', () => {
  const base = {
    conversation: {
      id: '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33',
      creator: { public_code: 'salsa234', display_name: 'Salsa', avatar_url: null },
      access: { state: 'ACTIVE', ends_at: null, ended_at: null },
    },
    items: [],
    next_before: null,
  };
  it('requires peer_read_seq ≥ 0', () => {
    expect(ChatHistoryResponseSchema.safeParse(base).success).toBe(false);
    const ok = { ...base, conversation: { ...base.conversation, peer_read_seq: 0 } };
    expect(ChatHistoryResponseSchema.safeParse(ok).success).toBe(true);
    const bad = { ...base, conversation: { ...base.conversation, peer_read_seq: -1 } };
    expect(ChatHistoryResponseSchema.safeParse(bad).success).toBe(false);
  });
});
