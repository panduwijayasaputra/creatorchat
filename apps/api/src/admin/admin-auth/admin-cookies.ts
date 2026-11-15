import type { IssuedTokens, ServerEnv } from '@creatorchat/backend-core';
import { ADMIN_AUTH_PATH, ADMIN_API_PREFIX, ADMIN_COOKIE } from '@creatorchat/contracts';
import type { FastifyReply } from 'fastify';

/** Cookie attributes from the env; `domain` is left out entirely (host-only) when not configured. */
function base(env: ServerEnv) {
  return {
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  } as const;
}

/**
 * - access: HttpOnly, only sent to `/v1/admin/*`
 * - refresh: HttpOnly, only sent to `/v1/admin/auth/*`
 * - csrf: readable by the admin app so it can echo the value in `X-CSRF-Token`
 */
export function setAdminCookies(reply: FastifyReply, env: ServerEnv, tokens: IssuedTokens): void {
  const common = base(env);
  void reply
    .setCookie(ADMIN_COOKIE.access, tokens.accessToken, {
      ...common,
      httpOnly: true,
      path: ADMIN_API_PREFIX,
      expires: tokens.accessExpiresAt,
    })
    .setCookie(ADMIN_COOKIE.refresh, tokens.refreshToken, {
      ...common,
      httpOnly: true,
      path: ADMIN_AUTH_PATH,
      expires: tokens.refreshExpiresAt,
    })
    .setCookie(ADMIN_COOKIE.csrf, tokens.csrfToken, {
      ...common,
      httpOnly: false,
      path: '/',
      expires: tokens.refreshExpiresAt,
    });
}

export function clearAdminCookies(reply: FastifyReply, env: ServerEnv): void {
  const common = base(env);
  void reply
    .clearCookie(ADMIN_COOKIE.access, { ...common, httpOnly: true, path: ADMIN_API_PREFIX })
    .clearCookie(ADMIN_COOKIE.refresh, { ...common, httpOnly: true, path: ADMIN_AUTH_PATH })
    .clearCookie(ADMIN_COOKIE.csrf, { ...common, httpOnly: false, path: '/' });
}
