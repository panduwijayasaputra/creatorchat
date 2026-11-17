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
  AccessOutcome,
  AccessRequestReviewService,
  SubscriptionAccessService,
  SubscriptionDetailService,
  SubscriptionListService,
} from '@creatorchat/backend-core';
import {
  ErrorCode,
  ExtendAccessSchema,
  RejectAccessRequestSchema,
  type AccessRequestConflictDetails,
  type AccessRequestsResponse,
  type RejectAccessRequestData,
  type RejectAccessRequestResponse,
  GrantAccessSchema,
  RevokeAccessSchema,
  SubscriptionEventsQuerySchema,
  type SubscriptionDetailResponse,
  type SubscriptionEventsQuery,
  type SubscriptionEventsResponse,
  SubscriptionListQuerySchema,
  type ExtendAccessData,
  type GrantableCreatorsResponse,
  type GrantAccessData,
  type RevokeAccessData,
  type SubscriptionActionResponse,
  type SubscriptionListQuery,
  type SubscriptionListResponse,
  type UserRoleConflictDetails,
  type UserStatusConflictDetails,
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
  ACCESS_REQUEST_REVIEW,
  SUBSCRIPTION_ACCESS,
  SUBSCRIPTION_DETAIL,
  SUBSCRIPTION_LIST,
} from './tokens.js';

type Failure = Exclude<AccessOutcome, { kind: 'ok' }>;

/** One generic message for every not-found case: no hint which id was wrong. */
const notFound = () => new AppError(ErrorCode.NOT_FOUND, 404, 'Not found.');

/** The request was already decided: what it is now, so the page can show the truth. */
const requestReviewed = (status: AccessRequestConflictDetails['status']) =>
  new AppError(
    ErrorCode.ACCESS_REQUEST_ALREADY_REVIEWED,
    409,
    'The access request was already reviewed.',
    { status } satisfies AccessRequestConflictDetails,
  );

/** Maps a refused outcome to the API error; nothing was written in any of these cases. */
function failure(outcome: Failure): AppError {
  switch (outcome.kind) {
    case 'not_found':
      return notFound();
    case 'user_role_conflict':
      return new AppError(
        ErrorCode.USER_ROLE_CONFLICT,
        409,
        'Only customer accounts can hold access.',
        { role: outcome.role } satisfies UserRoleConflictDetails,
      );
    case 'user_status_conflict':
      return new AppError(ErrorCode.USER_STATUS_CONFLICT, 409, 'The user account is blocked.', {
        status: outcome.status,
      } satisfies UserStatusConflictDetails);
    case 'creator_not_active':
      return new AppError(ErrorCode.CREATOR_NOT_ACTIVE, 409, 'The creator is not active.');
    case 'subscription_active':
      return new AppError(
        ErrorCode.SUBSCRIPTION_ACTIVE,
        409,
        'The access is still active; extend it instead.',
      );
    case 'subscription_revoked':
      return new AppError(
        ErrorCode.SUBSCRIPTION_REVOKED,
        409,
        'The access was revoked; grant it again instead.',
      );
    case 'subscription_not_active':
      return new AppError(ErrorCode.SUBSCRIPTION_NOT_ACTIVE, 409, 'The access is not active.');
    case 'request_reviewed':
      return requestReviewed(outcome.status);
    case 'invalid':
      return new AppError(ErrorCode.VALIDATION_FAILED, 400, outcome.message);
  }
}

function toResponse(outcome: AccessOutcome): SubscriptionActionResponse {
  if (outcome.kind !== 'ok') throw failure(outcome);
  const s = outcome.subscription;
  return {
    subscription: {
      id: s.id,
      creator_id: s.creatorId,
      status: s.status,
      starts_at: s.startsAt.toISOString(),
      ends_at: s.endsAt.toISOString(),
      revoked_at: s.revokedAt?.toISOString() ?? null,
    },
  };
}

/**
 * The Langganan tab of a user (US-020): list, the creators still grantable, and grant / extend /
 * revoke. `:id` is a user id and `:subId` must belong to it; the admin comes from the session and
 * no body carries an id of the admin, the customer or a date of record.
 */
@Controller('admin/users/:id')
@UseGuards(CsrfGuard, AdminJwtGuard)
export class UserSubscriptionsController {
  constructor(
    @Inject(SUBSCRIPTION_LIST) private readonly list: SubscriptionListService,
    @Inject(SUBSCRIPTION_ACCESS) private readonly access: SubscriptionAccessService,
    @Inject(SUBSCRIPTION_DETAIL) private readonly detail: SubscriptionDetailService,
    @Inject(ACCESS_REQUEST_REVIEW) private readonly review: AccessRequestReviewService,
  ) {}

  @Get('subscriptions')
  @Header('Cache-Control', 'no-store')
  async subscriptions(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(SubscriptionListQuerySchema)) query: SubscriptionListQuery,
  ): Promise<SubscriptionListResponse> {
    const result = await this.list.list(id, query);
    if (!result) throw notFound();
    return result;
  }

  /** One subscription of this user (US-021); another user's id is the same 404 as an unknown one. */
  @Get('subscriptions/:subId')
  @Header('Cache-Control', 'no-store')
  async subscription(
    @Param('id') id: string,
    @Param('subId') subId: string,
  ): Promise<SubscriptionDetailResponse> {
    const result = await this.detail.get(id, subId);
    if (!result) throw notFound();
    return result;
  }

  @Get('subscriptions/:subId/events')
  @Header('Cache-Control', 'no-store')
  async events(
    @Param('id') id: string,
    @Param('subId') subId: string,
    @Query(new ZodValidationPipe(SubscriptionEventsQuerySchema)) query: SubscriptionEventsQuery,
  ): Promise<SubscriptionEventsResponse> {
    const result = await this.detail.events(id, subId, query);
    if (!result) throw notFound();
    return result;
  }

  @Get('grantable-creators')
  @Header('Cache-Control', 'no-store')
  async grantable(@Param('id') id: string): Promise<GrantableCreatorsResponse> {
    const result = await this.list.grantableCreators(id);
    if (!result) throw notFound();
    return result;
  }

  /** The user's pending trial / renewal requests (US-024), for the Langganan banners. */
  @Get('access-requests')
  @Header('Cache-Control', 'no-store')
  async accessRequests(@Param('id') id: string): Promise<AccessRequestsResponse> {
    const result = await this.review.listPending(id);
    if (result.kind !== 'ok') throw notFound();
    return {
      items: result.items.map((r) => ({
        id: r.id,
        creator: { id: r.creator.id, display_name: r.creator.displayName },
        type: r.type,
        requested_at: r.requestedAt.toISOString(),
      })),
    };
  }

  /** Tolak: the reason is required; a request that is no longer pending is a 409 with its status. */
  @Post('access-requests/:requestId/reject')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async rejectAccessRequest(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body(new ZodValidationPipe(RejectAccessRequestSchema)) body: RejectAccessRequestData,
    @CurrentAdmin() current: CurrentAdminValue,
    @Req() request: FastifyRequest,
  ): Promise<RejectAccessRequestResponse> {
    const outcome = await this.review.reject(
      id,
      requestId,
      { reason: body.reason },
      { adminId: current.admin.id, requestId: request.id },
    );
    if (outcome.kind === 'not_found') throw notFound();
    if (outcome.kind === 'already_reviewed') throw requestReviewed(outcome.status);
    return { request: { id: outcome.requestId, status: 'REJECTED' } };
  }

  @Post('subscriptions')
  @Header('Cache-Control', 'no-store')
  async grant(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(GrantAccessSchema)) body: GrantAccessData,
    @CurrentAdmin() current: CurrentAdminValue,
    @Req() request: FastifyRequest,
  ): Promise<SubscriptionActionResponse> {
    return toResponse(
      await this.access.grant(
        id,
        {
          creatorId: body.creator_id,
          durationDays: body.duration_days,
          endDate: body.end_date,
          accessRequestId: body.access_request_id,
        },
        { adminId: current.admin.id, reason: body.reason, requestId: request.id },
      ),
    );
  }

  @Post('subscriptions/:subId/extend')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async extend(
    @Param('id') id: string,
    @Param('subId') subId: string,
    @Body(new ZodValidationPipe(ExtendAccessSchema)) body: ExtendAccessData,
    @CurrentAdmin() current: CurrentAdminValue,
    @Req() request: FastifyRequest,
  ): Promise<SubscriptionActionResponse> {
    return toResponse(
      await this.access.extend(
        id,
        subId,
        { durationDays: body.duration_days },
        { adminId: current.admin.id, reason: body.reason, requestId: request.id },
      ),
    );
  }

  @Post('subscriptions/:subId/revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async revoke(
    @Param('id') id: string,
    @Param('subId') subId: string,
    @Body(new ZodValidationPipe(RevokeAccessSchema)) body: RevokeAccessData,
    @CurrentAdmin() current: CurrentAdminValue,
    @Req() request: FastifyRequest,
  ): Promise<SubscriptionActionResponse> {
    return toResponse(
      await this.access.revoke(id, subId, {
        adminId: current.admin.id,
        reason: body.reason,
        requestId: request.id,
      }),
    );
  }
}
