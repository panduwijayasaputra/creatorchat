import {
  AccessScheduleService,
  OutboxService,
  type AccessScanResult,
} from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';
import type { Logger } from 'pino';

/** One key for the whole access scan: only one worker scans at a time. */
const SCAN_LOCK_KEY = 4_507_001n;
/** A scan can page through many subscriptions; the lock lives as long as this transaction. */
const SCAN_TIMEOUT_MS = 5 * 60_000;

/**
 * Runs one scan while holding a transaction-scoped advisory lock (released with the transaction, even
 * if the worker dies). `'locked'` means another worker is scanning right now. Overlapping scans
 * would be harmless anyway (the events are deduplicated); the lock only saves the work.
 */
export async function runLockedScan(
  prisma: PrismaClient,
  service: Pick<AccessScheduleService, 'scan'>,
): Promise<AccessScanResult | 'locked'> {
  return prisma.$transaction(
    async (tx) => {
      const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${SCAN_LOCK_KEY}::bigint) AS locked`;
      if (!row?.locked) return 'locked' as const;
      return service.scan();
    },
    { timeout: SCAN_TIMEOUT_MS, maxWait: 5000 },
  );
}

export interface AccessScheduler {
  /** Stops the timer and waits for a scan that is already running. */
  stop(): Promise<void>;
}

/**
 * Starts the loop that writes the time-based access notices (reminder, ended) into the outbox every
 * `intervalMs` (US-045). A slow scan is never re-entered, a failing scan does not stop the loop, and
 * an error is logged only when the loop goes from healthy to failing (class name only).
 */
export function startAccessScheduler(options: {
  prisma: PrismaClient;
  logger: Logger;
  leadDays: number;
  intervalMs?: number;
  clock?: () => Date;
}): AccessScheduler {
  const { prisma, logger } = options;
  const service = new AccessScheduleService(prisma, new OutboxService(), {
    leadDays: options.leadDays,
    ...(options.clock ? { clock: options.clock } : {}),
  });
  let stopped = false;
  let running: Promise<void> | undefined;
  let failing = false;

  const tick = () => {
    if (stopped || running) return;
    running = (async () => {
      try {
        const result = await runLockedScan(prisma, service);
        if (failing) logger.info('access scheduler recovered');
        failing = false;
        if (result !== 'locked' && (result.reminders > 0 || result.ended > 0)) {
          logger.info(result, 'access notices scheduled');
        }
      } catch (error) {
        if (!failing) {
          logger.error(
            { error: error instanceof Error ? error.name : 'Error' },
            'access scheduler failing',
          );
        }
        failing = true;
      } finally {
        running = undefined;
      }
    })();
  };
  const timer = setInterval(tick, options.intervalMs ?? 60_000);
  tick();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
