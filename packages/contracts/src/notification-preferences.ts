import { z } from 'zod';
import { CreatorLinkResponseSchema } from './creator-link.js';

/** The customer's Telegram notification choices (US-043); the bot side reads them (US-042). */
export const NOTIFICATION_PREFERENCES_PATH = '/v1/me/notification-preferences';
export const creatorMutePath = (publicCode: string): string =>
  `/v1/creators/by-code/${encodeURIComponent(publicCode)}/mute`;

/** No row stored means the defaults: message notifications on, the message text hidden. */
export const NotificationPreferencesResponseSchema = z.strictObject({
  messages_enabled: z.boolean(),
  show_content: z.boolean(),
});
export type NotificationPreferencesResponse = z.infer<typeof NotificationPreferencesResponseSchema>;

/** A partial update: only the given switches change, so two quick toggles never overwrite each other. */
export const UpdateNotificationPreferencesBodySchema = z
  .strictObject({
    messages_enabled: z.boolean().optional(),
    show_content: z.boolean().optional(),
  })
  .refine((b) => b.messages_enabled !== undefined || b.show_content !== undefined, {
    message: 'Send at least one setting.',
  });
export type UpdateNotificationPreferencesBody = z.infer<
  typeof UpdateNotificationPreferencesBodySchema
>;

export const MuteResponseSchema = z.strictObject({ muted: z.boolean() });
export type MuteResponse = z.infer<typeof MuteResponseSchema>;

/** The `:publicCode` of a mute route is checked with the creator link's own format. */
export const MutePublicCodeSchema = CreatorLinkResponseSchema.shape.public_code;
