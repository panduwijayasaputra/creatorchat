import { describe, expect, it } from 'vitest';
import {
  isDefaultHistoryFilter,
  parseHistorySearch,
  historySearchParams,
  resetHistoryFilters,
} from './history-url';

describe('history url', () => {
  it('round-trips and omits defaults', () => {
    const q = parseHistorySearch(
      new URLSearchParams(
        'q=tolak&type=application&status=failed&sort=actor&dir=asc&page=2&page_size=25',
      ),
    );
    expect(q).toMatchObject({
      q: 'tolak',
      type: 'application',
      status: 'failed',
      sort: 'actor',
      dir: 'asc',
      page: 2,
      page_size: 25,
    });
    expect(historySearchParams(q).toString()).toBe(
      'q=tolak&type=application&status=failed&sort=actor&dir=asc&page=2&page_size=25',
    );
    expect(historySearchParams(parseHistorySearch(new URLSearchParams())).toString()).toBe('');
  });
  it('falls back per value on garbage', () => {
    expect(
      parseHistorySearch(new URLSearchParams('type=chat&page=abc&sort=hax&status=failed')),
    ).toMatchObject({ type: 'all', page: 1, sort: 'time', status: 'failed' });
  });
  it('detects and resets filters, keeping sort and size', () => {
    const q = parseHistorySearch(new URLSearchParams('q=a&sort=actor&page_size=50&page=3'));
    expect(isDefaultHistoryFilter(q)).toBe(false);
    const r = resetHistoryFilters(q);
    expect(isDefaultHistoryFilter(r)).toBe(true);
    expect(r).toMatchObject({ sort: 'actor', page_size: 50, page: 1 });
  });
});
