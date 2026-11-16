import { Body, Controller, Get, HttpCode, Inject, Patch, UseGuards } from '@nestjs/common';
import {
  ProfileAccountNotActiveError,
  buildBioLink,
  type AuthenticatedUser,
  type CreatorSettingsService,
  type ProfileService,
  type ServerEnv,
} from '@creatorchat/backend-core';
import {
  ErrorCode,
  UpdateProfileRequestSchema,
  UpdateTimezoneRequestSchema,
  type CreatorSettingsResponse,
  type UpdateProfileData,
  type UpdateProfileResponse,
  type UpdateTimezoneRequest,
  type UpdateTimezoneResponse,
} from '@creatorchat/contracts';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { CurrentUser, UserJwtGuard } from '../../common/auth/user-jwt.guard.js';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../common/infra/tokens.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { CREATOR_PROFILE, CREATOR_SETTINGS } from './tokens.js';

/** Creator-only routes. There is no creator or user id in any request: the row comes from the session. */
@Controller('creator')
@UseGuards(UserJwtGuard, RolesGuard)
export class CreatorController {
  constructor(
    @Inject(CREATOR_SETTINGS) private readonly settings: CreatorSettingsService,
    @Inject(CREATOR_PROFILE) private readonly profile: ProfileService,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  @Get('settings')
  @Roles('CREATOR')
  async getSettings(@CurrentUser() current: AuthenticatedUser): Promise<CreatorSettingsResponse> {
    const found = await this.settings.get(current.user.id);
    if (!found) throw new AppError(ErrorCode.FORBIDDEN, 403, 'Creator profile is not available.');
    return {
      profile: found.profile,
      public_code: found.publicCode,
      bio_link: buildBioLink(this.env.TELEGRAM_BOT_USERNAME, found.publicCode),
    };
  }

  /** Same rules as the customer edit; fields the schema does not own are dropped by validation. */
  @Patch('profile')
  @HttpCode(200)
  @Roles('CREATOR')
  async updateProfile(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateProfileRequestSchema)) body: UpdateProfileData,
  ): Promise<UpdateProfileResponse> {
    try {
      return await this.profile.updateOwnProfile(current.user.id, body, 'CREATOR');
    } catch (error) {
      // Blocked, role changed or creator row blocked between the guard and the write.
      if (error instanceof ProfileAccountNotActiveError) {
        throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Authentication is required.');
      }
      throw error;
    }
  }

  /**
   * Display timezone only: stored timestamps stay UTC. The zone must be one of the allowed ids
   * (contract schema); other keys in the body are dropped.
   */
  @Patch('timezone')
  @HttpCode(200)
  @Roles('CREATOR')
  async updateTimezone(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateTimezoneRequestSchema)) body: UpdateTimezoneRequest,
  ): Promise<UpdateTimezoneResponse> {
    try {
      return await this.profile.updateOwnTimezone(current.user.id, body.timezone, 'CREATOR');
    } catch (error) {
      if (error instanceof ProfileAccountNotActiveError) {
        throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Authentication is required.');
      }
      throw error;
    }
  }
}
