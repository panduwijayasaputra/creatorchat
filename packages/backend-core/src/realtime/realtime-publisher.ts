import { userRoom, type RealtimeEventName, type RealtimeEvents } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { OutboxEventType } from '../outbox/outbox.service.js';

/** Where a signal goes: in production a Redis emitter reaching the API's Socket.IO rooms. */
export interface RealtimeEmitter {
  emit<E extends RealtimeEventName>(
    room: string,
    event: E,
    payload: RealtimeEvents[E],
  ): Promise<void> | void;
}

export interface PublishResult {
  published: number;
  /** Stamped without emitting: too old, or the conversation / reader no longer fits. */
  skipped: number;
  /** Left unstamped (the emitter threw); the next tick tries again. */
  failed: number;
}

export interface RealtimePublisherOptions {
  batchSize?: number;
  clock?: () => Date;
  /** Older events are stamped without emitting: clients refetch on reconnect anyway. */
  staleMs?: number;
}

interface Row {
  id: string;
  type: string;
  payload: unknown;
  created_at: Date;
}
interface Participants {
  customer_id: string;
  creator_user_id: string;
  seq?: number;
}

const TYPES = [OutboxEventType.MESSAGE_CREATED, OutboxEventType.READ_UPDATED];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null);

/**
 * Turns committed `message.created` / `read.updated` outbox rows into Socket.IO signals (US-031).
 * Recipients are read from the database (the conversation's two participants), never from the
 * client. A row is stamped `realtime_published_at` only after its emits succeeded, so a crash
 * re-emits it on the next tick: delivery is at-least-once and the signals are idempotent (the
 * client refetches). The same loop is the reconciler. Nothing here reads message text.
 */
export class RealtimePublisher {
  private readonly batchSize: number;
  private readonly clock: () => Date;
  private readonly staleMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly emitter: RealtimeEmitter,
    options: RealtimePublisherOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 50;
    this.clock = options.clock ?? (() => new Date());
    this.staleMs = options.staleMs ?? 15 * 60_000;
  }

  async publishPending(): Promise<PublishResult> {
    const result: PublishResult = { published: 0, skipped: 0, failed: 0 };
    await this.prisma.$transaction(async (tx) => {
      const now = this.clock();
      const rows = await tx.$queryRaw<Row[]>`
        SELECT id::text AS id, type, payload, created_at
        FROM outbox_events
        WHERE realtime_published_at IS NULL AND type IN (${TYPES[0]}, ${TYPES[1]})
        ORDER BY created_at, id
        LIMIT ${this.batchSize}
        FOR UPDATE SKIP LOCKED`;
      const done: string[] = [];
      for (const row of rows) {
        try {
          const emitted =
            now.getTime() - row.created_at.getTime() > this.staleMs
              ? false
              : await this.emitRow(tx, row);
          done.push(row.id);
          if (emitted) result.published += 1;
          else result.skipped += 1;
        } catch {
          result.failed += 1; // never log the payload; the row stays unstamped
        }
      }
      if (done.length > 0) {
        await tx.$executeRaw`
          UPDATE outbox_events SET realtime_published_at = ${now}
          WHERE id = ANY(${done}::uuid[])`;
      }
    });
    return result;
  }

  /** True when something was emitted, false when the row had to be skipped. */
  private async emitRow(tx: Pick<PrismaClient, '$queryRaw'>, row: Row): Promise<boolean> {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const conversationId = str(p.conversation_id);
    if (!conversationId) return false;

    if (row.type === OutboxEventType.MESSAGE_CREATED) {
      const messageId = str(p.message_id);
      if (!messageId) return false;
      const [who] = await tx.$queryRaw<Participants[]>`
        SELECT c.customer_id::text AS customer_id, cr.user_id::text AS creator_user_id, m.seq
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        JOIN creators cr ON cr.id = c.creator_id
        WHERE m.id = ${messageId}::uuid AND c.id = ${conversationId}::uuid`;
      if (!who || who.seq === undefined) return false;
      for (const room of [userRoom(who.customer_id), userRoom(who.creator_user_id)]) {
        await this.emitter.emit(room, 'message.created', {
          conversation_id: conversationId,
          seq: who.seq,
        });
        await this.emitter.emit(room, 'conversation.updated', { conversation_id: conversationId });
      }
      return true;
    }

    const readerId = str(p.reader_id);
    const through = typeof p.last_read_seq === 'number' ? p.last_read_seq : null;
    if (!readerId || through === null || !Number.isInteger(through) || through < 0) return false;
    const [who] = await tx.$queryRaw<Participants[]>`
      SELECT c.customer_id::text AS customer_id, cr.user_id::text AS creator_user_id
      FROM conversations c
      JOIN creators cr ON cr.id = c.creator_id
      WHERE c.id = ${conversationId}::uuid`;
    if (!who) return false;
    const peer =
      readerId === who.customer_id
        ? who.creator_user_id
        : readerId === who.creator_user_id
          ? who.customer_id
          : null;
    if (!peer) return false;
    await this.emitter.emit(userRoom(peer), 'read.updated', {
      conversation_id: conversationId,
      through_seq: through,
    });
    await this.emitter.emit(userRoom(readerId), 'conversation.updated', {
      conversation_id: conversationId,
    });
    return true;
  }
}
