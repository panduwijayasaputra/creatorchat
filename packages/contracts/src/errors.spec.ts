import { describe, expect, it } from 'vitest';
import { ErrorCode, ErrorResponseSchema } from './errors.js';
import { HealthResponseSchema } from './health.js';

describe('ErrorResponseSchema', () => {
  it('accepts code, message and request_id', () => {
    const parsed = ErrorResponseSchema.parse({
      code: ErrorCode.NOT_FOUND,
      message: 'Not found',
      request_id: 'req-12345678',
    });
    expect(parsed.code).toBe('NOT_FOUND');
  });

  it('rejects a missing request_id', () => {
    expect(ErrorResponseSchema.safeParse({ code: 'NOT_FOUND', message: 'x' }).success).toBe(false);
  });

  it('rejects an unknown error code', () => {
    expect(
      ErrorResponseSchema.safeParse({ code: 'WHATEVER', message: 'x', request_id: 'r' }).success,
    ).toBe(false);
  });

  it('allows optional details of any shape', () => {
    expect(
      ErrorResponseSchema.safeParse({
        code: 'VALIDATION_FAILED',
        message: 'x',
        request_id: 'r',
        details: [{ path: 'a', message: 'b' }],
      }).success,
    ).toBe(true);
  });
});

describe('HealthResponseSchema', () => {
  it('accepts ok and degraded shapes', () => {
    expect(
      HealthResponseSchema.safeParse({ status: 'ok', checks: { db: 'up', redis: 'up' } }).success,
    ).toBe(true);
    expect(
      HealthResponseSchema.safeParse({ status: 'degraded', checks: { db: 'down', redis: 'up' } })
        .success,
    ).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(
      HealthResponseSchema.safeParse({ status: 'fine', checks: { db: 'up', redis: 'up' } }).success,
    ).toBe(false);
  });
});

describe('creator link error codes', () => {
  it('includes CREATOR_NOT_FOUND and FORBIDDEN_ROLE', () => {
    expect(ErrorCode.CREATOR_NOT_FOUND).toBe('CREATOR_NOT_FOUND');
    expect(ErrorCode.FORBIDDEN_ROLE).toBe('FORBIDDEN_ROLE');
  });
});
