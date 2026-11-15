import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { ServerEnv } from '@creatorchat/backend-core';
import { PrismaService } from './prisma.service.js';
import { RedisService } from './redis.service.js';
import { ENV } from './tokens.js';

@Global()
@Module({})
export class InfraModule {
  static register(env: ServerEnv): DynamicModule {
    return {
      module: InfraModule,
      providers: [{ provide: ENV, useValue: env }, PrismaService, RedisService],
      exports: [ENV, PrismaService, RedisService],
    };
  }
}
