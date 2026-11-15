import { Module } from '@nestjs/common';
import {
  AdminAuthService,
  LoginLimiter,
  isAdminAuthConfigured,
  type ServerEnv,
} from '@creatorchat/backend-core';
import { AdminJwtGuard } from '../../common/auth/admin-jwt.guard.js';
import { CsrfGuard } from '../../common/auth/csrf.guard.js';
import { ADMIN_AUTH } from '../../common/auth/tokens.js';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { RedisService } from '../../common/infra/redis.service.js';
import { ENV } from '../../common/infra/tokens.js';
import { AdminAuthController } from './admin-auth.controller.js';

/**
 * Provides the admin auth service plus the two guards every admin controller uses
 * (`CsrfGuard`, `AdminJwtGuard`). Other admin modules import this module.
 */
@Module({
  controllers: [AdminAuthController],
  providers: [
    {
      provide: ADMIN_AUTH,
      inject: [ENV, PrismaService, RedisService],
      useFactory: (env: ServerEnv, prisma: PrismaService, redis: RedisService) => {
        const secrets = {
          accessSecret: env.ADMIN_ACCESS_TOKEN_SECRET,
          refreshSecret: env.ADMIN_REFRESH_TOKEN_SECRET,
        };
        // Without usable secrets the API still boots (health keeps working); admin auth answers 503.
        if (!isAdminAuthConfigured(secrets)) return null;
        return new AdminAuthService({
          prisma: prisma.client,
          // Tests share the dev Redis, so their counters live under their own prefix.
          limiter: new LoginLimiter(
            redis.client,
            env.NODE_ENV === 'test' ? 'test:admin:login' : 'admin:login',
          ),
          config: secrets,
        });
      },
    },
    AdminJwtGuard,
    CsrfGuard,
  ],
  exports: [ADMIN_AUTH, AdminJwtGuard, CsrfGuard],
})
export class AdminAuthModule {}
