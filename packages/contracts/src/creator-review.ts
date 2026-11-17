import { z } from 'zod';
import { CreatorApplicationSchema } from './creator-request.js';
import { codePointLength } from './profile.js';
import { UserRoleSchema } from './user-auth.js';

export const ADMIN_CREATOR_REQUESTS_PATH = '/v1/admin/creator-requests';
export const REJECT_REASON_MAX = 300;

// `AdmDlgRejectEmpty`: verbatim. The other two have no board (placeholder wording).
export const REJECT_REASON_REQUIRED = 'Alasan wajib diisi.';
export const REJECT_REASON_TOO_LONG = `Alasan maksimal ${REJECT_REASON_MAX} karakter.`;
export const REJECT_REASON_INVALID = 'Alasan tidak boleh berisi karakter kontrol.';

const CONTROL_EXCEPT_NEWLINE = /[^\P{Cc}\n]/u;

/** The reason shown to the applicant and kept in the audit log: trimmed, required, plain text. */
export const ReasonSchema = z
  .string({ message: REJECT_REASON_REQUIRED })
  .max(5000, { message: REJECT_REASON_TOO_LONG })
  .transform((value) => value.replace(/\r\n?/g, '\n').trim())
  .pipe(
    z
      .string()
      .refine((value) => codePointLength(value) >= 1, { message: REJECT_REASON_REQUIRED })
      .refine((value) => codePointLength(value) <= REJECT_REASON_MAX, {
        message: REJECT_REASON_TOO_LONG,
      })
      .refine((value) => !CONTROL_EXCEPT_NEWLINE.test(value), { message: REJECT_REASON_INVALID }),
  );

/** Plain `object`: any other key (`status`, `user_id`, `admin_id`, ...) is stripped and ignored. */
export const RejectCreatorRequestSchema = z.object({ reason: ReasonSchema });
export type RejectCreatorRequest = z.input<typeof RejectCreatorRequestSchema>;
export type RejectCreatorRequestData = z.output<typeof RejectCreatorRequestSchema>;

/**
 * The customer subscription(s) that stop an approval: how many, and the one that ends last. Also the
 * `details` of a 409 `CREATOR_APPROVAL_BLOCKED`.
 */
export const ApprovalBlockSchema = z.strictObject({
  count: z.number().int().min(1),
  creator_name: z.string(),
  ends_at: z.string(),
});
export type ApprovalBlock = z.infer<typeof ApprovalBlockSchema>;

/** `details` of a 409 `CREATOR_REQUEST_ALREADY_REVIEWED`: the status that won. */
export const AlreadyReviewedDetailsSchema = z.strictObject({
  status: z.enum(['APPROVED', 'REJECTED']),
});
export type AlreadyReviewedDetails = z.infer<typeof AlreadyReviewedDetailsSchema>;

/** The applicant as an admin sees them (internal id included: it links to the user page). */
export const AdminRequestApplicantSchema = z.strictObject({
  id: z.uuid(),
  display_name: z.string(),
  telegram_username: z.string().nullable(),
  telegram_id: z.string(),
  role: UserRoleSchema,
  status: z.enum(['ACTIVE', 'BLOCKED']),
});
export type AdminRequestApplicant = z.infer<typeof AdminRequestApplicantSchema>;

export const AdminCreatorRequestSchema = CreatorApplicationSchema.extend({
  user: AdminRequestApplicantSchema,
});
export type AdminCreatorRequest = z.infer<typeof AdminCreatorRequestSchema>;

/** `GET /v1/admin/creator-requests/:id`: the request and the approval pre-check. */
export const CreatorRequestReviewResponseSchema = z.strictObject({
  request: AdminCreatorRequestSchema,
  check: z.strictObject({
    block: ApprovalBlockSchema.nullable(),
    checked_at: z.string(),
  }),
});
export type CreatorRequestReviewResponse = z.infer<typeof CreatorRequestReviewResponseSchema>;

export const ApproveCreatorRequestResponseSchema = z.strictObject({
  request: AdminCreatorRequestSchema,
  creator: z.strictObject({ id: z.uuid(), public_code: z.string() }),
});
export type ApproveCreatorRequestResponse = z.infer<typeof ApproveCreatorRequestResponseSchema>;

export const RejectCreatorRequestResponseSchema = z.strictObject({
  request: AdminCreatorRequestSchema,
});
export type RejectCreatorRequestResponse = z.infer<typeof RejectCreatorRequestResponseSchema>;
