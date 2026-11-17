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
  UseGuards,
} from '@nestjs/common';
import type {
  AuthenticatedUser,
  ConversationReadService,
  CreatorInboxService,
} from '@creatorchat/backend-core';
import {
  ErrorCode,
  InboxQuerySchema,
  ReadBodySchema,
  type CreatorUnreadResponse,
  type InboxQuery,
  type ReadBody,
  type ReadResponse,
  type InboxResponse,
} from '@creatorchat/contracts';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { CurrentUser, UserJwtGuard } from '../../common/auth/user-jwt.guard.js';
import { AppError } from '../../common/errors/app-error.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { CREATOR_INBOX, CREATOR_READ } from './tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The creator's inbox (US-028). Creators only; there is no id in the request, the creator comes
 * from the session. The answer holds names, previews and counts, never a Telegram id.
 */
@Controller('creator')
@UseGuards(UserJwtGuard, RolesGuard)
export class CreatorInboxController {
  constructor(
    @Inject(CREATOR_INBOX) private readonly inbox: CreatorInboxService,
    @Inject(CREATOR_READ) private readonly reads: ConversationReadService,
  ) {}

  @Get('inbox')
  @Roles('CREATOR')
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser() current: AuthenticatedUser,
    @Query(new ZodValidationPipe(InboxQuerySchema)) query: InboxQuery,
  ): Promise<InboxResponse> {
    const outcome = await this.inbox.list(current.user.id, query);
    if (outcome.kind === 'bad_cursor') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'Invalid cursor.');
    }
    return {
      items: outcome.items.map((i) => ({
        conversation_id: i.conversationId,
        customer: { display_name: i.customerName, avatar_url: i.customerAvatarUrl },
        preview: i.preview,
        preview_media_kind: i.previewMediaKind,
        last_message_at: i.lastMessageAt.toISOString(),
        unread_count: i.unreadCount,
        access_active: i.accessActive,
      })),
      next_cursor: outcome.nextCursor,
      unread_conversations: outcome.unreadConversations,
    };
  }

  /** The Inbox tab badge: conversations with unread customer messages. */
  @Get('inbox/unread')
  @Roles('CREATOR')
  @Header('Cache-Control', 'no-store')
  async unread(@CurrentUser() current: AuthenticatedUser): Promise<CreatorUnreadResponse> {
    return { unread_conversations: await this.inbox.unreadConversations(current.user.id) };
  }

  /** Moves my own read cursor (US-030). Only the creator of the conversation; anything else is 404. */
  @Post('inbox/:conversationId/read')
  @HttpCode(200)
  @Roles('CREATOR')
  async read(
    @CurrentUser() current: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body(new ZodValidationPipe(ReadBodySchema)) body: ReadBody,
  ): Promise<ReadResponse> {
    const notFound = () => new AppError(ErrorCode.NOT_FOUND, 404, 'Not found.');
    if (!UUID.test(conversationId)) throw notFound();
    const outcome = await this.reads.advance(
      current.user.id,
      'creator',
      conversationId,
      body.through_seq,
    );
    if (outcome.kind === 'not_found') throw notFound();
    return { last_read_seq: outcome.lastReadSeq };
  }
}
