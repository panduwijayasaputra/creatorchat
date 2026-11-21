import type { PrismaClient } from '@creatorchat/db';

type Tx = Pick<PrismaClient, '$queryRaw'>;

export type RecipientRefusal = 'access_ended' | 'customer_blocked' | 'creator_blocked';

export type RecipientCheck =
  { ok: true; ownerUserId: string } | { ok: false; reason: RecipientRefusal };

interface PairRow {
  owner_user_id: string;
  customer_status: string;
  customer_role: string;
  creator_status: string;
  owner_status: string;
  starts_at: Date | null;
  ends_at: Date | null;
  revoked_at: Date | null;
}

/**
 * May this creator put a message in this customer's chat right now? The one rule the worker-written
 * messages (broadcast, welcome) share with a manual send: the creator and the creator's account are
 * ACTIVE, the customer is an ACTIVE customer account, and the subscription is running
 * (`starts_at <= now < ends_at`, not revoked). Creator problems win, then the customer account, then
 * the dates, so the reason says what to look at. Read-only: run it inside the transaction that
 * writes the message, after the conversation lock, so a block or revoke that lands meanwhile wins.
 */
export async function checkCreatorCanMessage(
  tx: Tx,
  creatorId: string,
  customerId: string,
  now: Date,
): Promise<RecipientCheck> {
  const [pair] = await tx.$queryRaw<PairRow[]>`
    SELECT ou.id::text AS owner_user_id, cu.status::text AS customer_status,
           cu.role::text AS customer_role, sc.status::text AS creator_status,
           ou.status::text AS owner_status, s.starts_at, s.ends_at, s.revoked_at
    FROM creators sc
    JOIN users ou ON ou.id = sc.user_id
    JOIN users cu ON cu.id = ${customerId}::uuid
    LEFT JOIN subscriptions s ON s.creator_id = sc.id AND s.customer_id = cu.id
    WHERE sc.id = ${creatorId}::uuid`;
  if (!pair) return { ok: false, reason: 'creator_blocked' };
  if (pair.creator_status !== 'ACTIVE' || pair.owner_status !== 'ACTIVE') {
    return { ok: false, reason: 'creator_blocked' };
  }
  if (pair.customer_status !== 'ACTIVE' || pair.customer_role !== 'USER') {
    return { ok: false, reason: 'customer_blocked' };
  }
  const active =
    pair.starts_at !== null &&
    pair.ends_at !== null &&
    pair.revoked_at === null &&
    pair.starts_at <= now &&
    now < pair.ends_at;
  return active
    ? { ok: true, ownerUserId: pair.owner_user_id }
    : { ok: false, reason: 'access_ended' };
}
