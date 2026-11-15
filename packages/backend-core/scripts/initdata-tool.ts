import { parseArgs } from 'node:util';
import { isUnset } from '../src/config/env.js';
import { buildSignedInitData } from '../src/user-auth/telegram-init-data.js';

export const USAGE = `Usage: pnpm telegram:initdata [--id <telegram id>] [--name <first name>] [--last-name <name>]
                              [--username <handle>] [--photo <https url>] [--age-seconds <n>]

Prints Telegram initData signed with TELEGRAM_BOT_TOKEN from .env, for trying the Mini App login
locally. The API still validates it for real. Open the printed URL in a browser (development only).

  --id           numeric Telegram id (default 100000001)
  --name         first name (default Nadia)
  --age-seconds  make the data that old (e.g. 90000 to see "Sesi Telegram berakhir")

Refuses to run when NODE_ENV is production. The bot token is never printed.`;

export class InitDataToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InitDataToolError';
  }
}

export interface InitDataToolResult {
  initData: string;
  devUrl: string;
}

export function createInitData(
  argv: string[],
  env: Record<string, string | undefined>,
  now: Date = new Date(),
): InitDataToolResult {
  const { values } = parseArgs({
    args: argv,
    options: {
      id: { type: 'string', default: '100000001' },
      name: { type: 'string', default: 'Nadia' },
      'last-name': { type: 'string' },
      username: { type: 'string' },
      photo: { type: 'string' },
      'age-seconds': { type: 'string', default: '0' },
    },
    strict: true,
  });

  if (env.NODE_ENV === 'production') {
    throw new InitDataToolError('Refusing to run: NODE_ENV is production.');
  }
  const botToken = env.TELEGRAM_BOT_TOKEN;
  if (botToken === undefined || isUnset(botToken)) {
    throw new InitDataToolError(
      'TELEGRAM_BOT_TOKEN is not set in .env. For local testing any value works (for example a fake "123456:local-dev-token"); the API must use the same one.',
    );
  }
  if (!/^[1-9][0-9]{0,14}$/.test(values.id)) {
    throw new InitDataToolError('--id must be a positive whole number (at most 15 digits).');
  }
  const age = Number(values['age-seconds']);
  if (!Number.isInteger(age) || age < 0) {
    throw new InitDataToolError('--age-seconds must be a whole number of seconds, 0 or more.');
  }

  const initData = buildSignedInitData({
    botToken,
    authDate: new Date(now.getTime() - age * 1000),
    user: {
      id: Number(values.id),
      first_name: values.name,
      ...(values['last-name'] ? { last_name: values['last-name'] } : {}),
      ...(values.username ? { username: values.username } : {}),
      ...(values.photo ? { photo_url: values.photo } : {}),
    },
  });
  const base = (env.MINIAPP_DEV_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  return { initData, devUrl: `${base}/?tgdev=${encodeURIComponent(initData)}` };
}
