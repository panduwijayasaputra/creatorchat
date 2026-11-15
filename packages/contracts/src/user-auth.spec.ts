import { describe, expect, it } from 'vitest';
import { ErrorCode } from './errors.js';
import {
  landingPathForRole,
  MeResponseSchema,
  TelegramLoginRequestSchema,
  TelegramLoginResponseSchema,
} from './user-auth.js';

const profile = {
  id: '5b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e11',
  telegram_id: '123456789',
  role: 'USER',
  status: 'ACTIVE',
  display_name: 'Nadia',
  telegram_username: null,
  avatar_url: null,
};

describe('user auth contracts', () => {
  it('accepts only init_data in the login request', () => {
    expect(TelegramLoginRequestSchema.safeParse({ init_data: 'a=b' }).success).toBe(true);
    expect(TelegramLoginRequestSchema.safeParse({ init_data: '' }).success).toBe(false);
    expect(
      TelegramLoginRequestSchema.safeParse({ init_data: 'a=b', role: 'CREATOR' }).success,
    ).toBe(false);
  });

  it('keeps telegram_id a digit string and rejects extra profile keys', () => {
    expect(MeResponseSchema.safeParse(profile).success).toBe(true);
    expect(MeResponseSchema.safeParse({ ...profile, telegram_id: 123 }).success).toBe(false);
    expect(MeResponseSchema.safeParse({ ...profile, telegram_id: 'abc' }).success).toBe(false);
    expect(MeResponseSchema.safeParse({ ...profile, session_version: 1 }).success).toBe(false);
  });

  it('parses a login response', () => {
    const body = { access_token: 't', token_type: 'Bearer', expires_in: 3600, user: profile };
    expect(TelegramLoginResponseSchema.safeParse(body).success).toBe(true);
    expect(TelegramLoginResponseSchema.safeParse({ ...body, token_type: 'Basic' }).success).toBe(
      false,
    );
  });

  it('lands USER on chats and CREATOR on inbox', () => {
    expect(landingPathForRole('USER')).toBe('/chats');
    expect(landingPathForRole('CREATOR')).toBe('/inbox');
  });

  it('has the new error codes', () => {
    expect(ErrorCode.TELEGRAM_AUTH_INVALID).toBe('TELEGRAM_AUTH_INVALID');
    expect(ErrorCode.TELEGRAM_AUTH_EXPIRED).toBe('TELEGRAM_AUTH_EXPIRED');
    expect(ErrorCode.ACCOUNT_BLOCKED).toBe('ACCOUNT_BLOCKED');
  });
});
