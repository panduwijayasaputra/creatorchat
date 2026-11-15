import type { ErrorCode } from '@creatorchat/contracts';

/** Expected, client-safe failure. The message is shown to the caller, so keep it generic. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly httpStatus: number,
    message: string,
    readonly details?: unknown,
    /** Extra response headers, e.g. `retry-after`. */
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
