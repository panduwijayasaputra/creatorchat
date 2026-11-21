import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser, NotificationPreferencesService } from '@creatorchat/backend-core';
import {
  ErrorCode,
  UpdateNotificationPreferencesBodySchema,
  type MuteResponse,
  type NotificationPreferencesResponse,
  type UpdateNotificationPreferencesBody,
} from '@creatorchat/contracts';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { CurrentUser, UserJwtGuard } from '../../common/auth/user-jwt.guard.js';
import { AppError } from '../../common/errors/app-error.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { NOTIFICATION_PREFERENCES } from './tokens.js';

/** Unknown, malformed, blocked and unrelated creators all look the same. */
const creatorNotFound = () =>
  new AppError(ErrorCode.CREATOR_NOT_FOUND, 404, 'This creator is not available.');

/**
 * The customer's Telegram notification choices and per-creator mute (US-043). Customers only; the
 * user comes from the session and no request carries a user id, so only the caller's own rows are
 * ever read or written. The bot reads the same rows (US-042); access notifications ignore them.
 */
@Controller()
@UseGuards(UserJwtGuard, RolesGuard)
export class NotificationsController {
  constructor(
    @Inject(NOTIFICATION_PREFERENCES) private readonly preferences: NotificationPreferencesService,
  ) {}

  @Get('me/notification-preferences')
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async get(@CurrentUser() current: AuthenticatedUser): Promise<NotificationPreferencesResponse> {
    const p = await this.preferences.get(current.user.id);
    return { messages_enabled: p.messagesEnabled, show_content: p.showContent };
  }

  /** Only the named switches change; the answer is the whole new state. */
  @Patch('me/notification-preferences')
  @HttpCode(200)
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async update(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateNotificationPreferencesBodySchema))
    body: UpdateNotificationPreferencesBody,
  ): Promise<NotificationPreferencesResponse> {
    const p = await this.preferences.update(current.user.id, {
      messagesEnabled: body.messages_enabled,
      showContent: body.show_content,
    });
    return { messages_enabled: p.messagesEnabled, show_content: p.showContent };
  }

  @Put('creators/by-code/:publicCode/mute')
  @HttpCode(200)
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async mute(
    @CurrentUser() current: AuthenticatedUser,
    @Param('publicCode') publicCode: string,
  ): Promise<MuteResponse> {
    if ((await this.preferences.mute(current.user.id, publicCode)) === 'not_found') {
      throw creatorNotFound();
    }
    return { muted: true };
  }

  @Delete('creators/by-code/:publicCode/mute')
  @HttpCode(200)
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async unmute(
    @CurrentUser() current: AuthenticatedUser,
    @Param('publicCode') publicCode: string,
  ): Promise<MuteResponse> {
    if ((await this.preferences.unmute(current.user.id, publicCode)) === 'not_found') {
      throw creatorNotFound();
    }
    return { muted: false };
  }
}
