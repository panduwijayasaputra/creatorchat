import { Body, Controller, Header, Inject, Post, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  RateLimiterUnavailableError,
  type AuthenticatedUser,
  type BroadcastService,
} from '@creatorchat/backend-core';
import {
  CreateBroadcastBodySchema,
  ErrorCode,
  type BroadcastView,
  type CreateBroadcastBody,
} from '@creatorchat/contracts';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { CurrentUser, UserJwtGuard } from '../../common/auth/user-jwt.guard.js';
import { AppError } from '../../common/errors/app-error.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { CREATOR_BROADCAST } from './tokens.js';

/**
 * A creator sends a photo or video to every active subscriber (US-038). Creators only; the creator
 * comes from the session and the asset is looked up scoped to it. Recording is all that happens
 * here: the worker delivers (US-039). Nothing in the answer reveals recipients.
 */
@Controller('creator/broadcasts')
@UseGuards(UserJwtGuard, RolesGuard)
export class CreatorBroadcastController {
  constructor(@Inject(CREATOR_BROADCAST) private readonly broadcasts: BroadcastService) {}

  /** 201 for a new broadcast, 200 when the same `client_broadcast_id` was already recorded. */
  @Post()
  @Roles('CREATOR')
  @Header('Cache-Control', 'no-store')
  async create(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateBroadcastBodySchema)) body: CreateBroadcastBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BroadcastView> {
    let outcome;
    try {
      outcome = await this.broadcasts.create(current.user.id, {
        clientBroadcastId: body.client_broadcast_id,
        assetId: body.attachment.asset_id,
        body: body.body,
        saveToGallery: body.save_to_gallery,
      });
    } catch (error) {
      if (error instanceof RateLimiterUnavailableError) {
        throw new AppError(
          ErrorCode.SERVICE_UNAVAILABLE,
          503,
          'The service is temporarily unavailable.',
        );
      }
      throw error;
    }
    switch (outcome.kind) {
      case 'not_found':
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Not found.');
      case 'media_not_found':
        throw new AppError(ErrorCode.MEDIA_NOT_FOUND, 404, 'Not found.');
      case 'media_not_ready':
        throw new AppError(ErrorCode.MEDIA_NOT_READY, 409, 'The file is still being processed.');
      case 'no_active_subscribers':
        throw new AppError(
          ErrorCode.NO_ACTIVE_SUBSCRIBERS,
          409,
          'There are no active subscribers.',
        );
      case 'conflict':
        throw new AppError(
          ErrorCode.IDEMPOTENCY_CONFLICT,
          409,
          'This broadcast id was already used for another broadcast.',
        );
      case 'invalid':
        throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'Invalid broadcast.');
      case 'rate_limited':
        throw new AppError(
          ErrorCode.RATE_LIMITED,
          429,
          'Too many broadcasts. Try again later.',
          undefined,
          { 'retry-after': String(outcome.retryAfterSeconds) },
        );
      default:
        void reply.status(outcome.kind === 'created' ? 201 : 200);
        return {
          id: outcome.broadcast.id,
          status: outcome.broadcast.status,
          created_at: outcome.broadcast.createdAt.toISOString(),
        };
    }
  }
}
