import { Body, Controller, Get, HttpCode, Inject, Patch, UseGuards } from '@nestjs/common';
import {
  ProfileAccountNotActiveError,
  type AuthenticatedUser,
  type ProfileService,
} from '@creatorchat/backend-core';
import {
  ErrorCode,
  UpdateProfileRequestSchema,
  type MeResponse,
  type UpdateProfileData,
  type UpdateProfileResponse,
} from '@creatorchat/contracts';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { CurrentUser, UserJwtGuard } from '../../common/auth/user-jwt.guard.js';
import { AppError } from '../../common/errors/app-error.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { PROFILE } from './tokens.js';

@Controller('me')
@UseGuards(UserJwtGuard, RolesGuard)
export class MeController {
  constructor(@Inject(PROFILE) private readonly profile: ProfileService) {}

  /** The account as the database sees it now: role and status never come from the token or client. */
  @Get()
  @Roles('USER', 'CREATOR')
  me(@CurrentUser() current: AuthenticatedUser): MeResponse {
    return current.user;
  }

  /**
   * Edits the caller's own profile (customers; the creator profile is its own story). There is no
   * user id anywhere in the request: the row comes from the session. Fields the schema does not
   * own (`id`, `role`, `telegram_id`, `username`, `status`, ...) are dropped by validation.
   */
  @Patch('profile')
  @HttpCode(200)
  @Roles('USER')
  async updateProfile(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateProfileRequestSchema)) body: UpdateProfileData,
  ): Promise<UpdateProfileResponse> {
    try {
      return await this.profile.updateOwnProfile(current.user.id, body);
    } catch (error) {
      // The account was blocked between the guard and the write: same answer as a dead session.
      if (error instanceof ProfileAccountNotActiveError) {
        throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Authentication is required.');
      }
      throw error;
    }
  }
}
