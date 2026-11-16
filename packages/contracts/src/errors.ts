import { z } from 'zod';

/** Stable, machine-readable error codes returned by the API. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  LOGIN_LOCKED: 'LOGIN_LOCKED',
  CSRF_FAILED: 'CSRF_FAILED',
  TELEGRAM_AUTH_INVALID: 'TELEGRAM_AUTH_INVALID',
  TELEGRAM_AUTH_EXPIRED: 'TELEGRAM_AUTH_EXPIRED',
  ACCOUNT_BLOCKED: 'ACCOUNT_BLOCKED',
  CREATOR_NOT_FOUND: 'CREATOR_NOT_FOUND',
  CREATOR_REQUEST_BLOCKED: 'CREATOR_REQUEST_BLOCKED',
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ErrorCodeSchema = z.enum(Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]]);

/** Every API error body: `{ code, message, request_id }` (+ optional safe `details`). */
export const ErrorResponseSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  request_id: z.string().min(1),
  details: z.unknown().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
