import { describe, expect, it } from 'vitest';
import {
  isDefaultSubscribersFilter,
  parseSubscribersSearch,
  resetSubscribersFilters,
  subscribersSearchParams,
} from './subscribers-url';

describe('subscribers url', () => {
  it('round-trips and omits defaults', () => {
    const q = parseSubscribersSearch(
      new URLSearchParams(
        'q=ra&status=expired&ends=past&sort=telegram&dir=asc&page=2&page_size=25',
      ),
    );
    expect(q).toMatchObject({
      q: 'ra',
      status: 'expired',
      ends: 'past',
      sort: 'telegram',
      dir: 'asc',
      page: 2,
      page_size: 25,
    });
    expect(subscribersSearchParams(q).toString()).toBe(
      'q=ra&status=expired&ends=past&sort=telegram&dir=asc&page=2&page_size=25',
    );
    expect(subscribersSearchParams(parseSubscribersSearch(new URLSearchParams())).toString()).toBe(
      '',
    );
  });
  it('falls back per value on garbage', () => {
    expect(
      parseSubscribersSearch(new URLSearchParams('status=gone&page=abc&sort=creator&dir=asc')),
    ).toMatchObject({ status: 'all', page: 1, sort: 'ends', dir: 'asc' });
  });
  it('resets filters, keeping sort and size', () => {
    const q = parseSubscribersSearch(
      new URLSearchParams('q=a&status=active&sort=starts&page_size=50&page=3'),
    );
    expect(isDefaultSubscribersFilter(q)).toBe(false);
    const r = resetSubscribersFilters(q);
    expect(isDefaultSubscribersFilter(r)).toBe(true);
    expect(r).toMatchObject({ sort: 'starts', page_size: 50, page: 1 });
  });
});
