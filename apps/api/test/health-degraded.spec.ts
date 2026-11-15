import { HealthResponseSchema } from '@creatorchat/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, testEnv, type TestApp } from './helpers.js';

let t: TestApp;

beforeAll(async () => {
  // Nothing listens on the configured DB/Redis ports.
  t = await buildTestApp(testEnv());
});

afterAll(async () => {
  await t.app.close();
});

describe('GET /v1/health when dependencies are down', () => {
  it('returns 503 degraded with both checks down and leaks no connection details', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(503);
    expect(HealthResponseSchema.parse(res.json())).toEqual({
      status: 'degraded',
      checks: { db: 'down', redis: 'down' },
    });
    expect(res.body).not.toMatch(/127\.0\.0\.1|nopass|nobody|ECONNREFUSED|postgres|redis:\/\//i);
  });

  it('does not require authentication', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).not.toBe(401);
  });
});
