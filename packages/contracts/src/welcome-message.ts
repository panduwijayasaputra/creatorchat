import { z } from 'zod';
import { CHAT_TEXT_MAX } from './chat.js';
import { MediaKindSchema } from './media.js';

/**
 * The creator's welcome message (US-040): sent once to each new subscriber (US-041). One per creator;
 * `PUT` replaces the whole saved state, so a retried save changes nothing.
 */
export const WELCOME_MESSAGE_PATH = '/v1/creator/welcome-message';

const codePoints = (s: string) => [...s].length;

/** The optional photo or video: a gallery file (the same asset) or an upload made for this message. */
export const WelcomeMediaSchema = z.strictObject({
  asset_id: z.uuid(),
  kind: MediaKindSchema,
  /** `GALLERY` = "Pilih Galeri" (no copy); `UPLOAD` = "Upload Baru" (only in the welcome message). */
  source: z.enum(['GALLERY', 'UPLOAD']),
  duration_seconds: z.int().nonnegative().nullable(),
  /** Short-lived signed link, or null while it cannot be made. */
  thumbnail_url: z.url().nullable(),
});
export type WelcomeMedia = z.infer<typeof WelcomeMediaSchema>;

export const WelcomeMessageResponseSchema = z.strictObject({
  enabled: z.boolean(),
  /** Empty while the creator never wrote one. */
  body: z.string(),
  media: WelcomeMediaSchema.nullable(),
});
export type WelcomeMessageResponse = z.infer<typeof WelcomeMessageResponseSchema>;

/** The text is required while the switch is on; a draft may be kept while it is off. */
export const SaveWelcomeMessageBodySchema = z
  .strictObject({
    enabled: z.boolean(),
    body: z
      .string()
      .transform((s) => s.trim())
      .refine((s) => codePoints(s) <= CHAT_TEXT_MAX, `Pesan maksimal ${CHAT_TEXT_MAX} karakter.`),
    asset_id: z.uuid().nullable(),
  })
  .refine((b) => !b.enabled || codePoints(b.body) >= 1, {
    path: ['body'],
    message: 'Isi pesan tidak boleh kosong.',
  });
export type SaveWelcomeMessageBody = z.infer<typeof SaveWelcomeMessageBodySchema>;
