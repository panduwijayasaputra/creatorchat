import { describe, expect, it } from 'vitest';
import {
  AdminLoginRequestSchema,
  AdminSessionResponseSchema,
  LoginFailureDetailsSchema,
  LoginLockedDetailsSchema,
} from './admin-auth.js';
import { ErrorCode, ErrorResponseSchema } from './errors.js';

const issue = (input: unknown) => {
  const result = AdminLoginRequestSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => [i.path.join('.'), i.message]);
};

describe('AdminLoginRequestSchema', () => {
  it('accepts a username and password and trims the username', () => {
    expect(AdminLoginRequestSchema.parse({ username: '  nadia.admin ', password: 'x' })).toEqual({
      username: 'nadia.admin',
      password: 'x',
    });
  });

  it('keeps the password exactly as typed (no trimming)', () => {
    expect(AdminLoginRequestSchema.parse({ username: 'a', password: ' pass ' }).password).toBe(
      ' pass ',
    );
  });

  it('uses the designed copy for empty fields', () => {
    expect(issue({ username: '', password: '' })).toEqual([
      ['username', 'Username wajib diisi.'],
      ['password', 'Password wajib diisi.'],
    ]);
  });

  it('treats a whitespace-only username as empty', () => {
    expect(issue({ username: '   ', password: 'x' })).toEqual([
      ['username', 'Username wajib diisi.'],
    ]);
  });

  it('uses the designed copy when fields are missing', () => {
    expect(issue({})).toEqual([
      ['username', 'Username wajib diisi.'],
      ['password', 'Password wajib diisi.'],
    ]);
  });

  it('rejects over-long values', () => {
    expect(issue({ username: 'a'.repeat(65), password: 'x' })).toHaveLength(1);
    expect(issue({ username: 'a', password: 'x'.repeat(257) })).toHaveLength(1);
  });

  it('strips unknown fields such as a role', () => {
    const parsed = AdminLoginRequestSchema.parse({ username: 'a', password: 'b', role: 'ADMIN' });
    expect(parsed).toEqual({ username: 'a', password: 'b' });
  });
});

describe('AdminSessionResponseSchema', () => {
  const admin = {
    id: '3f2b8c1e-5d4a-4b7e-9c1a-2d3e4f5a6b7c',
    username: 'a',
    role: 'Administrator',
  };

  it('accepts the admin profile', () => {
    expect(AdminSessionResponseSchema.safeParse({ admin }).success).toBe(true);
  });

  it('rejects a payload that carries a password hash or any extra field', () => {
    expect(
      AdminSessionResponseSchema.safeParse({ admin: { ...admin, passwordHash: 'x' } }).success,
    ).toBe(false);
    expect(AdminSessionResponseSchema.safeParse({ admin, refresh: 't' }).success).toBe(false);
  });
});

describe('login error contract', () => {
  it('has the new error codes', () => {
    expect(ErrorCode.INVALID_CREDENTIALS).toBe('INVALID_CREDENTIALS');
    expect(ErrorCode.LOGIN_LOCKED).toBe('LOGIN_LOCKED');
    expect(ErrorCode.CSRF_FAILED).toBe('CSRF_FAILED');
  });

  it('accepts the attempt counter and lock details', () => {
    expect(LoginFailureDetailsSchema.safeParse({ attempts: 2, max: 5 }).success).toBe(true);
    expect(LoginFailureDetailsSchema.safeParse({ attempts: 0, max: 5 }).success).toBe(false);
    expect(LoginLockedDetailsSchema.safeParse({ retry_after_seconds: 900 }).success).toBe(true);
    expect(
      ErrorResponseSchema.safeParse({
        code: 'LOGIN_LOCKED',
        message: 'x',
        request_id: 'r',
        details: { retry_after_seconds: 10 },
      }).success,
    ).toBe(true);
  });
});
