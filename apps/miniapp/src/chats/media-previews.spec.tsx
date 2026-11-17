import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import type { ChatListItem } from '@creatorchat/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeMiniappApi,
  fakeSeen,
  fakeTelegram,
  inboxItem,
  inboxPage,
  maya,
  nadia,
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
});

function mount(api: FakeMiniappApi, path: string) {
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=x&hash=y'),
      seen: fakeSeen(true),
    }),
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
}

const chatRow = (n: number, last: ChatListItem['last_message']): ChatListItem => ({
  conversation_id: `55555555-0000-4000-8000-${String(n).padStart(12, '0')}`,
  public_code: `crea${String(n).padStart(4, '2')}`,
  display_name: `Creator ${n}`,
  avatar_url: null,
  last_message: last,
  unread_count: 0,
  access: 'ACTIVE',
});

describe('media-only previews (US-036)', () => {
  it('the chat list says Foto / Video for a message without text and keeps text previews', async () => {
    mount(
      createFakeMiniappApi({
        me: [nadia],
        chatList: [
          {
            items: [
              chatRow(1, { preview: '', at: '2026-11-17T01:00:00.000Z', media_kind: 'PHOTO' }),
              chatRow(2, { preview: '', at: '2026-11-17T00:50:00.000Z', media_kind: 'VIDEO' }),
              chatRow(3, { preview: 'Halo', at: '2026-11-17T00:40:00.000Z', media_kind: null }),
            ],
            next_cursor: null,
          },
        ],
      }),
      '/chats',
    );
    expect(await screen.findByText('Foto')).toBeInTheDocument();
    expect(screen.getByText('Video')).toBeInTheDocument();
    expect(screen.getByText('Halo')).toBeInTheDocument();
  });

  it('the inbox says Foto / Video for a message without text', async () => {
    mount(
      createFakeMiniappApi({
        me: [maya],
        inbox: [
          inboxPage([
            inboxItem(1, { preview: '', preview_media_kind: 'VIDEO' }),
            inboxItem(2, { preview: '', preview_media_kind: 'PHOTO' }),
            inboxItem(3, { preview: 'Terima kasih' }),
          ]),
        ],
      }),
      '/inbox',
    );
    expect(await screen.findByText('Video')).toBeInTheDocument();
    expect(screen.getByText('Foto')).toBeInTheDocument();
    expect(screen.getByText('Terima kasih')).toBeInTheDocument();
  });
});
