import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Writable } from 'node:stream';
import { loadEnv } from '@creatorchat/backend-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger.js';
import { createWorker } from './worker.js';

function setup(
  overrides: { pingDb?: () => Promise<unknown>; pingRedis?: () => Promise<unknown> } = {},
) {
  let raw = '';
  const stream = new Writable({
    write(chunk, _e, cb) {
      raw += String(chunk);
      cb();
    },
  });
  const close = vi.fn(async () => undefined);
  const worker = createWorker({
    env: loadEnv({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      TELEGRAM_BOT_TOKEN: '<set-locally>',
    }),
    logger: createLogger('info', stream),
    pingDb: overrides.pingDb ?? (async () => 1),
    pingRedis: overrides.pingRedis ?? (async () => 'PONG'),
    close,
    intervalMs: 1000,
  });
  return {
    worker,
    close,
    lines: () =>
      raw
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    raw: () => raw,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('worker shell', () => {
  it('logs unconfigured integrations on start, without any secret values', async () => {
    const t = setup();
    await t.worker.start();
    const status = t.lines().find((l) => l.msg === 'integration status');
    expect(status.integrations).toEqual({
      telegram: 'unconfigured',
      r2: 'unconfigured',
      ai: 'unconfigured',
      aiProvider: 'fake',
    });
    expect(t.raw()).not.toMatch(/postgresql:|redis:\/\//);
    await t.worker.stop();
  });

  it('logs dependency state only when it changes', async () => {
    vi.useFakeTimers();
    let dbUp = true;
    const t = setup({ pingDb: async () => (dbUp ? 1 : Promise.reject(new Error('down'))) });
    await t.worker.start();
    await vi.advanceTimersByTimeAsync(3000); // still up: no new lines
    dbUp = false;
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(3000); // still down: no repeats
    const changes = t.lines().filter((l) => l.msg === 'dependency status changed');
    expect(changes.map((c) => [c.db, c.redis])).toEqual([
      ['up', 'up'],
      ['down', 'up'],
    ]);
    await t.worker.stop();
  });

  it('starts even when DB and Redis are unreachable', async () => {
    const down = async () => Promise.reject(new Error('ECONNREFUSED'));
    const t = setup({ pingDb: down, pingRedis: down });
    await expect(t.worker.start()).resolves.toBeUndefined();
    expect(t.lines().find((l) => l.msg === 'dependency status changed')).toMatchObject({
      db: 'down',
      redis: 'down',
    });
    await t.worker.stop();
  });

  it('closes its connections on stop', async () => {
    const t = setup();
    await t.worker.start();
    await t.worker.stop();
    expect(t.close).toHaveBeenCalledTimes(1);
  });
});

describe('worker process', () => {
  it('exits non-zero with readable key-only errors when DATABASE_URL is missing', () => {
    const r = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve(import.meta.dirname, 'main.ts')],
      {
        env: {
          ...process.env,
          DATABASE_URL: '',
          REDIS_URL: 'redis://localhost:6379',
          TELEGRAM_BOT_TOKEN: 'leak-me-not',
        },
        encoding: 'utf8',
        cwd: resolve(import.meta.dirname, '..'),
      },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('DATABASE_URL');
    expect(r.stdout + r.stderr).not.toContain('leak-me-not');
  });
});
