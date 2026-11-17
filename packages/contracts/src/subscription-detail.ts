import { z } from 'zod';
import { CREATOR_LIST_SEARCH_MAX } from './creator-list.js';
import {
  ACCESS_ZONE,
  SUBSCRIPTION_END_FILTERS,
  SUBSCRIPTION_PAGE_SIZES,
  SUBSCRIPTION_STATUSES,
  SubscriptionStatusSchema,
} from './subscription-access.js';

const PAGE_MAX = 100_000;
const HttpsUrl = z.string().regex(/^https:\/\//);
const DAY_MS = 86_400_000;
const JAKARTA_OFFSET_MS = 7 * 3_600_000;

/** Whole Jakarta calendar days from `from` to `to` (same day = 0; negative if `to` is earlier). */
export function daysBetweenJakarta(from: Date, to: Date): number {
  const day = (d: Date) => Math.floor((d.getTime() + JAKARTA_OFFSET_MS) / DAY_MS);
  return day(to) - day(from);
}
export { ACCESS_ZONE };

/** `GET /v1/admin/users/:id/subscriptions/:subId` (`AdmSubDetail`). No payment, chat or session data. */
export const SubscriptionDetailResponseSchema = z.strictObject({
  subscription: z.strictObject({
    id: z.uuid(),
    status: SubscriptionStatusSchema,
    starts_at: z.string(),
    ends_at: z.string(),
    revoked_at: z.string().nullable(),
    /** Access is only ever given by an admin. */
    source: z.literal('ADMIN'),
    /** Username of the admin of the latest GRANT event, never the admin id. */
    created_by_label: z.string().nullable(),
  }),
  customer: z.strictObject({
    id: z.uuid(),
    display_name: z.string(),
    telegram_username: z.string().nullable(),
    telegram_id: z.string(),
  }),
  creator: z.strictObject({ id: z.uuid(), display_name: z.string() }),
});
export type SubscriptionDetailResponse = z.infer<typeof SubscriptionDetailResponseSchema>;

/* ---------------- "Riwayat akses" ---------------- */

export const SUBSCRIPTION_EVENT_SORT_FIELDS = ['time', 'actor', 'action'] as const;
export type SubscriptionEventSort = (typeof SUBSCRIPTION_EVENT_SORT_FIELDS)[number];

const pageFields = {
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
};

export const SubscriptionEventsQuerySchema = z.strictObject({
  sort: z
    .enum(SUBSCRIPTION_EVENT_SORT_FIELDS)
    .optional()
    .transform((v) => v ?? 'time'),
  ...pageFields,
});
export type SubscriptionEventsQuery = z.output<typeof SubscriptionEventsQuerySchema>;
export const DEFAULT_SUBSCRIPTION_EVENTS_QUERY = SubscriptionEventsQuerySchema.parse({});

export const SubscriptionEventRowSchema = z.strictObject({
  id: z.uuid(),
  at: z.string(),
  actor: z.string(),
  action: z.string(),
  /** The reason is on the log detail page, not here. */
  summary: z.string(),
  status: z.literal('success'),
  /** The audit entry of the event; null when none was recorded. */
  log_id: z.uuid().nullable(),
});
export type SubscriptionEventRow = z.infer<typeof SubscriptionEventRowSchema>;

export const SubscriptionEventsResponseSchema = z.strictObject({
  items: z.array(SubscriptionEventRowSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.union([z.literal(10), z.literal(25), z.literal(50)]),
});
export type SubscriptionEventsResponse = z.infer<typeof SubscriptionEventsResponseSchema>;

/* ---------------- A creator's subscribers (`AdmCrSubs`) ---------------- */

export const CREATOR_SUBSCRIBER_SORT_FIELDS = [
  'subscriber',
  'telegram',
  'status',
  'starts',
  'ends',
] as const;
export type CreatorSubscriberSort = (typeof CREATOR_SUBSCRIBER_SORT_FIELDS)[number];

export const CreatorSubscribersQuerySchema = z.strictObject({
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
    .enum(CREATOR_SUBSCRIBER_SORT_FIELDS)
    .optional()
    .transform((v) => v ?? 'ends'),
  ...pageFields,
});
export type CreatorSubscribersQuery = z.output<typeof CreatorSubscribersQuerySchema>;
export const DEFAULT_CREATOR_SUBSCRIBERS_QUERY = CreatorSubscribersQuerySchema.parse({});

export const SubscriberCustomerSchema = z.strictObject({
  id: z.uuid(),
  display_name: z.string(),
  avatar_url: HttpsUrl.nullable(),
  telegram_username: z.string().nullable(),
  telegram_id: z.string(),
});

export const CreatorSubscriberRowSchema = z.strictObject({
  /** The subscription id (the id the US-020 endpoints take, together with `customer.id`). */
  id: z.uuid(),
  customer: SubscriberCustomerSchema,
  status: SubscriptionStatusSchema,
  starts_at: z.string(),
  ends_at: z.string(),
  revoked_at: z.string().nullable(),
});
export type CreatorSubscriberRow = z.infer<typeof CreatorSubscriberRowSchema>;

export const CreatorSubscribersResponseSchema = z.strictObject({
  items: z.array(CreatorSubscriberRowSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.union([z.literal(10), z.literal(25), z.literal(50)]),
});
export type CreatorSubscribersResponse = z.infer<typeof CreatorSubscribersResponseSchema>;

/** `GET /v1/admin/creators/:id/grantable-users?q=`: the picker of Berikan Akses (max 20). */
export const GrantableUsersQuerySchema = z.strictObject({
  q: z
    .string()
    .max(CREATOR_LIST_SEARCH_MAX)
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
});
export type GrantableUsersQuery = z.output<typeof GrantableUsersQuerySchema>;

export const GRANTABLE_USERS_LIMIT = 20;

export const GrantableUsersResponseSchema = z.strictObject({
  creator_status: z.enum(['ACTIVE', 'BLOCKED']),
  items: z.array(SubscriberCustomerSchema).max(GRANTABLE_USERS_LIMIT),
});
export type GrantableUsersResponse = z.infer<typeof GrantableUsersResponseSchema>;
export const SUBSCRIBER_PAGE_SIZES = SUBSCRIPTION_PAGE_SIZES;
