/** A delivery gives up after this many attempts and is marked FAILED (never an endless loop). */
export const MAX_ATTEMPTS = 10;

const SCHEDULE_MS = [
  5_000, // after attempt 1
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000, // attempt 7 and every later attempt
] as const;

/** Delay before the next attempt, given how many attempts have been made so far (>= 1). */
export function backoffMs(attemptsMade: number): number {
  const made = Number.isFinite(attemptsMade) ? Math.trunc(attemptsMade) : 1;
  const index = Math.min(Math.max(made, 1), SCHEDULE_MS.length) - 1;
  return SCHEDULE_MS[index] as number;
}

/** Telegram's `retry_after` is clamped so a bad value can neither spin nor park an event for days. */
export function clampRetryAfterMs(seconds: number): number {
  const ms = Number.isFinite(seconds) ? Math.trunc(seconds) * 1000 : 1000;
  return Math.min(Math.max(ms, 1_000), 60 * 60_000);
}
