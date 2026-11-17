import { describe, expect, it } from 'vitest';
import {
  CreatorRequestStateResponseSchema,
  DESCRIPTION_REQUIRED,
  INSTAGRAM_INVALID,
  RIGHTS_REQUIRED,
  SubmitCreatorRequestSchema,
  instagramHandle,
  normalizeInstagramUrl,
} from './creator-request.js';

const valid = {
  creator_name: 'Maya Lestari',
  instagram_url: 'https://instagram.com/maya.lestari',
  creator_type: 'HUMAN',
  description: 'Resep dan tips masak rumahan.',
  rights_confirmed: true,
};

describe('normalizeInstagramUrl', () => {
  it.each([
    ['https://instagram.com/namaakun', 'https://instagram.com/namaakun'],
    ['https://www.instagram.com/nama.akun/', 'https://instagram.com/nama.akun'],
    ['http://instagram.com/a_b', 'https://instagram.com/a_b'],
    ['HTTPS://WWW.INSTAGRAM.COM/Maya', 'https://instagram.com/Maya'],
    ['  https://instagram.com/maya?igsh=abc#top  ', 'https://instagram.com/maya'],
  ])('accepts %j', (input, expected) => {
    expect(normalizeInstagramUrl(input)).toBe(expected);
  });

  it.each([
    '',
    'instagram.com/maya',
    'https://instagram.com',
    'https://instagram.com/',
    'https://instagram.com/maya/posts',
    'https://instagram.com.evil.com/maya',
    'https://evil.com/instagram.com/maya',
    'https://user@instagram.com/maya',
    'https://instagram.com:8080/maya',
    'ftp://instagram.com/maya',
    'javascript:alert(1)',
    'https://m.instagram.com/maya',
    `https://instagram.com/${'a'.repeat(31)}`,
    'https://instagram.com/ma ya',
    'https://instagram.com/ma%20ya',
  ])('rejects %j', (input) => {
    expect(normalizeInstagramUrl(input)).toBeNull();
  });
});

describe('SubmitCreatorRequestSchema', () => {
  it('accepts and normalises a valid request, stripping unknown keys', () => {
    const parsed = SubmitCreatorRequestSchema.parse({
      ...valid,
      instagram_url: 'https://www.instagram.com/maya.lestari/?x=1',
      creator_name: '  Maya Lestari  ',
      user_id: 'x',
      role: 'CREATOR',
      status: 'APPROVED',
      id: 'y',
    });
    expect(parsed).toEqual(valid);
  });

  it('reports the board copy for each invalid field', () => {
    const result = SubmitCreatorRequestSchema.safeParse({
      ...valid,
      instagram_url: 'nope',
      description: '   ',
      rights_confirmed: false,
    });
    expect(result.success).toBe(false);
    const byField = Object.fromEntries(
      (result.error?.issues ?? []).map((issue) => [issue.path[0], issue.message]),
    );
    expect(byField).toEqual({
      instagram_url: INSTAGRAM_INVALID,
      description: DESCRIPTION_REQUIRED,
      rights_confirmed: RIGHTS_REQUIRED,
    });
  });

  it('gives the board copy when a field is missing entirely', () => {
    const result = SubmitCreatorRequestSchema.safeParse({
      creator_name: 'Maya',
      creator_type: 'HUMAN',
    });
    const byField = Object.fromEntries(
      (result.error?.issues ?? []).map((issue) => [issue.path[0], issue.message]),
    );
    expect(byField).toMatchObject({
      instagram_url: INSTAGRAM_INVALID,
      description: DESCRIPTION_REQUIRED,
      rights_confirmed: RIGHTS_REQUIRED,
    });
  });

  it.each([
    ['empty name', { creator_name: ' ' }],
    ['41-char name', { creator_name: 'a'.repeat(41) }],
    ['control char in name', { creator_name: 'Ma\u0000ya' }],
    ['301-char description', { description: 'a'.repeat(301) }],
    ['control char in description', { description: 'a\u0007b' }],
    ['unknown type', { creator_type: 'BOTH' }],
    ['missing type', { creator_type: undefined }],
    ['rights as string', { rights_confirmed: 'true' }],
    ['rights missing', { rights_confirmed: undefined }],
  ])('rejects %s', (_label, patch) => {
    expect(SubmitCreatorRequestSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('counts limits in code points and allows newlines in the description', () => {
    const ok = (patch: object) =>
      SubmitCreatorRequestSchema.safeParse({ ...valid, ...patch }).success;
    expect(ok({ creator_name: '😀'.repeat(40) })).toBe(true);
    expect(ok({ description: '😀'.repeat(300) })).toBe(true);
    expect(ok({ description: 'a\nb' })).toBe(true);
    expect(ok({ creator_type: 'AI_CHARACTER' })).toBe(true);
  });
});

describe('CreatorRequestStateResponseSchema', () => {
  it('allows no request and no block', () => {
    expect(CreatorRequestStateResponseSchema.parse({ request: null, blocked: null })).toEqual({
      request: null,
      blocked: null,
    });
  });
});

describe('instagramHandle', () => {
  it('shows the handle of a stored link', () => {
    expect(instagramHandle('https://instagram.com/maya.lestari')).toBe('@maya.lestari');
  });

  it('accepts a trailing slash and www, and keeps the handle case', () => {
    expect(instagramHandle('https://www.instagram.com/Maya_L/')).toBe('@Maya_L');
  });

  it('returns a value with another shape unchanged and never throws', () => {
    for (const value of [
      'https://example.com/maya',
      'https://instagram.com/a/b',
      'not a url',
      '',
    ]) {
      expect(instagramHandle(value)).toBe(value);
    }
  });
});
