import { z } from 'zod';
import { UserProfileSchema } from './user-auth.js';

export const CREATOR_TIMEZONE_PATH = '/v1/creator/timezone';

/** The zones a creator can pick (the `CrTimezone` board). Adding one is a one-line change. */
export const TIMEZONE_OPTIONS = [
  { id: 'Asia/Jakarta', label: 'WIB · Jakarta' },
  { id: 'Asia/Makassar', label: 'WITA · Makassar' },
  { id: 'Asia/Jayapura', label: 'WIT · Jayapura' },
  { id: 'Asia/Singapore', label: 'Singapura' },
  { id: 'Australia/Sydney', label: 'Sydney' },
] as const;

export type TimezoneId = (typeof TIMEZONE_OPTIONS)[number]['id'];

const IDS = TIMEZONE_OPTIONS.map((option) => option.id) as [TimezoneId, ...TimezoneId[]];

export const TimezoneIdSchema = z.enum(IDS);

/** Plain `object`: any other key (`id`, `role`, `display_name`, ...) is stripped and ignored. */
export const UpdateTimezoneRequestSchema = z.object({ timezone: TimezoneIdSchema });
export type UpdateTimezoneRequest = z.infer<typeof UpdateTimezoneRequestSchema>;

export const UpdateTimezoneResponseSchema = UserProfileSchema;
export type UpdateTimezoneResponse = z.infer<typeof UpdateTimezoneResponseSchema>;

/**
 * "UTC+7", "UTC+11", "UTC+5:30" for `timezone` at `at` (DST aware: Sydney is +11 only in summer).
 * Empty string when the zone is unknown, so rendering never throws.
 */
export function utcOffsetLabel(timezone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    }).formatToParts(at);
    const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    // "GMT+07:00", "GMT-03:30" or plain "GMT" for zero.
    const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
    if (!match) return '';
    if (!match[1]) return 'UTC+0';
    const hours = Number(match[2]);
    const minutes = match[3] === '00' ? '' : `:${match[3]}`;
    return `UTC${match[1]}${hours}${minutes}`;
  } catch {
    return '';
  }
}

/** Second line of a timezone option: "Asia/Jakarta · UTC+7". */
export function timezoneDetail(timezone: string, at = new Date()): string {
  const offset = utcOffsetLabel(timezone, at);
  return offset ? `${timezone} · ${offset}` : timezone;
}

/** The `CrSettings` row text: "WIB · Asia/Jakarta (UTC+7)"; the raw id for a zone outside the list. */
export function timezoneSummary(timezone: string, at = new Date()): string {
  const option = TIMEZONE_OPTIONS.find((candidate) => candidate.id === timezone);
  if (!option) return timezone;
  const offset = utcOffsetLabel(timezone, at);
  const short = option.label.split(' · ')[0];
  return `${short} · ${timezone}${offset ? ` (${offset})` : ''}`;
}
