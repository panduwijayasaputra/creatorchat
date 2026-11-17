import { DEFAULT_CREATOR_LIST_QUERY } from '@creatorchat/contracts';
import { describe, expect, it } from 'vitest';
import { isDefaultFilter, listSearchParams, parseListSearch, resetFilters } from './list-url';

const parse = (search: string) => parseListSearch(new URLSearchParams(search));

describe('list URL', () => {
  it('an empty URL is the default view', () => {
    expect(parse('')).toEqual(DEFAULT_CREATOR_LIST_QUERY);
    expect(isDefaultFilter(parse(''))).toBe(true);
  });

  it('round-trips a full query', () => {
    const query = parse(
      'q=maya&status=request,blocked&type=human&range=7d&sort=name&dir=asc&page=3&page_size=25',
    );
    expect(query).toMatchObject({
      q: 'maya',
      status: ['request', 'blocked'],
      type: 'human',
      range: '7d',
      sort: 'name',
      dir: 'asc',
      page: 3,
      page_size: 25,
    });
    expect(parseListSearch(listSearchParams(query))).toEqual(query);
  });

  it('falls back to defaults value by value, keeping what is valid', () => {
    expect(
      parse('sort=password&dir=asc&page=0&page_size=20&status=x&type=ai_character'),
    ).toMatchObject({
      sort: 'date',
      dir: 'asc',
      page: 1,
      page_size: 10,
      status: ['request', 'active', 'blocked'],
      type: 'ai_character',
    });
  });

  it('ignores unknown keys', () => {
    expect(parse('foo=bar&page=2').page).toBe(2);
  });

  it('reset restores the filters and page but keeps sort and page size', () => {
    const query = parse(
      'q=a&status=active&type=human&range=30d&sort=name&dir=asc&page=4&page_size=50',
    );
    expect(resetFilters(query)).toMatchObject({
      q: null,
      status: ['request', 'active', 'blocked'],
      type: 'all',
      range: 'all',
      page: 1,
      sort: 'name',
      dir: 'asc',
      page_size: 50,
    });
    expect(isDefaultFilter(query)).toBe(false);
  });
});
