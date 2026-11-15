import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  LoginLimiterUnavailableError,
  type AdminAuthService,
  type ServerEnv,
} from '@creatorchat/backend-core';
import {
  ADMIN_COOKIE,
  AdminLoginRequestSchema,
  ErrorCode,
  type AdminLoginRequest,
  type AdminSessionResponse,
  type LoginFailureDetails,
  type LoginLockedDetails,
} from '@creatorchat/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AdminJwtGuard,
  CurrentAdmin,
  adminAuthUnavailable,
} from '../../common/auth/admin-jwt.guard.js';
import { CsrfGuard, SkipCsrfToken } from '../../common/auth/csrf.guard.js';
import { ADMIN_AUTH } from '../../common/auth/tokens.js';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../common/infra/tokens.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { AuthenticatedAdmin } from '@creatorchat/backend-core';
import { clearAdminCookies, setAdminCookies } from './admin-cookies.js';

@Controller('admin/auth')
@UseGuards(CsrfGuard)
export class AdminAuthController {
  constructor(
    @Inject(ADMIN_AUTH) private readonly auth: AdminAuthService | null,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  private service(): AdminAuthService {
    if (!this.auth) throw adminAuthUnavailable();
    return this.auth;
  }

  @Post('login')
  @HttpCode(200)
  @SkipCsrfToken()
  async login(
    @Body(new ZodValidationPipe(AdminLoginRequestSchema)) body: AdminLoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminSessionResponse> {
    const service = this.service();
    let outcome;
    try {
      outcome = await service.login(body, { requestId: request.id, ip: request.ip });
    } catch (error) {
      if (error instanceof LoginLimiterUnavailableError) throw adminAuthUnavailable();
      throw error;
    }

    if (outcome.ok) {
      setAdminCookies(reply, this.env, outcome.tokens);
      return { admin: outcome.admin };
    }
    if (outcome.reason === 'invalid') {
      const details: LoginFailureDetails = { attempts: outcome.attempts, max: 5 };
      throw new AppError(
        ErrorCode.INVALID_CREDENTIALS,
        401,
        'Invalid username or password.',
        details,
      );
    }
    const retryAfter = String(outcome.retryAfterSeconds);
    if (outcome.reason === 'locked') {
      const details: LoginLockedDetails = { retry_after_seconds: outcome.retryAfterSeconds };
      throw new AppError(ErrorCode.LOGIN_LOCKED, 429, 'Login is temporarily locked.', details, {
        'retry-after': retryAfter,
      });
    }
    throw new AppError(
      ErrorCode.RATE_LIMITED,
      429,
      'Too many requests. Please try again later.',
      undefined,
      { 'retry-after': retryAfter },
    );
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminSessionResponse> {
    const service = this.service();
    const token = request.cookies?.[ADMIN_COOKIE.refresh];
    const unauthenticated = new AppError(
      ErrorCode.UNAUTHENTICATED,
      401,
      'Authentication is required.',
    );
    if (!token) {
      clearAdminCookies(reply, this.env);
      throw unauthenticated;
    }
    const outcome = await service.refresh(token, { requestId: request.id, ip: request.ip });
    if (outcome.ok) {
      setAdminCookies(reply, this.env, outcome.tokens);
      return { admin: outcome.admin };
    }
    // A racing tab just rotated the token: its fresh cookies must not be cleared from under it.
    if (outcome.reason === 'invalid') clearAdminCookies(reply, this.env);
    throw unauthenticated;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const service = this.service();
    const accessToken = request.cookies?.[ADMIN_COOKIE.access];
    const refreshToken = request.cookies?.[ADMIN_COOKIE.refresh];
    const current = accessToken ? await service.authenticate(accessToken) : null;
    await service.logout(
      { sessionId: current?.sessionId, refreshToken },
      { requestId: request.id, ip: request.ip },
    );
    clearAdminCookies(reply, this.env);
  }

  @Get('me')
  @UseGuards(AdminJwtGuard)
  me(@CurrentAdmin() current: AuthenticatedAdmin): AdminSessionResponse {
    // Built from the database row the guard loaded, never from token claims.
    return { admin: current.admin };
  }
}
