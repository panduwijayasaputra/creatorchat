import { REDACT_PATHS } from '@creatorchat/backend-core';
import { pino, type Logger } from 'pino';

export function createLogger(level: string, stream?: NodeJS.WritableStream): Logger {
  return pino(
    {
      level,
      base: { app: 'worker' },
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    },
    stream,
  );
}
