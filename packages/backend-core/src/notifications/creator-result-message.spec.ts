import { describe, expect, it } from 'vitest';
import { buildCreatorResultMessage } from './creator-result-message.js';

const miniAppUrl = 'https://app.example.test/some/path?x=1';

describe('buildCreatorResultMessage', () => {
  it('uses the RequestApproved board text and the app button', () => {
    expect(buildCreatorResultMessage({ decision: 'approved', miniAppUrl })).toEqual({
      text: 'Selamat, permintaanmu disetujui. Akunmu sekarang akun creator. Buka aplikasi untuk masuk ke Inbox.',
      buttonText: 'Buka Aplikasi',
      url: 'https://app.example.test/',
    });
  });

  it('puts the admin reason verbatim into the rejected message', () => {
    const message = buildCreatorResultMessage({
      decision: 'rejected',
      reason: '  Link Instagram belum bisa diverifikasi.\nCoba lagi.  ',
      miniAppUrl,
    });
    expect(message?.text).toBe(
      'Permintaanmu menjadi creator belum bisa disetujui.\n\n' +
        'Alasan dari admin: Link Instagram belum bisa diverifikasi.\nCoba lagi.\n\n' +
        'Kamu bisa memperbaiki isian lalu mengajukan lagi.',
    );
  });

  it('keeps an HTML-looking reason literal (plain text, no markup handling)', () => {
    const reason = '<b>x</b> & <a href="https://evil.test">klik</a> *_`';
    expect(buildCreatorResultMessage({ decision: 'rejected', reason, miniAppUrl })?.text).toContain(
      reason,
    );
  });

  it('leaves the reason line out when there is none', () => {
    const text = buildCreatorResultMessage({
      decision: 'rejected',
      reason: null,
      miniAppUrl,
    })?.text;
    expect(text).not.toContain('Alasan');
  });

  it('ignores a reason for an approval', () => {
    const text = buildCreatorResultMessage({
      decision: 'approved',
      reason: 'alasan-rahasia',
      miniAppUrl,
    })?.text;
    expect(text).not.toContain('alasan-rahasia');
    expect(text).not.toContain('Alasan');
  });

  it('is null without a usable Mini App URL, and the button stays on the configured origin', () => {
    for (const bad of [undefined, '', 'not a url', 'javascript:alert(1)', 'ftp://x.test']) {
      expect(buildCreatorResultMessage({ decision: 'approved', miniAppUrl: bad })).toBeNull();
    }
    expect(
      buildCreatorResultMessage({ decision: 'approved', miniAppUrl: 'http://localhost:5173' })?.url,
    ).toBe('http://localhost:5173/');
  });
});
