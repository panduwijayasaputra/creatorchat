import { z } from 'zod';
import { ReasonSchema } from './creator-review.js';

/** Block and unblock take the same body: the reason, required. Other keys are stripped. */
export const ModerateCreatorSchema = z.object({ reason: ReasonSchema });
export type ModerateCreatorData = z.output<typeof ModerateCreatorSchema>;

export const CreatorModerationStatusSchema = z.enum(['ACTIVE', 'BLOCKED']);
export type CreatorModerationStatus = z.infer<typeof CreatorModerationStatusSchema>;

/** `GET /v1/admin/creators/:id/block-check`: what the block dialog shows on open. */
export const CreatorBlockCheckResponseSchema = z.strictObject({
  creator_status: CreatorModerationStatusSchema,
  active_subscribers: z.number().int().min(0),
  checked_at: z.string(),
});
export type CreatorBlockCheckResponse = z.infer<typeof CreatorBlockCheckResponseSchema>;

export const BlockCreatorResponseSchema = z.strictObject({
  creator: z.strictObject({ id: z.uuid(), status: z.literal('BLOCKED') }),
  active_subscribers: z.number().int().min(0),
});
export type BlockCreatorResponse = z.infer<typeof BlockCreatorResponseSchema>;

export const UnblockCreatorResponseSchema = z.strictObject({
  creator: z.strictObject({ id: z.uuid(), status: z.literal('ACTIVE') }),
});
export type UnblockCreatorResponse = z.infer<typeof UnblockCreatorResponseSchema>;

/** `details` of a 409 `CREATOR_STATUS_CONFLICT`: the status the creator already has. */
export const CreatorStatusConflictDetailsSchema = z.strictObject({
  status: CreatorModerationStatusSchema,
});
export type CreatorStatusConflictDetails = z.infer<typeof CreatorStatusConflictDetailsSchema>;
