import type { AuthenticatedUser } from '@creatorchat/backend-core';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `UserJwtGuard` only. Never read from the client. */
    user?: AuthenticatedUser;
  }
}
