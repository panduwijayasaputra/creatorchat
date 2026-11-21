import { describe, expect, it } from 'vitest';
import {
  CreatorGalleryQuerySchema,
  CreatorGalleryResponseSchema,
  CreatorGalleryItemDetailSchema,
  CustomerGalleryItemDetailSchema,
  CustomerGalleryResponseSchema,
  PublicMediaItemSchema,
  customerGalleryItemPath,
  MediaAssetViewSchema,
  MediaUploadInitBodySchema,
  MediaUploadInitResponseSchema,
  creatorMediaCompletePath,
} from './media.js';

const id = '11111111-1111-4111-8111-111111111111';
const body = { client_upload_id: id, kind: 'PHOTO', content_type: 'image/jpeg', size_bytes: 1000 };
const view = {
  id,
  kind: 'PHOTO',
  state: 'READY',
  failure: null,
  duration_seconds: null,
  thumbnail_url: 'http://localhost:3000/v1/dev-storage/x?s=1',
  created_at: '2026-11-18T10:00:00.000Z',
};

describe('MediaUploadInitBodySchema', () => {
  it('accepts a photo and a video', () => {
    expect(MediaUploadInitBodySchema.safeParse(body).success).toBe(true);
    expect(
      MediaUploadInitBodySchema.safeParse({ ...body, kind: 'VIDEO', content_type: 'video/mp4' })
        .success,
    ).toBe(true);
  });

  it.each([
    ['kind and type disagree', { kind: 'VIDEO' }],
    ['a type outside the list', { content_type: 'image/gif' }],
    ['HEIC', { content_type: 'image/heic' }],
    ['zero size', { size_bytes: 0 }],
    ['negative size', { size_bytes: -5 }],
    ['fractional size', { size_bytes: 1.5 }],
    ['a non-uuid upload id', { client_upload_id: 'abc' }],
    ['an extra key', { object_key: 'm/x' }],
  ])('rejects %s', (_name, patch) => {
    expect(MediaUploadInitBodySchema.safeParse({ ...body, ...patch }).success).toBe(false);
  });
});

describe('upload purpose (US-036)', () => {
  it('GALLERY is the default and takes no conversation; CHAT needs one', () => {
    expect(MediaUploadInitBodySchema.parse(body).purpose).toBe('GALLERY');
    expect(MediaUploadInitBodySchema.safeParse({ ...body, purpose: 'CHAT' }).success).toBe(false);
    expect(
      MediaUploadInitBodySchema.safeParse({ ...body, purpose: 'CHAT', conversation_id: id })
        .success,
    ).toBe(true);
    expect(MediaUploadInitBodySchema.safeParse({ ...body, conversation_id: id }).success).toBe(
      false,
    );
  });

  it('BROADCAST and WELCOME uploads take no conversation (US-038)', () => {
    for (const purpose of ['BROADCAST', 'WELCOME']) {
      expect(MediaUploadInitBodySchema.safeParse({ ...body, purpose }).success).toBe(true);
      expect(
        MediaUploadInitBodySchema.safeParse({ ...body, purpose, conversation_id: id }).success,
      ).toBe(false);
    }
    expect(MediaUploadInitBodySchema.safeParse({ ...body, purpose: 'LIBRARY' }).success).toBe(
      false,
    );
  });
});

describe('responses', () => {
  it('a view carries no storage key and rejects extra keys', () => {
    expect(MediaAssetViewSchema.safeParse(view).success).toBe(true);
    expect(MediaAssetViewSchema.safeParse({ ...view, object_key: 'm/a/b' }).success).toBe(false);
    expect(MediaAssetViewSchema.safeParse({ ...view, failure: 'WHATEVER' }).success).toBe(false);
  });

  it('upload is nullable and its method is PUT only', () => {
    const upload = {
      url: 'http://localhost:3000/v1/dev-storage/k',
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      expires_at: '2026-11-18T10:15:00.000Z',
    };
    expect(MediaUploadInitResponseSchema.safeParse({ asset: view, upload }).success).toBe(true);
    expect(MediaUploadInitResponseSchema.safeParse({ asset: view, upload: null }).success).toBe(
      true,
    );
    expect(
      MediaUploadInitResponseSchema.safeParse({
        asset: view,
        upload: { ...upload, method: 'POST' },
      }).success,
    ).toBe(false);
  });

  it('a gallery page needs items, a total and a cursor', () => {
    expect(
      CreatorGalleryResponseSchema.safeParse({
        items: [{ asset: view, added_at: view.created_at }],
        total: 1,
        next_cursor: null,
      }).success,
    ).toBe(true);
    expect(
      CreatorGalleryResponseSchema.safeParse({ items: [], total: -1, next_cursor: null }).success,
    ).toBe(false);
  });
});

describe('CreatorGalleryQuerySchema', () => {
  it('defaults the limit to 30 and bounds it to 1..60', () => {
    expect(CreatorGalleryQuerySchema.parse({}).limit).toBe(30);
    expect(CreatorGalleryQuerySchema.parse({ limit: '60' }).limit).toBe(60);
    expect(CreatorGalleryQuerySchema.safeParse({ limit: '61' }).success).toBe(false);
    expect(CreatorGalleryQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(CreatorGalleryQuerySchema.safeParse({ cursor: 'x'.repeat(201) }).success).toBe(false);
    expect(CreatorGalleryQuerySchema.safeParse({ other: '1' }).success).toBe(false);
  });
});

describe('paths', () => {
  it('encodes the id', () => {
    expect(creatorMediaCompletePath('a/b')).toBe('/v1/creator/media/uploads/a%2Fb/complete');
  });
});

describe('CreatorGalleryItemDetailSchema', () => {
  const detail = {
    asset: view,
    original: { url: 'http://localhost:3000/v1/dev-storage/m/x?s=1', expires_at: view.created_at },
    uploaded_at: view.created_at,
    position: 1,
    total: 3,
    previous_id: null,
    next_id: id,
  };
  it('accepts a detail with neighbours and rejects bad positions and extra keys', () => {
    expect(CreatorGalleryItemDetailSchema.safeParse(detail).success).toBe(true);
    expect(CreatorGalleryItemDetailSchema.safeParse({ ...detail, position: 0 }).success).toBe(
      false,
    );
    expect(CreatorGalleryItemDetailSchema.safeParse({ ...detail, object_key: 'm/x' }).success).toBe(
      false,
    );
    expect(CreatorGalleryItemDetailSchema.safeParse({ ...detail, next_id: 'nope' }).success).toBe(
      false,
    );
  });
});

describe('customer gallery contracts', () => {
  const item = { id, kind: 'VIDEO', duration_seconds: 48, thumbnail_url: view.thumbnail_url };
  it('a public item has no state, failure or key, and a thumbnail is required', () => {
    expect(PublicMediaItemSchema.safeParse(item).success).toBe(true);
    expect(PublicMediaItemSchema.safeParse({ ...item, state: 'READY' }).success).toBe(false);
    expect(PublicMediaItemSchema.safeParse({ ...item, thumbnail_url: null }).success).toBe(false);
    expect(PublicMediaItemSchema.safeParse({ ...item, object_key: 'm/x' }).success).toBe(false);
  });
  it('list and detail are strict', () => {
    expect(
      CustomerGalleryResponseSchema.safeParse({ items: [item], total: 1, next_cursor: null })
        .success,
    ).toBe(true);
    expect(
      CustomerGalleryResponseSchema.safeParse({ items: [], total: 0, next_cursor: null, x: 1 })
        .success,
    ).toBe(false);
    const detail = {
      item,
      original: { url: view.thumbnail_url, expires_at: view.created_at },
      uploaded_at: view.created_at,
      position: 1,
      total: 1,
      previous_id: null,
      next_id: null,
    };
    expect(CustomerGalleryItemDetailSchema.safeParse(detail).success).toBe(true);
    expect(CustomerGalleryItemDetailSchema.safeParse({ ...detail, position: 0 }).success).toBe(
      false,
    );
  });
  it('encodes both path parts', () => {
    expect(customerGalleryItemPath('abc', 'a/b')).toBe('/v1/creators/by-code/abc/gallery/a%2Fb');
  });
});
