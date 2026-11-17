import { Module } from '@nestjs/common';
import { AdminAuthModule } from './admin-auth/admin-auth.module.js';
import { AdminAuditLogsModule } from './audit-logs/audit-logs.module.js';
import { AdminCreatorsModule } from './creators/creators.module.js';
import { AdminUsersModule } from './users/users.module.js';
import { AdminUserSubscriptionsModule } from './user-subscriptions/user-subscriptions.module.js';
import { CreatorRequestsModule } from './creator-requests/creator-requests.module.js';

/**
 * `/v1/admin` scope. Everything in here uses `CsrfGuard` + `AdminJwtGuard` and nothing from the
 * Telegram user session. Later admin capabilities (creators, users, audit, ...) are added here.
 */
@Module({
  imports: [
    AdminAuthModule,
    CreatorRequestsModule,
    AdminCreatorsModule,
    AdminAuditLogsModule,
    AdminUsersModule,
    AdminUserSubscriptionsModule,
  ],
})
export class AdminModule {}
