import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CHIP_SPECS, StatusChip, type ChipStatus } from './StatusChip';

const expected: [ChipStatus, string][] = [
  ['request', 'Request'],
  ['active', 'Active'],
  ['blocked', 'Blocked'],
  ['success', 'Berhasil'],
  ['failed', 'Gagal'],
  ['expired', 'Kedaluwarsa'],
  ['revoked', 'Dicabut'],
  ['rejected', 'Ditolak'],
  ['pending', 'Menunggu'],
  ['none', 'Belum mengajukan'],
];

describe('StatusChip', () => {
  it('covers exactly the nine designed statuses', () => {
    expect(Object.keys(CHIP_SPECS).sort()).toEqual(expected.map(([s]) => s).sort());
  });

  it.each(expected)('%s renders an icon and the label "%s"', (status, label) => {
    const { container } = render(<StatusChip status={status} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container).toHaveTextContent(label);
    expect(container.textContent?.trim()).toBe(label);
  });

  it('allows a label override but keeps the icon', () => {
    const { container } = render(<StatusChip status="active" label="Aktif" />);
    expect(container.textContent?.trim()).toBe('Aktif');
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
