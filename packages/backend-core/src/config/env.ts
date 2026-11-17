import { z } from 'zod';

/** Empty values and placeholders such as `<set-locally>` or `https://<tunnel-or-domain>` mean "not configured". */
export function isUnset(value: string | undefined): boolean {
  if (value === undefined) return true;
  const trimmed = value.trim();
  return trimmed === '' || /<[^>]*>/.test(trimmed);
}

/** Optional string: placeholders and empty values become `undefined`. */
const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && isUnset(v) ? undefined : v),
  z.string().optional(),
);

const optionalUrl = z.preprocess(
  (v) => (typeof v === 'string' && isUnset(v) ? undefined : v),
  z.url().optional(),
);

const requiredUrl = z.string().refine(
  (v) => {
    if (isUnset(v)) return false;
    try {
      new URL(v);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'must be a URL' },
);

const originList = z.preprocess(
  (v) =>
    typeof v === 'string'
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '' && !isUnset(s))
      : v,
  z.array(z.url()).default([]),
);

const booleanString = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() === 'true' : v),
  z.boolean().default(false),
);

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DATABASE_URL: requiredUrl,
  DATABASE_URL_TEST: optionalUrl,
  REDIS_URL: requiredUrl,
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_PUBLIC_URL: optionalUrl,
  ALLOWED_ORIGINS: originList,
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_BOT_USERNAME: optionalString,
  TELEGRAM_WEBHOOK_SECRET: optionalString,
  TELEGRAM_INITDATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86400),
  MINIAPP_URL: optionalUrl,
  USER_SESSION_SECRET: optionalString,
  ADMIN_ACCESS_TOKEN_SECRET: optionalString,
  ADMIN_REFRESH_TOKEN_SECRET: optionalString,
  MASTER_ENCRYPTION_KEY: optionalString,
  COOKIE_SECURE: booleanString,
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: optionalString,
  R2_ACCOUNT_ENDPOINT: optionalUrl,
  R2_BUCKET: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  // Media (US-032). `local` keeps files on disk behind short-lived signed URLs served by the API
  // (development and tests only); `r2` uses the private bucket.
  STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('.data/media'),
  STORAGE_LOCAL_SIGNING_SECRET: optionalString,
  MEDIA_MAX_PHOTO_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  MEDIA_MAX_VIDEO_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(200 * 1024 * 1024),
  MEDIA_MAX_VIDEO_SECONDS: z.coerce.number().int().positive().default(300),
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  FFPROBE_PATH: z.string().min(1).default('ffprobe'),
  AI_PROVIDER: z.string().default('fake'),
  AI_MODEL: optionalString,
  AI_API_KEY: optionalString,
});

const MIN_SECRET_LENGTH = 32;

export const ServerEnvSchema = baseSchema.superRefine((env, ctx) => {
  const secret = env.STORAGE_LOCAL_SIGNING_SECRET;
  if (secret !== undefined && secret.length < MIN_SECRET_LENGTH) {
    ctx.addIssue({
      code: 'custom',
      path: ['STORAGE_LOCAL_SIGNING_SECRET'],
      message: `at least ${MIN_SECRET_LENGTH} characters`,
    });
  }
  if (env.STORAGE_DRIVER === 'r2') {
    for (const key of [
      'R2_ACCOUNT_ENDPOINT',
      'R2_BUCKET',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
    ] as const) {
      if (env[key] === undefined) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'required when STORAGE_DRIVER=r2' });
      }
    }
  }
  if (env.NODE_ENV !== 'production') return;
  if (env.STORAGE_DRIVER === 'local') {
    ctx.addIssue({
      code: 'custom',
      path: ['STORAGE_DRIVER'],
      message: 'local disk storage is for development and tests only; use r2 in production',
    });
  }
  const secretKeys = [
    'USER_SESSION_SECRET',
    'ADMIN_ACCESS_TOKEN_SECRET',
    'ADMIN_REFRESH_TOKEN_SECRET',
  ] as const;
  const seen = new Set<string>();
  for (const key of secretKeys) {
    const value = env[key];
    if (value === undefined || value.length < MIN_SECRET_LENGTH) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `required in production, at least ${MIN_SECRET_LENGTH} characters`,
      });
    } else if (seen.has(value)) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'must differ from the other secrets' });
    } else {
      seen.add(value);
    }
  }
  if (env.MASTER_ENCRYPTION_KEY === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['MASTER_ENCRYPTION_KEY'],
      message: 'required in production',
    });
  }
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

/** Thrown for invalid configuration. Lists keys and reasons only — never values. */
export class EnvError extends Error {
  readonly keys: string[];

  constructor(issues: { key: string; message: string }[]) {
    super(
      `Invalid environment configuration:\n${issues.map((i) => `  - ${i.key}: ${i.message}`).join('\n')}`,
    );
    this.name = 'EnvError';
    this.keys = issues.map((i) => i.key);
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const result = ServerEnvSchema.safeParse(source);
  if (result.success) return result.data;
  throw new EnvError(
    result.error.issues.map((issue) => ({
      key: issue.path.join('.') || '(root)',
      // Custom messages are authored here and describe the rule, not the input value.
      message: issue.code === 'custom' ? issue.message : `invalid (${issue.code})`,
    })),
  );
}
