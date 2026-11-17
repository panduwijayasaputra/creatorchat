import { describe, expect, it } from 'vitest';
import { eventsSearchParams, parseEventsSearch } from './events-url';

describe('events url', () => {
  it('round-trips and omits defaults', () => {
    const q = parseEventsSearch(new URLSearchParams('sort=actor&dir=asc&page=2&page_size=25'));
    expect(q).toEqual({ sort: 'actor', dir: 'asc', page: 2, page_size: 25 });
    expect(eventsSearchParams(q).toString()).toBe('sort=actor&dir=asc&page=2&page_size=25');
    expect(eventsSearchParams(parseEventsSearch(new URLSearchParams())).toString()).toBe('');
  });
  it('falls back per value on garbage', () => {
    expect(parseEventsSearch(new URLSearchParams('sort=reason&page=abc&dir=asc'))).toMatchObject({
      sort: 'time',
      page: 1,
      dir: 'asc',
    });
  });
});
