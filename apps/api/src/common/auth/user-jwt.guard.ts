import {
  Inject,
  Injectable,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthenticatedUser, UserAuthService } from '@creatorchat/backend-core';
import { ErrorCode } from '@creatorchat/contracts';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import './request-user.js';
import { USER_AUTH } from './tokens.js';

export function userAuthUnavailable(): AppError {
  return new AppError(
    ErrorCode.SERVICE_UNAVAILABLE,
    503,
    'The service is temporarily unavailable.',
  );
}

const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

/**
 * Guard for the Mini App's user API. It reads only the `Authorization: Bearer` header (never a
 * cookie, so the admin cookies cannot authenticate here) and re-checks the live session, the
 * account status and `session_version` in the database on every request.
 */
@Injectable()
export class UserJwtGuard implements CanActivate {
  constructor(@Inject(USER_AUTH) private readonly auth: UserAuthService | null) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.auth) throw userAuthUnavailable();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    const token = typeof header === 'string' ? BEARER.exec(header)?.[1] : undefined;
    const session = token ? await this.auth.authenticate(token) : null;
    if (!session) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Authentication is required.');
    }
    request.user = session;
    return true;
  }
}

/** The signed-in user. Only valid on routes guarded by `UserJwtGuard`. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<FastifyRequest>().user;
  if (!user) throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Authentication is required.');
  return user;
});

export type CurrentUserValue = AuthenticatedUser;
