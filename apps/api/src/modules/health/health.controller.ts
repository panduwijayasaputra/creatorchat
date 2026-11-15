import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { HealthResponse } from '@creatorchat/contracts';
import type { FastifyReply } from 'fastify';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  /** Unauthenticated liveness/readiness: reachability only, no versions, hosts or errors. */
  @Get()
  async get(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthResponse> {
    const result = await this.health.check();
    if (result.status !== 'ok') void reply.status(503);
    return result;
  }
}
