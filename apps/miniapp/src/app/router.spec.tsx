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

  it.each(['/chats', '/explore', '/subscriptions', '/profile'])(
    'shows the customer shell with the placeholder at %s',
    async (path) => {
      await renderAt(path);
      expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Navigasi creator' })).toBeNull();
      expect(screen.getByTestId('not-implemented')).toHaveTextContent('Halaman ini belum dibangun');
    },
  );

  it.each(['/inbox', '/gallery', '/broadcast', '/settings'])(
    'shows the creator shell with the placeholder at %s',
    async (path) => {
      await renderAt(path);
      expect(screen.getByRole('navigation', { name: 'Navigasi creator' })).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Navigasi utama' })).toBeNull();
      expect(screen.getByTestId('not-implemented')).toBeInTheDocument();
    },
  );

  it('renders unknown paths as a neutral not-found placeholder', async () => {
    await renderAt('/tidak-ada');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Halaman tidak ditemukan');
  });

  it('passes the unread count to the first tab of the active shell', async () => {
    await renderAt('/inbox', { unreadCount: 3 });
    expect(screen.getByLabelText('3 pesan belum dibaca')).toBeInTheDocument();
  });

  it('keeps the API health indicator on the chat placeholder', async () => {
    await renderAt('/chats');
    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
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
    expect(screen.queryByRole('button')).toBeNull();
  });
});
