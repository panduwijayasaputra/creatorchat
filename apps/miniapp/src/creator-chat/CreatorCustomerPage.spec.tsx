import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  createFakeMiniappApi,
  creatorCustomer,
  fakeSeen,
  fakeTelegram,
  maya,
  nadia,
  type FakeMiniappApi,
} from '../../test/fake-miniapp-api';
import { createMiniappRoutes } from '../app/routes';

const CONV = '66666666-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T05:00:00.000Z') });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(api: FakeMiniappApi, path = `/inbox/${CONV}/customer`) {
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=x&hash=y'),
      seen: fakeSeen(true),
    }),
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('CrCustomer', () => {
  it('shows name, username, the access period in my zone and Buka Chat; no AI card, no ids', async () => {
    const api = createFakeMiniappApi({ me: [maya], creatorCustomer: [creatorCustomer()] });
    mount(api);
    expect(await screen.findByText('Rani Anggraini')).toBeInTheDocument();
    expect(screen.getByText('@rani.anggraini · dari Telegram')).toBeInTheDocument();
    expect(screen.getByText('Akses aktif hingga 27 Nov 2026')).toBeInTheDocument();
    expect(screen.getByText('Berakhir pukul 23.59 WIB · dikelola admin')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Buka Chat' })).toHaveAttribute(
      'href',
      `/inbox/${CONV}`,
    );
    expect(document.body.textContent).not.toMatch(/AI Aktif|memori|ringkasan/);
    expect(api.creatorCustomerCalls).toEqual([CONV]);
  });

  it('writes only "dari Telegram" for a customer without a username', async () => {
    mount(
      createFakeMiniappApi({ me: [maya], creatorCustomer: [creatorCustomer({ username: null })] }),
    );
    expect(await screen.findByText('dari Telegram')).toBeInTheDocument();
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it('shows the placeholder variant when access has ended', async () => {
    mount(
      createFakeMiniappApi({
        me: [maya],
        creatorCustomer: [
          creatorCustomer(
            {},
            { state: 'EXPIRED', ends_at: null, ended_at: '2026-11-06T16:59:59.000Z' },
          ),
        ],
      }),
    );
    expect(await screen.findByText('Akses telah berakhir')).toBeInTheDocument();
    expect(screen.getByText('Berakhir 6 Nov 2026 · dikelola admin')).toBeInTheDocument();
  });

  it('goes back to the chat, and shows not-found for an unknown conversation', async () => {
    const router = mount(
      createFakeMiniappApi({ me: [maya], creatorCustomer: [creatorCustomer()] }),
    );
    await screen.findByText('Rani Anggraini');
    await userEvent.click(screen.getByRole('button', { name: 'Kembali' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/inbox/${CONV}`));
    cleanup();
    mount(createFakeMiniappApi({ me: [maya], creatorCustomer: [apiError(404, 'NOT_FOUND')] }));
    expect(await screen.findByText('Percakapan tidak ditemukan.')).toBeInTheDocument();
  });

  it('redirects a USER session', async () => {
    const router = mount(createFakeMiniappApi({ me: [nadia] }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
  });
});
