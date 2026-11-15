import { Controller, Get, Inject, Module, Param, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '@creatorchat/backend-core';
import { ErrorCode } from '@creatorchat/contracts';
import { Roles } from '../../src/common/auth/roles.decorator.js';
import { RolesGuard } from '../../src/common/auth/roles.guard.js';
import { CurrentUser, UserJwtGuard } from '../../src/common/auth/user-jwt.guard.js';
import { AppError } from '../../src/common/errors/app-error.js';
import { PrismaService } from '../../src/common/infra/prisma.service.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * TEST-ONLY routes (registered through `buildTestApp(env, [EnforcementFixturesModule])`, never in
 * `AppModule`). They demonstrate the two patterns every later user endpoint must follow: declare
 * roles, and scope an ID lookup by the current user so another user's ID is a plain 404.
 */
@Controller('_test')
@UseGuards(UserJwtGuard, RolesGuard)
class EnforcementFixturesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('whoami')
  @Roles('USER', 'CREATOR')
  whoami(@CurrentUser() current: AuthenticatedUser) {
    return { id: current.user.id, role: current.role };
  }

  @Get('user-only')
  @Roles('USER')
  userOnly() {
    return { ok: true };
  }

  @Get('creator-only')
  @Roles('CREATOR')
  creatorOnly() {
    return { ok: true };
  }

  /** The owned-resource pattern: the lookup is scoped by the session's user. */
  @Get('owned/:id')
  @Roles('USER', 'CREATOR')
  async owned(@Param('id') id: string, @CurrentUser() current: AuthenticatedUser) {
    const row = UUID.test(id)
      ? await this.prisma.client.session.findFirst({
          where: { id, userId: current.user.id },
          select: { id: true },
        })
      : null;
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 404, 'Not found.');
    return { id: row.id };
  }
}

@Module({ imports: [AuthModule], controllers: [EnforcementFixturesController] })
export class EnforcementFixturesModule {}
