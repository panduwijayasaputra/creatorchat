/** DI token for the admin auth service, or `null` when the admin token secrets are not configured. */
export const ADMIN_AUTH = Symbol('ADMIN_AUTH');

/** DI token for the Mini App user auth service, or `null` when the bot token / session secret are not configured. */
export const USER_AUTH = Symbol('USER_AUTH');
