import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import type { CreatorLinkService } from '@creatorchat/backend-core';
import { ErrorCode, type CreatorLinkResponse } from '@creatorchat/contracts';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { UserJwtGuard } from '../../common/auth/user-jwt.guard.js';
import { AppError } from '../../common/errors/app-error.js';
import { CREATOR_LINKS } from './tokens.js';

@Controller('creators')
@UseGuards(UserJwtGuard, RolesGuard)
export class CreatorsController {
  constructor(@Inject(CREATOR_LINKS) private readonly links: CreatorLinkService) {}

  /**
   * Resolves a creator deep-link code after login. Customers only (`@Roles('USER')`, enforced by
   * `RolesGuard` from the live account). Unknown, malformed, blocked and inactive creators all give
   * the same 404, and the response holds no ids, status or media.
   */
  @Get('by-code/:publicCode')
  @Roles('USER')
  async byCode(@Param('publicCode') publicCode: string): Promise<CreatorLinkResponse> {
    const outcome = await this.links.resolve({ code: publicCode });
    if (outcome.kind === 'not_found') {
      throw new AppError(ErrorCode.CREATOR_NOT_FOUND, 404, 'This creator is not available.');
    }
    return {
      public_code: outcome.creator.publicCode,
      display_name: outcome.creator.displayName,
      avatar_url: outcome.creator.avatarUrl,
    };
  }
}
