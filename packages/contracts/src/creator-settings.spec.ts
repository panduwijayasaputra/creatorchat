import { describe, expect, it } from 'vitest';
import { CreatorSettingsResponseSchema } from './creator-settings.js';

const profile = {
  id: '3f2b6f0a-0000-4000-8000-000000000001',
  telegram_id: '1',
  telegram_username: 'salsa',
  role: 'CREATOR',
  status: 'ACTIVE',
  display_name: 'Salsa',
  bio: null,
  avatar_url: null,
  telegram_avatar_url: null,
  timezone: 'Asia/Jakarta',
};

describe('CreatorSettingsResponseSchema', () => {
  const ok = { profile, public_code: 'salsa234', bio_link: 'https://t.me/Bot_x?start=c_salsa234' };

  it('accepts a link or null', () => {
    expect(CreatorSettingsResponseSchema.safeParse(ok).success).toBe(true);
    expect(CreatorSettingsResponseSchema.safeParse({ ...ok, bio_link: null }).success).toBe(true);
  });

  it('rejects extra keys and a non-URL link', () => {
    expect(CreatorSettingsResponseSchema.safeParse({ ...ok, creator_id: 'x' }).success).toBe(false);
    expect(CreatorSettingsResponseSchema.safeParse({ ...ok, bio_link: 'nope' }).success).toBe(
      false,
    );
  });
});
