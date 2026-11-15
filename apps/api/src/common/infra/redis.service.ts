import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { ServerEnv } from '@creatorchat/backend-core';
import { Redis } from 'ioredis';
import { ENV } from './tokens.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(ENV) env: ServerEnv) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
    });
    // Without a listener, connection errors would crash the process; health reports them instead.
    this.client.on('error', () => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
