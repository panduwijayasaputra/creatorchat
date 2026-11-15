export const REDACTED = '[REDACTED]';

/** Keys whose values must never reach a log line, matched case-insensitively at any depth. */
const SENSITIVE_KEY =
  /authorization|cookie|init_?data|password|passwd|token|secret|api_?key|signature/i;

/** pino `redact.paths` for HTTP request/response logging. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-telegram-bot-api-secret-token"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.initData',
  '*.init_data',
  'req.body.init_data',
];

export function redactLogFields(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redactLogFields(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactLogFields(v, depth + 1);
    }
    return out;
  }
  return value;
}
