import { describe, expect, it } from 'vitest';
import {
  computeEndDate,
  computeExtendedEnd,
  DEFAULT_SUBSCRIPTION_LIST_QUERY,
  endOfJakartaDay,
  ExtendAccessSchema,
  GrantAccessSchema,
  jakartaDateString,
  RevokeAccessSchema,
  SubscriptionListQuerySchema,
} from './subscription-access.js';

const CREATOR = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
const grant = (o: object) =>
  GrantAccessSchema.safeParse({ creator_id: CREATOR, reason: 'Kompensasi', ...o });

describe('access dates (Jakarta, UTC+7)', () => {
  it('ends at 23:59:59 Jakarta of today + days, switching day at 17:00 UTC', () => {
    expect(computeEndDate(new Date('2026-11-14T16:59:59Z'), 30).toISOString()).toBe(
      '2026-12-14T16:59:59.000Z',
    );
    // 17:00 UTC is already the next Jakarta day
    expect(computeEndDate(new Date('2026-11-14T17:00:00Z'), 30).toISOString()).toBe(
      '2026-12-15T16:59:59.000Z',
    );
  });
  it('rolls over month and year', () => {
    expect(computeEndDate(new Date('2026-12-20T05:00:00Z'), 30).toISOString()).toBe(
      '2027-01-19T16:59:59.000Z',
    );
  });
  it('extends from a future end, and from now when the end is past or equal', () => {
    const now = new Date('2026-11-16T05:00:00Z');
    expect(computeExtendedEnd(new Date('2026-11-27T16:59:59Z'), now, 30).toISOString()).toBe(
      '2026-12-27T16:59:59.000Z',
    );
    expect(computeExtendedEnd(new Date('2026-11-06T16:59:59Z'), now, 30).toISOString()).toBe(
      '2026-12-16T16:59:59.000Z',
    );
    expect(computeExtendedEnd(now, now, 7).toISOString()).toBe('2026-11-23T16:59:59.000Z');
  });
  it('parses a custom date and refuses impossible ones', () => {
    expect(endOfJakartaDay('2026-12-14')?.toISOString()).toBe('2026-12-14T16:59:59.000Z');
    for (const bad of ['2026-02-30', '2026-13-01', '14-12-2026', '', '2026-1-1'])
      expect(endOfJakartaDay(bad)).toBeNull();
    expect(jakartaDateString(new Date('2026-11-14T17:00:00Z'))).toBe('2026-11-15');
  });
});

describe('GrantAccessSchema', () => {
  it('needs exactly one of duration_days / end_date', () => {
    expect(grant({}).success).toBe(false);
    expect(grant({ duration_days: 30, end_date: '2026-12-14' }).success).toBe(false);
    expect(grant({ duration_days: 30 }).success).toBe(true);
    expect(grant({ end_date: '2026-12-14' }).success).toBe(true);
  });
  it('refuses a duration outside 7/30/90 and a bad date', () => {
    expect(grant({ duration_days: 31 }).success).toBe(false);
    expect(grant({ end_date: '2026-02-30' }).success).toBe(false);
  });
  it('requires a trimmed reason of 1–300 characters', () => {
    for (const reason of ['', '   ', 'x'.repeat(301)])
      expect(
        GrantAccessSchema.safeParse({ creator_id: CREATOR, duration_days: 30, reason }).success,
      ).toBe(false);
  });
  it('strips keys the client must not set', () => {
    const r = GrantAccessSchema.parse({
      creator_id: CREATOR,
      duration_days: 30,
      reason: ' a ',
      admin_id: 'x',
      customer_id: 'y',
      starts_at: 'z',
    });
    expect(r).toEqual({ creator_id: CREATOR, duration_days: 30, reason: 'a' });
  });
});

describe('Extend / Revoke bodies', () => {
  it('validate duration and reason', () => {
    expect(ExtendAccessSchema.safeParse({ duration_days: 30, reason: 'a' }).success).toBe(true);
    expect(ExtendAccessSchema.safeParse({ duration_days: 5, reason: 'a' }).success).toBe(false);
    expect(ExtendAccessSchema.safeParse({ duration_days: 30, reason: '' }).success).toBe(false);
    expect(RevokeAccessSchema.safeParse({ reason: ' ' }).success).toBe(false);
    expect(RevokeAccessSchema.parse({ reason: 'a', ends_at: 'x' })).toEqual({ reason: 'a' });
  });
});

describe('SubscriptionListQuerySchema', () => {
  it('defaults to the board view', () => {
    expect(DEFAULT_SUBSCRIPTION_LIST_QUERY).toEqual({
      q: null,
      status: 'all',
      ends: 'all',
      sort: 'ends',
      dir: 'desc',
      page: 1,
      page_size: 10,
    });
  });
  it('refuses unknown keys and values', () => {
    for (const bad of [
      { x: '1' },
      { status: 'gone' },
      { ends: 'soon' },
      { sort: 'password' },
      { dir: 'up' },
      { page: '0' },
      { page: 'a' },
      { page_size: '11' },
    ])
      expect(SubscriptionListQuerySchema.safeParse(bad).success).toBe(false);
  });
  it('parses every field', () => {
    expect(
      SubscriptionListQuerySchema.parse({
        q: ' sal ',
        status: 'active',
        ends: 'next7',
        sort: 'creator',
        dir: 'asc',
        page: '2',
        page_size: '25',
      }),
    ).toEqual({
      q: 'sal',
      status: 'active',
      ends: 'next7',
      sort: 'creator',
      dir: 'asc',
      page: 2,
      page_size: 25,
    });
  });
});
