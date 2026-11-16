const FALLBACK_ZONE = 'Asia/Jakarta';

/** True when this runtime knows the IANA zone (an unknown one makes Intl throw). */
function isKnownZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('id-ID', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Formats a stored UTC instant in the account's display timezone (`user.timezone`). Every screen
 * that shows a time goes through here, so changing the timezone changes display only. An unknown
 * zone falls back to Asia/Jakarta and an invalid date renders as "-"; it never throws.
 */
export function formatDateTime(
  value: string | number | Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const zone = isKnownZone(timeZone) ? timeZone : FALLBACK_ZONE;
  return new Intl.DateTimeFormat('id-ID', { ...options, timeZone: zone }).format(date);
}

/** Clock time only, e.g. "07.00" (the chat message time). */
export function formatTime(value: string | number | Date, timeZone: string): string {
  return formatDateTime(value, timeZone, { hour: '2-digit', minute: '2-digit', hour12: false });
}
