import type { UserRole } from '@creatorchat/contracts';
import type { AuthenticatedUser, UserAuthService } from '../user-auth/user-auth.service.js';

export type ConnectionDecision =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; reason: 'unauthenticated' | 'forbidden_role' };

/**
 * One identity check for any long-lived connection (the Phase C socket handshake and room joins).
 * It applies the same rules as an HTTP request: the session row, the account status and
 * `session_version` are re-read, an admin or forged token is `unauthenticated`, and the role comes
 * from the live account row.
 */
export async function authorizeConnection(
  auth: Pick<UserAuthService, 'authenticate'>,
  token: string,
  options: { roles: readonly UserRole[] },
): Promise<ConnectionDecision> {
  const user = await auth.authenticate(token);
  if (!user) return { ok: false, reason: 'unauthenticated' };
  if (!options.roles.includes(user.role)) return { ok: false, reason: 'forbidden_role' };
  return { ok: true, user };
}
