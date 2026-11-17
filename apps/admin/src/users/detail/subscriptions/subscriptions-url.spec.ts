import { describe, expect, it } from 'vitest';
import {
  isDefaultSubscriptionsFilter,
  parseSubscriptionsSearch,
  resetSubscriptionsFilters,
  subscriptionsSearchParams,
} from './subscriptions-url';

describe('subscriptions url', () => {
  it('round-trips and omits defaults', () => {
    const q = parseSubscriptionsSearch(
      new URLSearchParams(
        'q=sal&status=active&ends=next7&sort=creator&dir=asc&page=2&page_size=25',
      ),
    );
    expect(q).toMatchObject({
      q: 'sal',
      status: 'active',
      ends: 'next7',
      sort: 'creator',
      dir: 'asc',
      page: 2,
      page_size: 25,
    });
    expect(subscriptionsSearchParams(q).toString()).toBe(
      'q=sal&status=active&ends=next7&sort=creator&dir=asc&page=2&page_size=25',
    );
    expect(
      subscriptionsSearchParams(parseSubscriptionsSearch(new URLSearchParams())).toString(),
    ).toBe('');
  });

  it('falls back per value on garbage', () => {
    expect(
      parseSubscriptionsSearch(
        new URLSearchParams('status=gone&ends=soon&page=abc&sort=hax&dir=asc'),
      ),
    ).toMatchObject({ status: 'all', ends: 'all', page: 1, sort: 'ends', dir: 'asc' });
  });

  it('detects and resets the filters (keeping sort and size)', () => {
    const q = parseSubscriptionsSearch(
      new URLSearchParams('q=x&status=revoked&sort=creator&page=3&page_size=25'),
    );
    expect(isDefaultSubscriptionsFilter(q)).toBe(false);
    const r = resetSubscriptionsFilters(q);
    expect(isDefaultSubscriptionsFilter(r)).toBe(true);
    expect(r).toMatchObject({ sort: 'creator', page: 1, page_size: 25 });
  });
});
