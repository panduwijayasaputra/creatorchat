import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  RateLimiterUnavailableError,
  type AuthenticatedUser,
  type MediaAssetSummary,
  type MediaUploadService,
} from '@creatorchat/backend-core';
import {
  CreatorGalleryQuerySchema,
  ErrorCode,
  MediaUploadInitBodySchema,
  type CreatorGalleryItemDetail,
  type CreatorGalleryQuery,
  type CreatorGalleryResponse,
  type MediaAssetResponse,
  type MediaAssetView,
  type MediaLimits,
  type MediaUploadInitBody,
  type MediaUploadInitResponse,
} from '@creatorchat/contracts';
import { Roles } from '../../common/auth/roles.decorator.js';
import { forbiddenRole, RolesGuard } from '../../common/auth/roles.guard.js';
import { CurrentUser, UserJwtGuard } from '../../common/auth/user-jwt.guard.js';
import { AppError } from '../../common/errors/app-error.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { MEDIA_UPLOAD } from './tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Another creator's, unknown and malformed ids all look the same. */
const notFound = () => new AppError(ErrorCode.MEDIA_NOT_FOUND, 404, 'Not found.');
const unavailable = () =>
  new AppError(ErrorCode.SERVICE_UNAVAILABLE, 503, 'The service is temporarily unavailable.');

/** The one place a stored asset becomes a response: explicit fields, so no key can leak. */
export const toAssetView = (a: MediaAssetSummary): MediaAssetView => ({
  id: a.id,
  kind: a.kind,
  state: a.state,
  failure: a.failure,
  duration_seconds: a.durationSeconds,
  thumbnail_url: a.thumbnailUrl,
  created_at: a.createdAt.toISOString(),
});

/**
 * Creator uploads and the gallery (US-032). Creators only; the creator comes from the session and
 * every asset id is looked up scoped to it in the service. Nothing here returns a storage key.
 */
@Controller('creator')
@UseGuards(UserJwtGuard, RolesGuard)
export class CreatorMediaController {
  constructor(@Inject(MEDIA_UPLOAD) private readonly media: MediaUploadService | null) {}

  private service(): MediaUploadService {
    if (!this.media) throw unavailable(); // storage is not configured; the rest of the API still works
    return this.media;
  }

  @Get('media/limits')
  @Roles('CREATOR')
  @Header('Cache-Control', 'no-store')
  limits(): MediaLimits {
    const l = this.service().limits();
    return {
      photo_max_bytes: l.photoMaxBytes,
      video_max_bytes: l.videoMaxBytes,
      video_max_seconds: l.videoMaxSeconds,
    };
  }

  /** 201 for a new asset, 200 when this `client_upload_id` already exists. */
  @Post('media/uploads')
  @Roles('CREATOR')
  @Header('Cache-Control', 'no-store')
  async init(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodValidationPipe(MediaUploadInitBodySchema)) body: MediaUploadInitBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MediaUploadInitResponse> {
    let outcome;
    try {
      outcome = await this.service().init(current.user.id, {
        clientUploadId: body.client_upload_id,
        kind: body.kind,
        contentType: body.content_type,
        sizeBytes: body.size_bytes,
        purpose: body.purpose,
        conversationId: body.conversation_id,
      });
    } catch (error) {
      if (error instanceof RateLimiterUnavailableError) throw unavailable();
      throw error;
    }
    switch (outcome.kind) {
      case 'not_creator':
        throw forbiddenRole();
      case 'creator_not_active':
        throw new AppError(
          ErrorCode.CREATOR_NOT_ACTIVE,
          403,
          'Your creator account is not active.',
        );
      case 'conversation_not_found':
        // The same answer the creator chat gives for a conversation that is not theirs.
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Not found.');
      case 'chat_access_expired':
        throw new AppError(ErrorCode.CHAT_ACCESS_EXPIRED, 403, 'Access has ended.');
      case 'type_not_allowed':
        throw new AppError(ErrorCode.MEDIA_TYPE_NOT_ALLOWED, 400, 'This file type is not allowed.');
      case 'too_large':
        throw new AppError(ErrorCode.MEDIA_TOO_LARGE, 400, 'This file is too large.');
      case 'rate_limited':
        throw new AppError(
          ErrorCode.MEDIA_RATE_LIMITED,
          429,
          'Too many uploads. Try again later.',
          undefined,
          { 'retry-after': String(outcome.retryAfterSeconds) },
        );
      default:
        void reply.status(outcome.kind === 'created' ? 201 : 200);
        return {
          asset: toAssetView(outcome.asset),
          upload: outcome.upload
            ? {
                url: outcome.upload.url,
                method: outcome.upload.method,
                headers: outcome.upload.headers,
                expires_at: outcome.upload.expiresAt.toISOString(),
              }
            : null,
        };
    }
  }

  @Post('media/uploads/:assetId/complete')
  @Roles('CREATOR')
  @Header('Cache-Control', 'no-store')
  async complete(
    @CurrentUser() current: AuthenticatedUser,
    @Param('assetId') assetId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MediaAssetResponse> {
    if (!UUID.test(assetId)) throw notFound();
    const outcome = await this.service().complete(current.user.id, assetId);
    if (outcome.kind === 'not_found') throw notFound();
    if (outcome.kind === 'incomplete') {
      throw new AppError(
        ErrorCode.MEDIA_UPLOAD_INCOMPLETE,
        409,
        'The file has not arrived yet. Upload it again.',
      );
    }
    void reply.status(200);
    return { asset: toAssetView(outcome.asset) };
  }

  @Get('media/:assetId')
  @Roles('CREATOR')
  @Header('Cache-Control', 'no-store')
  async get(
    @CurrentUser() current: AuthenticatedUser,
    @Param('assetId') assetId: string,
  ): Promise<MediaAssetResponse> {
    if (!UUID.test(assetId)) throw notFound();
    const outcome = await this.service().get(current.user.id, assetId);
    if (outcome.kind === 'not_found') throw notFound();
    return { asset: toAssetView(outcome.asset) };
  }

  @Get('gallery')
  @Roles('CREATOR')
  @Header('Cache-Control', 'no-store')
  async gallery(
    @CurrentUser() current: AuthenticatedUser,
    @Query(new ZodValidationPipe(CreatorGalleryQuerySchema)) query: CreatorGalleryQuery,
  ): Promise<CreatorGalleryResponse> {
    const outcome = await this.service().listGallery(current.user.id, query);
    if (outcome.kind === 'not_creator') throw forbiddenRole();
    if (outcome.kind === 'invalid_cursor') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'Invalid cursor.');
    }
    return {
      items: outcome.items.map((i) => ({
        asset: toAssetView(i.asset),
        added_at: i.addedAt.toISOString(),
      })),
      total: outcome.total,
      next_cursor: outcome.nextCursor,
    };
  }

  /** One gallery item for the viewer (US-033). */
  @Get('gallery/:assetId')
  @Roles('CREATOR')
  @Header('Cache-Control', 'no-store')
  async galleryItem(
    @CurrentUser() current: AuthenticatedUser,
    @Param('assetId') assetId: string,
  ): Promise<CreatorGalleryItemDetail> {
    if (!UUID.test(assetId)) throw notFound();
    const outcome = await this.service().galleryItemForOwner(current.user.id, assetId);
    if (outcome.kind === 'not_found') throw notFound();
    return {
      asset: toAssetView(outcome.asset),
      original: { url: outcome.original.url, expires_at: outcome.original.expiresAt.toISOString() },
      uploaded_at: outcome.uploadedAt.toISOString(),
      position: outcome.position,
      total: outcome.total,
      previous_id: outcome.previousId,
      next_id: outcome.nextId,
    };
  }
}
