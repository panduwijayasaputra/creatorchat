import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ErrorCode } from '@creatorchat/contracts';
import { webhookCallback, type Bot } from 'grammy';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../common/errors/app-error.js';
import { TELEGRAM_BOT } from './tokens.js';

/** Full path (including the global `/v1` prefix); the secret hook in the module matches on it. */
export const WEBHOOK_PATH = '/v1/telegram/webhook';

/** Updates are answered within a few seconds; Telegram retries slow webhooks, so never wait long. */
const HANDLER_TIMEOUT_MS = 5000;

@Controller('telegram')
export class TelegramWebhookController {
  private readonly handle: ((request: FastifyRequest, reply: FastifyReply) => Promise<void>) | null;

  constructor(@Inject(TELEGRAM_BOT) bot: Bot | null) {
    this.handle = bot
      ? webhookCallback(bot, 'fastify', {
          onTimeout: 'return',
          timeoutMilliseconds: HANDLER_TIMEOUT_MS,
        })
      : null;
  }

  /**
   * Public: authenticated only by the secret header, which the module's `onRequest` hook has already
   * verified before the body was parsed. Unsupported updates get a 200 with no reply so Telegram
   * does not retry them.
   */
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    if (!this.handle) {
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        503,
        'The service is temporarily unavailable.',
      );
    }
    await this.handle(request, reply);
  }
}
