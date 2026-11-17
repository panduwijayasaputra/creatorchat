import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  chatHistory,
  chatMessage,
  createFakeMiniappApi,
  fakeSeen,
  fakeTelegram,
  networkError,
  type FakeMiniappApi,
} from '../../test/fake-miniapp-api';
import { createMiniappRoutes } from '../app/routes';

const CONV = '22222222-0000-4000-8000-000000000001';

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

function mount(api: FakeMiniappApi, path = `/chats/${CONV}`) {
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
  chatHistory(
    [
      chatMessage(4, {
        sender: 'ME',
        body: 'Pengin coba bikin roti sobek.',
        created_at: '2026-11-17T02:05:00.000Z',
      }),
      chatMessage(3, {
        body: 'Versi pedas buat akhir pekan ini.',
        created_at: '2026-11-16T11:02:00.000Z',
      }),
    ],
    { next_before: null },
  );

describe('Chat (access active)', () => {
  it('shows the header, day separators, bubbles and times in the account zone', async () => {
    const api = createFakeMiniappApi({ chatHistory: [board()] });
    mount(api);
    expect(await screen.findByText('Salsa Maheswari')).toBeInTheDocument();
    expect(screen.getByText('Akses aktif hingga 27 Nov 2026')).toBeInTheDocument();
    expect(screen.getByText('Kemarin')).toBeInTheDocument();
    expect(screen.getByText('Hari ini')).toBeInTheDocument();
    expect(screen.getByText('Pengin coba bikin roti sobek.')).toBeInTheDocument();
    expect(screen.getByText('09.05')).toBeInTheDocument();
    expect(screen.getByText('18.02')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Salsa Maheswari/ })).toHaveAttribute(
      'href',
      '/creators/salsa234',
    );
    expect(screen.getByRole('textbox', { name: 'Tulis pesan' })).toBeInTheDocument();
  });

  it('never shows an AI / Manual label or read ticks', async () => {
    mount(createFakeMiniappApi({ chatHistory: [board()] }));
    await screen.findByText('Salsa Maheswari');
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\bAI\b|Manual|Dibaca/);
  });

  it('shows the loading frame with "Memuat riwayat…" while the history loads', async () => {
    let release!: (v: ReturnType<typeof board>) => void;
    const held = new Promise<ReturnType<typeof board>>((r) => (release = r));
    mount(createFakeMiniappApi({ chatHistory: [held] }));
    expect(await screen.findByText('Memuat riwayat…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kirim pesan' })).toBeDisabled();
    release(board());
    expect(await screen.findByText('Salsa Maheswari')).toBeInTheDocument();
  });

  it('sends with Enter: the bubble shows Mengirim…, then settles; the send button follows the input', async () => {
    let release!: (v: { message: ReturnType<typeof chatMessage> }) => void;
    const held = new Promise<{ message: ReturnType<typeof chatMessage> }>((r) => (release = r));
    const api = createFakeMiniappApi({ chatHistory: [board()], chatSend: [held] });
    mount(api);
    const input = await screen.findByRole('textbox', { name: 'Tulis pesan' });
    const send = screen.getByRole('button', { name: 'Kirim pesan' });
    expect(send).toBeDisabled();
    await userEvent.type(input, 'Halo kak{Enter}');
    expect(await screen.findByText('Mengirim…')).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(api.chatSendCalls).toHaveLength(1);
    const sent = api.chatSendCalls[0]!;
    release({
      message: chatMessage(5, {
        sender: 'ME',
        body: 'Halo kak',
        client_message_id: sent.client_message_id,
      }),
    });
    await waitFor(() => expect(screen.queryByText('Mengirim…')).toBeNull());
    expect(screen.getByText('Halo kak')).toBeInTheDocument();
  });

  it('a failed send shows Belum terkirim and Kirim Ulang, which retries with the same id', async () => {
    const api = createFakeMiniappApi({ chatHistory: [board()], chatSend: [networkError()] });
    mount(api);
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Tulis pesan' }),
      'Halo{Enter}',
    );
    expect(await screen.findByText('Belum terkirim')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kirim Ulang' }));
    await waitFor(() => expect(screen.queryByText('Belum terkirim')).toBeNull());
    expect(api.chatSendCalls).toHaveLength(2);
    expect(api.chatSendCalls[0]!.client_message_id).toBe(api.chatSendCalls[1]!.client_message_id);
    expect(screen.getAllByText('Halo')).toHaveLength(1);
  });

  it('a refused send (access ended) removes the bubble and shows the ChatExpired panel; history stays', async () => {
    const api = createFakeMiniappApi({
      chatHistory: [board(), chatHistory(board().items, { state: 'EXPIRED' })],
      chatSend: [apiError(403, 'CHAT_ACCESS_EXPIRED')],
    });
    mount(api);
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Tulis pesan' }),
      'Halo{Enter}',
    );
    expect(
      await screen.findByRole('button', { name: 'Minta Perpanjangan Akses' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Tulis pesan' })).toBeNull();
    expect(screen.queryByText('Halo')).toBeNull();
    expect(screen.getByText('Pengin coba bikin roti sobek.')).toBeInTheDocument();
  });
});

describe('ChatExpired', () => {
  const expired = () => chatHistory(board().items, { state: 'EXPIRED', name: 'Kirana Larasati' });

  it('keeps the history, shows the end time and the panel instead of the composer', async () => {
    mount(createFakeMiniappApi({ chatHistory: [expired()] }));
    expect(await screen.findByText('Kirana Larasati')).toBeInTheDocument();
    expect(screen.getAllByText('Akses telah berakhir').length).toBeGreaterThan(0);
    expect(screen.getByText('Akses berakhir 6 Nov 2026, 23.59 WIB')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Riwayat chat tetap bisa kamu baca. Minta perpanjangan untuk melanjutkan percakapan.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Pengin coba bikin roti sobek.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Minta Perpanjangan Akses requests once and opens the profile', async () => {
    const api = createFakeMiniappApi({ chatHistory: [expired()] });
    const router = mount(api);
    const button = await screen.findByRole('button', { name: 'Minta Perpanjangan Akses' });
    await userEvent.dblClick(button);
    await waitFor(() => expect(router.state.location.pathname).toBe('/creators/salsa234'));
    expect(api.requestAccessCalls).toEqual(['salsa234']);
  });

  it('shows the failure and stays when the request fails', async () => {
    const api = createFakeMiniappApi({
      chatHistory: [expired()],
      requestAccess: [networkError()],
    });
    const router = mount(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Minta Perpanjangan Akses' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Permintaan belum terkirim. Coba lagi.',
    );
    expect(router.state.location.pathname).toBe(`/chats/${CONV}`);
  });
});

describe('creator blocked (design gap)', () => {
  it('shows the placeholder panel with no renewal button', async () => {
    mount(
      createFakeMiniappApi({
        chatHistory: [chatHistory(board().items, { state: 'CREATOR_BLOCKED' })],
      }),
    );
    const panel = (await screen.findAllByText('Creator tidak tersedia'))[0]!;
    expect(panel).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Minta Perpanjangan Akses' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Pengin coba bikin roti sobek.')).toBeInTheDocument();
  });
});

describe('failures', () => {
  it('404 shows the placeholder not-found state', async () => {
    mount(createFakeMiniappApi({ chatHistory: [apiError(404, 'NOT_FOUND')] }));
    expect(await screen.findByText('Percakapan tidak ditemukan.')).toBeInTheDocument();
  });

  it('a load failure offers a retry', async () => {
    const api = createFakeMiniappApi({ chatHistory: [networkError(), board()] });
    mount(api);
    const retry = await screen.findByRole('button', { name: /coba lagi/i });
    await userEvent.click(retry);
    expect(await screen.findByText('Salsa Maheswari')).toBeInTheDocument();
  });

  it('the … button only says the feature is not available yet', async () => {
    mount(createFakeMiniappApi({ chatHistory: [board()] }));
    await screen.findByText('Salsa Maheswari');
    await userEvent.click(screen.getByRole('button', { name: 'Opsi percakapan' }));
    expect(
      within(await screen.findByRole('status')).getByText('Fitur ini belum tersedia.'),
    ).toBeInTheDocument();
  });
});
