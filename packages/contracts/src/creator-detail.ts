import { z } from 'zod';
import { CREATOR_LIST_PAGE_SIZES, CREATOR_LIST_SEARCH_MAX } from './creator-list.js';
import { CreatorTypeSchema } from './creator-request.js';
import { ApprovalBlockSchema } from './creator-review.js';

export const ADMIN_AUDIT_LOGS_PATH = '/v1/admin/audit-logs';

const httpsUrl = z.string().regex(/^https:\/\//);
const PAGE_MAX = 100_000;

/** `GET /v1/admin/creators/:id`: a pending request or a creator account, same page for both. */
export const CreatorDetailSchema = z
  .strictObject({
    kind: z.enum(['request', 'creator']),
    /** Canonical id: the application id for a request, the creator id for an account. */
    id: z.uuid(),
    status: z.enum(['REQUEST', 'ACTIVE', 'BLOCKED']),
    creator_name: z.string(),
    avatar_url: httpsUrl.nullable(),
    telegram_username: z.string().nullable(),
    telegram_id: z.string(),
    instagram_url: z.string().nullable(),
    creator_type: CreatorTypeSchema,
    /** Submitted date for a request, creation date for an account. */
    since: z.string(),
    /** Only for an account that is BLOCKED: when it was blocked (latest `creator.blocked` entry). */
    blocked_at: z.string().nullable(),
    request: z
      .strictObject({
        id: z.uuid(),
        description: z.string(),
        user_role: z.enum(['USER', 'CREATOR']),
        previous_rejections: z.number().int().min(0),
        subscription_block: ApprovalBlockSchema.nullable(),
      })
      .nullable(),
    creator: z
      .strictObject({
        public_code: z.string(),
        subscriber_count: z.number().int().min(0),
        bio: z.string().nullable(),
        description: z.string().nullable(),
      })
      .nullable(),
  })
  .refine((d) => (d.kind === 'request' ? d.request !== null && d.creator === null : true), {
    message: 'a request carries `request` only',
  })
  .refine((d) => (d.kind === 'creator' ? d.creator !== null && d.request === null : true), {
    message: 'a creator carries `creator` only',
  });
export type CreatorDetail = z.infer<typeof CreatorDetailSchema>;

export const CreatorDetailResponseSchema = z.strictObject({
  detail: CreatorDetailSchema,
  checked_at: z.string(),
});
export type CreatorDetailResponse = z.infer<typeof CreatorDetailResponseSchema>;

/* ---------------- History (audit rows about one person) ---------------- */

export const HISTORY_TYPES = ['all', 'account', 'application', 'access'] as const;
export const HISTORY_STATUSES = ['all', 'success', 'failed'] as const;
export const HISTORY_SORT_FIELDS = ['time', 'actor', 'action', 'status'] as const;
export type HistorySort = (typeof HISTORY_SORT_FIELDS)[number];

/** The query of a person's History (creator and user pages share it). Strict, snake_case. */
export const HistoryQuerySchema = z.strictObject({
  q: z
    .string()
    .max(CREATOR_LIST_SEARCH_MAX)
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : null)),
  type: z
    .enum(HISTORY_TYPES)
    .optional()
    .transform((value) => value ?? 'all'),
  status: z
    .enum(HISTORY_STATUSES)
    .optional()
    .transform((value) => value ?? 'all'),
  sort: z
    .enum(HISTORY_SORT_FIELDS)
    .optional()
    .transform((value) => value ?? 'time'),
  dir: z
    .enum(['asc', 'desc'])
    .optional()
    .transform((value) => value ?? 'desc'),
  page: z
    .string()
    .regex(/^\d{1,6}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(PAGE_MAX))
    .optional()
    .transform((value) => value ?? 1),
  page_size: z
    .enum(['10', '25', '50'])
    .transform(Number)
    .optional()
    .transform((value) => value ?? 10),
});
export type HistoryQuery = z.output<typeof HistoryQuerySchema>;
export const DEFAULT_HISTORY_QUERY: HistoryQuery = HistoryQuerySchema.parse({});
export const HISTORY_PAGE_SIZES = CREATOR_LIST_PAGE_SIZES;

export const HistoryRowSchema = z.strictObject({
  id: z.uuid(),
  at: z.string(),
  actor: z.string(),
  action: z.string(),
  /** Short text; the reason itself is on the log detail page. */
  summary: z.string(),
  kind: z.enum(['account', 'application', 'access']),
  status: z.enum(['success', 'failed']),
});
export type HistoryRow = z.infer<typeof HistoryRowSchema>;

export const HistoryResponseSchema = z.strictObject({
  items: z.array(HistoryRowSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.union([z.literal(10), z.literal(25), z.literal(50)]),
});
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

/* ---------------- One audit entry ---------------- */

const FieldLineSchema = z.strictObject({ label: z.string(), value: z.string() });

/** `GET /v1/admin/audit-logs/:id`: allowlisted fields only; `changes` is never returned raw. */
export const AuditLogDetailSchema = z.strictObject({
  id: z.uuid(),
  at: z.string(),
  actor: z.string(),
  action: z.string(),
  kind: z.enum(['account', 'application', 'access']),
  target: z.string(),
  status: z.enum(['success', 'failed']),
  summary: z.string(),
  reason: z.string().nullable(),
  request_id: z.string().nullable(),
  before: z.array(FieldLineSchema),
  after: z.array(FieldLineSchema),
});
export type AuditLogDetail = z.infer<typeof AuditLogDetailSchema>;
