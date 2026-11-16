import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreatorRequestStateResponse } from '@creatorchat/contracts';
import {
  createFakeMiniappApi,
  fakeSeen,
  fakeTelegram,
  maya,
  nadia,
} from '../../test/fake-miniapp-api';
import { createMiniappRoutes } from '../app/routes';

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

function mount(
  user = nadia,
  path = '/profile',
  creatorRequestState: (CreatorRequestStateResponse | Error)[] = [],
) {
  const api = createFakeMiniappApi({ login: [user], me: [user], creatorRequestState });
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=1&hash=a'),
      seen: fakeSeen(true),
    }),
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('/profile creator invitation', () => {
  const blocked = { creator_name: 'Salsa Maheswari', ends_at: '2026-11-27T00:00:00.000Z' };

  it('shows ProfileBlocked while a customer subscription is active: reason, line, inert button', async () => {
    mount(nadia, '/profile', [{ request: null, blocked }]);
    expect(
      await screen.findByText(
        'Permintaan menjadi creator dapat diajukan setelah seluruh langganan pelanggan berakhir.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Langganan aktif: Salsa Maheswari, hingga 27 Nov 2026'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajukan Jadi Creator' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Ajukan Jadi Creator' })).toBeNull();
  });

  it('shows the end date in the account timezone', async () => {
    mount({ ...nadia, timezone: 'Australia/Sydney' }, '/profile', [
      { request: null, blocked: { ...blocked, ends_at: '2026-11-27T20:00:00.000Z' } },
    ]);
    expect(await screen.findByText(/hingga 28 Nov 2026/)).toBeInTheDocument();
  });

  it('keeps the normal invitation when there is no block', async () => {
    mount(nadia, '/profile', [{ request: null, blocked: null }]);
    expect(await screen.findByRole('link', { name: 'Ajukan Jadi Creator' })).toBeInTheDocument();
    expect(screen.queryByText(/Langganan aktif/)).toBeNull();
  });

  it('keeps the normal invitation when the state cannot be loaded', async () => {
    mount(nadia, '/profile', [new Error('offline')]);
    expect(await screen.findByRole('link', { name: 'Ajukan Jadi Creator' })).toBeInTheDocument();
  });
});

describe('/profile', () => {
  it('shows the profile card with name, @username and the read-only note', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Profil', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Nadia Putri')).toBeInTheDocument();
    expect(screen.getByText('@nadia')).toBeInTheDocument();
    expect(screen.getByText('Dari Telegram, tidak bisa diubah')).toBeInTheDocument();
    expect(screen.getByTestId('avatar-placeholder')).toBeInTheDocument();
  });

  it('shows no @ line when the account has no Telegram username', async () => {
    mount({ ...nadia, telegram_username: null });
    await screen.findByText('Nadia Putri');
    expect(screen.queryByText(/^@/)).toBeNull();
  });

  it('Edit Profil and Ajukan Jadi Creator navigate to their routes', async () => {
    const router = mount();
    await userEvent.click(await screen.findByRole('link', { name: 'Edit Profil' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile/edit'));
    await router.navigate('/profile');
    await userEvent.click(await screen.findByRole('link', { name: 'Ajukan Jadi Creator' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile/creator-request'));
  });

  it('shows the Notifikasi switches in the designed state, not interactive', async () => {
    mount();
    const messages = await screen.findByRole('switch', { name: 'Notifikasi pesan' });
    const content = screen.getByRole('switch', { name: 'Tampilkan isi pesan di notifikasi' });
    expect(messages).toHaveAttribute('aria-checked', 'true');
    expect(content).toHaveAttribute('aria-checked', 'false');
    expect(messages).toBeDisabled();
    expect(content).toBeDisabled();
  });

  it('Kebijakan Privasi gives placeholder feedback (design gap) and navigates nowhere', async () => {
    const router = mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Kebijakan Privasi' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Kebijakan Privasi belum tersedia.',
    );
    expect(router.state.location.pathname).toBe('/profile');
  });

  it('Hubungi Admin links to the bot when a username is configured, and is absent otherwise', async () => {
    mount();
    await screen.findByText('Bantuan');
    expect(screen.queryByRole('link', { name: /Hubungi Admin/ })).toBeNull();
    cleanup();
    vi.stubEnv('VITE_TELEGRAM_BOT_USERNAME', 'TestBot');
    mount();
    const link = await screen.findByRole('link', { name: /Hubungi Admin/ });
    expect(link).toHaveAttribute('href', 'https://t.me/TestBot');
  });

  it('keeps the bottom navigation with Profil as the current page', async () => {
    mount();
    const nav = await screen.findByRole('navigation', { name: 'Navigasi utama' });
    expect(within(nav).getByRole('link', { name: /Profil/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('sends a CREATOR to their own landing instead of the customer profile', async () => {
    const router = mount(maya);
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    expect(screen.queryByText('Ingin menjadi creator?')).toBeNull();
  });
});
