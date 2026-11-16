import { z } from 'zod';
import { UserProfileSchema } from './user-auth.js';

export const PROFILE_PATH = '/v1/me/profile';
export const DISPLAY_NAME_MAX = 40;
export const BIO_MAX = 160;

/** Length in code points, so the client counter and the server limit agree. */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

// \p{Cc} = control characters (C0, DEL, C1); the second pattern lets "\n" through (bio only).
const CONTROL = /\p{Cc}/u;
const CONTROL_EXCEPT_NEWLINE = /[^\P{Cc}\n]/u;

// Messages are the inline validation copy shown under the field (EditStates 2).
export const DISPLAY_NAME_REQUIRED = 'Nama tampil wajib diisi.';
export const DISPLAY_NAME_TOO_LONG = `Nama tampil maksimal ${DISPLAY_NAME_MAX} karakter.`;
export const DISPLAY_NAME_INVALID = 'Nama tampil tidak boleh berisi karakter kontrol.';
// Design gap: no board for the bio error; placeholder wording.
export const BIO_TOO_LONG = `Bio maksimal ${BIO_MAX} karakter.`;
export const BIO_INVALID = 'Bio tidak boleh berisi karakter kontrol.';

const DisplayNameSchema = z
  .string()
  .max(1000)
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .refine((value) => codePointLength(value) >= 1, { message: DISPLAY_NAME_REQUIRED })
      .refine((value) => codePointLength(value) <= DISPLAY_NAME_MAX, {
        message: DISPLAY_NAME_TOO_LONG,
      })
      .refine((value) => !CONTROL.test(value), { message: DISPLAY_NAME_INVALID }),
  );

const BioSchema = z
  .string()
  .max(2000)
  .transform((value) => value.replace(/\r\n?/g, '\n').trim())
  .pipe(
    z
      .string()
      .refine((value) => codePointLength(value) <= BIO_MAX, { message: BIO_TOO_LONG })
      .refine((value) => !CONTROL_EXCEPT_NEWLINE.test(value), { message: BIO_INVALID }),
  );

/**
 * The full desired profile (PATCH carries every editable field, so saving the same values twice is
 * harmless). Plain `object`: any other key (`id`, `role`, `telegram_id`, `username`, `status`, ...)
 * is stripped and ignored. A missing, null or blank bio clears it.
 */
export const UpdateProfileRequestSchema = z.object({
  display_name: DisplayNameSchema,
  bio: BioSchema.nullish().transform((value) => (value ? value : null)),
  /** Reset the app photo to the current Telegram photo. */
  reset_avatar: z.boolean().optional(),
});
/** What a client may send (before trimming). */
export type UpdateProfileRequest = z.input<typeof UpdateProfileRequestSchema>;
/** What the server works with after validation. */
export type UpdateProfileData = z.output<typeof UpdateProfileRequestSchema>;

export const UpdateProfileResponseSchema = UserProfileSchema;
export type UpdateProfileResponse = z.infer<typeof UpdateProfileResponseSchema>;
