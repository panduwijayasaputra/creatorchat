import { z } from 'zod';
import { CreatorLinkResponseSchema } from './creator-link.js';

export const EXPLORE_PATH = '/v1/creators';
export const SUBSCRIPTIONS_PATH = '/v1/subscriptions';
/** Langganan is one page without paging: a customer's creator count is small. */
export const SUBSCRIPTIONS_MAX = 100;
export const EXPLORE_PAGE_SIZES = [10, 20, 50] as const;
export const ACCESS_REQUEST_TYPES = ['TRIAL', 'RENEWAL'] as const;
const PAGE_MAX = 100_000;

/**
 * The viewer's own access to a creator, exactly one state with only the fields that state needs
 * (US-022). No media, counts or internal ids: a customer learns nothing else about the creator.
 */
export const CreatorAccessSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('GUEST') }),
  z.strictObject({
    state: z.literal('PENDING'),
    requested_at: z.string(),
    request_type: z.enum(ACCESS_REQUEST_TYPES),
  }),
  z.strictObject({ state: z.literal('ACTIVE'), ends_at: z.string() }),
  z.strictObject({ state: z.literal('EXPIRED'), ended_at: z.string(), revoked: z.boolean() }),
]);
export type CreatorAccess = z.infer<typeof CreatorAccessSchema>;

/** The outcome of the viewer's latest reviewed access request (`StatesAccess` cards). */
export const CreatorAccessReviewSchema = z.strictObject({
  status: z.enum(['APPROVED', 'REJECTED']),
  reviewed_at: z.string(),
});
export type CreatorAccessReview = z.infer<typeof CreatorAccessReviewSchema>;

/** `POST …/access-requests` answer: what was asked and when; no ids. */
export const SubmitAccessRequestResponseSchema = z.strictObject({
  request_type: z.enum(ACCESS_REQUEST_TYPES),
  requested_at: z.string(),
});
export type SubmitAccessRequestResponse = z.infer<typeof SubmitAccessRequestResponseSchema>;

/** API path of the customer's request for access to the creator with this code. */
export function accessRequestPath(code: string): string {
  return `/v1/creators/by-code/${encodeURIComponent(code)}/access-requests`;
}

/** `GET /v1/creators/by-code/:publicCode`: the deep-link fields plus the viewer's access state. */
export const CreatorProfileResponseSchema = CreatorLinkResponseSchema.extend({
  access: CreatorAccessSchema,
  /** The viewer's latest reviewed request for this creator (US-023); no reason, no admin. */
  last_review: CreatorAccessReviewSchema.optional(),
  /** The viewer's own conversation with this creator, or null (US-027): links "Buka Chat". */
  conversation_id: z.uuid().nullable(),
});
export type CreatorProfileResponse = z.infer<typeof CreatorProfileResponseSchema>;

/** `GET /v1/creators` (Explore): strict, snake_case; an unknown key or value is a 400. */
export const ExploreQuerySchema = z.strictObject({
  page: z
    .string()
    .regex(/^\d{1,6}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(PAGE_MAX))
    .optional()
    .transform((value) => value ?? 1),
  page_size: z
    .enum(['10', '20', '50'])
    .transform(Number)
    .optional()
    .transform((value) => value ?? 20),
});
export type ExploreQuery = z.output<typeof ExploreQuerySchema>;
export const DEFAULT_EXPLORE_QUERY: ExploreQuery = ExploreQuerySchema.parse({});

export const ExploreItemSchema = z.strictObject({
  public_code: CreatorLinkResponseSchema.shape.public_code,
  display_name: z.string(),
  bio: z.string().nullable(),
  avatar_url: z
    .string()
    .regex(/^https:\/\//)
    .nullable(),
  /** The viewer's own state; `null` when there is no relation (no chip). */
  access: z.enum(['ACTIVE', 'PENDING', 'EXPIRED']).nullable(),
});
export type ExploreItem = z.infer<typeof ExploreItemSchema>;

export const ExploreResponseSchema = z.strictObject({
  items: z.array(ExploreItemSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.union([z.literal(10), z.literal(20), z.literal(50)]),
});
export type ExploreResponse = z.infer<typeof ExploreResponseSchema>;

/** The access states a Langganan card can show: every one except GUEST (no relation, no card). */
const SubscriptionAccessSchema = z.discriminatedUnion('state', [
  CreatorAccessSchema.options[1],
  CreatorAccessSchema.options[2],
  CreatorAccessSchema.options[3],
]);

/**
 * One Langganan card (US-025): public profile fields plus the viewer's own access. No ids, counts
 * or media. `creator_available` is false for a blocked creator: the card keeps its dates but has
 * no actions, since the profile would answer 404.
 */
export const SubscriptionItemSchema = z.strictObject({
  public_code: CreatorLinkResponseSchema.shape.public_code,
  display_name: z.string(),
  avatar_url: z
    .string()
    .regex(/^https:\/\//)
    .nullable(),
  access: SubscriptionAccessSchema,
  creator_available: z.boolean(),
  /** The viewer's own conversation with this creator, or null (US-027). */
  conversation_id: z.uuid().nullable(),
  /** The viewer muted this creator's message and broadcast notifications (US-043). */
  muted: z.boolean(),
});
export type SubscriptionItem = z.infer<typeof SubscriptionItemSchema>;

/** `GET /v1/subscriptions`: active first, then pending, then ended; at most 100 cards. */
export const SubscriptionsResponseSchema = z.strictObject({
  items: z.array(SubscriptionItemSchema).max(SUBSCRIPTIONS_MAX),
});
export type SubscriptionsResponse = z.infer<typeof SubscriptionsResponseSchema>;
