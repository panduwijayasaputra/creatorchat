import { z } from 'zod';
import { CREATOR_LIST_PAGE_SIZES, CREATOR_LIST_SEARCH_MAX } from './creator-list.js';
import { ReasonSchema } from './creator-review.js';

/** Admin display zone for access dates (no DST, so a fixed +07:00 offset is exact). */
export const ACCESS_ZONE = 'Asia/Jakarta';
const JAKARTA_OFFSET_MS = 7 * 3_600_000;

export const ACCESS_DURATIONS = [7, 30, 90] as const;
export const DEFAULT_DURATION = 30;
export const MAX_END_DAYS = 400;

export const SUBSCRIPTION_STATUSES = ['all', 'active', 'expired', 'revoked'] as const;
// The Berakhir filter has no designed options: placeholder allowlist (see the plan).
export const SUBSCRIPTION_END_FILTERS = ['all', 'next7', 'next30', 'past'] as const;
export const SUBSCRIPTION_SORT_FIELDS = ['creator', 'status', 'starts', 'ends'] as const;
const PAGE_MAX = 100_000;

/** `YYYY-MM-DD` of the Jakarta calendar day that contains `instant`. */
export function jakartaDateString(instant: Date): string {
  return new Date(instant.getTime() + JAKARTA_OFFSET_MS).toISOString().slice(0, 10);
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 23:59:59 Jakarta of `YYYY-MM-DD`; null for a malformed or impossible date. */
export function endOfJakartaDay(date: string): Date | null {
  const match = DATE_ONLY.exec(date);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d)
    return null;
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59) - JAKARTA_OFFSET_MS);
}

function endAfter(base: Date, days: number): Date {
  const local = new Date(base.getTime() + JAKARTA_OFFSET_MS);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days, 23, 59, 59) -
      JAKARTA_OFFSET_MS,
  );
}

/** Grant: 23:59:59 Jakarta of today + `days`. */
export const computeEndDate = (now: Date, days: number): Date => endAfter(now, days);

/** Extend: 23:59:59 Jakarta of the later of the current end and now, + `days`. */
export const computeExtendedEnd = (currentEnd: Date, now: Date, days: number): Date =>
  endAfter(currentEnd > now ? currentEnd : now, days);

const DurationSchema = z.union(
  ACCESS_DURATIONS.map((d) => z.literal(d)) as [
    z.ZodLiteral<7>,
    z.ZodLiteral<30>,
    z.ZodLiteral<90>,
  ],
);

/** Exactly one of `duration_days` / `end_date`. Other keys are stripped (as in the moderation bodies). */
export const GrantAccessSchema = z
  .object({
    creator_id: z.uuid(),
    duration_days: DurationSchema.optional(),
    end_date: z
      .string()
      .refine((v) => endOfJakartaDay(v) !== null, { message: 'Tanggal tidak valid.' })
      .optional(),
    reason: ReasonSchema,
    /** US-024: the pending request this grant answers; it must be the customer's, for this creator. */
    access_request_id: z.uuid().optional(),
  })
  .refine((v) => (v.duration_days === undefined) !== (v.end_date === undefined), {
    message: 'Pilih durasi atau tanggal berakhir.',
    path: ['duration_days'],
  });
export type GrantAccessData = z.output<typeof GrantAccessSchema>;

export const ExtendAccessSchema = z.object({ duration_days: DurationSchema, reason: ReasonSchema });
export type ExtendAccessData = z.output<typeof ExtendAccessSchema>;

export const RevokeAccessSchema = z.object({ reason: ReasonSchema });
export type RevokeAccessData = z.output<typeof RevokeAccessSchema>;

/** The query string of `GET /v1/admin/users/:id/subscriptions`: snake_case, strict, board defaults. */
export const SubscriptionListQuerySchema = z.strictObject({
  q: z
    .string()
    .max(CREATOR_LIST_SEARCH_MAX)
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
  status: z
    .enum(SUBSCRIPTION_STATUSES)
    .optional()
    .transform((v) => v ?? 'all'),
  ends: z
    .enum(SUBSCRIPTION_END_FILTERS)
    .optional()
    .transform((v) => v ?? 'all'),
  sort: z
    .enum(SUBSCRIPTION_SORT_FIELDS)
    .optional()
    .transform((v) => v ?? 'ends'),
  dir: z
    .enum(['asc', 'desc'])
    .optional()
    .transform((v) => v ?? 'desc'),
  page: z
    .string()
    .regex(/^\d{1,6}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(PAGE_MAX))
    .optional()
    .transform((v) => v ?? 1),
  page_size: z
    .enum(['10', '25', '50'])
    .transform(Number)
    .optional()
    .transform((v) => v ?? 10),
});
export type SubscriptionListQuery = z.output<typeof SubscriptionListQuerySchema>;
export const DEFAULT_SUBSCRIPTION_LIST_QUERY = SubscriptionListQuerySchema.parse({});
export const SUBSCRIPTION_PAGE_SIZES = CREATOR_LIST_PAGE_SIZES;

const HttpsUrl = z.string().regex(/^https:\/\//);
export const SubscriptionStatusSchema = z.enum(['ACTIVE', 'EXPIRED', 'REVOKED']);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const SubscriptionCreatorSchema = z.strictObject({
  id: z.uuid(),
  display_name: z.string(),
  avatar_url: HttpsUrl.nullable(),
});

export const SubscriptionRowSchema = z.strictObject({
  id: z.uuid(),
  creator: SubscriptionCreatorSchema,
  status: SubscriptionStatusSchema,
  starts_at: z.string(),
  ends_at: z.string(),
  revoked_at: z.string().nullable(),
});
export type SubscriptionRow = z.infer<typeof SubscriptionRowSchema>;

export const SubscriptionListResponseSchema = z.strictObject({
  items: z.array(SubscriptionRowSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.union([z.literal(10), z.literal(25), z.literal(50)]),
});
export type SubscriptionListResponse = z.infer<typeof SubscriptionListResponseSchema>;

export const GrantableCreatorsResponseSchema = z.strictObject({
  items: z.array(SubscriptionCreatorSchema),
});
export type GrantableCreatorsResponse = z.infer<typeof GrantableCreatorsResponseSchema>;

export const SubscriptionActionResponseSchema = z.strictObject({
  subscription: z.strictObject({
    id: z.uuid(),
    creator_id: z.uuid(),
    status: SubscriptionStatusSchema,
    starts_at: z.string(),
    ends_at: z.string(),
    revoked_at: z.string().nullable(),
  }),
});
export type SubscriptionActionResponse = z.infer<typeof SubscriptionActionResponseSchema>;
