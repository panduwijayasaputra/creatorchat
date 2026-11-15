import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectingScreen, ErrorScreen, LoginScreen, OutsideScreen } from './AuthGate';

afterEach(cleanup);

describe('LoginScreen (AuthLogin)', () => {
  it('shows the board copy, the Telegram button and no demo strip', async () => {
    const onContinue = vi.fn();
    render(<LoginScreen onContinue={onContinue} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Masuk dan mulai terhubung.',
    );
    expect(
      screen.getByText(
        'Masuk memakai identitas Telegram-mu. Tidak ada email, kata sandi, atau OTP.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Syarat Layanan')).toBeInTheDocument();
    expect(screen.getByText('Kebijakan Privasi')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(
      /DEMO|bukan fitur produk|Link creator|Akun creator/,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lanjutkan dengan Telegram' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('has no password, email or other login field', () => {
    render(<LoginScreen onContinue={() => {}} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.querySelector('input')).toBeNull();
  });
});

describe('OutsideScreen (AuthOutside)', () => {
  it('links "Buka di Telegram" to the configured bot and offers no other login', () => {
    render(<OutsideScreen botUsername="CreatorChatBot" />);
    const link = screen.getByRole('link', { name: 'Buka di Telegram' });
    expect(link).toHaveAttribute('href', 'https://t.me/CreatorChatBot');
    expect(
      screen.getByText(
        'Login tetap dilakukan lewat bot dan Mini App Telegram. Tidak ada email atau kata sandi.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is inert (no href) when no valid bot username is configured', () => {
    render(<OutsideScreen botUsername="<bot_username>" />);
    const link = screen.getByText('Buka di Telegram').closest('a');
    expect(link).not.toHaveAttribute('href');
    expect(link).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('state screens (AuthStates)', () => {
  it('announces the connecting state politely', () => {
    render(<ConnectingScreen />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Creator Chat');
    expect(status).toHaveTextContent('Menghubungkan ke Telegram…');
  });

  it('shows "Belum bisa masuk" with a retry for network, unavailable and blocked errors', async () => {
    for (const kind of ['network', 'unavailable', 'blocked'] as const) {
      const onRetry = vi.fn();
      const { unmount } = render(<ErrorScreen kind={kind} onRetry={onRetry} />);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Belum bisa masuk');
      await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
      expect(onRetry).toHaveBeenCalledOnce();
      unmount();
    }
  });

  it('shows "Sesi Telegram berakhir" with a retry when the session expired', async () => {
    const onRetry = vi.fn();
    render(<ErrorScreen kind="expired" onRetry={onRetry} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sesi Telegram berakhir');
    expect(
      screen.getByText(
        'Buka ulang aplikasi dari bot Telegram untuk melanjutkan. Kamu tidak perlu mengisi apa pun.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('never mentions AI anywhere on the auth screens', () => {
    render(<LoginScreen onContinue={() => {}} />);
    expect(document.body.textContent).not.toMatch(/\bAI\b/);
  });
});
