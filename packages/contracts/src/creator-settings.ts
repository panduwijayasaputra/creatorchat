import { z } from 'zod';
import { UserProfileSchema } from './user-auth.js';

export const CREATOR_SETTINGS_PATH = '/v1/creator/settings';
/** Body is `UpdateProfileRequestSchema`; the response is the updated account (`UserProfileSchema`). */
export const CREATOR_PROFILE_PATH = '/v1/creator/profile';

/** What `/settings` needs: the caller's own account, their public code and the bio link. */
export const CreatorSettingsResponseSchema = z.strictObject({
  profile: UserProfileSchema,
  public_code: z.string(),
  /** `https://t.me/<bot>?start=c_<public_code>`; null while the bot username is not configured. */
  bio_link: z.url().nullable(),
  /** The welcome message is switched on (the `Pesan selamat datang` row, US-040). */
  welcome_enabled: z.boolean(),
});
export type CreatorSettingsResponse = z.infer<typeof CreatorSettingsResponseSchema>;
