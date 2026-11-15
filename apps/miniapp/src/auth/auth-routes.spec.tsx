import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
  networkError,
  type FakeMiniappApi,
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
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function mount(
  api: FakeMiniappApi,
  telegram: ReturnType<typeof fakeTelegram>,
  seen: ReturnType<typeof fakeSeen>,
  path = '/',
) {
  const router = createMemoryRouter(createMiniappRoutes({ api, telegram, seen }), {
    initialEntries: [path],
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('Mini App login flow', () => {
  it('outside Telegram shows only the outside screen and never calls the API', async () => {
    const api = createFakeMiniappApi();
    mount(api, fakeTelegram(null), fakeSeen(true));
    expect(await screen.findByText('Buka di Telegram')).toBeInTheDocument();
    expect(api.loginCalls).toHaveLength(0);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('first launch inside Telegram asks to continue, then connects and lands a USER on chats', async () => {
    const api = createFakeMiniappApi();
    const seen = fakeSeen(false);
    const telegram = fakeTelegram('query_id=1&hash=abc');
    const router = mount(api, telegram, seen);
    await userEvent.click(await screen.findByRole('button', { name: 'Lanjutkan dengan Telegram' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
    expect(api.loginCalls).toEqual(['query_id=1&hash=abc']);
    expect(telegram.readyCalls).toBe(1);
    expect(seen.value).toBe(true);
    expect(await screen.findByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
  });

  it('a returning device connects on its own', async () => {
    const api = createFakeMiniappApi();
    const router = mount(api, fakeTelegram('query_id=1&hash=abc'), fakeSeen(true));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
    expect(api.loginCalls).toHaveLength(1);
  });

  it('takes the role from /me even when the login body says otherwise', async () => {
    const api = createFakeMiniappApi({ login: [nadia], me: [maya] });
    const router = mount(api, fakeTelegram('query_id=1&hash=abc'), fakeSeen(true));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    expect(await screen.findByRole('navigation', { name: 'Navigasi creator' })).toBeInTheDocument();
  });

  it('shows the connecting state while waiting', async () => {
    const api = createFakeMiniappApi();
    let release: () => void = () => {};
    api.loginWithTelegram = () =>
      new Promise((resolve) => {
        release = () => resolve(nadia);
      });
    mount(api, fakeTelegram('query_id=1&hash=abc'), fakeSeen(true));
    expect(await screen.findByText('Menghubungkan ke Telegram…')).toBeInTheDocument();
    await act(async () => release());
    await waitFor(() => expect(screen.queryByText('Menghubungkan ke Telegram…')).toBeNull());
  });

  it('a network error offers a retry that then succeeds', async () => {
    const api = createFakeMiniappApi({ login: [networkError()] });
    const router = mount(api, fakeTelegram('query_id=1&hash=abc'), fakeSeen(true));
    const retry = await screen.findByRole('button', { name: 'Coba Lagi' });
    await userEvent.click(retry);
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
    expect(api.loginCalls).toHaveLength(2);
  });

  it.each([
    ['TELEGRAM_AUTH_EXPIRED', 401],
    ['TELEGRAM_AUTH_INVALID', 401],
    ['ACCOUNT_BLOCKED', 403],
    ['SERVICE_UNAVAILABLE', 503],
  ] as const)('%s never reaches the shells and keeps the retry', async (code, status) => {
    const api = createFakeMiniappApi({ login: [apiError(status, code)] });
    mount(api, fakeTelegram('query_id=1&hash=abc'), fakeSeen(true));
    expect(await screen.findByRole('button', { name: 'Coba Lagi' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('goes back to an error state when the session is lost later', async () => {
    const api = createFakeMiniappApi();
    const router = mount(api, fakeTelegram('query_id=1&hash=abc'), fakeSeen(true));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
    await act(async () => api.loseSession('expired'));
    expect(await screen.findByRole('button', { name: 'Coba Lagi' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('stores nothing but the cosmetic flag', async () => {
    const api = createFakeMiniappApi();
    const router = mount(api, fakeTelegram('query_id=1&hash=abc'), fakeSeen(true));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
    const stored = JSON.stringify({ ...window.localStorage, ...window.sessionStorage });
    expect(stored).not.toMatch(/token|query_id|hash=/i);
  });
});
