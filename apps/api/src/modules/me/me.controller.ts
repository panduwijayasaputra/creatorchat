import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '@creatorchat/backend-core';
import type { MeResponse } from '@creatorchat/contracts';
import { CurrentUser, UserJwtGuard } from '../../common/auth/user-jwt.guard.js';

@Controller('me')
@UseGuards(UserJwtGuard)
export class MeController {
  /** The account as the database sees it now: role and status never come from the token or client. */
  @Get()
  me(@CurrentUser() current: AuthenticatedUser): MeResponse {
    return current.user;
  }
}
