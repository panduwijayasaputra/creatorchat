import { describe, expect, it } from 'vitest';
import { chatMessage } from '../../test/fake-miniapp-api';
import { dayLabel, groupByDay, mergeMessages } from './chat-model';

const JKT = 'Asia/Jakarta';
// 2026-11-17 12:00 in Jakarta
const now = new Date('2026-11-17T05:00:00.000Z');

describe('mergeMessages', () => {
  it('keeps seq order and never duplicates an overlapping page', () => {
    const a = [chatMessage(1), chatMessage(2), chatMessage(3)];
    const b = [chatMessage(3, { body: 'baru' }), chatMessage(4)];
    const merged = mergeMessages(a, b);
    expect(merged.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(merged[2]?.body).toBe('baru');
  });
  it('prepends an older page', () => {
    expect(
      mergeMessages([chatMessage(5), chatMessage(6)], [chatMessage(3), chatMessage(4)]).map(
        (m) => m.seq,
      ),
    ).toEqual([3, 4, 5, 6]);
  });
});

describe('dayLabel', () => {
  it('Hari ini and Kemarin in the account zone', () => {
    expect(dayLabel('2026-11-17T01:00:00.000Z', JKT, now)).toBe('Hari ini');
    expect(dayLabel('2026-11-16T10:00:00.000Z', JKT, now)).toBe('Kemarin');
  });
  it('follows the zone around midnight', () => {
    // 2026-11-16T18:00Z is already 17 Nov 01:00 in Jakarta, but still 16 Nov in New York
    expect(dayLabel('2026-11-16T18:00:00.000Z', JKT, now)).toBe('Hari ini');
    expect(dayLabel('2026-11-16T18:00:00.000Z', 'America/New_York', now)).toBe('Kemarin');
  });
  it('older dates use weekday, day and month; another year adds the year', () => {
    expect(dayLabel('2026-11-06T09:00:00.000Z', JKT, now)).toBe('Jumat, 6 Nov');
    expect(dayLabel('2025-11-06T09:00:00.000Z', JKT, now)).toContain('2025');
  });
  it('falls back to Jakarta for an unknown zone', () => {
    expect(dayLabel('2026-11-17T01:00:00.000Z', 'Mars/Olympus', now)).toBe('Hari ini');
  });
});

describe('groupByDay', () => {
  it('splits by day and keeps message order', () => {
    const groups = groupByDay(
      [
        chatMessage(1, { created_at: '2026-11-06T09:00:00.000Z' }),
        chatMessage(2, { created_at: '2026-11-06T10:00:00.000Z' }),
        chatMessage(3, { created_at: '2026-11-17T01:00:00.000Z' }),
      ],
      JKT,
      now,
    );
    expect(groups.map((g) => [g.label, g.messages.length])).toEqual([
      ['Jumat, 6 Nov', 2],
      ['Hari ini', 1],
    ]);
  });
});
