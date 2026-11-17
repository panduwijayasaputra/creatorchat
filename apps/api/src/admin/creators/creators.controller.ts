import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  AdminCreatorGalleryService,
  CreatorDetailService,
  CreatorHistoryService,
  CreatorListService,
  CreatorModerationService,
  CreatorSubscribersService,
} from '@creatorchat/backend-core';
import {
  AdminGalleryQuerySchema,
  CreatorListQuerySchema,
  type AdminGalleryQuery,
  type AdminGalleryResponse,
  type AdminMediaDetail,
  CreatorSubscribersQuerySchema,
  GrantableUsersQuerySchema,
  HistoryQuerySchema,
  type CreatorSubscribersQuery,
  type CreatorSubscribersResponse,
  type GrantableUsersQuery,
  type GrantableUsersResponse,
  type CreatorDetailResponse,
  type HistoryQuery,
  type HistoryResponse,
  ErrorCode,
  ModerateCreatorSchema,
  type BlockCreatorResponse,
  type CreatorBlockCheckResponse,
  type CreatorListQuery,
  type CreatorListResponse,
  type CreatorModerationStatus,
  type CreatorStatusConflictDetails,
  type ModerateCreatorData,
  type UnblockCreatorResponse,
} from '@creatorchat/contracts';
import type { FastifyRequest } from 'fastify';
import {
  AdminJwtGuard,
  CurrentAdmin,
  type CurrentAdminValue,
} from '../../common/auth/admin-jwt.guard.js';
import { CsrfGuard } from '../../common/auth/csrf.guard.js';
import { AppError } from '../../common/errors/app-error.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import {
  ADMIN_GALLERY,
  CREATOR_DETAIL,
  CREATOR_HISTORY,
  CREATOR_LIST,
  CREATOR_MODERATION,
  CREATOR_SUBSCRIBERS,
} from './tokens.js';

const notFound = () => new AppError(ErrorCode.NOT_FOUND, 404, 'Creator not found.');

const conflict = (status: CreatorModerationStatus) =>
  new AppError(ErrorCode.CREATOR_STATUS_CONFLICT, 409, 'The creator already has this status.', {
    status,
  } satisfies CreatorStatusConflictDetails);

/**
 * The admin Creator list (US-014) and the block / unblock decisions (US-016). Every filter, sort
 * and page value is validated against an allowlist by the contract. `:id` is a creator id; the
 * admin comes from the session and the body carries only the reason.
 */
@Controller('admin/creators')
@UseGuards(CsrfGuard, AdminJwtGuard)
export class CreatorsController {
  constructor(
    @Inject(CREATOR_LIST) private readonly creators: CreatorListService,
    @Inject(CREATOR_MODERATION) private readonly moderation: CreatorModerationService,
    @Inject(CREATOR_DETAIL) private readonly detail: CreatorDetailService,
    @Inject(CREATOR_HISTORY) private readonly history: CreatorHistoryService,
    @Inject(ADMIN_GALLERY) private readonly gallery: AdminCreatorGalleryService | null,
    @Inject(CREATOR_SUBSCRIBERS) private readonly subscribers: CreatorSubscribersService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Query(new ZodValidationPipe(CreatorListQuerySchema)) query: CreatorListQuery,
  ): Promise<CreatorListResponse> {
    return this.creators.list(query);
  }

  /** A creator or a pending request (US-015). Unknown, rejected and malformed ids are one 404. */
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async get(@Param('id') id: string): Promise<CreatorDetailResponse> {
    const result = await this.detail.get(id);
    if (!result) throw notFound();
    return result;
  }

  @Get(':id/history')
  @Header('Cache-Control', 'no-store')
  async historyOf(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(HistoryQuerySchema)) query: HistoryQuery,
  ): Promise<HistoryResponse> {
    const result = await this.history.list(id, query);
    if (!result) throw notFound();
    return result;
  }

  private galleries(): AdminCreatorGalleryService {
    if (!this.gallery) {
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        503,
        'The service is temporarily unavailable.',
      );
    }
    return this.gallery;
  }

  /** The media in a creator's gallery (US-035), read-only. `:id` is a creator id only. */
  @Get(':id/gallery')
  @Header('Cache-Control', 'no-store')
  async galleryOf(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(AdminGalleryQuerySchema)) query: AdminGalleryQuery,
  ): Promise<AdminGalleryResponse> {
    const result = await this.galleries().list(id, query);
    if (result.kind === 'creator_not_found') throw notFound();
    return result.page;
  }

  /** One gallery media with a short-lived preview link; chat-only assets are never reachable here. */
  @Get(':id/gallery/:assetId')
  @Header('Cache-Control', 'no-store')
  async mediaOf(
    @Param('id') id: string,
    @Param('assetId') assetId: string,
  ): Promise<AdminMediaDetail> {
    const result = await this.galleries().detail(id, assetId);
    if (result.kind === 'creator_not_found') throw notFound();
    if (result.kind === 'media_not_found') {
      throw new AppError(ErrorCode.MEDIA_NOT_FOUND, 404, 'Media not found.');
    }
    return result.detail;
  }

  /** A creator's customers (US-021). `:id` is a creator id only; a request id is a 404. */
  @Get(':id/subscribers')
  @Header('Cache-Control', 'no-store')
  async subscribersOf(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(CreatorSubscribersQuerySchema)) query: CreatorSubscribersQuery,
  ): Promise<CreatorSubscribersResponse> {
    const result = await this.subscribers.list(id, query);
    if (!result) throw notFound();
    return result;
  }

  /** The picker of Berikan Akses: at most 20 users, never an entitled one. */
  @Get(':id/grantable-users')
  @Header('Cache-Control', 'no-store')
  async grantableUsers(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(GrantableUsersQuerySchema)) query: GrantableUsersQuery,
  ): Promise<GrantableUsersResponse> {
    const result = await this.subscribers.grantableUsers(id, query.q);
    if (!result) throw notFound();
    return result;
  }

  /** What the block dialog shows on open. A read; the decision re-checks. */
  @Get(':id/block-check')
  @Header('Cache-Control', 'no-store')
  async blockCheck(@Param('id') id: string): Promise<CreatorBlockCheckResponse> {
    const check = await this.moderation.getBlockCheck(id);
    if (!check) throw notFound();
    return {
      creator_status: check.status,
      active_subscribers: check.activeSubscribers,
      checked_at: check.checkedAt.toISOString(),
    };
  }

  @Post(':id/block')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async block(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ModerateCreatorSchema)) body: ModerateCreatorData,
    @CurrentAdmin() current: CurrentAdminValue,
    @Req() request: FastifyRequest,
  ): Promise<BlockCreatorResponse> {
    const result = await this.moderation.block(id, context(current, body, request));
    if (result.kind === 'not_found') throw notFound();
    if (result.kind === 'conflict') throw conflict(result.status);
    return {
      creator: { id, status: 'BLOCKED' },
      active_subscribers: result.activeSubscribers,
    };
  }

  @Post(':id/unblock')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async unblock(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ModerateCreatorSchema)) body: ModerateCreatorData,
    @CurrentAdmin() current: CurrentAdminValue,
    @Req() request: FastifyRequest,
  ): Promise<UnblockCreatorResponse> {
    const result = await this.moderation.unblock(id, context(current, body, request));
    if (result.kind === 'not_found') throw notFound();
    if (result.kind === 'conflict') throw conflict(result.status);
    return { creator: { id, status: 'ACTIVE' } };
  }
}

function context(current: CurrentAdminValue, body: ModerateCreatorData, request: FastifyRequest) {
  return { adminId: current.admin.id, reason: body.reason, requestId: request.id };
}
