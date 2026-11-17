import {
  Body,
  Controller,
  Get,
  HttpCode,
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
  ChatMediaService,
  ChatService,
  ConversationReadService,
  StoredMessage,
} from '@creatorchat/backend-core';
import {
  ChatHistoryQuerySchema,
  ErrorCode,
  type ChatMediaDetail,
  type ChatMediaListResponse,
  ReadBodySchema,
  SendMessageBodySchema,
  type ReadBody,
  type ReadResponse,
  type ChatHistoryQuery,
  type ChatHistoryResponse,
  type ChatMessage,
  type SendMessageBody,
  type SendMessageResponse,
} from '@creatorchat/contracts';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { CurrentUser, UserJwtGuard } from '../../common/auth/user-jwt.guard.js';
import { AppError } from '../../common/errors/app-error.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { toAttachmentJson } from '../media/attachment-json.js';
import { CHAT, CHAT_MEDIA, CHAT_READ } from './tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Wrong owner, unknown and malformed ids all look the same. */
const notFound = () => new AppError(ErrorCode.NOT_FOUND, 404, 'Not found.');

const toMessage = (m: StoredMessage): ChatMessage => ({
  id: m.id,
  client_message_id: m.clientMessageId,
  seq: m.seq,
  sender: m.sender,
  type: m.type,
  body: m.body,
  attachments: m.attachments.map(toAttachmentJson),
  created_at: m.createdAt.toISOString(),
});

/**
 * The customer side of a private chat (US-026). Customers only (`@Roles('USER')`); the customer id
 * comes from the session and every query is scoped to it in the service. Answers carry no user or
 * creator ids and nothing about AI.
 */
@Controller('chats')
@UseGuards(UserJwtGuard, RolesGuard)
export class ChatController {
  constructor(
    @Inject(CHAT) private readonly chat: ChatService,
    @Inject(CHAT_READ) private readonly reads: ConversationReadService,
    @Inject(CHAT_MEDIA) private readonly media: ChatMediaService | null,
  ) {}

  private files(): ChatMediaService {
    if (!this.media) {
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        503,
        'The service is temporarily unavailable.',
      );
    }
    return this.media;
  }

  @Get(':conversationId/messages')
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async history(
    @CurrentUser() current: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Query(new ZodValidationPipe(ChatHistoryQuerySchema)) query: ChatHistoryQuery,
  ): Promise<ChatHistoryResponse> {
    if (!UUID.test(conversationId)) throw notFound();
    const outcome = await this.chat.history(current.user.id, conversationId, query);
    if (outcome.kind === 'not_found') throw notFound();
    const { conversation, items, nextBefore } = outcome.history;
    const access = conversation.access;
    return {
      conversation: {
        id: conversation.id,
        creator: {
          public_code: conversation.creator.publicCode,
          display_name: conversation.creator.displayName,
          avatar_url: conversation.creator.avatarUrl,
        },
        access: {
          state: access.state,
          ends_at: access.state === 'ACTIVE' ? access.endsAt.toISOString() : null,
          ended_at:
            access.state === 'EXPIRED' && access.endedAt ? access.endedAt.toISOString() : null,
        },
        peer_read_seq: conversation.peerReadSeq,
      },
      items: items.map(toMessage),
      next_before: nextBefore,
    };
  }

  /** 201 for a new message, 200 when the same `client_message_id` was already stored. */
  @Post(':conversationId/messages')
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async send(
    @CurrentUser() current: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body(new ZodValidationPipe(SendMessageBodySchema)) body: SendMessageBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SendMessageResponse> {
    if (!UUID.test(conversationId)) throw notFound();
    const outcome = await this.chat.send(current.user.id, conversationId, {
      clientMessageId: body.client_message_id,
      body: body.body,
    });
    switch (outcome.kind) {
      case 'not_found':
        throw notFound();
      case 'not_eligible':
        // Blocked or promoted since the token was issued: same as a dead session.
        throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Authentication is required.');
      case 'access_expired':
        throw new AppError(ErrorCode.CHAT_ACCESS_EXPIRED, 403, 'Access has ended.');
      case 'creator_blocked':
        throw new AppError(ErrorCode.CHAT_CREATOR_BLOCKED, 403, 'This creator is not available.');
      case 'conflict':
        throw new AppError(
          ErrorCode.IDEMPOTENCY_CONFLICT,
          409,
          'This message id was already used for other text.',
        );
      case 'invalid':
        throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'Invalid message.');
      default:
        void reply.status(outcome.kind === 'created' ? 201 : 200);
        return { message: toMessage(outcome.message) };
    }
  }

  /** Moves my own read cursor (US-030): up only, never past the newest message. */
  @Post(':conversationId/read')
  @HttpCode(200)
  @Roles('USER')
  async read(
    @CurrentUser() current: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body(new ZodValidationPipe(ReadBodySchema)) body: ReadBody,
  ): Promise<ReadResponse> {
    if (!UUID.test(conversationId)) throw notFound();
    const outcome = await this.reads.advance(
      current.user.id,
      'customer',
      conversationId,
      body.through_seq,
    );
    if (outcome.kind === 'not_found') throw notFound();
    return { last_read_seq: outcome.lastReadSeq };
  }

  /**
   * The files of one of my conversations, oldest first (the viewer's "n / N"). Received files stay
   * readable after the access ended (brief §6): there is no subscription check here.
   */
  @Get(':conversationId/media')
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async mediaList(
    @CurrentUser() current: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ): Promise<ChatMediaListResponse> {
    const outcome = await this.files().list(current.user.id, conversationId);
    if (outcome.kind === 'not_found') throw notFound();
    return { items: outcome.items };
  }

  /** One file with a 5-minute link, its place in the conversation and the neighbouring files. */
  @Get(':conversationId/media/:attachmentId')
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async mediaItem(
    @CurrentUser() current: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<ChatMediaDetail> {
    const outcome = await this.files().detail(current.user.id, conversationId, attachmentId);
    if (outcome.kind === 'not_found') throw notFound();
    return outcome.detail;
  }
}
