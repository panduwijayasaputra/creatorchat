import { describe, expect, it } from 'vitest';
import { BroadcastSchema, CreateBroadcastBodySchema } from './broadcast.js';
import { ErrorCode } from './errors.js';

const id = '3f6c1a52-8b71-4e0d-9c4a-2b7d5e8f1a90';
const asset = { asset_id: '7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d' };
const ok = { client_broadcast_id: id, attachment: asset };

describe('CreateBroadcastBodySchema', () => {
  it('takes media alone; save_to_gallery defaults to false', () => {
    expect(CreateBroadcastBodySchema.parse(ok)).toEqual({ ...ok, save_to_gallery: false });
  });

  it('trims the text and keeps the box', () => {
    expect(
      CreateBroadcastBodySchema.parse({ ...ok, body: '  Promo hari ini  ', save_to_gallery: true }),
    ).toMatchObject({ body: 'Promo hari ini', save_to_gallery: true });
  });

  it('refuses a missing attachment, a blank or over-long text, and unknown keys', () => {
    expect(CreateBroadcastBodySchema.safeParse({ client_broadcast_id: id }).success).toBe(false);
    expect(CreateBroadcastBodySchema.safeParse({ ...ok, body: '   ' }).success).toBe(false);
    expect(CreateBroadcastBodySchema.safeParse({ ...ok, body: 'a'.repeat(2001) }).success).toBe(
      false,
    );
    expect(CreateBroadcastBodySchema.safeParse({ ...ok, body: 'a'.repeat(2000) }).success).toBe(
      true,
    );
    expect(CreateBroadcastBodySchema.safeParse({ ...ok, segment: 'vip' }).success).toBe(false);
    expect(
      CreateBroadcastBodySchema.safeParse({ ...ok, attachment: { ...asset, url: 'x' } }).success,
    ).toBe(false);
  });

  it('refuses a missing or malformed client_broadcast_id and asset id', () => {
    expect(CreateBroadcastBodySchema.safeParse({ attachment: asset }).success).toBe(false);
    expect(
      CreateBroadcastBodySchema.safeParse({ ...ok, client_broadcast_id: 'nope' }).success,
    ).toBe(false);
    expect(
      CreateBroadcastBodySchema.safeParse({ ...ok, attachment: { asset_id: 'x' } }).success,
    ).toBe(false);
  });
});

describe('broadcast response', () => {
  it('has the id, the status and the time only', () => {
    const view = { id, status: 'QUEUED', created_at: '2026-11-21T10:00:00.000Z' };
    expect(BroadcastSchema.safeParse(view).success).toBe(true);
    expect(BroadcastSchema.safeParse({ ...view, recipients: [] }).success).toBe(false);
    expect(BroadcastSchema.safeParse({ ...view, status: 'SENT' }).success).toBe(false);
  });

  it('has an error code for a broadcast without active subscribers', () => {
    expect(ErrorCode.NO_ACTIVE_SUBSCRIBERS).toBe('NO_ACTIVE_SUBSCRIBERS');
  });
});
