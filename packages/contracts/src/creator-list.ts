import { z } from 'zod';
import { CreatorTypeSchema } from './creator-request.js';

export const ADMIN_CREATORS_PATH = '/v1/admin/creators';

export const CREATOR_LIST_STATUSES = ['request', 'active', 'blocked'] as const;
export const CREATOR_LIST_TYPES = ['all', 'human', 'ai_character'] as const;
export const CREATOR_LIST_RANGES = ['all', '7d', '30d', '90d'] as const;
export const CREATOR_LIST_SORT_FIELDS = [
  'name',
  'telegram',
  'type',
  'status',
  'subscribers',
  'date',
] as const;
export const CREATOR_LIST_PAGE_SIZES = [10, 25, 50] as const;
export const CREATOR_LIST_SEARCH_MAX = 100;
const PAGE_MAX = 100_000;

export type CreatorListStatus = (typeof CREATOR_LIST_STATUSES)[number];
export type CreatorListSort = (typeof CREATOR_LIST_SORT_FIELDS)[number];

const StatusList = z
  .string()
  .transform((value) => value.split(','))
  .pipe(z.array(z.enum(CREATOR_LIST_STATUSES)).min(1))
  .transform((items) => CREATOR_LIST_STATUSES.filter((s) => items.includes(s)));

/**
 * The query string of `GET /v1/admin/creators`, snake_case, strict: an unknown key or value is a 400.
 * Every field is optional and defaults to the board's default view ("Request, Active, Blocked",
 * newest first, 10 per page). Fastify may hand over an array for a repeated key; that is refused.
 */
export const CreatorListQuerySchema = z.strictObject({
  q: z
    .string()
    .max(CREATOR_LIST_SEARCH_MAX)
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : null)),
  status: StatusList.optional().transform((value) => value ?? [...CREATOR_LIST_STATUSES]),
  type: z
    .enum(CREATOR_LIST_TYPES)
    .optional()
    .transform((value) => value ?? 'all'),
  range: z
    .enum(CREATOR_LIST_RANGES)
    .optional()
    .transform((value) => value ?? 'all'),
  sort: z
    .enum(CREATOR_LIST_SORT_FIELDS)
    .optional()
    .transform((value) => value ?? 'date'),
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
export type CreatorListQuery = z.output<typeof CreatorListQuerySchema>;

export const DEFAULT_CREATOR_LIST_QUERY: CreatorListQuery = CreatorListQuerySchema.parse({});

export const CreatorListRowSchema = z.strictObject({
  /** `request`: `id` is the application id. `creator`: `id` is the creator id. */
  kind: z.enum(['request', 'creator']),
  id: z.uuid(),
  status: z.enum(['REQUEST', 'ACTIVE', 'BLOCKED']),
  creator_name: z.string(),
  avatar_url: z
    .string()
    .regex(/^https:\/\//)
    .nullable(),
  telegram_username: z.string().nullable(),
  telegram_id: z.string(),
  instagram_url: z.string().nullable(),
  creator_type: CreatorTypeSchema,
  /** Active subscribers of a creator; `null` for a request. */
  subscriber_count: z.number().int().min(0).nullable(),
  /** A request whose applicant, as a customer, has an active or future subscription. */
  has_active_subscription: z.boolean(),
  /** Request date for a request, creation date for an account. */
  date: z.string(),
});
export type CreatorListRow = z.infer<typeof CreatorListRowSchema>;

export const CreatorListResponseSchema = z.strictObject({
  items: z.array(CreatorListRowSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.union([z.literal(10), z.literal(25), z.literal(50)]),
});
export type CreatorListResponse = z.infer<typeof CreatorListResponseSchema>;
