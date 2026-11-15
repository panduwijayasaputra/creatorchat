import { getIntegrationStatus, type ServerEnv } from '@creatorchat/backend-core';
import type { Logger } from 'pino';

/** The minimal surface the worker needs, so tests can substitute fakes. */
export interface WorkerDeps {
  env: ServerEnv;
  logger: Logger;
  /** Resolves if PostgreSQL answers `SELECT 1`; rejects otherwise. */
  pingDb: () => Promise<unknown>;
  /** Resolves if Redis answers `PING`; rejects otherwise. */
  pingRedis: () => Promise<unknown>;
  /** Releases the DB and Redis connections. */
  close: () => Promise<void>;
  intervalMs?: number;
}

export interface Worker {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

type State = 'up' | 'down';

async function probe(fn: () => Promise<unknown>): Promise<State> {
  try {
    await fn();
    return 'up';
  } catch {
    return 'down';
  }
}

/**
 * Worker shell: logs which integrations are unconfigured, watches DB/Redis reachability (logging
 * only on state changes) and shuts down cleanly. Queue processors arrive with their stories.
 */
export function createWorker(deps: WorkerDeps): Worker {
  const { logger } = deps;
  const intervalMs = deps.intervalMs ?? 15_000;
  let timer: NodeJS.Timeout | undefined;
  let last: { db?: State; redis?: State } = {};
  let stopped = false;

  async function check(): Promise<void> {
    const [db, redis] = await Promise.all([probe(deps.pingDb), probe(deps.pingRedis)]);
    if (stopped) return;
    if (db !== last.db || redis !== last.redis) {
      const level = db === 'up' && redis === 'up' ? 'info' : 'warn';
      logger[level]({ db, redis }, 'dependency status changed');
      last = { db, redis };
    }
  }

  return {
    async start() {
      logger.info({ env: deps.env.NODE_ENV }, 'worker starting');
      logger.info({ integrations: getIntegrationStatus(deps.env) }, 'integration status');
      await check();
      timer = setInterval(() => void check(), intervalMs);
      logger.info('worker ready (no queues registered yet)');
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      await deps.close();
      logger.info('worker stopped');
    },
  };
}
