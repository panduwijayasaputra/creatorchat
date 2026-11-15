import { Module } from '@nestjs/common';
import { AdminAuthModule } from './admin-auth/admin-auth.module.js';

/**
 * `/v1/admin` scope. Everything in here uses `CsrfGuard` + `AdminJwtGuard` and nothing from the
 * Telegram user session. Later admin capabilities (creators, users, audit, ...) are added here.
 */
@Module({ imports: [AdminAuthModule] })
export class AdminModule {}
