import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminMediaDetail } from '@creatorchat/contracts';
import { ApiError, type CreatorGalleryApi } from '../../../auth/api-client';
import { PageCrumbsProvider } from '../../../components/shell/page-crumbs';
import { GALLERY_CREATOR_ID, MEDIA_DETAIL } from '../../../../test/gallery-fixtures';
import { MediaDetailPage } from './MediaDetailPage';

afterEach(cleanup);

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function setup(
  get: (id: string, mediaId: string) => Promise<AdminMediaDetail>,
  state?: { from: string },
) {
  const getCreatorMedia = vi.fn(get);
  const api = { getCreatorMedia, listCreatorGallery: vi.fn() } as unknown as CreatorGalleryApi;
  render(
    <PageCrumbsProvider>
      <MemoryRouter
        initialEntries={[
          { pathname: `/creators/${GALLERY_CREATOR_ID}/gallery/${MEDIA_DETAIL.asset_id}`, state },
        ]}
      >
        <Routes>
          <Route path="/creators/:id/gallery/:mediaId" element={<MediaDetailPage api={api} />} />
          <Route path="/creators/:id/gallery" element={<div>gallery list</div>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </PageCrumbsProvider>,
  );
  return { getCreatorMedia };
}

describe('MediaDetailPage', () => {
  it('shows the preview and the information rows of the board', async () => {
    const { getCreatorMedia } = setup(async () => MEDIA_DETAIL);
    expect(await screen.findByText('Informasi media')).toBeInTheDocument();
    expect(getCreatorMedia).toHaveBeenCalledWith(
      GALLERY_CREATOR_ID,
      MEDIA_DETAIL.asset_id,
      expect.anything(),
    );
    const rows: [string, string][] = [
      ['Jenis', 'Video'],
      ['Durasi', '0:48'],
      ['Ukuran', '18 MB'],
      ['Diunggah', '12 Nov 2026, 06.41 WIB'],
      ['Creator', 'Salsa Maheswari'],
      ['Tampil di', 'Galeri, untuk subscriber aktif'],
      ['ID media', 'med_8f21c04'],
    ];
    for (const [label, value] of rows) {
      expect(screen.getByText(label).nextElementSibling).toHaveTextContent(value);
    }
    expect(
      screen.getByText(
        'Tampilan admin hanya untuk media galeri. Lampiran chat privat tidak bisa dibuka dari sini.',
      ),
    ).toBeInTheDocument();
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video).toHaveAttribute('src', MEDIA_DETAIL.preview.url);
    expect(video).toHaveAttribute('poster', MEDIA_DETAIL.poster_url as string);
    expect(video.controls).toBe(true);
  });

  it('a photo is shown as an image', async () => {
    setup(async () => ({
      ...MEDIA_DETAIL,
      kind: 'PHOTO',
      duration_seconds: null,
      poster_url: null,
    }));
    await screen.findByText('Informasi media');
    expect(document.querySelector('img')).toHaveAttribute('src', MEDIA_DETAIL.preview.url);
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByText('Durasi').nextElementSibling).toHaveTextContent('–');
  });

  it('Kembali ke Galeri goes back to the list with its filters', async () => {
    setup(async () => MEDIA_DETAIL, { from: `/creators/${GALLERY_CREATOR_ID}/gallery?kind=VIDEO` });
    await userEvent.click(await screen.findByRole('link', { name: 'Kembali ke Galeri' }));
    expect(await screen.findByText('gallery list')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('?kind=VIDEO');
  });

  it('shows not-found, and a load failure that can be retried', async () => {
    setup(async () => Promise.reject(new ApiError(404, 'MEDIA_NOT_FOUND', 'x')));
    expect(await screen.findByText('Media tidak ditemukan')).toBeInTheDocument();
    cleanup();
    let calls = 0;
    setup(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return MEDIA_DETAIL;
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByText('Informasi media')).toBeInTheDocument();
  });

  it('shows a text when the preview file fails to load', async () => {
    setup(async () => ({ ...MEDIA_DETAIL, kind: 'PHOTO', poster_url: null }));
    await screen.findByText('Informasi media');
    document.querySelector('img')?.dispatchEvent(new Event('error'));
    expect(await screen.findByText('Pratinjau belum bisa dimuat.')).toBeInTheDocument();
  });
});
