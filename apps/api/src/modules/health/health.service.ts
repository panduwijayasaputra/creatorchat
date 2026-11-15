import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DependencyStatus, HealthResponse } from '@creatorchat/contracts';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { RedisService } from '../../common/infra/redis.service.js';

const CHECK_TIMEOUT_MS = 2000;

async function probe(name: string, check: () => Promise<unknown>): Promise<DependencyStatus> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return 'up';
  } catch (error) {
    // The reason stays server-side; the response only says up/down.
    new Logger('Health').warn(`${name} check failed: ${(error as Error).name}`);
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthResponse> {
    const [db, redis] = await Promise.all([
      probe('db', () => this.prisma.client.$queryRaw`SELECT 1`),
      probe('redis', () => this.redis.client.ping()),
    ]);
    return { status: db === 'up' && redis === 'up' ? 'ok' : 'degraded', checks: { db, redis } };
  }
}
