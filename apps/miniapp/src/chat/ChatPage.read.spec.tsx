import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(api: FakeMiniappApi) {
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=x&hash=y'),
      seen: fakeSeen(true),
    }),
    { initialEntries: [`/chats/${CONV}`] },
  );
  render(<RouterProvider router={router} />);
}

const items = () => [
  chatMessage(4, { sender: 'ME', body: 'Pesan terakhir saya' }),
  chatMessage(3, { sender: 'ME', body: 'Pesan kedua saya' }),
  chatMessage(2, { sender: 'CREATOR', body: 'Balasan creator' }),
  chatMessage(1, { sender: 'ME', body: 'Pesan pertama saya' }),
];
const bubble = (text: string) => screen.getByText(text).closest('div')!.parentElement!;

describe('"Dibaca" marker', () => {
  it('shows tick + Dibaca under my latest message the creator has read, and nowhere else', async () => {
    mount(createFakeMiniappApi({ chatHistory: [chatHistory(items(), { peer_read_seq: 3 })] }));
    await screen.findByText('Pesan kedua saya');
    expect(screen.getAllByText('Dibaca')).toHaveLength(1);
    expect(within(bubble('Pesan kedua saya')).getByText('Dibaca')).toBeInTheDocument();
    expect(within(bubble('Pesan terakhir saya')).queryByText('Dibaca')).toBeNull();
    expect(within(bubble('Balasan creator')).queryByText('Dibaca')).toBeNull();
    expect(within(bubble('Pesan pertama saya')).queryByText('Dibaca')).toBeNull();
  });

  it('shows nothing while the creator has read nothing', async () => {
    mount(createFakeMiniappApi({ chatHistory: [chatHistory(items(), { peer_read_seq: 0 })] }));
    await screen.findByText('Pesan kedua saya');
    expect(screen.queryByText('Dibaca')).toBeNull();
  });

  it('is on the newest message when the creator read everything', async () => {
    mount(createFakeMiniappApi({ chatHistory: [chatHistory(items(), { peer_read_seq: 4 })] }));
    await screen.findByText('Pesan terakhir saya');
    expect(within(bubble('Pesan terakhir saya')).getByText('Dibaca')).toBeInTheDocument();
    expect(screen.getAllByText('Dibaca')).toHaveLength(1);
  });

  it('has the same marker once access has ended', async () => {
    mount(
      createFakeMiniappApi({
        chatHistory: [chatHistory(items(), { peer_read_seq: 4, state: 'EXPIRED' })],
      }),
    );
    await screen.findByText('Pesan terakhir saya');
    expect(screen.getAllByText('Dibaca')).toHaveLength(1);
  });

  it('never marks an unsent message', async () => {
    const api = createFakeMiniappApi({
      chatHistory: [chatHistory(items(), { peer_read_seq: 4 })],
      chatSend: [networkError()],
    });
    mount(api);
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Tulis pesan' }),
      'Halo gagal{Enter}',
    );
    await screen.findByText('Belum terkirim');
    expect(within(bubble('Halo gagal')).queryByText('Dibaca')).toBeNull();
    expect(screen.getAllByText('Dibaca')).toHaveLength(1);
  });

  it('opening the chat moves my cursor to the newest creator message', async () => {
    const api = createFakeMiniappApi({ chatHistory: [chatHistory(items(), { peer_read_seq: 0 })] });
    mount(api);
    await screen.findByText('Balasan creator');
    await vi.waitFor(() =>
      expect(api.chatReadCalls).toEqual([{ conversationId: CONV, throughSeq: 2 }]),
    );
  });
});
