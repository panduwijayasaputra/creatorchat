import { z } from 'zod';
import { TelegramIdSchema } from './ids.js';

export const USER_AUTH_PATH = '/v1/auth';
/** Access token lifetime. There is no refresh token: the Mini App re-exchanges initData. */
export const USER_SESSION_TTL_SECONDS = 3600;
/** Non-sensitive hint (never a token) that this device has logged in before. */
export const TELEGRAM_SEEN_FLAG = 'cc_tg_seen';

export const UserRoleSchema = z.enum(['USER', 'CREATOR']);
export type UserRole = z.infer<typeof UserRoleSchema>;

/** The only input the login endpoint trusts: Telegram's signed initData string. */
export const TelegramLoginRequestSchema = z.strictObject({
  init_data: z.string().min(1).max(4096),
});
export type TelegramLoginRequest = z.infer<typeof TelegramLoginRequestSchema>;

/** The signed-in user as the Mini App needs it. Role and status come from the database. */
export const UserProfileSchema = z.strictObject({
  id: z.uuid(),
  telegram_id: TelegramIdSchema,
  role: UserRoleSchema,
  status: z.literal('ACTIVE'),
  display_name: z.string(),
  telegram_username: z.string().nullable(),
  avatar_url: z.string().nullable(),
  bio: z.string().nullable(),
  /** The Telegram photo as of the last login; "Pakai Foto Telegram" resets avatar_url to it. */
  telegram_avatar_url: z.string().nullable(),
  /** IANA zone used to display times (display only; stored timestamps stay UTC). */
  timezone: z.string(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const TelegramLoginResponseSchema = z.strictObject({
  access_token: z.string().min(1),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  user: UserProfileSchema,
});
export type TelegramLoginResponse = z.infer<typeof TelegramLoginResponseSchema>;

export const MeResponseSchema = UserProfileSchema;
export type MeResponse = UserProfile;

/** Where each role lands after login (USER: Chat, CREATOR: Inbox). */
export function landingPathForRole(role: UserRole): '/chats' | '/inbox' {
  return role === 'CREATOR' ? '/inbox' : '/chats';
}
