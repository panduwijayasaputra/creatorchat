import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  createFakeMiniappApi,
  fakeSeen,
  fakeTelegram,
  maya,
  nadia,
  type FakeMiniappApi,
} from '../../test/fake-miniapp-api';
import { createMiniappRoutes } from '../app/routes';

const salsa = {
  ...maya,
  display_name: 'Salsa Maheswari',
  telegram_username: 'salsa.maheswari',
  bio: 'Suka masak sederhana',
};
const settings = (over: Record<string, unknown> = {}) => ({
  profile: salsa,
  public_code: 'k4m5x2qa',
  bio_link: 'https://t.me/TestBot?start=c_k4m5x2qa',
  ...over,
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

function mount(options: { user?: typeof maya; api?: FakeMiniappApi } = {}) {
  const user = options.user ?? salsa;
  const api =
    options.api ??
    createFakeMiniappApi({ login: [user], me: [user], creatorSettings: [settings()] });
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=1&hash=a'),
      seen: fakeSeen(true),
    }),
    { initialEntries: ['/settings'] },
  );
  render(<RouterProvider router={router} />);
  return { api, router };
}

describe('/settings (creator)', () => {
  it('renders the board copy: identity, preview, link card, rows and account', async () => {
    mount();
    expect(
      await screen.findByRole('heading', { name: 'Pengaturan', level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByText('@salsa.maheswari · dari Telegram')).toBeInTheDocument();
    expect(screen.getByText('Creator · disetujui admin')).toBeInTheDocument();
    expect(screen.getByText('Preview profil')).toBeInTheDocument();
    expect(screen.getByText('Suka masak sederhana')).toBeInTheDocument();
    expect(screen.getByText('Link bot untuk bio Instagram')).toBeInTheDocument();
    expect(screen.getByTestId('bio-link')).toHaveTextContent('t.me/TestBot?start=c_k4m5x2qa');
    expect(
      screen.getByText('Pelanggan masuk lewat bot, lalu langsung ke profilmu.'),
    ).toBeInTheDocument();
    for (const title of [
      'Persona AI',
      'Pesan selamat datang',
      'Harga subscription',
      'Zona waktu',
      'Akun Telegram',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    // No invented data: no category/city line and no status chips on the later rows.
    expect(screen.queryByText(/Bandung/)).toBeNull();
    expect(screen.queryByText('Tersimpan')).toBeNull();
    expect(screen.queryByText('Aktif')).toBeNull();
    expect(screen.queryByText(/Rp\d/)).toBeNull();
  });

  it('Pengaturan is the current page in the creator navigation', async () => {
    mount();
    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByRole('link', { name: /Pengaturan/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('Salin Link Profil copies the full link and confirms with a toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Salin Link Profil' }));
    expect(writeText).toHaveBeenCalledWith('https://t.me/TestBot?start=c_k4m5x2qa');
    expect(await screen.findByRole('status')).toHaveTextContent('Link disalin');
  });

  it('falls back to execCommand and reports a failure instead of staying silent', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    const exec = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Salin Link Profil' }));
    expect(exec).toHaveBeenCalledWith('copy');
    expect(await screen.findByRole('status')).toHaveTextContent('Link belum bisa disalin');
    exec.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Salin Link Profil' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Link disalin'));
  });

  it('shows a clear not-configured state and a disabled button when there is no link', async () => {
    const api = createFakeMiniappApi({
      login: [salsa],
      me: [salsa],
      creatorSettings: [settings({ bio_link: null })],
    });
    mount({ api });
    expect(await screen.findByText('Link bot belum diatur. Hubungi admin.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salin Link Profil' })).toBeDisabled();
  });

  it('Edit Profil and the later rows navigate to their routes', async () => {
    const { router } = mount();
    await userEvent.click(await screen.findByRole('link', { name: /Edit Profil/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/profile'));
    await router.navigate('/settings');
    await userEvent.click(await screen.findByRole('link', { name: /Harga subscription/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/price'));
    expect(await screen.findByTestId('not-implemented')).toBeInTheDocument();
  });

  it('Bantuan appears only with a configured bot username', async () => {
    mount();
    await screen.findByText('Akun Telegram');
    expect(screen.queryByText('Bantuan')).toBeNull();
    cleanup();
    vi.stubEnv('VITE_TELEGRAM_BOT_USERNAME', 'TestBot');
    mount();
    expect(await screen.findByRole('link', { name: /Bantuan/ })).toHaveAttribute(
      'href',
      'https://t.me/TestBot',
    );
  });

  it('shows an error with retry when the settings cannot be loaded', async () => {
    const api = createFakeMiniappApi({
      login: [salsa],
      me: [salsa],
      creatorSettings: [apiError(500, 'INTERNAL_ERROR'), settings()],
    });
    mount({ api });
    expect(await screen.findByRole('alert')).toHaveTextContent('Pengaturan belum bisa dimuat');
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByText('Preview profil')).toBeInTheDocument();
    expect(api.creatorSettingsCalls).toBe(2);
  });

  it('sends a USER to their own landing and never calls the creator API', async () => {
    const api = createFakeMiniappApi({ login: [nadia], me: [nadia] });
    const { router } = mount({ user: nadia, api });
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
    expect(api.creatorSettingsCalls).toBe(0);
  });
});

describe('/settings timezone row', () => {
  it('links to the real timezone screen, not a placeholder', async () => {
    const { router } = mount();
    await userEvent.click(await screen.findByRole('link', { name: /Zona waktu/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/timezone'));
    expect(await screen.findByRole('radiogroup')).toBeInTheDocument();
    expect(screen.queryByTestId('not-implemented')).toBeNull();
  });
});
