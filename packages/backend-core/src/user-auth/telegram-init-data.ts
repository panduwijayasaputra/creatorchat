import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** initData is a short query string; anything larger is not from Telegram. */
export const MAX_INIT_DATA_LENGTH = 4096;
/** Tolerated clock skew for an auth_date slightly in the future. */
export const FUTURE_SKEW_SECONDS = 60;

export interface TelegramUser {
  telegramId: bigint;
  firstName: string;
  lastName?: string | undefined;
  username?: string | undefined;
  photoUrl?: string | undefined;
}

export type InitDataFailure = 'malformed' | 'bad_signature' | 'expired' | 'missing_user';

export type InitDataResult =
  { ok: true; user: TelegramUser; authDate: Date } | { ok: false; reason: InitDataFailure };

const TelegramUserJsonSchema = z.object({
  id: z.number().int().positive().safe(),
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
});

function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function signature(botToken: string, checkString: string): Buffer {
  // Telegram: secret_key = HMAC_SHA256(key = "WebAppData", message = bot_token).
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secretKey).update(checkString).digest();
}

/**
 * Validates Telegram Mini App `initData`
 * (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * The signature is checked first, so `expired` is only ever reported for data Telegram really signed.
 * Never throws on garbage input and never echoes the input.
 */
export function validateInitData(
  initData: string,
  botToken: string,
  now: Date,
  maxAgeSeconds: number,
): InitDataResult {
  if (initData.length === 0 || initData.length > MAX_INIT_DATA_LENGTH) {
    return { ok: false, reason: 'malformed' };
  }
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (hash === null || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: 'malformed' };

  const expected = signature(botToken, dataCheckString(params));
  const received = Buffer.from(hash, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const authDateRaw = params.get('auth_date');
  if (authDateRaw === null || !/^[0-9]{1,12}$/.test(authDateRaw)) {
    return { ok: false, reason: 'malformed' };
  }
  const authDateSeconds = Number(authDateRaw);
  const ageSeconds = Math.floor(now.getTime() / 1000) - authDateSeconds;
  if (ageSeconds < -FUTURE_SKEW_SECONDS) return { ok: false, reason: 'malformed' };
  if (ageSeconds > maxAgeSeconds) return { ok: false, reason: 'expired' };

  const userRaw = params.get('user');
  if (userRaw === null) return { ok: false, reason: 'missing_user' };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(userRaw);
  } catch {
    return { ok: false, reason: 'missing_user' };
  }
  const parsed = TelegramUserJsonSchema.safeParse(parsedJson);
  if (!parsed.success) return { ok: false, reason: 'missing_user' };

  return {
    ok: true,
    authDate: new Date(authDateSeconds * 1000),
    user: {
      telegramId: BigInt(parsed.data.id),
      firstName: parsed.data.first_name,
      lastName: parsed.data.last_name,
      username: parsed.data.username,
      photoUrl: parsed.data.photo_url,
    },
  };
}

export interface SignedInitDataInput {
  botToken: string;
  user: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
  };
  authDate: Date;
  extra?: Record<string, string>;
}

/**
 * Builds initData signed exactly as Telegram does. For tests and the local dev tool only: with a
 * real bot token it would mint valid logins, so API code never calls it.
 */
export function buildSignedInitData(input: SignedInitDataInput): string {
  const params = new URLSearchParams({
    ...(input.extra ?? {}),
    auth_date: String(Math.floor(input.authDate.getTime() / 1000)),
    user: JSON.stringify(input.user),
  });
  params.set('hash', signature(input.botToken, dataCheckString(params)).toString('hex'));
  return params.toString();
}
