import { describe, expect, it } from 'vitest';
import { ErrorCode } from './errors.js';
import {
  AdminCreatorRequestSchema,
  ApprovalBlockSchema,
  ApproveCreatorRequestResponseSchema,
  CreatorRequestReviewResponseSchema,
  REJECT_REASON_INVALID,
  REJECT_REASON_REQUIRED,
  REJECT_REASON_TOO_LONG,
  RejectCreatorRequestSchema,
  RejectCreatorRequestResponseSchema,
} from './creator-review.js';

const reason = (value: unknown) => RejectCreatorRequestSchema.safeParse({ reason: value });
const message = (value: unknown) => {
  const result = reason(value);
  return result.success ? null : result.error.issues[0]?.message;
};

const ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
const request = {
  id: ID,
  status: 'PENDING',
  creator_name: 'Maya Lestari',
  instagram_url: 'https://instagram.com/maya.lestari',
  creator_type: 'HUMAN',
  description: 'Resep',
  created_at: '2026-11-16T05:00:00.000Z',
  reviewed_at: null,
  review_reason: null,
  user: {
    id: '5b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e11',
    display_name: 'Maya Lestari',
    telegram_username: 'mayalestari',
    telegram_id: '582917403',
    role: 'USER',
    status: 'ACTIVE',
  },
};

describe('RejectCreatorRequestSchema', () => {
  it('trims the reason and normalises line breaks', () => {
    expect(reason('  Link belum bisa diverifikasi.\r\nCoba lagi.  ')).toMatchObject({
      success: true,
      data: { reason: 'Link belum bisa diverifikasi.\nCoba lagi.' },
    });
  });

  it('answers empty, whitespace-only, missing and non-string reasons with the board text', () => {
    for (const value of ['', '   ', '\n\t ', undefined, null, 42]) {
      expect(message(value)).toBe(REJECT_REASON_REQUIRED);
    }
    expect(RejectCreatorRequestSchema.safeParse({}).success).toBe(false);
  });

  it('allows 300 code points and refuses 301, counting an emoji once', () => {
    expect(reason('a'.repeat(300)).success).toBe(true);
    expect(message('a'.repeat(301))).toBe(REJECT_REASON_TOO_LONG);
    expect(reason('😀'.repeat(300)).success).toBe(true);
    expect(message('😀'.repeat(301))).toBe(REJECT_REASON_TOO_LONG);
    expect(message('a'.repeat(5001))).toBe(REJECT_REASON_TOO_LONG);
  });

  it('refuses control characters except a newline', () => {
    expect(message('a\u0000b')).toBe(REJECT_REASON_INVALID);
    expect(message('a\tb')).toBe(REJECT_REASON_INVALID);
    expect(reason('a\nb').success).toBe(true);
  });

  it('strips every other key', () => {
    const result = RejectCreatorRequestSchema.parse({
      reason: 'x',
      status: 'APPROVED',
      user_id: ID,
      admin_id: ID,
    });
    expect(result).toEqual({ reason: 'x' });
  });
});

describe('response schemas', () => {
  const check = { block: null, checked_at: '2026-11-16T08:02:00.000Z' };

  it('accept the documented shapes', () => {
    expect(CreatorRequestReviewResponseSchema.safeParse({ request, check }).success).toBe(true);
    expect(RejectCreatorRequestResponseSchema.safeParse({ request }).success).toBe(true);
    expect(
      ApproveCreatorRequestResponseSchema.safeParse({
        request: { ...request, status: 'APPROVED', reviewed_at: '2026-11-16T08:02:00.000Z' },
        creator: { id: ID, public_code: 'k4m5x2qa' },
      }).success,
    ).toBe(true);
  });

  it('reject unknown keys, so nothing internal leaks', () => {
    expect(
      AdminCreatorRequestSchema.safeParse({ ...request, reviewed_by_admin_id: ID }).success,
    ).toBe(false);
    expect(
      AdminCreatorRequestSchema.safeParse({ ...request, user: { ...request.user, password: 'x' } })
        .success,
    ).toBe(false);
    expect(CreatorRequestReviewResponseSchema.safeParse({ request, check, extra: 1 }).success).toBe(
      false,
    );
  });

  it('describe a blocking subscription with a positive count', () => {
    const block = {
      count: 1,
      creator_name: 'Salsa Maheswari',
      ends_at: '2026-11-27T00:00:00.000Z',
    };
    expect(ApprovalBlockSchema.safeParse(block).success).toBe(true);
    expect(ApprovalBlockSchema.safeParse({ ...block, count: 0 }).success).toBe(false);
  });
});

describe('review error codes', () => {
  it('are distinct and present', () => {
    const codes = [
      ErrorCode.CREATOR_REQUEST_ALREADY_REVIEWED,
      ErrorCode.CREATOR_REQUEST_ACCOUNT_NOT_ELIGIBLE,
      ErrorCode.CREATOR_APPROVAL_BLOCKED,
    ];
    expect(new Set(codes).size).toBe(3);
    expect(codes.every((code) => typeof code === 'string' && code.length > 0)).toBe(true);
    expect(new Set(Object.values(ErrorCode)).size).toBe(Object.values(ErrorCode).length);
  });
});
