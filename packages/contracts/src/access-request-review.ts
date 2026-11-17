import { z } from 'zod';
import { ACCESS_REQUEST_TYPES } from './creator-access.js';
import { ReasonSchema } from './creator-review.js';

export const userAccessRequestsPath = (userId: string) =>
  `/v1/admin/users/${encodeURIComponent(userId)}/access-requests`;

export const rejectAccessRequestPath = (userId: string, requestId: string) =>
  `${userAccessRequestsPath(userId)}/${encodeURIComponent(requestId)}/reject`;

/** One pending trial / renewal request, as the Langganan banner shows it. No customer data. */
export const PendingAccessRequestSchema = z.strictObject({
  id: z.uuid(),
  creator: z.strictObject({ id: z.uuid(), display_name: z.string() }),
  type: z.enum(ACCESS_REQUEST_TYPES),
  requested_at: z.string(),
});
export type PendingAccessRequest = z.infer<typeof PendingAccessRequestSchema>;

/** `GET /v1/admin/users/:id/access-requests`: the user's PENDING requests, oldest first. */
export const AccessRequestsResponseSchema = z.strictObject({
  items: z.array(PendingAccessRequestSchema),
});
export type AccessRequestsResponse = z.infer<typeof AccessRequestsResponseSchema>;

/** `POST …/access-requests/:requestId/reject`: the reason is required; other keys are stripped. */
export const RejectAccessRequestSchema = z.object({ reason: ReasonSchema });
export type RejectAccessRequestData = z.output<typeof RejectAccessRequestSchema>;

export const RejectAccessRequestResponseSchema = z.strictObject({
  request: z.strictObject({ id: z.uuid(), status: z.literal('REJECTED') }),
});
export type RejectAccessRequestResponse = z.infer<typeof RejectAccessRequestResponseSchema>;

/** `details` of a 409 `ACCESS_REQUEST_ALREADY_REVIEWED`: what the request is now. */
export interface AccessRequestConflictDetails {
  status: 'APPROVED' | 'REJECTED';
}
