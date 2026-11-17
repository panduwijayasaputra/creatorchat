import type { Logger } from 'pino';

interface Tickable {
  dispatch(): Promise<unknown>;
  reconcile(): Promise<unknown>;
}

export interface OutboxLoops {
  /** Stops the timers and waits for a tick that is already running. */
  stop(): Promise<void>;
}

/**
 * Runs dispatch every `intervalMs` and reconcile every `reconcileMs`. A slow tick is never
 * re-entered, a failing tick does not stop the loop, and an error is logged only when the loop
 * goes from healthy to failing (class name only: messages can hold connection strings).
 */
export function startOutboxLoops(options: {
  dispatcher: Tickable;
  logger: Logger;
  intervalMs?: number;
  reconcileMs?: number;
}): OutboxLoops {
  const { dispatcher, logger } = options;
  let stopped = false;

  function loop(name: string, run: () => Promise<unknown>, everyMs: number) {
    let running: Promise<void> | undefined;
    let failing = false;
    const tick = () => {
      if (stopped || running) return;
      running = (async () => {
        try {
          await run();
          if (failing) logger.info({ loop: name }, 'outbox loop recovered');
          failing = false;
        } catch (error) {
          if (!failing) {
            logger.error(
              { loop: name, error: error instanceof Error ? error.name : 'Error' },
              'outbox loop failing',
            );
          }
          failing = true;
        } finally {
          running = undefined;
        }
      })();
    };
    const timer = setInterval(tick, everyMs);
    tick();
    return async () => {
      clearInterval(timer);
      await running;
    };
  }

  const stops = [
    loop('dispatch', () => dispatcher.dispatch(), options.intervalMs ?? 1000),
    loop('reconcile', () => dispatcher.reconcile(), options.reconcileMs ?? 30_000),
  ];
  return {
    async stop() {
      stopped = true;
      await Promise.all(stops.map((stop) => stop()));
    },
  };
}
