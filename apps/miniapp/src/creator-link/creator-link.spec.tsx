import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  opts: { seen?: boolean; initData?: string | null; path?: string } = {},
) {
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram(opts.initData === undefined ? 'query_id=1&hash=abc' : opts.initData),
      seen: fakeSeen(opts.seen ?? true),
    }),
    { initialEntries: [opts.path ?? '/creators/k4m5x2qa'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('/creators/:publicCode', () => {
  it('keeps the deep link through the first-launch login instead of landing on chats', async () => {
    const api = createFakeMiniappApi();
    const router = mount(api, { seen: false });
    expect(api.resolveCalls).toHaveLength(0);
    await userEvent.click(await screen.findByRole('button', { name: 'Lanjutkan dengan Telegram' }));
    expect(await screen.findByRole('heading', { name: 'Salsa' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/creators/k4m5x2qa');
    expect(api.resolveCalls).toEqual(['k4m5x2qa']);
  });

  it('a returning launch auto-connects and stays on the same path', async () => {
    const api = createFakeMiniappApi();
    const router = mount(api, { seen: true });
    expect(await screen.findByRole('heading', { name: 'Salsa' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/creators/k4m5x2qa');
  });

  it('shows the designed "Creator tidak tersedia" state for an unknown code and goes to Jelajahi', async () => {
    const api = createFakeMiniappApi({ resolve: [apiError(404, 'CREATOR_NOT_FOUND')] });
    const router = mount(api, { path: '/creators/zzzzzzzz' });
    expect(
      await screen.findByRole('heading', { name: 'Creator tidak tersedia' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Profil ini sedang tidak bisa dibuka atau sudah tidak aktif.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kembali' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kembali ke Jelajahi' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/explore'));
  });

  it('a CREATOR sees the explanation, never the creator page, and makes no lookup', async () => {
    const api = createFakeMiniappApi({ login: [maya], me: [maya] });
    const router = mount(api);
    expect(
      await screen.findByRole('heading', { name: 'Link ini untuk pelanggan' }),
    ).toBeInTheDocument();
    expect(api.resolveCalls).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Salsa' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ke Inbox' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
  });

  it('shows the explanation when the server answers FORBIDDEN_ROLE', async () => {
    const api = createFakeMiniappApi({ resolve: [apiError(403, 'FORBIDDEN_ROLE')] });
    mount(api);
    expect(
      await screen.findByRole('heading', { name: 'Link ini untuk pelanggan' }),
    ).toBeInTheDocument();
  });

  it('a network error offers a retry that then shows the creator', async () => {
    const api = createFakeMiniappApi({ resolve: [networkError()] });
    mount(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByRole('heading', { name: 'Salsa' })).toBeInTheDocument();
    expect(api.resolveCalls).toHaveLength(2);
  });

  it('makes no lookup while signed out (outside Telegram) and stores nothing but the seen flag', async () => {
    const api = createFakeMiniappApi();
    mount(api, { initData: null });
    expect(await screen.findByText('Buka di Telegram')).toBeInTheDocument();
    expect(api.resolveCalls).toHaveLength(0);
    expect(window.sessionStorage.length).toBe(0);
    for (let i = 0; i < window.localStorage.length; i++) {
      expect(window.localStorage.key(i)).toBe('cc_tg_seen');
    }
  });

  it('still lands without a code on chats (USER) and inbox (CREATOR)', async () => {
    const userRouter = mount(createFakeMiniappApi(), { path: '/' });
    await waitFor(() => expect(userRouter.state.location.pathname).toBe('/chats'));
    cleanup();
    const creatorRouter = mount(createFakeMiniappApi({ login: [maya], me: [maya] }), { path: '/' });
    await waitFor(() => expect(creatorRouter.state.location.pathname).toBe('/inbox'));
  });
});
