import { Body, Controller, Get, Header, HttpCode, Inject, Put, UseGuards } from '@nestjs/common';
import type {
  AuthenticatedUser,
  WelcomeMessage,
  WelcomeMessageService,
} from '@creatorchat/backend-core';
import {
  ErrorCode,
  SaveWelcomeMessageBodySchema,
  type SaveWelcomeMessageBody,
  type WelcomeMessageResponse,
} from '@creatorchat/contracts';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { CurrentUser, UserJwtGuard } from '../../common/auth/user-jwt.guard.js';
import { AppError } from '../../common/errors/app-error.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { CREATOR_WELCOME } from './tokens.js';

const toJson = (w: WelcomeMessage): WelcomeMessageResponse => ({
  enabled: w.enabled,
  body: w.body,
  media: w.media
    ? {
        asset_id: w.media.assetId,
        kind: w.media.kind,
        source: w.media.source,
        duration_seconds: w.media.durationSeconds,
        thumbnail_url: w.media.thumbnailUrl,
      }
    : null,
});

/**
 * The creator's welcome message (US-040). Creators only; the creator comes from the session and the
 * only id in a request is the media asset, which is looked up scoped to that creator. `PUT`
 * replaces the whole state, so a retry changes nothing. Delivery to subscribers is US-041.
 */
@Controller('creator/welcome-message')
@UseGuards(UserJwtGuard, RolesGuard)
export class CreatorWelcomeController {
  constructor(@Inject(CREATOR_WELCOME) private readonly welcome: WelcomeMessageService) {}

  @Get()
  @Roles('CREATOR')
  @Header('Cache-Control', 'no-store')
  async get(@CurrentUser() current: AuthenticatedUser): Promise<WelcomeMessageResponse> {
    const outcome = await this.welcome.get(current.user.id);
    if (outcome.kind === 'not_found') throw new AppError(ErrorCode.NOT_FOUND, 404, 'Not found.');
    return toJson(outcome.welcome);
  }

  @Put()
  @HttpCode(200)
  @Roles('CREATOR')
  @Header('Cache-Control', 'no-store')
  async save(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodValidationPipe(SaveWelcomeMessageBodySchema)) body: SaveWelcomeMessageBody,
  ): Promise<WelcomeMessageResponse> {
    const outcome = await this.welcome.save(current.user.id, {
      enabled: body.enabled,
      body: body.body,
      assetId: body.asset_id,
    });
    switch (outcome.kind) {
      case 'not_found':
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Not found.');
      case 'media_not_found':
        throw new AppError(ErrorCode.MEDIA_NOT_FOUND, 404, 'Not found.');
      case 'media_not_ready':
        throw new AppError(ErrorCode.MEDIA_NOT_READY, 409, 'The file is still being processed.');
      case 'invalid':
        throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'Invalid welcome message.');
      default:
        return toJson(outcome.welcome);
    }
  }
}
