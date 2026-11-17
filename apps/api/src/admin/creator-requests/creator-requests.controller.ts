import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { CreatorApprovalService, ReviewContext } from '@creatorchat/backend-core';
import {
  ErrorCode,
  RejectCreatorRequestSchema,
  type AlreadyReviewedDetails,
  type ApproveCreatorRequestResponse,
  type CreatorRequestReviewResponse,
  type RejectCreatorRequestData,
  type RejectCreatorRequestResponse,
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
import { CREATOR_APPROVAL } from './tokens.js';

const notFound = () => new AppError(ErrorCode.NOT_FOUND, 404, 'Creator request not found.');

const alreadyReviewed = (status: AlreadyReviewedDetails['status']) =>
  new AppError(
    ErrorCode.CREATOR_REQUEST_ALREADY_REVIEWED,
    409,
    'This request has already been reviewed.',
    { status } satisfies AlreadyReviewedDetails,
  );

/**
 * An admin reviews a creator request. The only identifier from the client is the application id in
 * the path; the admin comes from the session, and the applicant's id, role and status are never read
 * from the request. All decisions are re-checked inside one transaction by the service.
 */
@Controller('admin/creator-requests')
@UseGuards(CsrfGuard, AdminJwtGuard)
export class CreatorRequestsController {
  constructor(@Inject(CREATOR_APPROVAL) private readonly approvals: CreatorApprovalService) {}

  /** The request, its applicant and the approval pre-check (what the dialogs show on open). */
  @Get(':id')
  async review(@Param('id') id: string): Promise<CreatorRequestReviewResponse> {
    const view = await this.approvals.getForReview(id);
    if (!view) throw notFound();
    return {
      request: view.request,
      check: { block: view.check.block, checked_at: view.check.checkedAt.toISOString() },
    };
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(
    @Param('id') id: string,
    @CurrentAdmin() current: CurrentAdminValue,
    @Req() request: FastifyRequest,
  ): Promise<ApproveCreatorRequestResponse> {
    const result = await this.approvals.approve(id, context(current, request));
    switch (result.kind) {
      case 'ok':
        return {
          request: result.request,
          creator: { id: result.creator.id, public_code: result.creator.publicCode },
        };
      case 'not_found':
        throw notFound();
      case 'already_reviewed':
        throw alreadyReviewed(result.status);
      case 'not_eligible':
        throw new AppError(
          ErrorCode.CREATOR_REQUEST_ACCOUNT_NOT_ELIGIBLE,
          409,
          'The account cannot be approved.',
        );
      case 'blocked':
        throw new AppError(
          ErrorCode.CREATOR_APPROVAL_BLOCKED,
          409,
          'A customer subscription is still active or scheduled.',
          result.block,
        );
    }
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RejectCreatorRequestSchema)) body: RejectCreatorRequestData,
    @CurrentAdmin() current: CurrentAdminValue,
    @Req() request: FastifyRequest,
  ): Promise<RejectCreatorRequestResponse> {
    const result = await this.approvals.reject(id, body, context(current, request));
    switch (result.kind) {
      case 'ok':
        return { request: result.request };
      case 'not_found':
        throw notFound();
      case 'already_reviewed':
        throw alreadyReviewed(result.status);
    }
  }
}

function context(current: CurrentAdminValue, request: FastifyRequest): ReviewContext {
  return { adminId: current.admin.id, requestId: request.id };
}
