import { describe, expect, it } from 'vitest';
import { SaveWelcomeMessageBodySchema, WelcomeMessageResponseSchema } from './welcome-message.js';

const asset = '7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('SaveWelcomeMessageBodySchema', () => {
  it('takes the switch on with text, with or without media, and trims the text', () => {
    expect(
      SaveWelcomeMessageBodySchema.parse({ enabled: true, body: '  Halo!  ', asset_id: null }),
    ).toEqual({ enabled: true, body: 'Halo!', asset_id: null });
    expect(
      SaveWelcomeMessageBodySchema.safeParse({ enabled: true, body: 'Halo', asset_id: asset })
        .success,
    ).toBe(true);
  });

  it('refuses the switch on without text, but keeps a draft (or nothing) while it is off', () => {
    for (const body of ['', '   ']) {
      expect(
        SaveWelcomeMessageBodySchema.safeParse({ enabled: true, body, asset_id: null }).success,
      ).toBe(false);
    }
    expect(
      SaveWelcomeMessageBodySchema.safeParse({ enabled: false, body: '', asset_id: null }).success,
    ).toBe(true);
    expect(
      SaveWelcomeMessageBodySchema.safeParse({ enabled: false, body: 'Draft', asset_id: null })
        .success,
    ).toBe(true);
  });

  it('limits the text to 2000 characters, switch on or off', () => {
    for (const enabled of [true, false]) {
      expect(
        SaveWelcomeMessageBodySchema.safeParse({ enabled, body: 'a'.repeat(2000), asset_id: null })
          .success,
      ).toBe(true);
      expect(
        SaveWelcomeMessageBodySchema.safeParse({ enabled, body: 'a'.repeat(2001), asset_id: null })
          .success,
      ).toBe(false);
    }
  });

  it('is strict: all three keys, a uuid or null, no unknown keys', () => {
    const ok = { enabled: true, body: 'Halo', asset_id: null };
    expect(SaveWelcomeMessageBodySchema.safeParse({ ...ok, creator_id: asset }).success).toBe(
      false,
    );
    expect(SaveWelcomeMessageBodySchema.safeParse({ enabled: true, body: 'Halo' }).success).toBe(
      false,
    );
    expect(SaveWelcomeMessageBodySchema.safeParse({ ...ok, asset_id: 'x' }).success).toBe(false);
    expect(SaveWelcomeMessageBodySchema.safeParse({ ...ok, enabled: 'yes' }).success).toBe(false);
  });
});

describe('WelcomeMessageResponseSchema', () => {
  it('has the switch, the text and the media only, and carries no storage key', () => {
    const media = {
      asset_id: asset,
      kind: 'PHOTO',
      source: 'GALLERY',
      duration_seconds: null,
      thumbnail_url: 'https://cdn.example.test/t.webp',
    };
    expect(
      WelcomeMessageResponseSchema.safeParse({ enabled: false, body: '', media: null }).success,
    ).toBe(true);
    expect(
      WelcomeMessageResponseSchema.safeParse({ enabled: true, body: 'Halo', media }).success,
    ).toBe(true);
    expect(
      WelcomeMessageResponseSchema.safeParse({
        enabled: true,
        body: 'Halo',
        media: { ...media, object_key: 'm/x' },
      }).success,
    ).toBe(false);
    expect(
      WelcomeMessageResponseSchema.safeParse({
        enabled: true,
        body: 'Halo',
        media: { ...media, source: 'CHAT' },
      }).success,
    ).toBe(false);
  });
});
