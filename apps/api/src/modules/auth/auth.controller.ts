import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { RateLimiterUnavailableError, type UserAuthService } from '@creatorchat/backend-core';
import {
  ErrorCode,
  TelegramLoginRequestSchema,
  USER_SESSION_TTL_SECONDS,
  type TelegramLoginRequest,
  type TelegramLoginResponse,
} from '@creatorchat/contracts';
import type { FastifyRequest } from 'fastify';
import { USER_AUTH } from '../../common/auth/tokens.js';
import { userAuthUnavailable } from '../../common/auth/user-jwt.guard.js';
import { AppError } from '../../common/errors/app-error.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(USER_AUTH) private readonly auth: UserAuthService | null) {}

  /** Public. The only thing trusted from the client is Telegram's signed `init_data`. */
  @Post('telegram')
  @HttpCode(200)
  async telegram(
    @Body(new ZodValidationPipe(TelegramLoginRequestSchema)) body: TelegramLoginRequest,
    @Req() request: FastifyRequest,
  ): Promise<TelegramLoginResponse> {
    if (!this.auth) throw userAuthUnavailable();
    let outcome;
    try {
      outcome = await this.auth.loginWithTelegram(
        { initData: body.init_data },
        { requestId: request.id, ip: request.ip },
      );
    } catch (error) {
      if (error instanceof RateLimiterUnavailableError) throw userAuthUnavailable();
      throw error;
    }

    switch (outcome.kind) {
      case 'ok':
        return {
          access_token: outcome.accessToken,
          token_type: 'Bearer',
          expires_in: outcome.expiresIn || USER_SESSION_TTL_SECONDS,
          user: outcome.user,
        };
      case 'expired':
        throw new AppError(
          ErrorCode.TELEGRAM_AUTH_EXPIRED,
          401,
          'The Telegram session has expired.',
        );
      case 'blocked':
        throw new AppError(ErrorCode.ACCOUNT_BLOCKED, 403, 'This account cannot sign in.');
      case 'rate_limited':
        throw new AppError(
          ErrorCode.RATE_LIMITED,
          429,
          'Too many requests. Please try again later.',
          undefined,
          { 'retry-after': String(outcome.retryAfterSeconds) },
        );
      case 'invalid':
        throw new AppError(ErrorCode.TELEGRAM_AUTH_INVALID, 401, 'Telegram data is not valid.');
    }
  }
}
