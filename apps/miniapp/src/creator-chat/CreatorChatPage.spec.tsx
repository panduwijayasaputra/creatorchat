import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  createFakeMiniappApi,
  creatorChatHistory,
  creatorChatMessage,
  fakeSeen,
  fakeTelegram,
  maya,
  nadia,
  networkError,
  type FakeMiniappApi,
} from '../../test/fake-miniapp-api';
import { createMiniappRoutes } from '../app/routes';

const CONV = '66666666-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
  // 17 Nov 2026 12.00 WIB; only Date is faked so timers and promises stay real.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T05:00:00.000Z') });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(api: FakeMiniappApi, path = `/inbox/${CONV}`) {
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

const board = () =>
  creatorChatHistory([
    creatorChatMessage(2, {
      sender: 'ME',
      body: 'Rekomendasiku tepung protein tinggi.',
      created_at: '2026-11-17T02:23:00.000Z',
    }),
    creatorChatMessage(1, {
      body: 'Oke, aku coba. Boleh minta rekomendasi tepungnya?',
      created_at: '2026-11-17T02:20:00.000Z',
    }),
  ]);

describe('CrChatManual (access active)', () => {
  it('shows the header, bubbles, times in my zone and the Manual tag on my bubble only', async () => {
    mount(createFakeMiniappApi({ me: [maya], creatorChatHistory: [board()] }));
    expect(await screen.findByText('Rani Anggraini')).toBeInTheDocument();
    expect(screen.getByText('Akses aktif hingga 27 Nov 2026')).toBeInTheDocument();
    expect(screen.getByText('Hari ini')).toBeInTheDocument();
    expect(screen.getByText('09.20')).toBeInTheDocument();
    expect(screen.getAllByText('Manual')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Tulis balasan' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Detail pelanggan' })).toHaveAttribute(
      'href',
      `/inbox/${CONV}/customer`,
    );
  });

  it('shows nothing of Phase F or ids, and offers Lampirkan media (US-036)', async () => {
    mount(createFakeMiniappApi({ me: [maya], creatorChatHistory: [board()] }));
    await screen.findByText('Rani Anggraini');
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Aktifkan AI|Kamu mengambil alih|AI dijeda|Perlu Perhatian/);
    expect(screen.getByRole('button', { name: 'Lampirkan media' })).toBeInTheDocument();
    expect(text).not.toMatch(/Mengirim akan mengambil alih/);
    expect(document.body.innerHTML).not.toContain('66666666-0000-4000-8000-000000000001"');
    expect(text).not.toMatch(/424242/);
  });

  it('sends once with Enter: Mengirim…, then the stored message with its Manual tag', async () => {
    let release!: (v: { message: ReturnType<typeof creatorChatMessage> }) => void;
    const held = new Promise<{ message: ReturnType<typeof creatorChatMessage> }>(
      (r) => (release = r),
    );
    const api = createFakeMiniappApi({
      me: [maya],
      creatorChatHistory: [creatorChatHistory([])],
      creatorChatSend: [held],
    });
    mount(api);
    await screen.findByText('Rani Anggraini');
    const input = screen.getByRole('textbox', { name: 'Tulis balasan' });
    const send = screen.getByRole('button', { name: 'Kirim pesan' });
    expect(send).toBeDisabled();
    await userEvent.type(input, 'Halo Rani{Enter}');
    expect(await screen.findByText('Mengirim…')).toBeInTheDocument();
    expect(api.creatorChatSendCalls).toHaveLength(1);
    release({
      message: creatorChatMessage(1, {
        sender: 'ME',
        body: 'Halo Rani',
        client_message_id: api.creatorChatSendCalls[0]!.client_message_id,
      }),
    });
    await waitFor(() => expect(screen.queryByText('Mengirim…')).toBeNull());
    expect(screen.getByText('Halo Rani')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });

  it('shows Belum terkirim, and Kirim Ulang reuses the same client id', async () => {
    const api = createFakeMiniappApi({
      me: [maya],
      creatorChatHistory: [creatorChatHistory([])],
      creatorChatSend: [networkError()],
    });
    mount(api);
    await screen.findByText('Rani Anggraini');
    await userEvent.type(screen.getByRole('textbox', { name: 'Tulis balasan' }), 'Halo{Enter}');
    expect(await screen.findByText('Belum terkirim')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kirim Ulang' }));
    await waitFor(() => expect(api.creatorChatSendCalls).toHaveLength(2));
    expect(api.creatorChatSendCalls[1]!.client_message_id).toBe(
      api.creatorChatSendCalls[0]!.client_message_id,
    );
    await waitFor(() => expect(screen.queryByText('Belum terkirim')).toBeNull());
  });

  it('moves into the expired layout when the server refuses a send', async () => {
    const api = createFakeMiniappApi({
      me: [maya],
      creatorChatHistory: [
        creatorChatHistory([]),
        creatorChatHistory([], { state: 'EXPIRED', ended_at: '2026-11-17T04:00:00.000Z' }),
      ],
      creatorChatSend: [apiError(403, 'CHAT_ACCESS_EXPIRED')],
    });
    mount(api);
    await screen.findByText('Rani Anggraini');
    await userEvent.type(screen.getByRole('textbox', { name: 'Tulis balasan' }), 'Halo{Enter}');
    expect(await screen.findByText('Akses pelanggan telah berakhir.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('Halo')).toBeNull();
  });
});

describe('CrChatExpired (access ended)', () => {
  const expired = () =>
    creatorChatHistory(
      [
        creatorChatMessage(2, {
          sender: 'ME',
          body: 'Sama-sama, Nadia. Senang kalau cocok.',
          created_at: '2026-11-06T09:25:00.000Z',
        }),
        creatorChatMessage(1, {
          body: 'Terima kasih banyak ya kak, resepnya enak.',
          created_at: '2026-11-06T09:20:00.000Z',
        }),
      ],
      { state: 'EXPIRED', name: 'Nadia Kusuma', ended_at: '2026-11-06T16:59:59.000Z' },
    );

  it('shows the strip, the ended pill and the panel instead of a composer; history stays readable', async () => {
    mount(createFakeMiniappApi({ me: [maya], creatorChatHistory: [expired()] }));
    expect(await screen.findByText('Nadia Kusuma')).toBeInTheDocument();
    expect(screen.getAllByText('Akses telah berakhir')).toHaveLength(1);
    expect(screen.getByText('Akses berakhir')).toBeInTheDocument();
    expect(
      screen.getByText('AI tidak membalas dan broadcast baru tidak diterima.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Terima kasih banyak ya kak, resepnya enak.')).toBeInTheDocument();
    expect(screen.getByText('Akses pelanggan berakhir 6 Nov 2026, 23.59 WIB')).toBeInTheDocument();
    expect(screen.getByText('Akses pelanggan telah berakhir.')).toBeInTheDocument();
    expect(screen.getByText('Masa akses dikelola admin.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('omits the ended pill when no end date is known', async () => {
    const h = expired();
    h.conversation.access.ended_at = null;
    mount(createFakeMiniappApi({ me: [maya], creatorChatHistory: [h] }));
    await screen.findByText('Nadia Kusuma');
    expect(screen.queryByText(/Akses pelanggan berakhir/)).toBeNull();
  });
});

describe('states and roles', () => {
  it('shows the not-found text for an unknown conversation, and Coba lagi on a failure', async () => {
    mount(createFakeMiniappApi({ me: [maya], creatorChatHistory: [apiError(404, 'NOT_FOUND')] }));
    expect(await screen.findByText('Percakapan tidak ditemukan.')).toBeInTheDocument();
    cleanup();
    mount(createFakeMiniappApi({ me: [maya], creatorChatHistory: [networkError()] }));
    expect(await screen.findByRole('button', { name: /coba lagi/i })).toBeInTheDocument();
  });

  it('redirects a USER session to the customer landing', async () => {
    const router = mount(createFakeMiniappApi({ me: [nadia] }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
  });
});
