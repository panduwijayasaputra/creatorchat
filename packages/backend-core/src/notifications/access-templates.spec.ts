import { describe, expect, it } from 'vitest';
import { ACCESS_TEMPLATES, renderTemplate } from './access-templates.js';

describe('renderTemplate', () => {
  it('fills the board texts', () => {
    expect(
      renderTemplate(ACCESS_TEMPLATES.activated, {
        nama: 'Raka',
        creator: 'Salsa',
        tanggal: '27 Nov 2026, 23.59 WIB',
      }),
    ).toBe(
      'Halo Raka, aksesmu ke Salsa sudah aktif sampai 27 Nov 2026, 23.59 WIB. Selamat mengobrol.',
    );
    expect(renderTemplate(ACCESS_TEMPLATES.ended, { nama: 'Raka', creator: 'Salsa' })).toBe(
      'Halo Raka, aksesmu ke Salsa sudah berakhir. Terima kasih sudah bergabung.',
    );
  });

  it('does not expand a variable that a name itself contains', () => {
    expect(
      renderTemplate('Halo {nama} dari {creator}', { nama: '{creator}', creator: 'Salsa' }),
    ).toBe('Halo {creator} dari Salsa');
  });

  it('leaves unknown or unfilled variables as written', () => {
    expect(renderTemplate('{x} {tanggal}', { nama: 'a', creator: 'b' })).toBe('{x} {tanggal}');
  });
});
