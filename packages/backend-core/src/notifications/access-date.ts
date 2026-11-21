const FALLBACK_ZONE = 'Asia/Jakarta';

const ZONE_LABEL: Record<string, string> = {
  'Asia/Jakarta': 'WIB',
  'Asia/Makassar': 'WITA',
  'Asia/Jayapura': 'WIT',
};

function knownZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('id-ID', { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_ZONE;
  }
}

/**
 * An access date as the boards show it, in the account's display timezone: `27 Nov 2026, 23.59 WIB`
 * (WIB / WITA / WIT for the Indonesian zones, the zone's own short name otherwise). An unknown zone
 * falls back to Asia/Jakarta; it never throws.
 */
export function formatAccessDate(value: Date, timeZone: string): string {
  const zone = knownZone(timeZone);
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: zone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(value);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const label = ZONE_LABEL[zone] ?? get('timeZoneName');
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}.${get('minute')} ${label}`;
}
