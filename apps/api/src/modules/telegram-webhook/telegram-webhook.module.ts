import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { isTelegramWebhookConfigured, type ServerEnv } from '@creatorchat/backend-core';
import { ErrorCode } from '@creatorchat/contracts';
import type { Bot } from 'grammy';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { ENV } from '../../common/infra/tokens.js';
import { createTelegramBot } from './telegram-bot.factory.js';
import { TELEGRAM_BOT, TELEGRAM_WEBHOOK_SECRET } from './tokens.js';
import { TelegramWebhookController, WEBHOOK_PATH } from './telegram-webhook.controller.js';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/** Constant-time comparison. Hashing first makes the length irrelevant. */
export function secretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string') return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function reject(request: FastifyRequest, reply: FastifyReply, status: 401 | 503): FastifyReply {
  return reply.code(status).send({
    code: status === 401 ? ErrorCode.UNAUTHENTICATED : ErrorCode.SERVICE_UNAVAILABLE,
    message:
      status === 401 ? 'Authentication is required.' : 'The service is temporarily unavailable.',
    request_id: request.id,
  });
}

/**
 * Telegram bot webhook (US-005). The secret header is checked in an `onRequest` hook, i.e. before
 * the body is read or parsed. With the bot, secret or Mini App URL unconfigured the route answers
 * 503 while the rest of the API still boots.
 */
@Module({
  controllers: [TelegramWebhookController],
  providers: [
    {
      provide: TELEGRAM_WEBHOOK_SECRET,
      inject: [ENV],
      useFactory: (env: ServerEnv): string | null =>
        isTelegramWebhookConfigured(env) ? (env.TELEGRAM_WEBHOOK_SECRET ?? null) : null,
    },
    {
      provide: TELEGRAM_BOT,
      inject: [ENV, PrismaService],
      useFactory: (env: ServerEnv, prisma: PrismaService): Bot | null => {
        if (!isTelegramWebhookConfigured(env)) return null;
        const logger = new Logger('TelegramWebhook');
        return createTelegramBot({
          token: env.TELEGRAM_BOT_TOKEN as string,
          username: env.TELEGRAM_BOT_USERNAME as string,
          miniAppUrl: env.MINIAPP_URL as string,
          // Tests point the bot at a fake Bot API through the environment-free seam below.
          ...(env.NODE_ENV === 'test' && process.env.TEST_BOT_API_ROOT
            ? { apiRoot: process.env.TEST_BOT_API_ROOT }
            : {}),
          // /start proves the user can receive bot messages again: clear a recorded block.
          onStart: async (telegramId) => {
            await prisma.client.user.updateMany({
              where: { telegramId, botBlockedAt: { not: null } },
              data: { botBlockedAt: null },
            });
          },
          onError: (name) => logger.error(`update handler failed: ${name}`),
        });
      },
    },
  ],
})
export class TelegramWebhookModule implements OnModuleInit {
  constructor(
    @Inject(HttpAdapterHost) private readonly host: HttpAdapterHost,
    @Inject(TELEGRAM_WEBHOOK_SECRET) private readonly secret: string | null,
  ) {}

  onModuleInit(): void {
    const fastify = this.host.httpAdapter.getInstance() as FastifyInstance;
    const secret = this.secret;
    fastify.addHook('onRequest', async (request, reply) => {
      if (request.method !== 'POST' || request.url.split('?')[0] !== WEBHOOK_PATH) return;
      if (secret === null) return reject(request, reply, 503);
      if (!secretMatches(request.headers[SECRET_HEADER], secret)) {
        return reject(request, reply, 401);
      }
      return undefined;
    });
  }
}
