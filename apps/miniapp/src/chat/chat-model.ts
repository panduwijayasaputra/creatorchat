import { formatDateTime } from '../format/date-time';

/** Server messages by `seq` (ascending); the incoming copy wins for a repeated seq. */
export function mergeMessages<M extends { seq: number }>(existing: M[], incoming: M[]): M[] {
  const bySeq = new Map<number, M>();
  for (const m of existing) bySeq.set(m.seq, m);
  for (const m of incoming) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** The calendar day of an instant in the account zone, `YYYY-MM-DD` (unknown zone: Asia/Jakarta). */
function dayKey(value: string | Date, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = (zone: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
  let list: Intl.DateTimeFormatPart[];
  try {
    list = parts(timeZone);
  } catch {
    list = parts('Asia/Jakarta');
  }
  const get = (type: string) => list.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "Hari ini", "Kemarin", else "Jumat, 6 Nov" (the year is added for another year: not designed). */
export function dayLabel(value: string | Date, timeZone: string, now: Date): string {
  const key = dayKey(value, timeZone);
  if (key === dayKey(now, timeZone)) return 'Hari ini';
  if (key === dayKey(new Date(now.getTime() - 86_400_000), timeZone)) return 'Kemarin';
  const sameYear = key.slice(0, 4) === dayKey(now, timeZone).slice(0, 4);
  return formatDateTime(value, timeZone, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export interface DayGroup<M extends { created_at: string }> {
  key: string;
  label: string;
  messages: M[];
}

/** Ascending messages split by calendar day in the account zone. */
export function groupByDay<M extends { created_at: string }>(
  messages: M[],
  timeZone: string,
  now: Date,
): DayGroup<M>[] {
  const groups: DayGroup<M>[] = [];
  for (const message of messages) {
    const key = dayKey(message.created_at, timeZone);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.messages.push(message);
    else
      groups.push({ key, label: dayLabel(message.created_at, timeZone, now), messages: [message] });
  }
  return groups;
}
