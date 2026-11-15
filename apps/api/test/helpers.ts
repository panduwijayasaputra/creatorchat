import { Writable } from 'node:stream';
import { loadEnv, type ServerEnv } from '@creatorchat/backend-core';
import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory.js';

/** Nothing listens on port 1, so connections are refused immediately. */
export const UNREACHABLE = {
  DATABASE_URL: 'postgresql://nobody:nopass@127.0.0.1:1/none',
  REDIS_URL: 'redis://127.0.0.1:1',
};

export function testEnv(overrides: Record<string, string> = {}): ServerEnv {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ...UNREACHABLE,
    ...overrides,
  });
}

export interface TestApp {
  app: NestFastifyApplication;
  /** Parsed JSON log lines written so far. */
  logs: () => Record<string, unknown>[];
  /** Raw log text, for "must not contain" assertions. */
  rawLogs: () => string;
}

export async function buildTestApp(
  env: ServerEnv = testEnv(),
  extraModules: Type[] = [],
): Promise<TestApp> {
  let raw = '';
  const logStream = new Writable({
    write(chunk, _encoding, callback) {
      raw += String(chunk);
      callback();
    },
  });
  const app = await createApp(env, { logStream, extraModules });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    rawLogs: () => raw,
    logs: () =>
      raw
        .split('\n')
        .filter((l) => l.trim().startsWith('{'))
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}
