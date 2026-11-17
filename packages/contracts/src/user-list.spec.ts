import { describe, expect, it } from 'vitest';
import {
  DEFAULT_USER_LIST_QUERY,
  UserListQuerySchema,
  UserListResponseSchema,
  UserListRowSchema,
} from './user-list.js';

const parse = (input: unknown) => UserListQuerySchema.safeParse(input);
const row = {
  id: '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33',
  display_name: 'Hendra Wijaya',
  avatar_url: null,
  telegram_username: 'hendraw',
  telegram_id: '299017733',
  status: 'ACTIVE',
  active_subscription_count: 1,
  creator_request_status: 'NONE',
  pending_access_count: 0,
  joined_at: '2026-11-13T05:00:00.000Z',
};

describe('UserListQuerySchema', () => {
  it('defaults to the board view', () => {
    expect(DEFAULT_USER_LIST_QUERY).toEqual({
      q: null,
      status: ['active', 'blocked'],
      request: ['none', 'pending', 'rejected'],
      access: 'any',
      range: 'all',
      sort: 'date',
      dir: 'desc',
      page: 1,
      page_size: 10,
    });
  });

  it('parses every field', () => {
    const r = parse({
      q: ' hendra ',
      status: 'blocked',
      request: 'pending,rejected,pending',
      range: '7d',
      sort: 'subscriptions',
      dir: 'asc',
      page: '3',
      page_size: '25',
    });
    expect(r.success && r.data).toEqual({
      q: 'hendra',
      status: ['blocked'],
      request: ['pending', 'rejected'],
      access: 'any',
      range: '7d',
      sort: 'subscriptions',
      dir: 'asc',
      page: 3,
      page_size: 25,
    });
  });

  it.each([
    { sort: 'role' },
    { dir: 'up' },
    { status: 'active,deleted' },
    { status: '' },
    { request: 'approved' },
    { request: '' },
    { range: '1y' },
    { page_size: '20' },
    { page: '0' },
    { page: 'abc' },
    { q: 'x'.repeat(101) },
    { role: 'CREATOR' },
  ])('refuses %o', (input) => {
    expect(parse(input).success).toBe(false);
  });

  it('treats an all-space q as none', () => {
    const r = parse({ q: '   ' });
    expect(r.success && r.data.q).toBeNull();
  });
});

describe('UserListRowSchema / UserListResponseSchema', () => {
  it('accepts the documented shape', () => {
    expect(UserListRowSchema.safeParse(row).success).toBe(true);
    expect(
      UserListResponseSchema.safeParse({ items: [row], total: 1, page: 1, page_size: 10 }).success,
    ).toBe(true);
  });

  it.each(['role', 'bio', 'session_version'])('rejects an extra key %s', (key) => {
    expect(UserListRowSchema.safeParse({ ...row, [key]: 'x' }).success).toBe(false);
  });
});
