import { z } from 'zod';
import {
  CREATOR_LIST_PAGE_SIZES,
  CREATOR_LIST_RANGES,
  CREATOR_LIST_SEARCH_MAX,
} from './creator-list.js';

export const ADMIN_USERS_PATH = '/v1/admin/users';

export const USER_LIST_STATUSES = ['active', 'blocked'] as const;
export const USER_LIST_REQUEST_STATES = ['none', 'pending', 'rejected'] as const;
export const USER_LIST_ACCESS_FILTERS = ['any', 'pending'] as const;
export const USER_LIST_RANGES = CREATOR_LIST_RANGES;
export const USER_LIST_SORT_FIELDS = [
  'name',
  'telegram',
  'status',
  'subscriptions',
  'request',
  'date',
] as const;
export const USER_LIST_PAGE_SIZES = CREATOR_LIST_PAGE_SIZES;
const PAGE_MAX = 100_000;

export type UserListSort = (typeof USER_LIST_SORT_FIELDS)[number];

/** A comma list where every item is allowlisted; empty is refused; result is deduped in allowlist order. */
const listOf = <const T extends readonly [string, ...string[]]>(all: T) =>
  z
    .string()
    .transform((value) => value.split(','))
    .pipe(z.array(z.enum(all)).min(1))
    .transform((items) => all.filter((s) => items.includes(s)))
    .optional()
    .transform((value) => value ?? [...all]);

/**
 * The query string of `GET /v1/admin/users`, snake_case, strict: an unknown key or value is a 400.
 * Every field is optional and defaults to the board's default view (all users, newest first, 10 per page).
 */
export const UserListQuerySchema = z.strictObject({
  q: z
    .string()
    .max(CREATOR_LIST_SEARCH_MAX)
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : null)),
  status: listOf(USER_LIST_STATUSES),
  request: listOf(USER_LIST_REQUEST_STATES),
  /** US-024: `pending` keeps only users with a pending customer access request. */
  access: z
    .enum(USER_LIST_ACCESS_FILTERS)
    .optional()
    .transform((value) => value ?? 'any'),
  range: z
    .enum(USER_LIST_RANGES)
    .optional()
    .transform((value) => value ?? 'all'),
  sort: z
    .enum(USER_LIST_SORT_FIELDS)
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
export type UserListQuery = z.output<typeof UserListQuerySchema>;

export const DEFAULT_USER_LIST_QUERY: UserListQuery = UserListQuerySchema.parse({});

export const UserListRowSchema = z.strictObject({
  id: z.uuid(),
  display_name: z.string(),
  avatar_url: z
    .string()
    .regex(/^https:\/\//)
    .nullable(),
  telegram_username: z.string().nullable(),
  telegram_id: z.string(),
  status: z.enum(['ACTIVE', 'BLOCKED']),
  /** Subscriptions active right now (started, not ended, not revoked). */
  active_subscription_count: z.number().int().min(0),
  creator_request_status: z.enum(['NONE', 'PENDING', 'REJECTED']),
  /** Pending trial / renewal requests to creators that are still active (US-024). */
  pending_access_count: z.number().int().min(0),
  joined_at: z.string(),
});
export type UserListRow = z.infer<typeof UserListRowSchema>;

export const UserListResponseSchema = z.strictObject({
  items: z.array(UserListRowSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.union([z.literal(10), z.literal(25), z.literal(50)]),
});
export type UserListResponse = z.infer<typeof UserListResponseSchema>;
