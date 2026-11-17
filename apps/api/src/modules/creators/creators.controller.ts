import {
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
import type {
  AccessRequestService,
  AuthenticatedUser,
  CreatorAccessService,
  CustomerGalleryService,
} from '@creatorchat/backend-core';
import {
  CustomerGalleryQuerySchema,
  ErrorCode,
  ExploreQuerySchema,
  type CustomerGalleryItemDetail,
  type CustomerGalleryQuery,
  type CustomerGalleryResponse,
  type CreatorProfileResponse,
  type ExploreQuery,
  type ExploreResponse,
  type SubmitAccessRequestResponse,
} from '@creatorchat/contracts';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { CurrentUser, UserJwtGuard } from '../../common/auth/user-jwt.guard.js';
import { AppError } from '../../common/errors/app-error.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { ACCESS_REQUESTS, CREATOR_ACCESS, CUSTOMER_GALLERY } from './tokens.js';

/**
 * What a signed-in customer sees of creators (US-005 deep link, US-022 Explore and profile).
 * Customers only (`@Roles('USER')`, enforced by `RolesGuard` from the live account). The viewer id
 * comes from the session only; the answers hold the public profile and the viewer's own access
 * state: no creator ids, status, counts, other customers or media.
 */
@Controller('creators')
@UseGuards(UserJwtGuard, RolesGuard)
export class CreatorsController {
  constructor(
    @Inject(CREATOR_ACCESS) private readonly access: CreatorAccessService,
    @Inject(ACCESS_REQUESTS) private readonly requests: AccessRequestService,
    @Inject(CUSTOMER_GALLERY) private readonly gallery: CustomerGalleryService | null,
  ) {}

  @Get()
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async explore(
    @CurrentUser() current: AuthenticatedUser,
    @Query(new ZodValidationPipe(ExploreQuerySchema)) query: ExploreQuery,
  ): Promise<ExploreResponse> {
    const result = await this.access.explore(current.user.id, query);
    return {
      items: result.items.map((i) => ({
        public_code: i.publicCode,
        display_name: i.displayName,
        bio: i.bio,
        avatar_url: i.avatarUrl,
        access: i.access,
      })),
      total: result.total,
      page: result.page,
      page_size: result.pageSize as 10 | 20 | 50,
    };
  }

  /**
   * Resolves a creator code to the profile with the viewer's access state. Unknown, malformed,
   * blocked and inactive creators all give the same 404.
   */
  @Get('by-code/:publicCode')
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async byCode(
    @CurrentUser() current: AuthenticatedUser,
    @Param('publicCode') publicCode: string,
  ): Promise<CreatorProfileResponse> {
    const outcome = await this.access.profile(current.user.id, publicCode);
    if (outcome.kind === 'not_found') {
      throw new AppError(ErrorCode.CREATOR_NOT_FOUND, 404, 'This creator is not available.');
    }
    const { creator, access, lastReview, conversationId } = outcome;
    return {
      public_code: creator.publicCode,
      display_name: creator.displayName,
      bio: creator.bio,
      avatar_url: creator.avatarUrl,
      conversation_id: conversationId,
      access:
        access.state === 'PENDING'
          ? {
              state: 'PENDING',
              requested_at: access.requestedAt.toISOString(),
              request_type: access.type,
            }
          : access.state === 'ACTIVE'
            ? { state: 'ACTIVE', ends_at: access.endsAt.toISOString() }
            : access.state === 'EXPIRED'
              ? {
                  state: 'EXPIRED',
                  ended_at: access.endedAt.toISOString(),
                  revoked: access.revoked,
                }
              : { state: 'GUEST' },
      ...(lastReview
        ? {
            last_review: {
              status: lastReview.status,
              reviewed_at: lastReview.reviewedAt.toISOString(),
            },
          }
        : {}),
    };
  }

  /**
   * The customer asks for trial or renewal access (US-023). The body is ignored: the type comes
   * from the viewer's own state and the code only chooses the target. 201 for a new request, 200
   * when one was already pending (a retry or a second tap).
   */
  @Post('by-code/:publicCode/access-requests')
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async requestAccess(
    @CurrentUser() current: AuthenticatedUser,
    @Param('publicCode') publicCode: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SubmitAccessRequestResponse> {
    const outcome = await this.requests.submit(current.user.id, publicCode);
    switch (outcome.kind) {
      case 'not_found':
        throw new AppError(ErrorCode.CREATOR_NOT_FOUND, 404, 'This creator is not available.');
      case 'already_active':
        throw new AppError(ErrorCode.ACCESS_ALREADY_ACTIVE, 409, 'Access is already active.');
      case 'not_eligible':
        // Blocked or promoted since the token was issued: same as a dead session.
        throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Authentication is required.');
      default:
        void reply.status(outcome.kind === 'created' ? 201 : 200);
        return { request_type: outcome.type, requested_at: outcome.requestedAt.toISOString() };
    }
  }

  private galleries(): CustomerGalleryService {
    if (!this.gallery) {
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        503,
        'The service is temporarily unavailable.',
      );
    }
    return this.gallery;
  }

  /**
   * A creator's gallery for a customer with active access (US-034). Entitlement is checked on every
   * call; without it nothing is returned, not even a count.
   */
  @Get('by-code/:publicCode/gallery')
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async galleryList(
    @CurrentUser() current: AuthenticatedUser,
    @Param('publicCode') publicCode: string,
    @Query(new ZodValidationPipe(CustomerGalleryQuerySchema)) query: CustomerGalleryQuery,
  ): Promise<CustomerGalleryResponse> {
    const outcome = await this.galleries().list(current.user.id, publicCode, query);
    switch (outcome.kind) {
      case 'creator_not_found':
        throw new AppError(ErrorCode.CREATOR_NOT_FOUND, 404, 'This creator is not available.');
      case 'not_entitled':
        throw new AppError(ErrorCode.GALLERY_ACCESS_REQUIRED, 403, 'Active access is required.');
      case 'invalid_cursor':
        throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'Invalid cursor.');
      default:
        return {
          items: outcome.items.map((i) => ({
            id: i.id,
            kind: i.kind,
            duration_seconds: i.durationSeconds,
            thumbnail_url: i.thumbnailUrl,
          })),
          total: outcome.total,
          next_cursor: outcome.nextCursor,
        };
    }
  }

  @Get('by-code/:publicCode/gallery/:assetId')
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async galleryItem(
    @CurrentUser() current: AuthenticatedUser,
    @Param('publicCode') publicCode: string,
    @Param('assetId') assetId: string,
  ): Promise<CustomerGalleryItemDetail> {
    const outcome = await this.galleries().item(current.user.id, publicCode, assetId);
    switch (outcome.kind) {
      case 'creator_not_found':
        throw new AppError(ErrorCode.CREATOR_NOT_FOUND, 404, 'This creator is not available.');
      case 'not_entitled':
        throw new AppError(ErrorCode.GALLERY_ACCESS_REQUIRED, 403, 'Active access is required.');
      case 'media_not_found':
        throw new AppError(ErrorCode.MEDIA_NOT_FOUND, 404, 'Not found.');
      default:
        return {
          item: {
            id: outcome.item.id,
            kind: outcome.item.kind,
            duration_seconds: outcome.item.durationSeconds,
            thumbnail_url: outcome.item.thumbnailUrl,
          },
          original: {
            url: outcome.original.url,
            expires_at: outcome.original.expiresAt.toISOString(),
          },
          uploaded_at: outcome.uploadedAt.toISOString(),
          position: outcome.position,
          total: outcome.total,
          previous_id: outcome.previousId,
          next_id: outcome.nextId,
        };
    }
  }
}
