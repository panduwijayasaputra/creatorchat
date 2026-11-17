import { describe, expect, it } from 'vitest';
import {
  AuditLogDetailSchema,
  CreatorDetailSchema,
  DEFAULT_HISTORY_QUERY,
  HistoryQuerySchema,
  HistoryResponseSchema,
  HistoryRowSchema,
} from './creator-detail.js';

const ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
const base = {
  id: ID,
  creator_name: 'Maya',
  avatar_url: null,
  telegram_username: 'maya',
  telegram_id: '1',
  instagram_url: null,
  creator_type: 'HUMAN',
  since: '2026-11-14T05:00:00.000Z',
  blocked_at: null,
};
const request = {
  ...base,
  kind: 'request',
  status: 'REQUEST',
  request: {
    id: ID,
    description: 'd',
    user_role: 'USER',
    previous_rejections: 0,
    subscription_block: null,
  },
  creator: null,
};
const creator = {
  ...base,
  kind: 'creator',
  status: 'ACTIVE',
  request: null,
  creator: { public_code: 'abcdefgh', subscriber_count: 3, bio: null, description: null },
};
const parse = (input: unknown) => HistoryQuerySchema.safeParse(input);

describe('HistoryQuerySchema', () => {
  it('defaults', () => {
    expect(DEFAULT_HISTORY_QUERY).toEqual({
      q: null,
      type: 'all',
      status: 'all',
      sort: 'time',
      dir: 'desc',
      page: 1,
      page_size: 10,
    });
  });
  it.each([
    { sort: 'secret' },
    { dir: 'up' },
    { type: 'chat' },
    { status: 'maybe' },
    { page_size: '20' },
    { page: '0' },
    { page: 'abc' },
    { extra: '1' },
    { type: ['all', 'account'] },
    { q: 'x'.repeat(101) },
  ])('refuses %o', (input) => {
    expect(parse(input).success).toBe(false);
  });
  it('parses every field and trims q', () => {
    const r = parse({
      q: ' a ',
      type: 'access',
      status: 'failed',
      sort: 'actor',
      dir: 'asc',
      page: '2',
      page_size: '50',
    });
    expect(r.success && r.data).toEqual({
      q: 'a',
      type: 'access',
      status: 'failed',
      sort: 'actor',
      dir: 'asc',
      page: 2,
      page_size: 50,
    });
    const blank = parse({ q: '  ' });
    expect(blank.success && blank.data.q).toBeNull();
  });
});

describe('CreatorDetailSchema', () => {
  it('accepts both kinds', () => {
    expect(CreatorDetailSchema.safeParse(request).success).toBe(true);
    expect(CreatorDetailSchema.safeParse(creator).success).toBe(true);
  });
  it('refuses a mismatched kind, both blocks, extra keys and http avatars', () => {
    expect(CreatorDetailSchema.safeParse({ ...request, request: null }).success).toBe(false);
    expect(CreatorDetailSchema.safeParse({ ...creator, request: request.request }).success).toBe(
      false,
    );
    expect(CreatorDetailSchema.safeParse({ ...creator, role: 'CREATOR' }).success).toBe(false);
    expect(
      CreatorDetailSchema.safeParse({ ...creator, avatar_url: 'http://x/y.png' }).success,
    ).toBe(false);
  });
});

describe('history and audit schemas', () => {
  const row = {
    id: ID,
    at: '2026-11-14T05:00:00.000Z',
    actor: 'Admin',
    action: 'Setujui creator',
    summary: 'Role USER → CREATOR',
    kind: 'application',
    status: 'success',
  };
  it('accept the documented shape and are strict', () => {
    expect(HistoryRowSchema.safeParse(row).success).toBe(true);
    expect(HistoryRowSchema.safeParse({ ...row, changes: {} }).success).toBe(false);
    expect(
      HistoryResponseSchema.safeParse({ items: [row], total: 1, page: 1, page_size: 10 }).success,
    ).toBe(true);
    const log = {
      id: ID,
      at: row.at,
      actor: 'A',
      action: 'x',
      kind: 'access',
      target: 'T',
      status: 'failed',
      summary: 's',
      reason: null,
      request_id: null,
      before: [{ label: 'Status', value: 'Active' }],
      after: [],
    };
    expect(AuditLogDetailSchema.safeParse(log).success).toBe(true);
    expect(AuditLogDetailSchema.safeParse({ ...log, changes: { password: 'x' } }).success).toBe(
      false,
    );
  });
});
