import { describe, expect, it } from 'vitest';
import { formatAccessDate } from './access-date.js';

const ends = new Date('2026-11-27T16:59:00.000Z'); // 23.59 in Jakarta

describe('formatAccessDate', () => {
  it('shows the Indonesian zones with their labels', () => {
    expect(formatAccessDate(ends, 'Asia/Jakarta')).toBe('27 Nov 2026, 23.59 WIB');
    expect(formatAccessDate(ends, 'Asia/Makassar')).toBe('28 Nov 2026, 00.59 WITA');
    expect(formatAccessDate(ends, 'Asia/Jayapura')).toBe('28 Nov 2026, 01.59 WIT');
  });

  it('keeps midnight as 00 and uses Indonesian short months', () => {
    expect(formatAccessDate(new Date('2026-05-31T17:00:00.000Z'), 'Asia/Jakarta')).toBe(
      '1 Jun 2026, 00.00 WIB',
    );
    expect(formatAccessDate(new Date('2026-08-10T03:05:00.000Z'), 'Asia/Jakarta')).toBe(
      '10 Agu 2026, 10.05 WIB',
    );
  });

  it("uses the zone's own short name for other zones, and falls back for an unknown one", () => {
    expect(formatAccessDate(ends, 'America/New_York')).toMatch(/^27 Nov 2026, 11\.59 /);
    expect(formatAccessDate(ends, 'Nowhere/Land')).toBe('27 Nov 2026, 23.59 WIB');
  });
});
