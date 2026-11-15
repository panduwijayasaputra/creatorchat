import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { ServerEnv } from '@creatorchat/backend-core';
import { createPrismaClient, type PrismaClient } from '@creatorchat/db';
import { ENV } from './tokens.js';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(ENV) env: ServerEnv) {
    // Connections are opened lazily, so the API can start (and report `degraded`) without a DB.
    this.client = createPrismaClient(env.DATABASE_URL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
