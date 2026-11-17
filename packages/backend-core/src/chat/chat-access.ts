import { isEntitled, type EntitlementWindow } from '../subscription-access/entitlement.js';

export type ChatAccess =
  | { state: 'ACTIVE'; endsAt: Date }
  | { state: 'EXPIRED'; endedAt: Date | null }
  | { state: 'CREATOR_BLOCKED' };

/**
 * What a customer can do in one conversation. A blocked creator (or creator account) wins over a
 * running subscription; otherwise the entitlement rule decides. `endedAt` is the earlier of the
 * end date and the revocation (null when there never was a subscription).
 */
export function chatAccessState(
  input: { subscription: EntitlementWindow | null; creatorBlocked: boolean },
  now: Date,
): ChatAccess {
  if (input.creatorBlocked) return { state: 'CREATOR_BLOCKED' };
  const sub = input.subscription;
  if (sub && isEntitled(sub, now)) return { state: 'ACTIVE', endsAt: sub.endsAt };
  if (!sub) return { state: 'EXPIRED', endedAt: null };
  const ended = sub.revokedAt && sub.revokedAt < sub.endsAt ? sub.revokedAt : sub.endsAt;
  return { state: 'EXPIRED', endedAt: ended };
}
