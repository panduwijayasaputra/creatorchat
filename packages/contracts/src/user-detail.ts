import { z } from 'zod';
import { CREATOR_LIST_PAGE_SIZES, CREATOR_LIST_SEARCH_MAX } from './creator-list.js';
import { CreatorTypeSchema } from './creator-request.js';
import { ApprovalBlockSchema } from './creator-review.js';

const PAGE_MAX = 100_000;
const httpsUrl = z.string().regex(/^https:\/\//);

/** `GET /v1/admin/users/:id`: a USER's detail, or (for a creator's id) only where to go instead. */
export const UserDetailResponseSchema = z.discriminatedUnion('role', [
  z.strictObject({
    role: z.literal('USER'),
    user: z.strictObject({
      id: z.uuid(),
      display_name: z.string(),
      avatar_url: httpsUrl.nullable(),
      telegram_username: z.string().nullable(),
      telegram_id: z.string(),
      status: z.enum(['ACTIVE', 'BLOCKED']),
      bio: z.string().nullable(),
      joined_at: z.string(),
    }),
    subscriptions: z.strictObject({
      active_count: z.number().int().min(0),
      expired_count: z.number().int().min(0),
      nearest_end: z.strictObject({ creator_name: z.string(), ends_at: z.string() }).nullable(),
    }),
    creator_request: z.strictObject({
      status: z.enum(['NONE', 'PENDING', 'REJECTED']),
      submitted_at: z.string().nullable(),
      rejection_count: z.number().int().min(0),
      last_rejected_at: z.string().nullable(),
      latest_request_id: z.uuid().nullable(),
    }),
    /** Only while the account is BLOCKED; reason and admin come from the latest block audit entry. */
    block: z
      .strictObject({
        reason: z.string().nullable(),
        admin_label: z.string().nullable(),
        at: z.string(),
      })
      .nullable(),
  }),
  z.strictObject({ role: z.literal('CREATOR'), creator_id: z.uuid() }),
]);
export type UserDetailResponse = z.infer<typeof UserDetailResponseSchema>;

export const USER_REQUEST_STATUSES = ['all', 'pending', 'rejected'] as const;
export const USER_REQUEST_SORT_FIELDS = ['date', 'status'] as const;
export type UserRequestSort = (typeof USER_REQUEST_SORT_FIELDS)[number];

/** Query of a user's creator-request table. Strict, snake_case. */
export const UserRequestsQuerySchema = z.strictObject({
  q: z
    .string()
    .max(CREATOR_LIST_SEARCH_MAX)
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : null)),
  status: z
    .enum(USER_REQUEST_STATUSES)
    .optional()
    .transform((value) => value ?? 'all'),
  sort: z
    .enum(USER_REQUEST_SORT_FIELDS)
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
export type UserRequestsQuery = z.output<typeof UserRequestsQuerySchema>;
export const DEFAULT_USER_REQUESTS_QUERY: UserRequestsQuery = UserRequestsQuerySchema.parse({});
export const USER_REQUEST_PAGE_SIZES = CREATOR_LIST_PAGE_SIZES;

export const UserRequestRowSchema = z.strictObject({
  id: z.uuid(),
  created_at: z.string(),
  /** "Pengajuan ke-n": rank of the request among all of the user's requests, oldest first. */
  ordinal: z.number().int().min(1),
  status: z.enum(['PENDING', 'REJECTED']),
  summary: z.string(),
});
export type UserRequestRow = z.infer<typeof UserRequestRowSchema>;

export const UserRequestsResponseSchema = z.strictObject({
  items: z.array(UserRequestRowSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.union([z.literal(10), z.literal(25), z.literal(50)]),
  /** The banner data: independent of the filters and the page. */
  pending: z
    .strictObject({ id: z.uuid(), subscription_block: ApprovalBlockSchema.nullable() })
    .nullable(),
});
export type UserRequestsResponse = z.infer<typeof UserRequestsResponseSchema>;

/** `GET /v1/admin/users/:id/requests/:reqId` (`AdmReqDetail`, `AdmReqDetailRej`). */
export const UserRequestDetailSchema = z
  .strictObject({
    request: z.strictObject({
      id: z.uuid(),
      status: z.enum(['PENDING', 'REJECTED']),
      creator_name: z.string(),
      instagram_url: z.string(),
      creator_type: CreatorTypeSchema,
      description: z.string(),
      created_at: z.string(),
      ordinal: z.number().int().min(1),
    }),
    applicant: z.strictObject({
      display_name: z.string(),
      telegram_username: z.string().nullable(),
      telegram_id: z.string(),
    }),
    /** Pending only: the approval pre-check. */
    check: z.strictObject({ block: ApprovalBlockSchema.nullable() }).nullable(),
    /** Rejected only. */
    review: z
      .strictObject({
        reason: z.string().nullable(),
        reviewed_at: z.string().nullable(),
        reviewer_label: z.string().nullable(),
        log_id: z.uuid().nullable(),
      })
      .nullable(),
  })
  .refine((d) => (d.request.status === 'PENDING' ? d.check !== null && d.review === null : true), {
    message: 'a pending request carries `check` only',
  })
  .refine((d) => (d.request.status === 'REJECTED' ? d.review !== null && d.check === null : true), {
    message: 'a rejected request carries `review` only',
  });
export type UserRequestDetail = z.infer<typeof UserRequestDetailSchema>;
