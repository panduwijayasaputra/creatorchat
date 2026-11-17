import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../auth/api-client';
import {
  createFakeMiniappApi,
  galleryPage,
  mediaAsset,
  networkError,
  type FakeMiniappApi,
} from '../../test/fake-miniapp-api';
import { GalleryPage } from './GalleryPage';
import { UploadError, type PutFile } from './upload-file';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'authenticated', user: { timezone: 'Asia/Jakarta' } } }),
}));

afterEach(cleanup);

const photo = (name = 'a.jpg', type = 'image/jpeg') =>
  new File([new Uint8Array(1000)], name, { type });

function mount(api: FakeMiniappApi, put?: PutFile) {
  const router = createMemoryRouter(
    [{ path: '/gallery', element: <GalleryPage api={api} {...(put ? { put } : {})} pollMs={0} /> }],
    { initialEntries: ['/gallery'] },
  );
  render(<RouterProvider router={router} />);
}
const choose = (file: File) =>
  userEvent.upload(screen.getByTestId('file-input') as HTMLInputElement, file, {
    applyAccept: false,
  });
const okPut: PutFile = async (_t, _f, onProgress) => onProgress(100);

const fiveItems = () =>
  [1, 2, 3, 4, 5].map((n) => mediaAsset(n, n === 2 ? { kind: 'VIDEO', duration_seconds: 48 } : {}));

describe('GalleryPage states', () => {
  it('shows the empty board copy and an Upload button', async () => {
    mount(createFakeMiniappApi({ gallery: [galleryPage([])] }));
    expect(await screen.findByText('Galeri masih kosong')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Upload foto atau video. Media galeri hanya terlihat oleh subscriber aktif.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
  });

  it('shows a skeleton while loading, then the count, the note and the tiles', async () => {
    mount(createFakeMiniappApi({ gallery: [galleryPage(fiveItems(), { total: 12 })] }));
    expect(screen.getByRole('status', { name: 'Memuat' })).toBeInTheDocument();
    expect(await screen.findByText('12 foto dan video')).toBeInTheDocument();
    expect(screen.getByText('Galeri hanya terlihat oleh subscriber aktif.')).toBeInTheDocument();
    expect(screen.getByText('0:48')).toBeInTheDocument();
    expect(screen.queryByText('Baru')).toBeNull();
  });

  it('shows a retryable error when the gallery cannot load', async () => {
    const api = createFakeMiniappApi({ gallery: [networkError(), galleryPage(fiveItems())] });
    mount(api);
    expect(await screen.findByText('Galeri gagal dimuat')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByText('5 foto dan video')).toBeInTheDocument();
  });
});

describe('GalleryPage upload', () => {
  it('shows progress, then a "Baru" tile at the top, count + 1 and the toast', async () => {
    const api = createFakeMiniappApi({ gallery: [galleryPage(fiveItems())] });
    let finish: () => void = () => undefined;
    const put: PutFile = (_t, _f, onProgress) =>
      new Promise<void>((resolve) => {
        onProgress(64);
        finish = resolve;
      });
    mount(api, put);
    await screen.findByText('5 foto dan video');
    await choose(photo());
    expect(await screen.findByText('64%')).toBeInTheDocument();
    expect(api.mediaInitCalls[0]).toMatchObject({
      kind: 'PHOTO',
      content_type: 'image/jpeg',
      size_bytes: 1000,
    });
    finish();
    expect(await screen.findByText('Baru')).toBeInTheDocument();
    expect(screen.getByText('6 foto dan video')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Media berhasil diunggah ke galeri');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(api.mediaCompleteCalls).toHaveLength(1);
  });

  it('starts from the empty state and shows the grid once an upload is under way', async () => {
    const api = createFakeMiniappApi({ gallery: [galleryPage([])] });
    mount(api, () => new Promise<void>(() => undefined));
    await screen.findByText('Galeri masih kosong');
    await choose(photo());
    expect(await screen.findByRole('progressbar', { name: 'Mengunggah' })).toBeInTheDocument();
    expect(screen.queryByText('Galeri masih kosong')).toBeNull();
  });

  it('after a dropped connection shows the banner, and Coba Lagi reuses the same client_upload_id', async () => {
    const api = createFakeMiniappApi({ gallery: [galleryPage(fiveItems())] });
    const put = vi.fn<PutFile>().mockRejectedValueOnce(new UploadError()).mockImplementation(okPut);
    mount(api, put);
    await screen.findByText('5 foto dan video');
    await choose(photo());
    expect(await screen.findByText('Unggahan gagal')).toBeInTheDocument();
    expect(
      screen.getByText('Koneksi terputus saat mengunggah. Media belum masuk ke galeri.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unggahan gagal. Coba lagi' }));
    expect(await screen.findByText('Baru')).toBeInTheDocument();
    expect(api.mediaInitCalls).toHaveLength(2);
    expect(api.mediaInitCalls[1]?.client_upload_id).toBe(api.mediaInitCalls[0]?.client_upload_id);
  });

  it('a 409 on complete uploads once more with a fresh link, then succeeds', async () => {
    const api = createFakeMiniappApi({
      gallery: [galleryPage(fiveItems())],
      mediaComplete: [
        new ApiError(409, 'MEDIA_UPLOAD_INCOMPLETE', 'x'),
        { asset: mediaAsset(900, { state: 'PROCESSING', thumbnail_url: null }) },
      ],
    });
    const put = vi.fn<PutFile>(okPut);
    mount(api, put);
    await screen.findByText('5 foto dan video');
    await choose(photo());
    expect(await screen.findByText('Baru')).toBeInTheDocument();
    expect(put).toHaveBeenCalledTimes(2);
    expect(api.mediaInitCalls).toHaveLength(2);
    expect(api.mediaCompleteCalls).toHaveLength(2);
  });

  it('a file the server refused becomes a failed tile, and Coba Lagi starts over with a new id', async () => {
    const api = createFakeMiniappApi({
      gallery: [galleryPage(fiveItems())],
      mediaComplete: [
        {
          asset: mediaAsset(900, {
            state: 'FAILED',
            failure: 'TYPE_NOT_ALLOWED',
            thumbnail_url: null,
          }),
        },
      ],
    });
    mount(api, okPut);
    await screen.findByText('5 foto dan video');
    await choose(photo());
    expect(
      await screen.findByText('Jenis file tidak didukung. Media belum masuk ke galeri.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unggahan gagal. Coba lagi' }));
    expect(await screen.findByText('Baru')).toBeInTheDocument();
    expect(api.mediaInitCalls[1]?.client_upload_id).not.toBe(
      api.mediaInitCalls[0]?.client_upload_id,
    );
  });

  it('refuses an over-limit file and an unsupported type without any request', async () => {
    const api = createFakeMiniappApi({ gallery: [galleryPage(fiveItems())] });
    mount(api, okPut);
    await screen.findByText('5 foto dan video');
    await waitFor(() => expect(api.mediaLimitsResult).toBeDefined());
    const big = photo('big.jpg');
    Object.defineProperty(big, 'size', { value: 10_485_761 });
    await choose(big);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'File terlalu besar. Batasnya 10 MB.',
    );
    await choose(photo('x.gif', 'image/gif'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Jenis file tidak didukung.'),
    );
    expect(api.mediaInitCalls).toHaveLength(0);
  });

  it('keeps one file per tap: only the first chosen file starts', async () => {
    const api = createFakeMiniappApi({ gallery: [galleryPage(fiveItems())] });
    mount(api, okPut);
    await screen.findByText('5 foto dan video');
    await userEvent.upload(
      screen.getByTestId('file-input') as HTMLInputElement,
      [photo('1.jpg'), photo('2.jpg')],
      { applyAccept: false },
    );
    await waitFor(() => expect(api.mediaInitCalls).toHaveLength(1));
  });
});

describe('GalleryPage tiles', () => {
  it('opens each tile as a button with its label', async () => {
    mount(createFakeMiniappApi({ gallery: [galleryPage(fiveItems())] }));
    await screen.findByText('5 foto dan video');
    expect(screen.getAllByRole('button', { name: 'Foto' })).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: 'Video' })).toHaveLength(1);
    expect(within(document.body).queryByRole('img', { name: 'Foto' })).toBeNull();
  });
});
