import { Module } from '@nestjs/common';
import {
  FixedWindowLimiter,
  UserAuthService,
  isUserAuthConfigured,
  type ServerEnv,
} from '@creatorchat/backend-core';
import { USER_AUTH } from '../../common/auth/tokens.js';
import { UserJwtGuard } from '../../common/auth/user-jwt.guard.js';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { RedisService } from '../../common/infra/redis.service.js';
import { ENV } from '../../common/infra/tokens.js';
import { AuthController } from './auth.controller.js';

/**
 * Mini App (Telegram) login plus the `UserJwtGuard` every user endpoint uses. Other modules import
 * this module to protect their controllers.
 */
@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: USER_AUTH,
      inject: [ENV, PrismaService, RedisService],
      useFactory: (env: ServerEnv, prisma: PrismaService, redis: RedisService) => {
        const secrets = {
          botToken: env.TELEGRAM_BOT_TOKEN,
          sessionSecret: env.USER_SESSION_SECRET,
        };
        // Without a bot token / secret the API still boots (health keeps working); login answers 503.
        if (!isUserAuthConfigured(secrets)) return null;
        return new UserAuthService({
          prisma: prisma.client,
          // Tests share the dev Redis, so their counters live under their own prefix.
          limiter: new FixedWindowLimiter(
            redis.client,
            env.NODE_ENV === 'test' ? 'test:user:login' : 'user:login',
          ),
          config: {
            ...secrets,
            maxAgeSeconds: env.TELEGRAM_INITDATA_MAX_AGE_SECONDS,
          },
        });
      },
    },
    UserJwtGuard,
  ],
  exports: [USER_AUTH, UserJwtGuard],
})
export class AuthModule {}
