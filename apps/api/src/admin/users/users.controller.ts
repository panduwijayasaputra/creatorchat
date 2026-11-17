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
  UserDetailService,
  UserHistoryService,
  UserListService,
  UserModerationService,
  UserRequestsService,
} from '@creatorchat/backend-core';
import {
  ErrorCode,
  HistoryQuerySchema,
  ModerateUserSchema,
  UserRequestsQuerySchema,
  type HistoryQuery,
  type HistoryResponse,
  type UserDetailResponse,
  type UserRequestDetail,
  type UserRequestsQuery,
  type UserRequestsResponse,
  UserListQuerySchema,
  type BlockUserResponse,
  type ModerateUserData,
  type UnblockUserResponse,
  type UserBlockCheckResponse,
  type UserListQuery,
  type UserListResponse,
  type UserModerationStatus,
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
import { USER_DETAIL, USER_HISTORY, USER_LIST, USER_MODERATION, USER_REQUESTS } from './tokens.js';

const notFound = () => new AppError(ErrorCode.NOT_FOUND, 404, 'User not found.');

const statusConflict = (status: UserModerationStatus) =>
  new AppError(ErrorCode.USER_STATUS_CONFLICT, 409, 'The user already has this status.', {
    status,
  } satisfies UserStatusConflictDetails);

const roleConflict = (role: UserRoleConflictDetails['role']) =>
  new AppError(
    ErrorCode.USER_ROLE_CONFLICT,
    409,
    'Creators are blocked and unblocked through the creator endpoints.',
    { role } satisfies UserRoleConflictDetails,
  );

/**
 * The admin User list (US-017): a read-only projection of USER accounts with their latest creator
 * request and active subscription count (every filter, sort and page value is allowlisted by the
 * contract), and the block / unblock decisions (US-019). `:id` is a user id; the admin comes from the
 * session and the body carries only the reason.
 */
@Controller('admin/users')
@UseGuards(CsrfGuard, AdminJwtGuard)
export class UsersController {
  constructor(
    @Inject(USER_LIST) private readonly users: UserListService,
    @Inject(USER_MODERATION) private readonly moderation: UserModerationService,
    @Inject(USER_DETAIL) private readonly detail: UserDetailService,
    @Inject(USER_REQUESTS) private readonly requests: UserRequestsService,
    @Inject(USER_HISTORY) private readonly history: UserHistoryService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Query(new ZodValidationPipe(UserListQuerySchema)) query: UserListQuery,
  ): Promise<UserListResponse> {
    return this.users.list(query);
  }

  /** A USER's detail; a creator's id answers only the creator id (US-018). Others: one 404. */
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async get(@Param('id') id: string): Promise<UserDetailResponse> {
    const result = await this.detail.get(id);
    if (!result) throw notFound();
    return result;
  }

  @Get(':id/requests')
  @Header('Cache-Control', 'no-store')
  async requestsOf(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(UserRequestsQuerySchema)) query: UserRequestsQuery,
  ): Promise<UserRequestsResponse> {
    const result = await this.requests.list(id, query);
    if (!result) throw notFound();
    return result;
  }

  /** The request must belong to `:id`; another user's request is the same 404 as an unknown one. */
  @Get(':id/requests/:requestId')
  @Header('Cache-Control', 'no-store')
  async request(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
  ): Promise<UserRequestDetail> {
    const result = await this.requests.get(id, requestId);
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

  /** What the block dialog shows on open. A read; the decision re-checks. */
  @Get(':id/block-check')
  @Header('Cache-Control', 'no-store')
  async blockCheck(@Param('id') id: string): Promise<UserBlockCheckResponse> {
    const check = await this.moderation.getBlockCheck(id);
    if (!check) throw notFound();
    return {
      user_status: check.status,
      role: check.role,
      active_subscriptions: check.activeSubscriptions,
      checked_at: check.checkedAt.toISOString(),
    };
  }

  @Post(':id/block')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async block(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ModerateUserSchema)) body: ModerateUserData,
    @CurrentAdmin() current: CurrentAdminValue,
    @Req() request: FastifyRequest,
  ): Promise<BlockUserResponse> {
    const result = await this.moderation.block(id, context(current, body, request));
    if (result.kind === 'not_found') throw notFound();
    if (result.kind === 'role_conflict') throw roleConflict(result.role);
    if (result.kind === 'conflict') throw statusConflict(result.status);
    return { user: { id, status: 'BLOCKED' } };
  }

  @Post(':id/unblock')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async unblock(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ModerateUserSchema)) body: ModerateUserData,
    @CurrentAdmin() current: CurrentAdminValue,
    @Req() request: FastifyRequest,
  ): Promise<UnblockUserResponse> {
    const result = await this.moderation.unblock(id, context(current, body, request));
    if (result.kind === 'not_found') throw notFound();
    if (result.kind === 'role_conflict') throw roleConflict(result.role);
    if (result.kind === 'conflict') throw statusConflict(result.status);
    return { user: { id, status: 'ACTIVE' } };
  }
}

function context(current: CurrentAdminValue, body: ModerateUserData, request: FastifyRequest) {
  return { adminId: current.admin.id, reason: body.reason, requestId: request.id };
}
