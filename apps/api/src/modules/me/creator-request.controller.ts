import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import {
  CreatorRequestAccountNotActiveError,
  CreatorRequestBlockedError,
  type AuthenticatedUser,
  type CreatorRequestService,
} from '@creatorchat/backend-core';
import {
  ErrorCode,
  SubmitCreatorRequestSchema,
  type CreatorRequestStateResponse,
  type SubmitCreatorRequestData,
  type SubmitCreatorRequestResponse,
} from '@creatorchat/contracts';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { CurrentUser, UserJwtGuard } from '../../common/auth/user-jwt.guard.js';
import { AppError } from '../../common/errors/app-error.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { CREATOR_REQUEST } from './tokens.js';

/**
 * A customer asks to become a creator. There is no user or request id anywhere in the request:
 * the account comes from the session, and fields the schema does not own are dropped by validation.
 */
@Controller('me/creator-request')
@UseGuards(UserJwtGuard, RolesGuard)
export class CreatorRequestController {
  constructor(@Inject(CREATOR_REQUEST) private readonly requests: CreatorRequestService) {}

  /** The caller's latest request and, if they still hold a customer subscription, what blocks them. */
  @Get()
  @Roles('USER')
  state(@CurrentUser() current: AuthenticatedUser): Promise<CreatorRequestStateResponse> {
    return this.requests.getState(current.user.id);
  }

  /** Idempotent while a request is pending: the existing one is returned, not a second row. */
  @Post()
  @HttpCode(200)
  @Roles('USER')
  async submit(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodValidationPipe(SubmitCreatorRequestSchema)) body: SubmitCreatorRequestData,
  ): Promise<SubmitCreatorRequestResponse> {
    try {
      return { request: await this.requests.submit(current.user.id, body) };
    } catch (error) {
      if (error instanceof CreatorRequestAccountNotActiveError) {
        // Blocked, promoted or removed between the guard and the write: same as a dead session.
        throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Authentication is required.');
      }
      if (error instanceof CreatorRequestBlockedError) {
        throw new AppError(
          ErrorCode.CREATOR_REQUEST_BLOCKED,
          409,
          'A customer subscription is still active.',
          error.block,
        );
      }
      throw error;
    }
  }
}
