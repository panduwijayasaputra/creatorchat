import {
  ReasonSchema,
  REJECT_REASON_REQUIRED,
  type SubscriptionActionResponse,
} from '@creatorchat/contracts';
import { ApiError } from '../../../auth/api-client';

/** What the tab needs after a dialog closes: the result, or "the state moved, refetch". */
export type AccessDecision =
  { kind: 'done'; subscription: SubscriptionActionResponse['subscription'] } | { kind: 'conflict' };

/** The reason text the server will accept, or the message to show in the dialog. */
export function checkReason(
  reason: string | undefined,
): { ok: true; reason: string } | { ok: false; message: string } {
  const parsed = ReasonSchema.safeParse(reason ?? '');
  return parsed.success
    ? { ok: true, reason: parsed.data }
    : { ok: false, message: parsed.error.issues[0]?.message ?? REJECT_REASON_REQUIRED };
}

/**
 * Runs one access call. A 409 (the access, the account or the creator changed since the page
 * loaded) is a handled "conflict"; every other failure is rethrown so the dialog stays open.
 */
export async function decide(
  call: () => Promise<SubscriptionActionResponse>,
): Promise<AccessDecision> {
  try {
    return { kind: 'done', subscription: (await call()).subscription };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return { kind: 'conflict' };
    throw error;
  }
}
