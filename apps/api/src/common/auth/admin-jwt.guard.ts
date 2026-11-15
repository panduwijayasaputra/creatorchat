import {
  Inject,
  Injectable,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { AdminAuthService, AuthenticatedAdmin } from '@creatorchat/backend-core';
import { ADMIN_COOKIE, ErrorCode } from '@creatorchat/contracts';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import './request-admin.js';
import { ADMIN_AUTH } from './tokens.js';

export function adminAuthUnavailable(): AppError {
  return new AppError(
    ErrorCode.SERVICE_UNAVAILABLE,
    503,
    'The service is temporarily unavailable.',
  );
}

/**
 * The only guard for `/v1/admin/*`. It reads the access token from the admin cookie (never from an
 * Authorization header), verifies it, and checks the live session and admin status in the database,
 * so logout, revocation and disabling take effect on the very next request.
 */
@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(@Inject(ADMIN_AUTH) private readonly auth: AdminAuthService | null) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.auth) throw adminAuthUnavailable();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies?.[ADMIN_COOKIE.access];
    const session = token ? await this.auth.authenticate(token) : null;
    if (!session) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Authentication is required.');
    }
    request.admin = session;
    return true;
  }
}

/** The signed-in admin. Only valid on routes guarded by `AdminJwtGuard`. */
export const CurrentAdmin = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const admin = context.switchToHttp().getRequest<FastifyRequest>().admin;
  if (!admin) throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Authentication is required.');
  return admin;
});

export type CurrentAdminValue = AuthenticatedAdmin;
