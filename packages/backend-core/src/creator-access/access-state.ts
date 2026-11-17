import { isEntitled, type EntitlementWindow } from '../subscription-access/entitlement.js';

export type AccessRequestKind = 'TRIAL' | 'RENEWAL';

/** The viewer's access to one creator: exactly one state, with only the facts that state needs. */
export type AccessState =
  | { state: 'GUEST' }
  | { state: 'PENDING'; requestedAt: Date; type: AccessRequestKind }
  | { state: 'ACTIVE'; endsAt: Date }
  | { state: 'EXPIRED'; endedAt: Date; revoked: boolean };

/**
 * Precedence `ACTIVE > PENDING > EXPIRED > GUEST` (US-022): a pending request, trial or renewal,
 * shows as pending even after the access ended. `ACTIVE` is the entitlement rule (`isEntitled`);
 * a revoked subscription counts as ended, at its revocation time.
 */
export function accessStateOf(
  input: {
    subscription: EntitlementWindow | null;
    pending: { createdAt: Date; type: AccessRequestKind } | null;
  },
  now: Date,
): AccessState {
  const { subscription, pending } = input;
  if (subscription && isEntitled(subscription, now)) {
    return { state: 'ACTIVE', endsAt: subscription.endsAt };
  }
  if (pending) return { state: 'PENDING', requestedAt: pending.createdAt, type: pending.type };
  if (subscription) {
    const revoked = subscription.revokedAt !== null;
    return { state: 'EXPIRED', endedAt: subscription.revokedAt ?? subscription.endsAt, revoked };
  }
  return { state: 'GUEST' };
}
