import type { Type } from '@nestjs/common';
import fastifyCookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { REDACT_PATHS, type ServerEnv } from '@creatorchat/backend-core';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { resolveRequestId } from './common/request-id/request-id.js';

const BODY_LIMIT_BYTES = 1024 * 1024; // 1 MiB; media uploads use presigned URLs, not this API.
/** Responses under these paths carry or reveal session state and are never cached. */
const NO_STORE_PREFIXES = ['/v1/admin', '/v1/auth', '/v1/me', '/v1/creator', '/v1/telegram'];

export interface CreateAppOptions {
  /** Where pino writes; defaults to stdout. Tests pass a capturing stream. */
  logStream?: NodeJS.WritableStream;
  /** Extra Nest modules; used only by tests to mount throwaway routes. */
  extraModules?: Type[];
}

export async function createApp(
  env: ServerEnv,
  options: CreateAppOptions = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: false,
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) =>
      resolveRequestId(req.headers['x-request-id']),
    logger: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      // Only method + path (no query string, headers or body) are logged for requests.
      serializers: {
        req: (req: { method: string; url: string }) => ({
          method: req.method,
          path: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(env, options.extraModules),
    adapter,
    {
      logger: ['error', 'warn'],
    },
  );

  await app.register(fastifyCookie);
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  // Explicit allowlist, no wildcard. An empty list allows no cross-origin browser calls.
  app.enableCors({ origin: env.ALLOWED_ORIGINS, credentials: true });
  adapter.getInstance().addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    // Auth state must never be cached by a browser or proxy.
    if (NO_STORE_PREFIXES.some((prefix) => request.url.startsWith(prefix))) {
      reply.header('cache-control', 'no-store');
    }
  });
  app.enableShutdownHooks();

  return app;
}
