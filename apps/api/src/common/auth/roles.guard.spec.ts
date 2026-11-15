import { Controller, Get, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

@Roles('USER')
@Controller('x')
class ClassLevel {
  @Get('a')
  plain() {
    return 1;
  }

  @Get('b')
  @Roles('CREATOR')
  override() {
    return 2;
  }
}

@Controller('y')
class Undeclared {
  @Get()
  nothing() {
    return 3;
  }
}

function context(
  target: new () => object,
  method: string,
  role: 'USER' | 'CREATOR' | null,
): ExecutionContext {
  const handler = (target.prototype as Record<string, () => unknown>)[method] as () => unknown;
  return {
    getHandler: () => handler,
    getClass: () => target,
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
  } as unknown as ExecutionContext;
}

const guard = new RolesGuard(new Reflector());

function code(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof AppError ? `${error.httpStatus} ${error.code}` : String(error);
  }
}

describe('RolesGuard', () => {
  it('lets an allowed role through', () => {
    expect(guard.canActivate(context(ClassLevel, 'plain', 'USER'))).toBe(true);
  });

  it('answers 403 FORBIDDEN_ROLE to another role', () => {
    expect(code(() => guard.canActivate(context(ClassLevel, 'plain', 'CREATOR')))).toBe(
      '403 FORBIDDEN_ROLE',
    );
  });

  it('lets handler metadata override the class', () => {
    expect(guard.canActivate(context(ClassLevel, 'override', 'CREATOR'))).toBe(true);
    expect(code(() => guard.canActivate(context(ClassLevel, 'override', 'USER')))).toBe(
      '403 FORBIDDEN_ROLE',
    );
  });

  it('fails closed on a route without a declaration', () => {
    expect(code(() => guard.canActivate(context(Undeclared, 'nothing', 'USER')))).toBe(
      '403 FORBIDDEN_ROLE',
    );
  });

  it('refuses when no user was set by the authentication guard', () => {
    expect(code(() => guard.canActivate(context(ClassLevel, 'plain', null)))).toBe(
      '403 FORBIDDEN_ROLE',
    );
  });
});
