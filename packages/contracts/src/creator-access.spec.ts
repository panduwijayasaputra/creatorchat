import { describe, expect, it } from 'vitest';
import {
  accessRequestPath,
  CreatorAccessReviewSchema,
  CreatorAccessSchema,
  CreatorProfileResponseSchema,
  DEFAULT_EXPLORE_QUERY,
  ExploreItemSchema,
  ExploreQuerySchema,
  ExploreResponseSchema,
  SubmitAccessRequestResponseSchema,
  SubscriptionItemSchema,
  SubscriptionsResponseSchema,
} from './creator-access.js';

const base = {
  public_code: 'k4m5x2qa',
  display_name: 'Salsa',
  bio: null,
  avatar_url: null,
  conversation_id: null,
};
const parse = (input: unknown) => ExploreQuerySchema.safeParse(input);

describe('CreatorAccessSchema', () => {
  it.each([
    { state: 'GUEST' },
    { state: 'PENDING', requested_at: '2026-11-13T03:42:00.000Z', request_type: 'TRIAL' },
    { state: 'PENDING', requested_at: '2026-11-13T03:42:00.000Z', request_type: 'RENEWAL' },
    { state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' },
    { state: 'EXPIRED', ended_at: '2026-11-06T16:59:59.000Z', revoked: false },
  ])('accepts %o', (value) => {
    expect(CreatorAccessSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    { state: 'GUEST', ends_at: 'x' },
    { state: 'ACTIVE' },
    { state: 'ACTIVE', ends_at: 'x', requested_at: 'y' },
    { state: 'PENDING', requested_at: 'x' },
    { state: 'PENDING', requested_at: 'x', request_type: 'GIFT' },
    { state: 'EXPIRED', ended_at: 'x' },
    { state: 'REVOKED' },
    {},
  ])('refuses %o', (value) => {
    expect(CreatorAccessSchema.safeParse(value).success).toBe(false);
  });
});

describe('CreatorProfileResponseSchema', () => {
  it('is the deep-link answer plus access, and nothing else', () => {
    expect(
      CreatorProfileResponseSchema.safeParse({ ...base, access: { state: 'GUEST' } }).success,
    ).toBe(true);
    expect(CreatorProfileResponseSchema.safeParse(base).success).toBe(false);
    for (const extra of [
      'id',
      'creator_id',
      'status',
      'media',
      'gallery',
      'tiles',
      'subscriber_count',
    ]) {
      expect(
        CreatorProfileResponseSchema.safeParse({ ...base, access: { state: 'GUEST' }, [extra]: 1 })
          .success,
        extra,
      ).toBe(false);
    }
  });
});

describe('ExploreQuerySchema', () => {
  it('defaults', () => {
    expect(DEFAULT_EXPLORE_QUERY).toEqual({ page: 1, page_size: 20 });
  });
  it('parses page and size', () => {
    const r = parse({ page: '3', page_size: '50' });
    expect(r.success && r.data).toEqual({ page: 3, page_size: 50 });
  });
  it.each([
    { page: '0' },
    { page: 'abc' },
    { page: '1000000' },
    { page_size: '15' },
    { extra: '1' },
    { page: ['1', '2'] },
  ])('refuses %o', (input) => {
    expect(parse(input).success).toBe(false);
  });
});

describe('Explore response', () => {
  // Explore rows carry no conversation id.
  const { conversation_id: _conversation, ...exploreBase } = base;
  void _conversation;
  const item = { ...exploreBase, access: 'ACTIVE' };
  it('accepts the documented shape and refuses leaks', () => {
    expect(ExploreItemSchema.safeParse(item).success).toBe(true);
    expect(ExploreItemSchema.safeParse({ ...item, access: null }).success).toBe(true);
    expect(ExploreItemSchema.safeParse({ ...item, access: 'GUEST' }).success).toBe(false);
    expect(ExploreItemSchema.safeParse({ ...item, avatar_url: 'http://x/y.png' }).success).toBe(
      false,
    );
    for (const extra of ['id', 'status', 'media', 'subscriber_count']) {
      expect(ExploreItemSchema.safeParse({ ...item, [extra]: 1 }).success, extra).toBe(false);
    }
    expect(
      ExploreResponseSchema.safeParse({ items: [item], total: 1, page: 1, page_size: 20 }).success,
    ).toBe(true);
    expect(
      ExploreResponseSchema.safeParse({ items: [], total: 0, page: 1, page_size: 15 }).success,
    ).toBe(false);
  });
});

describe('access request contracts (US-023)', () => {
  const at = '2026-11-17T03:00:00.000Z';

  it('accepts the exact submit answer and refuses anything else', () => {
    const ok = { request_type: 'TRIAL', requested_at: at };
    expect(SubmitAccessRequestResponseSchema.safeParse(ok).success).toBe(true);
    expect(
      SubmitAccessRequestResponseSchema.safeParse({ ...ok, request_type: 'RENEWAL' }).success,
    ).toBe(true);
    expect(
      SubmitAccessRequestResponseSchema.safeParse({ ...ok, request_type: 'PAID' }).success,
    ).toBe(false);
    for (const extra of ['id', 'creator_id', 'status', 'review_reason']) {
      expect(SubmitAccessRequestResponseSchema.safeParse({ ...ok, [extra]: 'x' }).success).toBe(
        false,
      );
    }
  });

  it('last_review is optional, strict and holds no reason or admin', () => {
    const review = { status: 'REJECTED', reviewed_at: at };
    expect(CreatorAccessReviewSchema.safeParse(review).success).toBe(true);
    expect(CreatorAccessReviewSchema.safeParse({ ...review, status: 'PENDING' }).success).toBe(
      false,
    );
    for (const extra of ['review_reason', 'reviewed_by', 'id']) {
      expect(CreatorAccessReviewSchema.safeParse({ ...review, [extra]: 'x' }).success).toBe(false);
    }
    const profile = { ...base, access: { state: 'GUEST' } };
    expect(CreatorProfileResponseSchema.safeParse(profile).success).toBe(true);
    expect(
      CreatorProfileResponseSchema.safeParse({ ...profile, last_review: review }).success,
    ).toBe(true);
  });

  it('builds the encoded path', () => {
    expect(accessRequestPath('k4m5x2qa')).toBe('/v1/creators/by-code/k4m5x2qa/access-requests');
    expect(accessRequestPath('a/b')).toBe('/v1/creators/by-code/a%2Fb/access-requests');
  });
});

describe('Langganan contracts (US-025)', () => {
  const card = {
    public_code: 'k4m5x2qa',
    display_name: 'Salsa',
    avatar_url: null,
    creator_available: true,
    conversation_id: null,
    muted: false,
  };
  const states = [
    { state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' },
    { state: 'PENDING', requested_at: '2026-11-13T03:42:00.000Z', request_type: 'TRIAL' },
    { state: 'EXPIRED', ended_at: '2026-11-06T16:59:59.000Z', revoked: false },
  ];

  it.each(states)('accepts a card in the %o state', (access) => {
    expect(SubscriptionItemSchema.safeParse({ ...card, access }).success).toBe(true);
  });

  it('refuses GUEST, foreign fields on a state and a missing creator_available', () => {
    expect(SubscriptionItemSchema.safeParse({ ...card, access: { state: 'GUEST' } }).success).toBe(
      false,
    );
    expect(
      SubscriptionItemSchema.safeParse({
        ...card,
        access: { state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z', requested_at: 'x' },
      }).success,
    ).toBe(false);
    const { creator_available: _unused, ...without } = card;
    void _unused;
    expect(SubscriptionItemSchema.safeParse({ ...without, access: states[0] }).success).toBe(false);
  });

  it('refuses leaked keys and a non-https avatar', () => {
    const ok = { ...card, access: states[0] };
    for (const extra of [
      'id',
      'creator_id',
      'status',
      'media',
      'gallery',
      'subscriber_count',
      'review_reason',
    ]) {
      expect(SubscriptionItemSchema.safeParse({ ...ok, [extra]: 1 }).success, extra).toBe(false);
    }
    expect(SubscriptionItemSchema.safeParse({ ...ok, avatar_url: 'http://x/y.png' }).success).toBe(
      false,
    );
    expect(SubscriptionItemSchema.safeParse({ ...ok, avatar_url: 'https://x/y.png' }).success).toBe(
      true,
    );
  });

  it('caps the list at 100 cards', () => {
    const item = { ...card, access: states[0] };
    expect(SubscriptionsResponseSchema.safeParse({ items: Array(100).fill(item) }).success).toBe(
      true,
    );
    expect(SubscriptionsResponseSchema.safeParse({ items: Array(101).fill(item) }).success).toBe(
      false,
    );
    expect(SubscriptionsResponseSchema.safeParse({ items: [], total: 0 }).success).toBe(false);
  });
});

describe('muted on a Langganan card (US-043)', () => {
  const card = {
    public_code: 'k4m5x2qa',
    display_name: 'Salsa',
    avatar_url: null,
    creator_available: true,
    conversation_id: null,
    access: { state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' },
  };

  it('is a required boolean', () => {
    expect(SubscriptionItemSchema.safeParse({ ...card, muted: true }).success).toBe(true);
    expect(SubscriptionItemSchema.safeParse({ ...card, muted: false }).success).toBe(true);
    expect(SubscriptionItemSchema.safeParse(card).success).toBe(false);
    expect(SubscriptionItemSchema.safeParse({ ...card, muted: 'yes' }).success).toBe(false);
  });
});

describe('conversation_id on profile and Langganan (US-027)', () => {
  const id = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
  const profile = { ...base, access: { state: 'GUEST' } };

  it('is a required uuid-or-null on the profile answer', () => {
    expect(
      CreatorProfileResponseSchema.safeParse({ ...profile, conversation_id: id }).success,
    ).toBe(true);
    expect(
      CreatorProfileResponseSchema.safeParse({ ...profile, conversation_id: null }).success,
    ).toBe(true);
    expect(
      CreatorProfileResponseSchema.safeParse({ ...profile, conversation_id: 'nope' }).success,
    ).toBe(false);
    const { conversation_id: _unused, ...without } = profile;
    void _unused;
    expect(CreatorProfileResponseSchema.safeParse(without).success).toBe(false);
  });

  it('is a required uuid-or-null on a Langganan card', () => {
    const card = {
      public_code: 'k4m5x2qa',
      display_name: 'Salsa',
      avatar_url: null,
      access: { state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' },
      creator_available: true,
      muted: false,
    };
    expect(SubscriptionItemSchema.safeParse({ ...card, conversation_id: id }).success).toBe(true);
    expect(SubscriptionItemSchema.safeParse({ ...card, conversation_id: null }).success).toBe(true);
    expect(SubscriptionItemSchema.safeParse({ ...card, conversation_id: 'x' }).success).toBe(false);
    expect(SubscriptionItemSchema.safeParse(card).success).toBe(false);
  });
});
