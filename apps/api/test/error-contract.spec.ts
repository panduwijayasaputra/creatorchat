import { Body, Controller, Get, Module, Post, UsePipes } from '@nestjs/common';
import { ErrorCode, ErrorResponseSchema } from '@creatorchat/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../src/common/errors/app-error.js';
import { ZodValidationPipe } from '../src/common/validation/zod-validation.pipe.js';
import { buildTestApp, testEnv, type TestApp } from './helpers.js';

const Payload = z.object({ name: z.string().min(2), age: z.number().int() });

@Controller('test-support')
class TestSupportController {
  @Get('boom')
  boom(): never {
    throw new Error('database password is hunter2 at host secret.internal');
  }

  @Get('forbidden')
  forbidden(): never {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'You are not allowed to do this.');
  }

  @Post('validate')
  @UsePipes(new ZodValidationPipe(Payload))
  validate(@Body() body: z.infer<typeof Payload>) {
    return body;
  }

  @Post('echo')
  echo(@Body() body: unknown) {
    return { received: typeof body };
  }
}

@Module({ controllers: [TestSupportController] })
class TestSupportModule {}

let t: TestApp;

beforeAll(async () => {
  t = await buildTestApp(testEnv(), [TestSupportModule]);
});

afterAll(async () => {
  await t.app.close();
});

const get = (url: string, headers: Record<string, string> = {}) =>
  t.app.inject({ method: 'GET', url, headers });

describe('error contract', () => {
  it('returns NOT_FOUND with request_id equal to the x-request-id header for unknown routes', async () => {
    const res = await get('/v1/nope');
    expect(res.statusCode).toBe(404);
    const body = ErrorResponseSchema.parse(res.json());
    expect(body.code).toBe('NOT_FOUND');
    expect(body.request_id).toBe(res.headers['x-request-id']);
  });

  it('maps AppError to its code and status', async () => {
    const res = await get('/v1/test-support/forbidden');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('returns a generic INTERNAL_ERROR for unexpected errors, without stack or message text', async () => {
    const res = await get('/v1/test-support/boom');
    expect(res.statusCode).toBe(500);
    const body = ErrorResponseSchema.parse(res.json());
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toMatch(/hunter2|secret\.internal|at .*\.ts|stack/);
  });

  it('logs the unexpected error with the same request id that the client received', async () => {
    const res = await get('/v1/test-support/boom', { 'x-request-id': 'trace-abc-12345' });
    expect(res.json().request_id).toBe('trace-abc-12345');
    const line = t.logs().find((l) => l.msg === 'unhandled error' && l.reqId === 'trace-abc-12345');
    expect(line).toBeDefined();
  });

  it('returns VALIDATION_FAILED with field paths but without echoing input values', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/test-support/validate',
      payload: { name: 'x', age: 'sensitive-input-value' },
    });
    expect(res.statusCode).toBe(400);
    const body = ErrorResponseSchema.parse(res.json());
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(body.details)).toContain('name');
    expect(res.body).not.toContain('sensitive-input-value');
  });

  it('accepts valid input through the validation pipe', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/test-support/validate',
      payload: { name: 'Salsa', age: 20 },
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 in the error contract for malformed JSON', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/test-support/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken": ',
    });
    expect(res.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('VALIDATION_FAILED');
  });

  it('returns 413 PAYLOAD_TOO_LARGE above the body limit', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/test-support/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ blob: 'x'.repeat(1024 * 1024 + 10) }),
    });
    expect(res.statusCode).toBe(413);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('request id', () => {
  it('echoes a safe inbound x-request-id', async () => {
    const res = await get('/v1/nope', { 'x-request-id': 'client-req-0001' });
    expect(res.headers['x-request-id']).toBe('client-req-0001');
  });

  it.each(['short', 'has spaces in it!!', 'x'.repeat(200), 'inj\u0000ect-1234'])(
    'replaces an unsafe inbound x-request-id (%#)',
    async (bad) => {
      const res = await get('/v1/nope', { 'x-request-id': bad });
      const id = String(res.headers['x-request-id']);
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it('puts the request id on request log lines', async () => {
    await get('/v1/nope', { 'x-request-id': 'logged-req-0001' });
    const lines = t.logs().filter((l) => l.reqId === 'logged-req-0001');
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe('log hygiene', () => {
  it('never logs authorization, cookies, request bodies, query strings or initData', async () => {
    await t.app.inject({
      method: 'POST',
      url: '/v1/test-support/echo?initData=query-secret-xyz',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer top-secret-token',
        cookie: 'session=cookie-secret-value',
        'x-telegram-bot-api-secret-token': 'webhook-secret-value',
      },
      payload: { initData: 'raw-init-data-abc', password: 'hunter2', message: 'private chat text' },
    });
    const raw = t.rawLogs();
    for (const leaked of [
      'top-secret-token',
      'cookie-secret-value',
      'webhook-secret-value',
      'query-secret-xyz',
      'raw-init-data-abc',
      'hunter2',
      'private chat text',
    ]) {
      expect(raw, leaked).not.toContain(leaked);
    }
  });
});

describe('CORS', () => {
  it('allows an allowlisted origin', async () => {
    const res = await get('/v1/nope', { origin: 'http://localhost:5173' });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('does not allow other origins', async () => {
    const res = await get('/v1/nope', { origin: 'https://evil.example' });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
