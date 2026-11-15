import { timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ServerEnv } from '@creatorchat/backend-core';
import { ADMIN_COOKIE, ADMIN_CSRF_HEADER, ErrorCode } from '@creatorchat/contracts';
import type { FastifyRequest } from 'fastify';
import { ENV } from '../infra/tokens.js';
import { AppError } from '../errors/app-error.js';

const SKIP_CSRF_TOKEN = 'admin:skip-csrf-token';

/**
 * Marks a route that has no session yet (login), so there is no CSRF cookie to compare.
 * The Origin allowlist still applies to it.
 */
export const SkipCsrfToken = () => SetMetadata(SKIP_CSRF_TOKEN, true);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sameValue(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * CSRF defence for cookie-authenticated admin routes: every unsafe request must come from an
 * allowed Origin and (except login) echo the CSRF cookie in `X-CSRF-Token` (double-submit).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method)) return true;

    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !this.env.ALLOWED_ORIGINS.includes(origin)) {
      throw this.failure();
    }

    const skipToken = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_TOKEN, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipToken) return true;

    const header = request.headers[ADMIN_CSRF_HEADER];
    const cookie = request.cookies?.[ADMIN_COOKIE.csrf];
    if (typeof header !== 'string' || !cookie || !sameValue(header, cookie)) throw this.failure();
    return true;
  }

  private failure(): AppError {
    return new AppError(ErrorCode.CSRF_FAILED, 403, 'The request could not be verified.');
  }
}
