import { describe, expect, it } from 'vitest';
import {
  AccessRequestsResponseSchema,
  RejectAccessRequestResponseSchema,
  RejectAccessRequestSchema,
  rejectAccessRequestPath,
  userAccessRequestsPath,
} from './access-request-review.js';
import { GrantAccessSchema } from './subscription-access.js';
import { UserListQuerySchema, UserListRowSchema } from './user-list.js';

const uuid = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
const item = {
  id: uuid,
  creator: { id: uuid, display_name: 'Dinda' },
  type: 'TRIAL',
  requested_at: '2026-11-13T03:42:00.000Z',
};

describe('access request review contracts (US-024)', () => {
  it('accepts the banner list and refuses leaked keys or bad types', () => {
    expect(AccessRequestsResponseSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(AccessRequestsResponseSchema.safeParse({ items: [] }).success).toBe(true);
    for (const extra of ['customer_id', 'status', 'review_reason', 'admin_id']) {
      expect(
        AccessRequestsResponseSchema.safeParse({ items: [{ ...item, [extra]: 'x' }] }).success,
      ).toBe(false);
    }
    expect(
      AccessRequestsResponseSchema.safeParse({ items: [{ ...item, type: 'PAID' }] }).success,
    ).toBe(false);
  });

  it('requires a trimmed reason of 1–300 code points and strips other keys', () => {
    expect(RejectAccessRequestSchema.parse({ reason: '  Belum sesuai.  ' })).toEqual({
      reason: 'Belum sesuai.',
    });
    expect(
      RejectAccessRequestSchema.parse({ reason: 'ok', admin_id: 'x', status: 'APPROVED' }),
    ).toEqual({
      reason: 'ok',
    });
    for (const bad of [undefined, '', '   ', 'a'.repeat(301), 'a\u0000b']) {
      expect(RejectAccessRequestSchema.safeParse({ reason: bad }).success, String(bad)).toBe(false);
    }
    expect(RejectAccessRequestSchema.safeParse({ reason: '😀'.repeat(300) }).success).toBe(true);
    const empty = RejectAccessRequestSchema.safeParse({ reason: '' });
    expect(empty.success ? '' : empty.error.issues[0]?.message).toBe('Alasan wajib diisi.');
  });

  it('answers a rejection with the id and status only', () => {
    expect(
      RejectAccessRequestResponseSchema.safeParse({ request: { id: uuid, status: 'REJECTED' } })
        .success,
    ).toBe(true);
    expect(
      RejectAccessRequestResponseSchema.safeParse({ request: { id: uuid, status: 'APPROVED' } })
        .success,
    ).toBe(false);
    expect(
      RejectAccessRequestResponseSchema.safeParse({
        request: { id: uuid, status: 'REJECTED', reason: 'x' },
      }).success,
    ).toBe(false);
  });

  it('grant: access_request_id is an optional uuid; the old body still parses', () => {
    const base = { creator_id: uuid, duration_days: 30, reason: 'Kompensasi.' };
    expect(GrantAccessSchema.safeParse(base).success).toBe(true);
    expect(GrantAccessSchema.safeParse({ ...base, access_request_id: uuid }).success).toBe(true);
    expect(GrantAccessSchema.safeParse({ ...base, access_request_id: 'nope' }).success).toBe(false);
    expect(GrantAccessSchema.safeParse({ creator_id: uuid, reason: 'x' }).success).toBe(false);
  });

  it('user list: access defaults to any, accepts pending, refuses other values', () => {
    expect(UserListQuerySchema.parse({}).access).toBe('any');
    expect(UserListQuerySchema.parse({ access: 'pending' }).access).toBe('pending');
    for (const bad of [{ access: 'all' }, { access: '' }, { access: ['pending', 'any'] }]) {
      expect(UserListQuerySchema.safeParse(bad).success).toBe(false);
    }
    const row = {
      id: uuid,
      display_name: 'Raka',
      avatar_url: null,
      telegram_username: null,
      telegram_id: '1',
      status: 'ACTIVE',
      active_subscription_count: 0,
      creator_request_status: 'NONE',
      pending_access_count: 2,
      joined_at: '2026-11-13T05:00:00.000Z',
    };
    expect(UserListRowSchema.safeParse(row).success).toBe(true);
    expect(UserListRowSchema.safeParse({ ...row, pending_access_count: -1 }).success).toBe(false);
  });

  it('builds encoded paths', () => {
    expect(userAccessRequestsPath(uuid)).toBe(`/v1/admin/users/${uuid}/access-requests`);
    expect(rejectAccessRequestPath(uuid, 'a/b')).toBe(
      `/v1/admin/users/${uuid}/access-requests/a%2Fb/reject`,
    );
  });
});
