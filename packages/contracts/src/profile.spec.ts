import { describe, expect, it } from 'vitest';
import {
  BIO_MAX,
  BIO_TOO_LONG,
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_REQUIRED,
  DISPLAY_NAME_TOO_LONG,
  UpdateProfileRequestSchema,
} from './profile.js';

const parse = (input: unknown) => UpdateProfileRequestSchema.safeParse(input);

describe('UpdateProfileRequestSchema', () => {
  it('trims the name and the bio', () => {
    expect(parse({ display_name: '  Maya L  ', bio: '  halo  ' }).data).toEqual({
      display_name: 'Maya L',
      bio: 'halo',
    });
  });

  it('rejects an empty or whitespace-only name with the designed message', () => {
    for (const display_name of ['', '   ']) {
      const result = parse({ display_name });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(DISPLAY_NAME_REQUIRED);
    }
  });

  it('accepts a 40-character name and rejects 41', () => {
    expect(parse({ display_name: 'a'.repeat(DISPLAY_NAME_MAX) }).success).toBe(true);
    const result = parse({ display_name: 'a'.repeat(DISPLAY_NAME_MAX + 1) });
    expect(result.error?.issues[0]?.message).toBe(DISPLAY_NAME_TOO_LONG);
  });

  it('counts emoji as one character each (code points)', () => {
    expect(parse({ display_name: '😀'.repeat(40) }).success).toBe(true);
    expect(parse({ display_name: '😀'.repeat(41) }).success).toBe(false);
  });

  it('accepts a 160-character bio and rejects 161', () => {
    expect(parse({ display_name: 'a', bio: 'b'.repeat(BIO_MAX) }).success).toBe(true);
    const result = parse({ display_name: 'a', bio: 'b'.repeat(BIO_MAX + 1) });
    expect(result.error?.issues[0]?.message).toBe(BIO_TOO_LONG);
  });

  it('turns a missing, null or blank bio into null', () => {
    for (const bio of [undefined, null, '', '   ']) {
      expect(parse({ display_name: 'a', bio }).data?.bio).toBeNull();
    }
  });

  it('rejects control characters but keeps newlines in the bio', () => {
    expect(parse({ display_name: 'a\nb' }).success).toBe(false);
    expect(parse({ display_name: 'a\u0000' }).success).toBe(false);
    expect(parse({ display_name: 'a', bio: 'x\u0007y' }).success).toBe(false);
    expect(parse({ display_name: 'a', bio: 'baris 1\r\nbaris 2' }).data?.bio).toBe(
      'baris 1\nbaris 2',
    );
  });

  it('strips fields it does not own instead of failing', () => {
    const result = parse({
      display_name: 'a',
      id: 'x',
      role: 'CREATOR',
      telegram_id: '1',
      username: 'u',
      status: 'BLOCKED',
    });
    expect(result.data).toEqual({ display_name: 'a', bio: null });
  });

  it('rejects a non-boolean reset_avatar and keeps a boolean one', () => {
    expect(parse({ display_name: 'a', reset_avatar: 'yes' }).success).toBe(false);
    expect(parse({ display_name: 'a', reset_avatar: true }).data?.reset_avatar).toBe(true);
  });
});
