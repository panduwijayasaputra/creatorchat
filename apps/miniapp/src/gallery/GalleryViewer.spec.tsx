import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../auth/api-client';
import {
  createFakeMiniappApi,
  galleryDetail,
  galleryPage,
  mediaAsset,
  networkError,
  type FakeMiniappApi,
} from '../../test/fake-miniapp-api';
import { GalleryPage } from './GalleryPage';
import { GalleryViewer } from './GalleryViewer';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'authenticated', user: { timezone: 'Asia/Jakarta' } } }),
}));

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const A = mediaAsset(1);
const B = mediaAsset(2, { kind: 'VIDEO', duration_seconds: 48 });
const C = mediaAsset(3);
const UPLOADED = '2026-11-11T23:41:00.000Z'; // 12 Nov 2026, 06.41 in Jakarta

function mount(api: FakeMiniappApi, path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/gallery',
        element: <GalleryPage api={api} />,
        children: [{ path: ':assetId', element: <GalleryViewer api={api} /> }],
      },
    ],
    { initialEntries: path === '/gallery' ? ['/gallery'] : ['/gallery', path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}
const detailOf = (
  asset: typeof A,
  position: number,
  previous: string | null,
  next: string | null,
) =>
  galleryDetail(asset, {
    position,
    total: 3,
    previous_id: previous,
    next_id: next,
    uploaded_at: UPLOADED,
  });

describe('GalleryViewer', () => {
  it('shows the position, the upload time in the account zone and the file, with only a next button at the first item', async () => {
    const api = createFakeMiniappApi({
      gallery: [galleryPage([C, B, A])],
      galleryItem: [detailOf(C, 1, null, B.id)],
    });
    mount(api, `/gallery/${C.id}`);
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('Diunggah 12 Nov 2026, 06.41 WIB')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Media sebelumnya' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Media berikutnya' })).toBeInTheDocument();
    expect(document.querySelector('img[src*="o-"]')).toHaveAttribute(
      'src',
      expect.stringContaining('/v1/dev-storage/m/o-'),
    );
  });

  it('shows only a previous button at the last item', async () => {
    const api = createFakeMiniappApi({
      gallery: [galleryPage([C, B, A])],
      galleryItem: [detailOf(A, 3, B.id, null)],
    });
    mount(api, `/gallery/${A.id}`);
    expect(await screen.findByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Media sebelumnya' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Media berikutnya' })).toBeNull();
  });

  it('next replaces the route and loads the neighbour', async () => {
    const api = createFakeMiniappApi({
      gallery: [galleryPage([C, B, A])],
      galleryItem: [detailOf(C, 1, null, B.id), detailOf(B, 2, C.id, A.id)],
    });
    const router = mount(api, `/gallery/${C.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Media berikutnya' }));
    expect(await screen.findByText('2 / 3')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/gallery/${B.id}`);
    expect(api.galleryItemCalls).toEqual([C.id, B.id]);
    // replace: going back leaves the viewer entirely
    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.pathname).toBe('/gallery');
  });

  it('plays and pauses a video and shows elapsed and total time', async () => {
    const api = createFakeMiniappApi({
      gallery: [galleryPage([C, B, A])],
      galleryItem: [detailOf(B, 2, C.id, A.id)],
    });
    mount(api, `/gallery/${B.id}`);
    const play = await screen.findByRole('button', { name: 'Putar video' });
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('0:00')).toBeInTheDocument();
    expect(dialog.getByText('0:48')).toBeInTheDocument();
    await userEvent.click(play);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    const video = document.querySelector('video') as HTMLVideoElement;
    // jsdom does not play: make the element report what a real one would.
    Object.defineProperty(video, 'paused', { value: false, configurable: true });
    fireEvent.play(video);
    expect(screen.getByRole('button', { name: 'Jeda video' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Jeda video' }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    Object.defineProperty(video, 'paused', { value: true, configurable: true });
    fireEvent.pause(video);
    expect(screen.getByRole('button', { name: 'Putar video' })).toBeInTheDocument();
    expect(video).toHaveAttribute('playsinline');
  });

  it('refetches the link once when the file fails, then shows an error with retry', async () => {
    const api = createFakeMiniappApi({
      gallery: [galleryPage([C])],
      galleryItem: [
        detailOf(C, 1, null, null),
        detailOf(C, 1, null, null),
        detailOf(C, 1, null, null),
      ],
    });
    mount(api, `/gallery/${C.id}`);
    await screen.findByText('1 / 3');
    fireEvent.error(document.querySelector('img[src*="o-"]') as HTMLImageElement);
    await waitFor(() => expect(api.galleryItemCalls).toHaveLength(2));
    await screen.findByText('1 / 3');
    fireEvent.error(document.querySelector('img[src*="o-"]') as HTMLImageElement);
    expect(await screen.findByText('Media belum termuat.')).toBeInTheDocument();
    expect(api.galleryItemCalls).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    await waitFor(() => expect(api.galleryItemCalls).toHaveLength(3));
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
  });

  it('shows not-found with Tutup, and a retryable error when the load fails', async () => {
    const api = createFakeMiniappApi({
      gallery: [galleryPage([C])],
      galleryItem: [new ApiError(404, 'MEDIA_NOT_FOUND', 'x')],
    });
    const router = mount(api, `/gallery/${A.id}`);
    expect(await screen.findByText('Media tidak ditemukan.')).toBeInTheDocument();
    cleanup();
    const failing = createFakeMiniappApi({
      gallery: [galleryPage([C])],
      galleryItem: [networkError(), detailOf(C, 1, null, null)],
    });
    mount(failing, `/gallery/${C.id}`);
    await screen.findByText('Media belum termuat.');
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    void router;
  });

  it('Tutup returns to the grid, which stays mounted (no second gallery request)', async () => {
    const api = createFakeMiniappApi({
      gallery: [galleryPage([C, B, A])],
      galleryItem: [detailOf(C, 1, null, B.id)],
    });
    const router = mount(api, '/gallery');
    await screen.findByText('3 foto dan video');
    await userEvent.click(screen.getAllByRole('button', { name: 'Foto' })[0] as HTMLElement);
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/gallery/${C.id}`);
    expect(screen.getByText('3 foto dan video')).toBeInTheDocument(); // the grid is still there
    await userEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/gallery'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.galleryCalls).toHaveLength(1);
  });

  it('opened directly (no history) Tutup goes to /gallery', async () => {
    const api = createFakeMiniappApi({
      gallery: [galleryPage([C])],
      galleryItem: [detailOf(C, 1, null, null)],
    });
    const router = createMemoryRouter(
      [
        {
          path: '/gallery',
          element: <GalleryPage api={api} />,
          children: [{ path: ':assetId', element: <GalleryViewer api={api} /> }],
        },
      ],
      { initialEntries: [`/gallery/${C.id}`] },
    );
    render(<RouterProvider router={router} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Tutup' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/gallery'));
  });

  it('shows and hides Telegram BackButton while open', async () => {
    const button = { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() };
    window.Telegram = { WebApp: { BackButton: button } as never };
    const api = createFakeMiniappApi({
      gallery: [galleryPage([C])],
      galleryItem: [detailOf(C, 1, null, null)],
    });
    mount(api, `/gallery/${C.id}`);
    await screen.findByText('1 / 3');
    expect(button.show).toHaveBeenCalled();
    cleanup();
    expect(button.hide).toHaveBeenCalled();
    delete window.Telegram;
  });
});
