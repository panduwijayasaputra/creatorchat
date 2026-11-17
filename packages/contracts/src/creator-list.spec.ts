import { describe, expect, it } from 'vitest';
import {
  CreatorListQuerySchema,
  CreatorListResponseSchema,
  CreatorListRowSchema,
  DEFAULT_CREATOR_LIST_QUERY,
} from './creator-list.js';

const parse = (input: unknown) => CreatorListQuerySchema.safeParse(input);
const ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
const row = {
  kind: 'request',
  id: ID,
  status: 'REQUEST',
  creator_name: 'Maya Lestari',
  avatar_url: null,
  telegram_username: 'mayalestari',
  telegram_id: '582917403',
  instagram_url: 'https://instagram.com/maya.lestari',
  creator_type: 'HUMAN',
  subscriber_count: null,
  has_active_subscription: false,
  date: '2026-11-14T05:00:00.000Z',
};

describe('CreatorListQuerySchema', () => {
  it('defaults to the board view', () => {
    expect(DEFAULT_CREATOR_LIST_QUERY).toEqual({
      q: null,
      status: ['request', 'active', 'blocked'],
      type: 'all',
      range: 'all',
      sort: 'date',
      dir: 'desc',
      page: 1,
      page_size: 10,
    });
  });

  it('parses every field', () => {
    expect(
      parse({
        q: '  maya ',
        status: 'blocked,request,request',
        type: 'ai_character',
        range: '30d',
        sort: 'subscribers',
        dir: 'asc',
        page: '3',
        page_size: '50',
      }),
    ).toMatchObject({
      success: true,
      data: {
        q: 'maya',
        status: ['request', 'blocked'],
        type: 'ai_character',
        range: '30d',
        sort: 'subscribers',
        dir: 'asc',
        page: 3,
        page_size: 50,
      },
    });
  });

  it('turns a blank search into none and refuses a 101-character one', () => {
    expect(parse({ q: '   ' })).toMatchObject({ success: true, data: { q: null } });
    expect(parse({ q: 'a'.repeat(100) }).success).toBe(true);
    expect(parse({ q: 'a'.repeat(101) }).success).toBe(false);
  });

  it('refuses every unknown value and key', () => {
    for (const bad of [
      { sort: 'instagram' },
      { sort: 'password' },
      { dir: 'up' },
      { status: 'rejected' },
      { status: 'request,approved' },
      { status: '' },
      { type: 'bot' },
      { range: '1y' },
      { page_size: '20' },
      { page_size: '0' },
      { page: '0' },
      { page: 'abc' },
      { page: '1000000' },
      { page: '-1' },
      { extra: '1' },
      { status: ['request', 'active'] },
    ]) {
      expect(parse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('response schemas', () => {
  it('accept the documented shape', () => {
    expect(CreatorListRowSchema.safeParse(row).success).toBe(true);
    expect(
      CreatorListResponseSchema.safeParse({ items: [row], total: 1, page: 1, page_size: 10 })
        .success,
    ).toBe(true);
  });

  it('reject extra keys, http avatars and odd page sizes', () => {
    expect(CreatorListRowSchema.safeParse({ ...row, review_reason: 'x' }).success).toBe(false);
    expect(
      CreatorListRowSchema.safeParse({ ...row, avatar_url: 'http://x.test/a.png' }).success,
    ).toBe(false);
    expect(
      CreatorListResponseSchema.safeParse({ items: [], total: 0, page: 1, page_size: 20 }).success,
    ).toBe(false);
    expect(
      CreatorListResponseSchema.safeParse({ items: [], total: 0, page: 1, page_size: 10, x: 1 })
        .success,
    ).toBe(false);
  });
});
