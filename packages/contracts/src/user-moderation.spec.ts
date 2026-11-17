import { describe, expect, it } from 'vitest';
import { ErrorCode } from './errors.js';
import { REJECT_REASON_REQUIRED } from './creator-review.js';
import {
  BlockUserResponseSchema,
  ModerateUserSchema,
  UnblockUserResponseSchema,
  UserBlockCheckResponseSchema,
  UserRoleConflictDetailsSchema,
  UserStatusConflictDetailsSchema,
} from './user-moderation.js';

const ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
const parse = (reason: unknown) => ModerateUserSchema.safeParse({ reason });

describe('ModerateUserSchema', () => {
  it('trims the reason and normalises line breaks', () => {
    expect(parse('  Spam berulang.\r\nSetelah peringatan.  ')).toMatchObject({
      success: true,
      data: { reason: 'Spam berulang.\nSetelah peringatan.' },
    });
  });

  it('refuses empty, blank, missing and non-string reasons with the board text', () => {
    for (const value of ['', '   ', '\n ', undefined, null, 5]) {
      const result = parse(value);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(REJECT_REASON_REQUIRED);
    }
  });

  it('allows 300 code points and refuses 301 or control characters', () => {
    expect(parse('a'.repeat(300)).success).toBe(true);
    expect(parse('a'.repeat(301)).success).toBe(false);
    expect(parse('😀'.repeat(300)).success).toBe(true);
    expect(parse('a\u0000b').success).toBe(false);
  });

  it('strips every other key', () => {
    expect(ModerateUserSchema.parse({ reason: 'x', status: 'ACTIVE', admin_id: ID })).toEqual({
      reason: 'x',
    });
  });
});

describe('response schemas', () => {
  it('accept the documented shapes and nothing more', () => {
    expect(
      UserBlockCheckResponseSchema.safeParse({
        user_status: 'ACTIVE',
        role: 'USER',
        active_subscriptions: 1,
        checked_at: '2026-11-16T08:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      UserBlockCheckResponseSchema.safeParse({
        user_status: 'ACTIVE',
        role: 'USER',
        active_subscriptions: 1,
        checked_at: 'x',
        extra: 1,
      }).success,
    ).toBe(false);
    expect(BlockUserResponseSchema.safeParse({ user: { id: ID, status: 'BLOCKED' } }).success).toBe(
      true,
    );
    expect(BlockUserResponseSchema.safeParse({ user: { id: ID, status: 'ACTIVE' } }).success).toBe(
      false,
    );
    expect(
      UnblockUserResponseSchema.safeParse({ user: { id: ID, status: 'ACTIVE' } }).success,
    ).toBe(true);
    expect(UserStatusConflictDetailsSchema.safeParse({ status: 'BLOCKED' }).success).toBe(true);
    expect(UserRoleConflictDetailsSchema.safeParse({ role: 'CREATOR' }).success).toBe(true);
    expect(UserRoleConflictDetailsSchema.safeParse({ role: 'ADMIN' }).success).toBe(false);
  });

  it('has distinct conflict codes', () => {
    expect(ErrorCode.USER_STATUS_CONFLICT).not.toBe(ErrorCode.USER_ROLE_CONFLICT);
    expect(new Set(Object.values(ErrorCode)).size).toBe(Object.values(ErrorCode).length);
  });
});
