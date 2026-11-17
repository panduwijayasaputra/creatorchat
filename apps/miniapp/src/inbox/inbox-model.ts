import { formatDateTime, formatTime } from '../format/date-time';

/** First letters of the first two words: "Rani Anggraini" → "RA". */
export function initialsOf(name: string): string {
  const letters = [...name.trim().split(/\s+/).filter(Boolean)]
    .slice(0, 2)
    .map((word) => [...word][0] ?? '');
  return letters.join('').toUpperCase();
}

/** Clock time for today, "6 Nov" for any other day (as on `CrInbox`; "Kemarin" is not designed). */
export function timeLabel(value: string, timeZone: string, now: Date): string {
  const day = (d: Date | string) =>
    formatDateTime(d, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  if (day(value) === day(now)) return formatTime(value, timeZone);
  return formatDateTime(value, timeZone, { day: 'numeric', month: 'short' });
}

/** Avatar backgrounds of the board (RA, BS, NK): picked by a stable hash of the conversation id. */
export const AVATAR_TONES = ['#E4C1B4', '#D9C3D6', '#F0D3B8'] as const;
export function avatarTone(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length]!;
}
