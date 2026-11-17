import { Module } from '@nestjs/common';
import {
  ChatListService,
  ChatMediaService,
  ChatService,
  ConversationReadService,
  MediaAccessService,
  OutboxService,
  type ObjectStorage,
} from '@creatorchat/backend-core';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../media/storage.module.js';
import { STORAGE } from '../media/tokens.js';
import { ChatController } from './chat.controller.js';
import { ChatListController } from './chat-list.controller.js';
import { CHAT, CHAT_LIST, CHAT_MEDIA, CHAT_READ } from './tokens.js';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [ChatController, ChatListController],
  providers: [
    {
      provide: CHAT,
      inject: [PrismaService, STORAGE],
      useFactory: (prisma: PrismaService, storage: ObjectStorage | null) =>
        new ChatService(
          prisma.client,
          new OutboxService(),
          undefined,
          storage ? new MediaAccessService(prisma.client, storage) : null,
        ),
    },
    {
      provide: CHAT_MEDIA,
      inject: [PrismaService, STORAGE],
      useFactory: (prisma: PrismaService, storage: ObjectStorage | null) =>
        storage
          ? new ChatMediaService(prisma.client, new MediaAccessService(prisma.client, storage))
          : null,
    },
    {
      provide: CHAT_READ,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ConversationReadService(prisma.client, new OutboxService()),
    },
    {
      provide: CHAT_LIST,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new ChatListService(prisma.client),
    },
  ],
})
export class ChatModule {}
