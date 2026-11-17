import { z } from 'zod';
import { ReasonSchema } from './creator-review.js';

/** Block and unblock take the same body: the reason, required. Other keys are stripped. */
export const ModerateUserSchema = z.object({ reason: ReasonSchema });
export type ModerateUserData = z.output<typeof ModerateUserSchema>;

export const UserModerationStatusSchema = z.enum(['ACTIVE', 'BLOCKED']);
export type UserModerationStatus = z.infer<typeof UserModerationStatusSchema>;

export const UserModerationRoleSchema = z.enum(['USER', 'CREATOR']);

/** `GET /v1/admin/users/:id/block-check`: what the block dialog shows on open. */
export const UserBlockCheckResponseSchema = z.strictObject({
  user_status: UserModerationStatusSchema,
  role: UserModerationRoleSchema,
  /** Subscriptions of the user, as a customer, running right now. */
  active_subscriptions: z.number().int().min(0),
  checked_at: z.string(),
});
export type UserBlockCheckResponse = z.infer<typeof UserBlockCheckResponseSchema>;

export const BlockUserResponseSchema = z.strictObject({
  user: z.strictObject({ id: z.uuid(), status: z.literal('BLOCKED') }),
});
export type BlockUserResponse = z.infer<typeof BlockUserResponseSchema>;

export const UnblockUserResponseSchema = z.strictObject({
  user: z.strictObject({ id: z.uuid(), status: z.literal('ACTIVE') }),
});
export type UnblockUserResponse = z.infer<typeof UnblockUserResponseSchema>;

/** `details` of a 409 `USER_STATUS_CONFLICT`: the status the user already has. */
export const UserStatusConflictDetailsSchema = z.strictObject({
  status: UserModerationStatusSchema,
});
export type UserStatusConflictDetails = z.infer<typeof UserStatusConflictDetailsSchema>;

/** `details` of a 409 `USER_ROLE_CONFLICT`: creators are moderated through the creator endpoints. */
export const UserRoleConflictDetailsSchema = z.strictObject({ role: UserModerationRoleSchema });
export type UserRoleConflictDetails = z.infer<typeof UserRoleConflictDetailsSchema>;
