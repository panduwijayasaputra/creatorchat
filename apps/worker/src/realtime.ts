import { RealtimePublisher, type RealtimeEmitter, type ServerEnv } from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';
import { Emitter } from '@socket.io/redis-emitter';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { startOutboxLoops } from './outbox/loops.js';

export interface RealtimeOptions {
  env: Pick<ServerEnv, 'REDIS_URL'>;
  prisma: PrismaClient;
  logger: Logger;
  /** Socket.IO key prefix; must match the API's adapter (tests use their own). */
  keyPrefix?: string;
  intervalMs?: number;
}

export interface Realtime {
  /** Stops the loop, waits for a running tick, then closes Redis. */
  stop(): Promise<void>;
}

/**
 * Publishes committed message / read events to the API's Socket.IO rooms through Redis (US-031).
 * Unlike the Telegram pipeline it needs no bot configuration, so it always runs. The publisher
 * stamps each outbox row after emitting, so a crash re-emits instead of losing the signal.
 */
export function startRealtime(options: RealtimeOptions): Realtime {
  const redis = new Redis(options.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
  });
  redis.on('error', () => undefined); // a down Redis only fails ticks, which the loop reports once
  const emitter = new Emitter(redis, options.keyPrefix ? { key: options.keyPrefix } : {});
  const adapter: RealtimeEmitter = {
    emit: (room, event, payload) => {
      emitter.to(room).emit(event, payload);
    },
  };
  const publisher = new RealtimePublisher(options.prisma, adapter);
  const loops = startOutboxLoops({
    // The publisher is its own reconciler: every tick also picks up rows a crash left unstamped.
    dispatcher: { dispatch: () => publisher.publishPending(), reconcile: async () => undefined },
    logger: options.logger,
    ...(options.intervalMs !== undefined ? { intervalMs: options.intervalMs } : {}),
  });
  return {
    async stop() {
      await loops.stop();
      redis.disconnect();
    },
  };
}
