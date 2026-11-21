import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeMiniappApi, fakeSeen, fakeTelegram, maya } from '../../test/fake-miniapp-api';
import { createMiniappRoutes, type MiniappRoutesOptions } from './routes';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Renders a signed-in Mini App (returning device, valid initData) as a USER unless told otherwise. */
async function renderAt(path: string, options: Partial<MiniappRoutesOptions> = {}) {
  const router = createMemoryRouter(
    createMiniappRoutes({
      api: createFakeMiniappApi(),
      telegram: fakeTelegram('query_id=x&hash=y'),
      seen: fakeSeen(true),
      ...options,
    }),
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  if (path === '/') await waitFor(() => expect(router.state.location.pathname).not.toBe('/'));
  return router;
}

describe('Mini App routes', () => {
  it('lands a USER from / on /chats', async () => {
    const router = await renderAt('/');
    expect(router.state.location.pathname).toBe('/chats');
    expect(await screen.findByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
  });

  it('shows the customer shell with the real chat list (not a placeholder) at /chats', async () => {
    await renderAt('/chats');
    expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Navigasi creator' })).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(await screen.findByText('Salsa Maheswari')).toBeInTheDocument();
    expect(screen.queryByTestId('not-implemented')).toBeNull();
  });

  it('shows the customer shell with the real Langganan (not a placeholder) at /subscriptions', async () => {
    await renderAt('/subscriptions');
    expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Langganan' })).toBeInTheDocument();
    expect(screen.queryByTestId('not-implemented')).toBeNull();
  });

  it('shows the customer shell with the real Explore (not a placeholder) at /explore', async () => {
    await renderAt('/explore');
    expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Jelajahi' })).toBeInTheDocument();
    expect(screen.queryByTestId('not-implemented')).toBeNull();
  });

  it('shows the customer shell with the real profile (not a placeholder) at /profile', async () => {
    await renderAt('/profile');
    expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
    expect(screen.queryByTestId('not-implemented')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Profil');
  });

  it('shows the creator shell with the real broadcast composer (not a placeholder) at /broadcast', async () => {
    await renderAt('/broadcast', { api: createFakeMiniappApi({ me: [maya] }) });
    expect(screen.getByRole('navigation', { name: 'Navigasi creator' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Navigasi utama' })).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: 'Broadcast' })).toBeInTheDocument();
    expect(screen.queryByTestId('not-implemented')).toBeNull();
  });

  it('shows the real welcome message page, full screen without navigation, at /settings/welcome', async () => {
    await renderAt('/settings/welcome', { api: createFakeMiniappApi({ me: [maya] }) });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Pesan selamat datang' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Navigasi creator' })).toBeNull();
    expect(screen.queryByTestId('not-implemented')).toBeNull();
  });

  it('shows the creator shell with the real gallery (not a placeholder) at /gallery', async () => {
    await renderAt('/gallery', { api: createFakeMiniappApi({ me: [maya] }) });
    expect(screen.getByRole('navigation', { name: 'Navigasi creator' })).toBeInTheDocument();
    expect(screen.queryByTestId('not-implemented')).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: 'Galeri' })).toBeInTheDocument();
  });

  it('shows the creator shell with the real inbox (not a placeholder) at /inbox', async () => {
    await renderAt('/inbox', { api: createFakeMiniappApi({ me: [maya] }) });
    expect(screen.getByRole('navigation', { name: 'Navigasi creator' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByTestId('not-implemented')).toBeNull();
  });

  it('shows the real conversation and customer detail (US-029), full screen without navigation', async () => {
    const id = '33333333-0000-4000-8000-000000000001';
    await renderAt(`/inbox/${id}`, { api: createFakeMiniappApi({ me: [maya] }) });
    expect(await screen.findByRole('textbox', { name: 'Tulis balasan' })).toBeInTheDocument();
    expect(screen.queryByTestId('not-implemented')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Navigasi creator' })).toBeNull();
    cleanup();
    await renderAt(`/inbox/${id}/customer`, { api: createFakeMiniappApi({ me: [maya] }) });
    expect(await screen.findByRole('link', { name: 'Buka Chat' })).toBeInTheDocument();
  });

  it('shows the creator shell with the real settings (not a placeholder) at /settings', async () => {
    await renderAt('/settings', { api: createFakeMiniappApi({ me: [maya] }) });
    expect(screen.getByRole('navigation', { name: 'Navigasi creator' })).toBeInTheDocument();
    expect(screen.queryByTestId('not-implemented')).toBeNull();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Pengaturan' }),
    ).toBeInTheDocument();
  });

  it('renders unknown paths as a neutral not-found placeholder', async () => {
    await renderAt('/tidak-ada');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Halaman tidak ditemukan');
  });

  it('passes the unread count to the first tab of the active shell', async () => {
    await renderAt('/inbox', { unreadCount: 3, api: createFakeMiniappApi({ me: [maya] }) });
    expect(screen.getByLabelText('3 percakapan belum dibaca')).toBeInTheDocument();
  });

  it('lands a CREATOR from / on /inbox', async () => {
    const router = await renderAt('/', { api: createFakeMiniappApi({ me: [maya] }) });
    expect(router.state.location.pathname).toBe('/inbox');
    expect(await screen.findByRole('navigation', { name: 'Navigasi creator' })).toBeInTheDocument();
  });

  it('navigates between tabs without a role control anywhere', async () => {
    await renderAt('/chats');
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Navigasi utama' })).getByRole('link', {
        name: 'Profil',
      }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Profil');
    // No role switcher: nothing on the page offers to change role or mode.
    expect(screen.queryByRole('button', { name: /peran|mode|beralih|creator/i })).toBeNull();
  });
});
