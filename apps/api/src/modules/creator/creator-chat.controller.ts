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
import type {
  AuthenticatedUser,
  CreatorChatAccess,
  CreatorChatMessage as StoredMessage,
  CreatorChatService,
} from '@creatorchat/backend-core';
import {
  CreatorChatHistoryQuerySchema,
  CreatorSendMessageBodySchema,
  ErrorCode,
  type CreatorChatAccess as AccessJson,
  type CreatorChatHistoryQuery,
  type CreatorChatHistoryResponse,
  type CreatorChatMessage,
  type CreatorCustomerDetailResponse,
  type CreatorSendMessageBody,
  type CreatorSendMessageResponse,
} from '@creatorchat/contracts';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { CurrentUser, UserJwtGuard } from '../../common/auth/user-jwt.guard.js';
import { AppError } from '../../common/errors/app-error.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { toAttachmentJson } from '../media/attachment-json.js';
import { CREATOR_CHAT } from './tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Another creator's, unknown and malformed ids all look the same. */
const notFound = () => new AppError(ErrorCode.NOT_FOUND, 404, 'Not found.');

const toMessage = (m: StoredMessage): CreatorChatMessage => ({
  id: m.id,
  client_message_id: m.clientMessageId,
  seq: m.seq,
  sender: m.sender,
  type: m.type,
  body: m.body,
  attachments: m.attachments.map(toAttachmentJson),
  origin: m.origin,
  created_at: m.createdAt.toISOString(),
});

const toAccess = (a: CreatorChatAccess): AccessJson =>
  a.state === 'ACTIVE'
    ? { state: 'ACTIVE', ends_at: a.endsAt.toISOString(), ended_at: null }
    : { state: 'EXPIRED', ends_at: null, ended_at: a.endedAt?.toISOString() ?? null };

/**
 * The creator side of a private chat (US-029). Creators only; the creator comes from the session and
 * every query is scoped to it in the service. Answers carry no user ids and no Telegram id.
 */
@Controller('creator/conversations')
@UseGuards(UserJwtGuard, RolesGuard)
export class CreatorChatController {
  constructor(@Inject(CREATOR_CHAT) private readonly chat: CreatorChatService) {}

  @Get(':conversationId/messages')
  @Roles('CREATOR')
  @Header('Cache-Control', 'no-store')
  async history(
    @CurrentUser() current: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Query(new ZodValidationPipe(CreatorChatHistoryQuerySchema)) query: CreatorChatHistoryQuery,
  ): Promise<CreatorChatHistoryResponse> {
    if (!UUID.test(conversationId)) throw notFound();
    const outcome = await this.chat.history(current.user.id, conversationId, query);
    if (outcome.kind === 'not_found') throw notFound();
    const { conversation, items, nextBefore } = outcome.history;
    return {
      conversation: {
        id: conversation.id,
        customer: {
          display_name: conversation.customer.displayName,
          avatar_url: conversation.customer.avatarUrl,
        },
        access: toAccess(conversation.access),
      },
      items: items.map(toMessage),
      next_before: nextBefore,
    };
  }

  /** 201 for a new message, 200 when the same `client_message_id` was already stored. */
  @Post(':conversationId/messages')
  @Roles('CREATOR')
  @Header('Cache-Control', 'no-store')
  async send(
    @CurrentUser() current: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body(new ZodValidationPipe(CreatorSendMessageBodySchema)) body: CreatorSendMessageBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CreatorSendMessageResponse> {
    if (!UUID.test(conversationId)) throw notFound();
    const outcome = await this.chat.send(current.user.id, conversationId, {
      clientMessageId: body.client_message_id,
      body: body.body,
      attachmentAssetId: body.attachment?.asset_id,
    });
    switch (outcome.kind) {
      case 'not_found':
        throw notFound();
      case 'access_expired':
        throw new AppError(ErrorCode.CHAT_ACCESS_EXPIRED, 403, 'Access has ended.');
      case 'conflict':
        throw new AppError(
          ErrorCode.IDEMPOTENCY_CONFLICT,
          409,
          'This message id was already used for other text.',
        );
      case 'invalid':
        throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'Invalid message.');
      case 'media_not_found':
        throw new AppError(ErrorCode.MEDIA_NOT_FOUND, 404, 'Not found.');
      case 'media_not_ready':
        throw new AppError(ErrorCode.MEDIA_NOT_READY, 409, 'The file is still being processed.');
      default:
        void reply.status(outcome.kind === 'created' ? 201 : 200);
        return { message: toMessage(outcome.message) };
    }
  }

  @Get(':conversationId/customer')
  @Roles('CREATOR')
  @Header('Cache-Control', 'no-store')
  async customer(
    @CurrentUser() current: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ): Promise<CreatorCustomerDetailResponse> {
    if (!UUID.test(conversationId)) throw notFound();
    const outcome = await this.chat.customerDetail(current.user.id, conversationId);
    if (outcome.kind === 'not_found') throw notFound();
    return {
      customer: {
        display_name: outcome.customer.displayName,
        avatar_url: outcome.customer.avatarUrl,
        username: outcome.customer.username,
      },
      access: toAccess(outcome.access),
    };
  }
}
