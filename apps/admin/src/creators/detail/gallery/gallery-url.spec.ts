import { describe, expect, it } from 'vitest';
import {
  gallerySearchParams,
  isDefaultGalleryFilter,
  parseGallerySearch,
  resetGalleryFilters,
} from './gallery-url';

describe('gallery URL state', () => {
  it('parses valid values and ignores each invalid one alone', () => {
    const q = parseGallerySearch(
      new URLSearchParams('kind=VIDEO&sort=nope&page=2&uploaded=30&q=12'),
    );
    expect(q).toMatchObject({ kind: 'VIDEO', sort: 'uploaded', page: 2, uploaded: '30', q: '12' });
  });

  it('writes only what differs from the defaults and round-trips', () => {
    const q = parseGallerySearch(
      new URLSearchParams('kind=PHOTO&sort=size&dir=asc&page=3&page_size=25'),
    );
    const text = gallerySearchParams(q).toString();
    expect(text).toBe('kind=PHOTO&sort=size&dir=asc&page=3&page_size=25');
    expect(parseGallerySearch(new URLSearchParams(text))).toEqual(q);
    expect(gallerySearchParams(parseGallerySearch(new URLSearchParams())).toString()).toBe('');
  });

  it('reset keeps sort and page size, drops filters and goes to page 1', () => {
    const q = parseGallerySearch(
      new URLSearchParams('q=7&kind=VIDEO&sort=size&page=4&page_size=50'),
    );
    expect(isDefaultGalleryFilter(q)).toBe(false);
    const reset = resetGalleryFilters(q);
    expect(reset).toMatchObject({ q: null, kind: 'all', sort: 'size', page: 1, page_size: 50 });
    expect(isDefaultGalleryFilter(reset)).toBe(true);
  });
});
