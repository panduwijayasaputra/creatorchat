import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, type UserRole } from '@creatorchat/contracts';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import './request-user.js';
import { ROLES_KEY } from './roles.decorator.js';

export function forbiddenRole(): AppError {
  return new AppError(
    ErrorCode.FORBIDDEN_ROLE,
    403,
    'This action is not available for your account.',
  );
}

/**
 * Runs after `UserJwtGuard` (`@UseGuards(UserJwtGuard, RolesGuard)`). The role compared is the one
 * the guard just read from the account row, never anything the client sent. A route without a
 * `@Roles()` declaration is refused (fail closed).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const user = context.switchToHttp().getRequest<FastifyRequest>().user;
    if (!allowed || allowed.length === 0 || !user || !allowed.includes(user.role)) {
      throw forbiddenRole();
    }
    return true;
  }
}
