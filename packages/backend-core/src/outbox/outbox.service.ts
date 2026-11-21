import type { PrismaClient } from '@creatorchat/db';

/** Event types written to the outbox. Consumers (US-013 onwards) match on these strings. */
export const OutboxEventType = {
  CREATOR_APPLICATION_APPROVED: 'creator_application.approved',
  CREATOR_APPLICATION_REJECTED: 'creator_application.rejected',
  // US-020: written with the access change; no handler until Phase E sends the Telegram message.
  SUBSCRIPTION_GRANTED: 'subscription.granted',
  SUBSCRIPTION_EXTENDED: 'subscription.extended',
  SUBSCRIPTION_REVOKED: 'subscription.revoked',
  // US-023: a customer asked for access; no handler until US-024 / Phase E.
  ACCESS_REQUEST_CREATED: 'access_request.created',
  // US-024: written with the rejection; no handler until Phase E tells the customer.
  ACCESS_REQUEST_REJECTED: 'access_request.rejected',
  // US-026: a chat message was committed; no handler until realtime / notifications (US-031, Phase E).
  MESSAGE_CREATED: 'message.created',
  // US-030: a read cursor really moved; no handler until realtime (US-031).
  READ_UPDATED: 'read.updated',
  // US-032: an upload was verified and waits for the worker (clean, thumbnail, gallery).
  MEDIA_UPLOADED: 'media.uploaded',
  // US-045: written by the access scheduler (not by a business transaction); the notification pipeline sends them.
  SUBSCRIPTION_REMINDER_DUE: 'subscription.reminder_due',
  SUBSCRIPTION_ENDED: 'subscription.ended',
  // US-041: written by the grant that creates a customer's subscription (their first access).
  WELCOME_REQUESTED: 'welcome.requested',
  // US-038: a creator recorded a broadcast; the worker fans it out in US-039.
  BROADCAST_CREATED: 'broadcast.created',
} as const;
export type OutboxEventType = (typeof OutboxEventType)[keyof typeof OutboxEventType];

/** A payload entry is an id or a short code, never free text (no spaces, no admin-written reason). */
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;

export type OutboxPayload = Record<string, string | number | boolean>;

export interface OutboxEventInput {
  type: OutboxEventType;
  aggregateType: string;
  aggregateId: string;
  payload: OutboxPayload;
  /** One event per business fact: a repeat with the same key writes nothing. */
  dedupeKey: string;
}

/** The unsafe payload entry; the message names the key but never the value. */
export class UnsafeOutboxPayloadError extends Error {
  constructor(key: string) {
    super(`Outbox payload entry "${key}" must be an id, a code, a number or a boolean.`);
    this.name = 'UnsafeOutboxPayloadError';
  }
}

type Tx = Pick<PrismaClient, '$executeRaw'>;

export function assertSafePayload(payload: OutboxPayload): void {
  for (const [key, value] of Object.entries(payload)) {
    if (!SAFE_TOKEN.test(key)) throw new UnsafeOutboxPayloadError(key);
    if (typeof value === 'string' && !SAFE_TOKEN.test(value))
      throw new UnsafeOutboxPayloadError(key);
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new UnsafeOutboxPayloadError(key);
  }
}

/**
 * Write side of the outbox (brief §14). Called with the business transaction's client, so the event
 * commits with the change or not at all. Nothing here dispatches: the dispatcher and the
 * reconciler are US-013.
 */
export class OutboxService {
  /** `created: false` when an event with this dedupe key already exists (a repeat is ignored). */
  async add(tx: Tx, input: OutboxEventInput): Promise<{ created: boolean }> {
    assertSafePayload(input.payload);
    const payload = JSON.stringify(input.payload);
    const inserted = await tx.$executeRaw`
      INSERT INTO outbox_events (type, aggregate_type, aggregate_id, payload, dedupe_key)
      VALUES (${input.type}, ${input.aggregateType}, ${input.aggregateId}::uuid,
              ${payload}::jsonb, ${input.dedupeKey})
      ON CONFLICT (dedupe_key) DO NOTHING`;
    return { created: inserted === 1 };
  }
}
