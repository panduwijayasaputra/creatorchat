import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../auth/api-client';
import {
  chatHistory,
  chatMediaDetail,
  chatMessage,
  createFakeMiniappApi,
  creatorChatHistory,
  creatorChatMessage,
  fakeSeen,
  fakeTelegram,
  maya,
  type FakeMiniappApi,
} from '../../test/fake-miniapp-api';
import { createMiniappRoutes } from '../app/routes';

const CONV = '22222222-0000-4000-8000-000000000001';
const A = '77777777-0000-4000-8000-000000000001';
const B = '77777777-0000-4000-8000-000000000002';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T05:00:00.000Z') });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

const photo = (id: string) => ({
  id,
  kind: 'PHOTO' as const,
  duration_seconds: null,
  thumbnail_url: `http://localhost:3000/v1/dev-storage/m/t-${id}?s=x`,
});
const video = (id: string) => ({ ...photo(id), kind: 'VIDEO' as const, duration_seconds: 42 });

const history = (state: 'ACTIVE' | 'EXPIRED' = 'ACTIVE') =>
  chatHistory(
    [
      chatMessage(2, {
        type: 'MEDIA',
        body: null,
        attachments: [video(B)],
        created_at: '2026-11-17T02:16:00.000Z',
      }),
      chatMessage(1, {
        type: 'MEDIA',
        body: 'Versi pedas buat akhir pekan ini.',
        attachments: [photo(A)],
        created_at: '2026-11-17T02:10:00.000Z',
      }),
    ],
    { state },
  );

describe('media bubbles in the customer chat', () => {
  it('shows a photo with its message and a video with its length', async () => {
    mount(createFakeMiniappApi({ chatHistory: [history()] }));
    expect(await screen.findByText('Versi pedas buat akhir pekan ini.')).toBeInTheDocument();
    expect(screen.getAllByTestId('media-bubble')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Buka foto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Putar video 0:42' })).toBeInTheDocument();
    expect(screen.getByText('0:42')).toBeInTheDocument();
    expect(screen.queryByText('Manual')).toBeNull();
  });

  it('opens the viewer at the right place; the footer shows message, creator and time; Tutup returns', async () => {
    const api = createFakeMiniappApi({
      chatHistory: [history()],
      chatMedia: [chatMediaDetail(A, { position: 1, total: 2, next_id: B })],
    });
    const router = mount(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Buka foto' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('1 / 2')).toBeInTheDocument();
    expect(within(dialog).getByText('Versi pedas buat akhir pekan ini.')).toBeInTheDocument();
    expect(within(dialog).getByText('Salsa Maheswari · Hari ini, 09.16 WIB')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/chats/${CONV}/media/${A}`);
    expect(api.chatMediaCalls[0]).toEqual({ conversationId: CONV, attachmentId: A });
    expect(within(dialog).queryByRole('button', { name: 'Media sebelumnya' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tutup' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.pathname).toBe(`/chats/${CONV}`);
  });

  it("previous and next walk the conversation's files", async () => {
    const api = createFakeMiniappApi({
      chatHistory: [history()],
      chatMedia: [
        chatMediaDetail(A, { position: 1, total: 2, next_id: B }),
        chatMediaDetail(B, {
          position: 2,
          total: 2,
          previous_id: A,
          item: { ...video(B), duration_seconds: 42 },
          message: { body: null, created_at: '2026-11-17T02:16:00.000Z' },
        }),
        chatMediaDetail(A, { position: 1, total: 2, next_id: B }),
      ],
    });
    const router = mount(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Buka foto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Media berikutnya' }));
    expect(await screen.findByText('2 / 2')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/chats/${CONV}/media/${B}`);
    expect(screen.queryByRole('button', { name: 'Media berikutnya' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Media sebelumnya' }));
    expect(await screen.findByText('1 / 2')).toBeInTheDocument();
  });

  it('an expired chat still opens its files', async () => {
    const api = createFakeMiniappApi({
      chatHistory: [history('EXPIRED')],
      chatMedia: [chatMediaDetail(A, { position: 1, total: 2, next_id: B })],
    });
    mount(api);
    expect(
      await screen.findByText('Akses telah berakhir', { selector: 'div' }),
    ).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Buka foto' }));
    expect(await screen.findByText('1 / 2')).toBeInTheDocument();
  });

  it('a failing link is refreshed once, then an error with retry; no AI wording anywhere', async () => {
    const api = createFakeMiniappApi({
      chatHistory: [history()],
      chatMedia: [
        chatMediaDetail(A, { position: 1, total: 2 }),
        chatMediaDetail(A, { position: 1, total: 2 }),
        chatMediaDetail(A, { position: 1, total: 2 }),
      ],
    });
    mount(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Buka foto' }));
    await screen.findByText('1 / 2');
    fireEvent.error(document.querySelector('[role="dialog"] img') as HTMLImageElement);
    await waitFor(() => expect(api.chatMediaCalls).toHaveLength(2));
    await screen.findByText('1 / 2');
    fireEvent.error(document.querySelector('[role="dialog"] img') as HTMLImageElement);
    expect(await screen.findByText('Media belum termuat.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bAI\b|\bManual\b/);
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    await waitFor(() => expect(api.chatMediaCalls).toHaveLength(3));
  });

  it('shows not-found for a file that is not mine', async () => {
    const api = createFakeMiniappApi({
      chatHistory: [history()],
      chatMedia: [new ApiError(404, 'NOT_FOUND', 'x')],
    });
    mount(api, `/chats/${CONV}/media/${A}`);
    expect(await screen.findByText('Media tidak ditemukan.')).toBeInTheDocument();
  });
});

describe('the creator side', () => {
  it('shows media bubbles that are not tappable, with the Manual tag', async () => {
    const api = createFakeMiniappApi({
      me: [maya],
      creatorChatHistory: [
        creatorChatHistory([
          creatorChatMessage(1, {
            sender: 'ME',
            type: 'MEDIA',
            body: 'Ini tepungnya',
            attachments: [photo(A)],
          }),
        ]),
      ],
    });
    mount(api, '/inbox/66666666-0000-4000-8000-000000000001');
    expect(await screen.findByTestId('media-bubble')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buka foto' })).toBeNull();
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });
});
