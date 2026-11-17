import { describe, expect, it } from 'vitest';
import {
  isDefaultRequestsFilter,
  parseRequestsSearch,
  requestsSearchParams,
  resetRequestsFilters,
} from './requests-url';

describe('requests url', () => {
  it('round-trips and omits defaults', () => {
    const q = parseRequestsSearch(
      new URLSearchParams('q=ig&status=rejected&sort=status&dir=asc&page=2&page_size=25'),
    );
    expect(q).toMatchObject({
      q: 'ig',
      status: 'rejected',
      sort: 'status',
      dir: 'asc',
      page: 2,
      page_size: 25,
    });
    expect(requestsSearchParams(q).toString()).toBe(
      'q=ig&status=rejected&sort=status&dir=asc&page=2&page_size=25',
    );
    expect(requestsSearchParams(parseRequestsSearch(new URLSearchParams())).toString()).toBe('');
  });
  it('falls back per value on garbage', () => {
    expect(
      parseRequestsSearch(new URLSearchParams('status=approved&page=abc&sort=hax&dir=asc')),
    ).toMatchObject({ status: 'all', page: 1, sort: 'date', dir: 'asc' });
  });
  it('resets filters, keeping sort and size', () => {
    const q = parseRequestsSearch(
      new URLSearchParams('q=a&status=pending&sort=status&page_size=50&page=3'),
    );
    expect(isDefaultRequestsFilter(q)).toBe(false);
    const r = resetRequestsFilters(q);
    expect(isDefaultRequestsFilter(r)).toBe(true);
    expect(r).toMatchObject({ sort: 'status', page_size: 50, page: 1 });
  });
});
