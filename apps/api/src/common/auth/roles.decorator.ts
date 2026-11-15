import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@creatorchat/contracts';

export const ROLES_KEY = 'cc:roles';

/**
 * Declares which account roles may call a user endpoint (on the handler or the whole controller).
 * Every route under `UserJwtGuard` must declare it; `RolesGuard` rejects a route that does not.
 */
export const Roles = (...roles: [UserRole, ...UserRole[]]) => SetMetadata(ROLES_KEY, roles);
