import { z } from 'zod';
import { codePointLength } from './profile.js';

export const CREATOR_REQUEST_PATH = '/v1/me/creator-request';
export const CREATOR_NAME_MAX = 40;
export const CREATOR_DESCRIPTION_MAX = 300;

export const CreatorTypeSchema = z.enum(['HUMAN', 'AI_CHARACTER']);
export type CreatorType = z.infer<typeof CreatorTypeSchema>;

export const CreatorApplicationStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type CreatorApplicationStatus = z.infer<typeof CreatorApplicationStatusSchema>;

// Inline validation copy: verbatim from the `RequestStates` board. The name and length copy mirrors
// the profile rules and has no board (placeholder wording).
export const INSTAGRAM_INVALID =
  'Link Instagram tidak valid. Contoh: https://instagram.com/namaakun';
export const DESCRIPTION_REQUIRED = 'Deskripsi wajib diisi.';
export const RIGHTS_REQUIRED = 'Centang pernyataan ini untuk melanjutkan.';
export const CREATOR_NAME_REQUIRED = 'Nama creator wajib diisi.';
export const CREATOR_NAME_TOO_LONG = `Nama creator maksimal ${CREATOR_NAME_MAX} karakter.`;
export const CREATOR_NAME_INVALID = 'Nama creator tidak boleh berisi karakter kontrol.';
export const DESCRIPTION_TOO_LONG = `Deskripsi maksimal ${CREATOR_DESCRIPTION_MAX} karakter.`;
export const DESCRIPTION_INVALID = 'Deskripsi tidak boleh berisi karakter kontrol.';

const CONTROL = /\p{Cc}/u;
const CONTROL_EXCEPT_NEWLINE = /[^\P{Cc}\n]/u;
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const HANDLE = /^\/([A-Za-z0-9._]{1,30})\/?$/;

/**
 * An Instagram profile URL reduced to `https://instagram.com/<handle>`, or null when it is not
 * one: http(s) only, host exactly instagram.com / www.instagram.com (no userinfo, no port),
 * a single handle segment. Query and fragment are dropped. Syntax only; the account is not checked.
 */
export function normalizeInstagramUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  if (!INSTAGRAM_HOSTS.has(url.hostname)) return null;
  const handle = HANDLE.exec(url.pathname)?.[1];
  return handle ? `https://instagram.com/${handle}` : null;
}

const CreatorNameSchema = z
  .string()
  .max(1000)
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .refine((value) => codePointLength(value) >= 1, { message: CREATOR_NAME_REQUIRED })
      .refine((value) => codePointLength(value) <= CREATOR_NAME_MAX, {
        message: CREATOR_NAME_TOO_LONG,
      })
      .refine((value) => !CONTROL.test(value), { message: CREATOR_NAME_INVALID }),
  );

const InstagramUrlSchema = z
  .string({ message: INSTAGRAM_INVALID })
  .max(1000, { message: INSTAGRAM_INVALID })
  .transform((value, ctx) => {
    const normalized = normalizeInstagramUrl(value);
    if (normalized === null) {
      ctx.addIssue({ code: 'custom', message: INSTAGRAM_INVALID });
      return z.NEVER;
    }
    return normalized;
  });

const DescriptionSchema = z
  .string({ message: DESCRIPTION_REQUIRED })
  .max(5000)
  .transform((value) => value.replace(/\r\n?/g, '\n').trim())
  .pipe(
    z
      .string()
      .refine((value) => codePointLength(value) >= 1, { message: DESCRIPTION_REQUIRED })
      .refine((value) => codePointLength(value) <= CREATOR_DESCRIPTION_MAX, {
        message: DESCRIPTION_TOO_LONG,
      })
      .refine((value) => !CONTROL_EXCEPT_NEWLINE.test(value), { message: DESCRIPTION_INVALID }),
  );

/**
 * The creator request form. Plain `object`: any other key (`user_id`, `role`, `status`, `id`, ...)
 * is stripped and ignored. `rights_confirmed` is only a gate; it is not stored as a column.
 */
export const SubmitCreatorRequestSchema = z.object({
  creator_name: CreatorNameSchema,
  instagram_url: InstagramUrlSchema,
  creator_type: CreatorTypeSchema,
  description: DescriptionSchema,
  rights_confirmed: z.literal(true, { message: RIGHTS_REQUIRED }),
});
export type SubmitCreatorRequest = z.input<typeof SubmitCreatorRequestSchema>;
export type SubmitCreatorRequestData = z.output<typeof SubmitCreatorRequestSchema>;

export const CreatorApplicationSchema = z.strictObject({
  id: z.uuid(),
  status: CreatorApplicationStatusSchema,
  creator_name: z.string(),
  instagram_url: z.string(),
  creator_type: CreatorTypeSchema,
  description: z.string(),
  created_at: z.string(),
  reviewed_at: z.string().nullable(),
  review_reason: z.string().nullable(),
});
export type CreatorApplication = z.infer<typeof CreatorApplicationSchema>;

/** The customer subscription that blocks a request: the creator it is with and when it ends. */
export const CreatorRequestBlockSchema = z.strictObject({
  creator_name: z.string(),
  ends_at: z.string(),
});
export type CreatorRequestBlock = z.infer<typeof CreatorRequestBlockSchema>;

export const CreatorRequestStateResponseSchema = z.strictObject({
  request: CreatorApplicationSchema.nullable(),
  blocked: CreatorRequestBlockSchema.nullable(),
});
export type CreatorRequestStateResponse = z.infer<typeof CreatorRequestStateResponseSchema>;

export const SubmitCreatorRequestResponseSchema = z.strictObject({
  request: CreatorApplicationSchema,
});
export type SubmitCreatorRequestResponse = z.infer<typeof SubmitCreatorRequestResponseSchema>;
