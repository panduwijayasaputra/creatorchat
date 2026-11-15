import 'reflect-metadata';
import { EnvError, getIntegrationStatus, loadEnv } from '@creatorchat/backend-core';
import { createApp } from './app.factory.js';

async function bootstrap(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    // EnvError lists keys only, never values.
    console.error(error instanceof EnvError ? error.message : 'Failed to load configuration');
    process.exit(1);
  }

  const app = await createApp(env);
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });

  const log = app.getHttpAdapter().getInstance().log;
  log.info({ port: env.API_PORT, env: env.NODE_ENV }, 'api listening');
  log.info({ integrations: getIntegrationStatus(env) }, 'integration status');
}

void bootstrap();
