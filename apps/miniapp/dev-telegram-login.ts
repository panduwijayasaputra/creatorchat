import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import type { Plugin } from 'vite';
import { createInitData } from '../../packages/backend-core/scripts/initdata-tool';

export const DEV_INIT_DATA_PATH = '/__dev/initdata';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Development server only (`apply: 'serve'`, never in a build): `GET /__dev/initdata?id=&name=&username=`
 * answers initData signed with TELEGRAM_BOT_TOKEN from the root .env, so a plain browser can log in
 * without `pnpm telegram:initdata`. The API still validates the signature. Answers only loopback
 * clients, so a tunnel to the dev server cannot mint logins. `MINIAPP_DEV_TELEGRAM_LOGIN=off` disables it.
 */
export function devTelegramLogin(): Plugin {
  return {
    name: 'creatorchat:dev-telegram-login',
    apply: 'serve',
    configureServer(server) {
      if (process.env.MINIAPP_DEV_TELEGRAM_LOGIN === 'off') return;
      server.middlewares.use(DEV_INIT_DATA_PATH, (req, res) => {
        const send = (status: number, body: object) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(body));
        };
        if (!LOOPBACK.has(req.socket.remoteAddress ?? ''))
          return send(403, { error: 'loopback only' });

        const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const argv = ['id', 'name', 'username'].flatMap((key) => {
          const value = query.get(key);
          return value ? [`--${key}`, value] : [];
        });
        const rootEnv = resolve(import.meta.dirname, '../../.env');
        const env = {
          ...(existsSync(rootEnv) ? parseEnv(readFileSync(rootEnv, 'utf8')) : {}),
          ...process.env,
        };
        try {
          send(200, { initData: createInitData(argv, env).initData });
        } catch (error) {
          send(400, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}
