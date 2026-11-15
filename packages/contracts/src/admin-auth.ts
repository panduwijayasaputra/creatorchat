import { z } from 'zod';

/** Lockout policy shown to the admin ("Percobaan: N dari 5", "dikunci 15 menit"). */
export const ADMIN_LOGIN_MAX_ATTEMPTS = 5;
export const ADMIN_LOGIN_LOCK_SECONDS = 900;

/** The CSRF token is echoed in this header on every unsafe admin request (double-submit cookie). */
export const ADMIN_CSRF_HEADER = 'x-csrf-token';

export const ADMIN_COOKIE = {
  access: 'cc_admin_at',
  refresh: 'cc_admin_rt',
  csrf: 'cc_admin_csrf',
} as const;

export const ADMIN_API_PREFIX = '/v1/admin';
export const ADMIN_AUTH_PATH = `${ADMIN_API_PREFIX}/auth`;

/** Inline validation copy; the login screen shows these strings verbatim. */
export const ADMIN_LOGIN_MESSAGES = {
  usernameRequired: 'Username wajib diisi.',
  passwordRequired: 'Password wajib diisi.',
} as const;

/** Login input. No complexity rules here: those apply when a password is created, not checked. */
export const AdminLoginRequestSchema = z.object({
  username: z
    .string({ error: ADMIN_LOGIN_MESSAGES.usernameRequired })
    .trim()
    .min(1, ADMIN_LOGIN_MESSAGES.usernameRequired)
    .max(64),
  password: z
    .string({ error: ADMIN_LOGIN_MESSAGES.passwordRequired })
    .min(1, ADMIN_LOGIN_MESSAGES.passwordRequired)
    .max(256),
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;

/** The signed-in admin as the dashboard needs it. Never carries hashes or session internals. */
export const AdminProfileSchema = z.strictObject({
  id: z.uuid(),
  username: z.string().min(1),
  role: z.literal('Administrator'),
});
export type AdminProfile = z.infer<typeof AdminProfileSchema>;

/** Response of `POST /login` and `GET /me`. */
export const AdminSessionResponseSchema = z.strictObject({ admin: AdminProfileSchema });
export type AdminSessionResponse = z.infer<typeof AdminSessionResponseSchema>;

/** `details` of a `INVALID_CREDENTIALS` error. */
export const LoginFailureDetailsSchema = z.strictObject({
  attempts: z.number().int().min(1),
  max: z.literal(ADMIN_LOGIN_MAX_ATTEMPTS),
});
export type LoginFailureDetails = z.infer<typeof LoginFailureDetailsSchema>;

/** `details` of a `LOGIN_LOCKED` error. */
export const LoginLockedDetailsSchema = z.strictObject({
  retry_after_seconds: z.number().int().min(1),
});
export type LoginLockedDetails = z.infer<typeof LoginLockedDetailsSchema>;
