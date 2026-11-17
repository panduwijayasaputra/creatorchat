import { describe, expect, it } from 'vitest';
import {
  CreatorSubscriberRowSchema,
  CreatorSubscribersQuerySchema,
  DEFAULT_CREATOR_SUBSCRIBERS_QUERY,
  DEFAULT_SUBSCRIPTION_EVENTS_QUERY,
  GrantableUsersQuerySchema,
  GrantableUsersResponseSchema,
  SubscriptionDetailResponseSchema,
  SubscriptionEventRowSchema,
  SubscriptionEventsQuerySchema,
  SubscriptionEventsResponseSchema,
  daysBetweenJakarta,
} from './subscription-detail.js';

const ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
const customer = {
  id: ID,
  display_name: 'Raka',
  avatar_url: null,
  telegram_username: 'raka',
  telegram_id: '1',
};

describe('queries', () => {
  it('defaults', () => {
    expect(DEFAULT_SUBSCRIPTION_EVENTS_QUERY).toEqual({
      sort: 'time',
      dir: 'desc',
      page: 1,
      page_size: 10,
    });
    expect(DEFAULT_CREATOR_SUBSCRIBERS_QUERY).toEqual({
      q: null,
      status: 'all',
      ends: 'all',
      sort: 'ends',
      dir: 'desc',
      page: 1,
      page_size: 10,
    });
  });
  it.each([
    { sort: 'reason' },
    { dir: 'up' },
    { page_size: '20' },
    { page: '0' },
    { page: 'abc' },
    { extra: '1' },
    { sort: ['time', 'actor'] },
  ])('events refuses %o', (input) => {
    expect(SubscriptionEventsQuerySchema.safeParse(input).success).toBe(false);
  });
  it.each([
    { sort: 'creator' },
    { status: 'gone' },
    { ends: 'never' },
    { dir: 'up' },
    { page_size: '20' },
    { page: '0' },
    { extra: '1' },
    { q: 'x'.repeat(101) },
    { status: ['all', 'active'] },
  ])('subscribers refuses %o', (input) => {
    expect(CreatorSubscribersQuerySchema.safeParse(input).success).toBe(false);
  });
  it('parses every subscriber field and trims q', () => {
    const r = CreatorSubscribersQuerySchema.safeParse({
      q: ' ra ',
      status: 'expired',
      ends: 'past',
      sort: 'telegram',
      dir: 'asc',
      page: '2',
      page_size: '25',
    });
    expect(r.success && r.data).toEqual({
      q: 'ra',
      status: 'expired',
      ends: 'past',
      sort: 'telegram',
      dir: 'asc',
      page: 2,
      page_size: 25,
    });
    expect(GrantableUsersQuerySchema.parse({ q: '  ' }).q).toBeNull();
    expect(GrantableUsersQuerySchema.safeParse({ q: 'a', extra: 1 }).success).toBe(false);
  });
});

describe('response schemas are strict', () => {
  const detail = {
    subscription: {
      id: ID,
      status: 'ACTIVE',
      starts_at: 'x',
      ends_at: 'y',
      revoked_at: null,
      source: 'ADMIN',
      created_by_label: 'Admin Nadia',
    },
    customer: { id: ID, display_name: 'Raka', telegram_username: null, telegram_id: '1' },
    creator: { id: ID, display_name: 'Salsa' },
  };
  it('detail', () => {
    expect(SubscriptionDetailResponseSchema.safeParse(detail).success).toBe(true);
    expect(SubscriptionDetailResponseSchema.safeParse({ ...detail, payment: {} }).success).toBe(
      false,
    );
    expect(
      SubscriptionDetailResponseSchema.safeParse({
        ...detail,
        subscription: { ...detail.subscription, admin_id: ID },
      }).success,
    ).toBe(false);
    expect(
      SubscriptionDetailResponseSchema.safeParse({
        ...detail,
        subscription: { ...detail.subscription, source: 'PAYMENT' },
      }).success,
    ).toBe(false);
  });
  it('event rows carry no reason, admin id or changes', () => {
    const row = {
      id: ID,
      at: 'x',
      actor: 'Admin',
      action: 'Berikan akses',
      summary: '30 hari',
      status: 'success',
      log_id: null,
    };
    expect(SubscriptionEventRowSchema.safeParse(row).success).toBe(true);
    for (const key of ['reason', 'admin_id', 'changes']) {
      expect(SubscriptionEventRowSchema.safeParse({ ...row, [key]: 'x' }).success, key).toBe(false);
    }
    expect(
      SubscriptionEventsResponseSchema.safeParse({ items: [row], total: 1, page: 1, page_size: 10 })
        .success,
    ).toBe(true);
  });
  it('subscriber rows and the picker', () => {
    const row = {
      id: ID,
      customer,
      status: 'ACTIVE',
      starts_at: 'x',
      ends_at: 'y',
      revoked_at: null,
    };
    expect(CreatorSubscriberRowSchema.safeParse(row).success).toBe(true);
    expect(
      CreatorSubscriberRowSchema.safeParse({ ...row, customer: { ...customer, role: 'USER' } })
        .success,
    ).toBe(false);
    expect(
      CreatorSubscriberRowSchema.safeParse({
        ...row,
        customer: { ...customer, avatar_url: 'http://x/y.png' },
      }).success,
    ).toBe(false);
    const users = Array.from({ length: 21 }, () => customer);
    expect(
      GrantableUsersResponseSchema.safeParse({
        creator_status: 'ACTIVE',
        items: users.slice(0, 20),
      }).success,
    ).toBe(true);
    expect(
      GrantableUsersResponseSchema.safeParse({ creator_status: 'ACTIVE', items: users }).success,
    ).toBe(false);
    expect(
      GrantableUsersResponseSchema.safeParse({ creator_status: 'GONE', items: [] }).success,
    ).toBe(false);
  });
});

describe('daysBetweenJakarta', () => {
  it('counts Jakarta calendar days', () => {
    expect(
      daysBetweenJakarta(new Date('2026-10-28T03:20:00Z'), new Date('2026-11-27T16:59:59Z')),
    ).toBe(30);
    expect(
      daysBetweenJakarta(new Date('2026-11-16T16:59:59Z'), new Date('2026-11-16T17:00:00Z')),
    ).toBe(1);
    expect(
      daysBetweenJakarta(new Date('2026-11-16T01:00:00Z'), new Date('2026-11-16T10:00:00Z')),
    ).toBe(0);
    expect(
      daysBetweenJakarta(new Date('2026-11-17T01:00:00Z'), new Date('2026-11-16T01:00:00Z')),
    ).toBe(-1);
  });
});
