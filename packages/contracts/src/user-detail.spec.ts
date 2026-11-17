import { describe, expect, it } from 'vitest';
import {
  DEFAULT_USER_REQUESTS_QUERY,
  UserDetailResponseSchema,
  UserRequestDetailSchema,
  UserRequestRowSchema,
  UserRequestsQuerySchema,
  UserRequestsResponseSchema,
} from './user-detail.js';

const ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
const user = {
  role: 'USER',
  user: {
    id: ID,
    display_name: 'Raka',
    avatar_url: null,
    telegram_username: 'raka',
    telegram_id: '1',
    status: 'ACTIVE',
    bio: null,
    joined_at: '2026-10-12T00:00:00.000Z',
  },
  subscriptions: {
    active_count: 1,
    expired_count: 1,
    nearest_end: { creator_name: 'Salsa', ends_at: '2026-11-27T00:00:00.000Z' },
  },
  creator_request: {
    status: 'PENDING',
    submitted_at: '2026-11-13T00:00:00.000Z',
    rejection_count: 1,
    last_rejected_at: '2026-11-05T00:00:00.000Z',
    latest_request_id: ID,
  },
  block: null,
};
const detail = (status: 'PENDING' | 'REJECTED', extra = {}) => ({
  request: {
    id: ID,
    status,
    creator_name: 'R',
    instagram_url: 'https://instagram.com/r',
    creator_type: 'HUMAN',
    description: 'd',
    created_at: '2026-11-13T00:00:00.000Z',
    ordinal: 2,
  },
  applicant: { display_name: 'Raka', telegram_username: null, telegram_id: '1' },
  check: status === 'PENDING' ? { block: null } : null,
  review:
    status === 'REJECTED'
      ? { reason: 'r', reviewed_at: null, reviewer_label: 'Admin', log_id: null }
      : null,
  ...extra,
});
const parse = (input: unknown) => UserRequestsQuerySchema.safeParse(input);

describe('UserDetailResponseSchema', () => {
  it('accepts both roles and refuses mixed or extra fields', () => {
    expect(UserDetailResponseSchema.safeParse(user).success).toBe(true);
    expect(UserDetailResponseSchema.safeParse({ role: 'CREATOR', creator_id: ID }).success).toBe(
      true,
    );
    expect(
      UserDetailResponseSchema.safeParse({ role: 'CREATOR', creator_id: ID, user: user.user })
        .success,
    ).toBe(false);
    expect(UserDetailResponseSchema.safeParse({ ...user, session_version: 3 }).success).toBe(false);
    expect(
      UserDetailResponseSchema.safeParse({ ...user, user: { ...user.user, role: 'USER' } }).success,
    ).toBe(false);
    expect(
      UserDetailResponseSchema.safeParse({
        ...user,
        user: { ...user.user, avatar_url: 'http://x/y.png' },
      }).success,
    ).toBe(false);
    expect(UserDetailResponseSchema.safeParse({ ...user, role: 'ADMIN' }).success).toBe(false);
  });
});

describe('UserRequestsQuerySchema', () => {
  it('defaults', () => {
    expect(DEFAULT_USER_REQUESTS_QUERY).toEqual({
      q: null,
      status: 'all',
      sort: 'date',
      dir: 'desc',
      page: 1,
      page_size: 10,
    });
  });
  it.each([
    { sort: 'secret' },
    { dir: 'up' },
    { status: 'approved' },
    { page_size: '20' },
    { page: '0' },
    { page: 'abc' },
    { extra: '1' },
    { status: ['all', 'pending'] },
    { q: 'x'.repeat(101) },
  ])('refuses %o', (input) => {
    expect(parse(input).success).toBe(false);
  });
  it('trims q and parses every field', () => {
    const r = parse({
      q: ' a ',
      status: 'rejected',
      sort: 'status',
      dir: 'asc',
      page: '2',
      page_size: '25',
    });
    expect(r.success && r.data).toEqual({
      q: 'a',
      status: 'rejected',
      sort: 'status',
      dir: 'asc',
      page: 2,
      page_size: 25,
    });
  });
});

describe('request rows and detail', () => {
  it('rows and responses are strict; APPROVED is not a row status', () => {
    const row = {
      id: ID,
      created_at: 'x',
      ordinal: 1,
      status: 'PENDING',
      summary: 'Menunggu peninjauan',
    };
    expect(UserRequestRowSchema.safeParse(row).success).toBe(true);
    expect(UserRequestRowSchema.safeParse({ ...row, status: 'APPROVED' }).success).toBe(false);
    expect(UserRequestRowSchema.safeParse({ ...row, review_reason: 'x' }).success).toBe(false);
    expect(
      UserRequestsResponseSchema.safeParse({
        items: [row],
        total: 1,
        page: 1,
        page_size: 10,
        pending: { id: ID, subscription_block: null },
      }).success,
    ).toBe(true);
  });
  it('ties check and review to the status', () => {
    expect(UserRequestDetailSchema.safeParse(detail('PENDING')).success).toBe(true);
    expect(UserRequestDetailSchema.safeParse(detail('REJECTED')).success).toBe(true);
    expect(UserRequestDetailSchema.safeParse(detail('PENDING', { check: null })).success).toBe(
      false,
    );
    expect(UserRequestDetailSchema.safeParse(detail('REJECTED', { review: null })).success).toBe(
      false,
    );
    expect(UserRequestDetailSchema.safeParse(detail('PENDING', { admin_id: ID })).success).toBe(
      false,
    );
  });
});
