import { describe, expect, it } from 'vitest';
import {
  ADMIN_GALLERY_SORT_FIELDS,
  AdminGalleryQuerySchema,
  AdminGalleryResponseSchema,
  AdminMediaDetailSchema,
  DEFAULT_ADMIN_GALLERY_QUERY,
  adminCreatorMediaPath,
} from './admin-media.js';

const id = '11111111-1111-4111-8111-111111111111';
const when = '2026-11-18T10:00:00.000Z';

describe('AdminGalleryQuerySchema', () => {
  it('defaults to the newest upload first, page 1 of 10', () => {
    expect(DEFAULT_ADMIN_GALLERY_QUERY).toEqual({
      q: null,
      kind: 'all',
      uploaded: 'all',
      sort: 'uploaded',
      dir: 'desc',
      page: 1,
      page_size: 10,
    });
  });

  it('parses URL strings and trims the search', () => {
    expect(
      AdminGalleryQuerySchema.parse({
        q: '  #12 ',
        kind: 'VIDEO',
        uploaded: '30',
        sort: 'size',
        dir: 'asc',
        page: '3',
        page_size: '25',
      }),
    ).toMatchObject({
      q: '#12',
      kind: 'VIDEO',
      uploaded: '30',
      sort: 'size',
      dir: 'asc',
      page: 3,
      page_size: 25,
    });
  });

  it.each([
    ['an unknown sort', { sort: 'created_at; DROP TABLE x' }],
    ['an unknown kind', { kind: 'AUDIO' }],
    ['an unknown period', { uploaded: '365' }],
    ['a page size outside the list', { page_size: '100' }],
    ['page 0', { page: '0' }],
    ['a long search', { q: 'x'.repeat(21) }],
    ['an extra key', { extra: '1' }],
  ])('rejects %s', (_name, input) => {
    expect(AdminGalleryQuerySchema.safeParse(input).success).toBe(false);
  });

  it('accepts every sort field', () => {
    for (const sort of ADMIN_GALLERY_SORT_FIELDS) {
      expect(AdminGalleryQuerySchema.safeParse({ sort }).success).toBe(true);
    }
  });
});

describe('responses', () => {
  const row = {
    asset_id: id,
    number: 12,
    kind: 'PHOTO',
    duration_seconds: null,
    size_bytes: 2_516_582,
    uploaded_at: when,
    thumbnail_url: 'http://localhost:3000/v1/dev-storage/m/t',
  };
  it('a row and page are strict', () => {
    expect(
      AdminGalleryResponseSchema.safeParse({ items: [row], total: 1, page: 1, page_size: 10 })
        .success,
    ).toBe(true);
    expect(
      AdminGalleryResponseSchema.safeParse({
        items: [{ ...row, object_key: 'm/x' }],
        total: 1,
        page: 1,
        page_size: 10,
      }).success,
    ).toBe(false);
    expect(
      AdminGalleryResponseSchema.safeParse({ items: [], total: 0, page: 1, page_size: 7 }).success,
    ).toBe(false);
  });

  it('a detail needs the gallery marker and rejects extra keys', () => {
    const detail = {
      asset_id: id,
      short_id: 'med_1111111',
      number: 12,
      kind: 'VIDEO',
      duration_seconds: 48,
      size_bytes: 10,
      uploaded_at: when,
      creator: { id, display_name: 'Salsa' },
      shown_in: 'GALLERY',
      preview: { url: row.thumbnail_url, expires_at: when },
      poster_url: row.thumbnail_url,
    };
    expect(AdminMediaDetailSchema.safeParse(detail).success).toBe(true);
    expect(AdminMediaDetailSchema.safeParse({ ...detail, shown_in: 'CHAT' }).success).toBe(false);
    expect(AdminMediaDetailSchema.safeParse({ ...detail, conversation_id: id }).success).toBe(
      false,
    );
    expect(adminCreatorMediaPath('a', 'b')).toBe('/v1/admin/creators/a/gallery/b');
  });
});
