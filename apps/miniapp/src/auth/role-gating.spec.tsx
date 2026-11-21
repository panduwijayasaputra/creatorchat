import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
import { BLOCKED_COPY } from './screens/AuthGate';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function mount(api: FakeMiniappApi, path: string) {
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=1&hash=abc'),
      seen: fakeSeen(true),
    }),
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const CREATOR_ROUTES = ['/inbox', '/gallery', '/broadcast', '/settings', '/settings/welcome'];
const CUSTOMER_ROUTES = ['/chats', '/explore', '/subscriptions', '/profile'];

describe('role-gated shells', () => {
  it.each(CREATOR_ROUTES)('sends a USER away from %s to /chats', async (path) => {
    const router = mount(createFakeMiniappApi({ me: [nadia] }), path);
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
    expect(await screen.findByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Navigasi creator' })).toBeNull();
  });

  it.each(CUSTOMER_ROUTES)('sends a CREATOR away from %s to /inbox', async (path) => {
    const router = mount(createFakeMiniappApi({ me: [maya] }), path);
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    expect(await screen.findByRole('navigation', { name: 'Navigasi creator' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Navigasi utama' })).toBeNull();
  });

  it('leaves each role on its own routes without redirecting', async () => {
    const user = mount(createFakeMiniappApi({ me: [nadia] }), '/explore');
    expect(await screen.findByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
    expect(user.state.location.pathname).toBe('/explore');
    cleanup();

    const creator = mount(createFakeMiniappApi({ me: [maya] }), '/gallery');
    expect(await screen.findByRole('navigation', { name: 'Navigasi creator' })).toBeInTheDocument();
    expect(creator.state.location.pathname).toBe('/gallery');
  });

  it('keeps /creators/:code outside both shells for either role', async () => {
    const asCreator = mount(createFakeMiniappApi({ me: [maya] }), '/creators/k4m5x2qa');
    await waitFor(() => expect(asCreator.state.location.pathname).toBe('/creators/k4m5x2qa'));
    cleanup();
    const asUser = mount(createFakeMiniappApi({ me: [nadia] }), '/creators/k4m5x2qa');
    await waitFor(() => expect(asUser.state.location.pathname).toBe('/creators/k4m5x2qa'));
  });

  it('follows the server when a silent renewal brings a different role', async () => {
    const api = createFakeMiniappApi({ me: [nadia] });
    const router = mount(api, '/chats');
    expect(await screen.findByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
    act(() => api.renewSession(maya));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    expect(await screen.findByRole('navigation', { name: 'Navigasi creator' })).toBeInTheDocument();
  });
});

describe('blocked and ended sessions', () => {
  it('shows the placeholder message for a blocked login, not the session-ended screen', async () => {
    const api = createFakeMiniappApi({ login: [apiError(403, 'ACCOUNT_BLOCKED')] });
    mount(api, '/');
    expect(await screen.findByText(BLOCKED_COPY.text)).toBeInTheDocument();
    expect(screen.queryByText('Sesi Telegram berakhir')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('ends on the blocked message when a live session turns out blocked', async () => {
    const api = createFakeMiniappApi({ me: [nadia] });
    mount(api, '/chats');
    expect(await screen.findByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
    act(() => api.loseSession('blocked'));
    expect(await screen.findByText(BLOCKED_COPY.text)).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('shows "Sesi Telegram berakhir" when Telegram data is no longer accepted mid-session', async () => {
    const api = createFakeMiniappApi({ me: [nadia] });
    mount(api, '/chats');
    expect(await screen.findByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
    act(() => api.loseSession('expired'));
    expect(await screen.findByText('Sesi Telegram berakhir')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba Lagi' })).toBeInTheDocument();
  });
});
