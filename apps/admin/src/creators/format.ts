/** The admin dashboard shows times in WIB, as the boards do (there is no admin timezone setting). */
const ZONE = 'Asia/Jakarta';

/** `15.02` */
export function formatClockWib(iso: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: ZONE,
  }).format(new Date(iso));
}

/** `27 Nov 2026` */
export function formatDateWib(iso: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: ZONE,
  }).format(new Date(iso));
}

/** Up to two initials of a display name, for the avatar disc. */
export function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

/** `14 Nov 2026, 14.58 WIB` */
export function formatDateTimeWib(iso: string): string {
  return `${formatDateWib(iso)}, ${formatClockWib(iso)} WIB`;
}

/** `13 Nov 2026, 11.20.18 WIB (UTC+7)` */
export function formatFullWib(iso: string): string {
  const clock = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: ZONE,
  }).format(new Date(iso));
  return `${formatDateWib(iso)}, ${clock} WIB (UTC+7)`;
}

/** `2,4 MB` / `18 MB` / `512 KB`: Indonesian decimal comma, one decimal below 10 MB, whole numbers above. */
export function formatBytes(bytes: number): string {
  const number = (value: number, decimals: number) =>
    new Intl.NumberFormat('id-ID', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    }).format(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${number(Math.round(bytes / 1024), 0)} KB`;
  const mb = bytes / 1_048_576;
  return `${number(mb, mb < 10 ? 1 : 0)} MB`;
}
