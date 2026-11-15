import type { AuthenticatedAdmin } from '@creatorchat/backend-core';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `AdminJwtGuard` only. Never read from the client. */
    admin?: AuthenticatedAdmin;
  }
}
