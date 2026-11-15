import { Module, type DynamicModule, type Type } from '@nestjs/common';
import type { ServerEnv } from '@creatorchat/backend-core';
import { AdminModule } from './admin/admin.module.js';
import { InfraModule } from './common/infra/infra.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CreatorsModule } from './modules/creators/creators.module.js';
import { MeModule } from './modules/me/me.module.js';
import { TelegramWebhookModule } from './modules/telegram-webhook/telegram-webhook.module.js';

@Module({})
export class AppModule {
  static register(env: ServerEnv, extraModules: Type[] = []): DynamicModule {
    return {
      module: AppModule,
      imports: [
        InfraModule.register(env),
        HealthModule,
        AdminModule,
        AuthModule,
        MeModule,
        CreatorsModule,
        TelegramWebhookModule,
        ...extraModules,
      ],
    };
  }
}
