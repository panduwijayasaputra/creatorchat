import { loadEnv } from '@creatorchat/backend-core';
import { HealthResponseSchema } from '@creatorchat/contracts';
import { loadRootEnv } from '@creatorchat/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, UNREACHABLE, type TestApp } from './helpers.js';

loadRootEnv();

let healthy: TestApp;
let dbDown: TestApp;
let redisDown: TestApp;

function envWith(overrides: Record<string, string>) {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL_TEST,
    REDIS_URL: process.env.REDIS_URL,
    ...overrides,
  });
}

beforeAll(async () => {
  healthy = await buildTestApp(envWith({}));
  dbDown = await buildTestApp(envWith({ DATABASE_URL: UNREACHABLE.DATABASE_URL }));
  redisDown = await buildTestApp(envWith({ REDIS_URL: UNREACHABLE.REDIS_URL }));
});

afterAll(async () => {
  await Promise.all([healthy.app.close(), dbDown.app.close(), redisDown.app.close()]);
});

const health = (t: TestApp) => t.app.inject({ method: 'GET', url: '/v1/health' });

describe('GET /v1/health against real PostgreSQL and Redis', () => {
  it('returns 200 ok when both are reachable, with no connection strings in the body', async () => {
    const res = await health(healthy);
    expect(res.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(res.json())).toEqual({
      status: 'ok',
      checks: { db: 'up', redis: 'up' },
    });
    expect(res.body).not.toMatch(/postgres|redis:|creatorchat|localhost/i);
  });

  it('reports only the database as down when PostgreSQL is unreachable', async () => {
    const res = await health(dbDown);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', checks: { db: 'down', redis: 'up' } });
  });

  it('reports only Redis as down when Redis is unreachable', async () => {
    const res = await health(redisDown);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', checks: { db: 'up', redis: 'down' } });
  });
});
