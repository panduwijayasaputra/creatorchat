import { Controller, Get, Header, Inject, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser, ChatListService } from '@creatorchat/backend-core';
import {
  ChatListQuerySchema,
  ErrorCode,
  type ChatListQuery,
  type ChatListResponse,
  type ChatUnreadResponse,
} from '@creatorchat/contracts';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { CurrentUser, UserJwtGuard } from '../../common/auth/user-jwt.guard.js';
import { AppError } from '../../common/errors/app-error.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { CHAT_LIST } from './tokens.js';

/**
 * The customer's chat list and the unread total of the bottom navigation (US-027). Customers only;
 * the viewer comes from the session and the requests carry no id. Read-only.
 */
@Controller('chats')
@UseGuards(UserJwtGuard, RolesGuard)
export class ChatListController {
  constructor(@Inject(CHAT_LIST) private readonly list: ChatListService) {}

  @Get()
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async chats(
    @CurrentUser() current: AuthenticatedUser,
    @Query(new ZodValidationPipe(ChatListQuerySchema)) query: ChatListQuery,
  ): Promise<ChatListResponse> {
    const out = await this.list.list(current.user.id, {
      limit: query.limit,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    });
    if (out.kind === 'bad_cursor') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'The cursor is not valid.');
    }
    return {
      items: out.items.map((row) => ({
        conversation_id: row.conversationId,
        public_code: row.publicCode,
        display_name: row.displayName,
        avatar_url: row.avatarUrl,
        last_message: row.lastMessage
          ? {
              preview: row.lastMessage.preview,
              at: row.lastMessage.at.toISOString(),
              media_kind: row.lastMessage.mediaKind,
            }
          : null,
        unread_count: row.unreadCount,
        access: row.access,
      })),
      next_cursor: out.nextCursor,
    };
  }

  @Get('unread')
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async unread(@CurrentUser() current: AuthenticatedUser): Promise<ChatUnreadResponse> {
    return { unread_total: await this.list.unreadTotal(current.user.id) };
  }
}
