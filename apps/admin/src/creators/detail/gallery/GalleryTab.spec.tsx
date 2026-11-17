import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminGalleryResponse } from '@creatorchat/contracts';
import { ToastProvider } from '@creatorchat/ui';
import type { CreatorGalleryApi } from '../../../auth/api-client';
import { GALLERY_CREATOR_ID, GALLERY_ROWS, galleryPage } from '../../../../test/gallery-fixtures';
import { GalleryTab } from './GalleryTab';

afterEach(cleanup);

function Where() {
  const l = useLocation();
  return (
    <>
      <div data-testid="where">{l.pathname + l.search}</div>
      <div data-testid="from">{(l.state as { from?: string } | null)?.from}</div>
    </>
  );
}

function setup(
  options: { list?: (q: unknown) => Promise<AdminGalleryResponse>; url?: string } = {},
) {
  const listCreatorGallery = vi.fn(options.list ?? (async () => galleryPage(GALLERY_ROWS)));
  const api = { listCreatorGallery, getCreatorMedia: vi.fn() } as unknown as CreatorGalleryApi;
  render(
    <MemoryRouter initialEntries={[options.url ?? `/creators/${GALLERY_CREATOR_ID}/gallery`]}>
      <ToastProvider>
        <Routes>
          <Route
            path="/creators/:id/gallery"
            element={<GalleryTab api={api} creatorId={GALLERY_CREATOR_ID} />}
          />
          <Route path="/creators/:id/gallery/:mediaId" element={<div>media page</div>} />
        </Routes>
        <Where />
      </ToastProvider>
    </MemoryRouter>,
  );
  return { listCreatorGallery };
}

const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;

describe('GalleryTab table', () => {
  it('shows the private-chat note, the board columns and the formatted rows', async () => {
    setup();
    await screen.findByText('Media #12');
    expect(
      screen.getByText(
        'Hanya media galeri yang tampil di sini. Lampiran chat privat tidak ditampilkan dan tidak bisa dibuka secara massal.',
      ),
    ).toBeInTheDocument();
    for (const h of ['Thumbnail', 'Jenis', 'Durasi', 'Ukuran', 'Diunggah', 'Aksi']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(`^${h}`) })).toBeInTheDocument();
    }
    const photo = rowOf('Media #12');
    expect(within(photo).getByText('Foto')).toBeInTheDocument();
    expect(within(photo).getByText('–')).toBeInTheDocument();
    expect(within(photo).getByText('2,4 MB')).toBeInTheDocument();
    expect(within(photo).getByText('12 Nov 2026')).toBeInTheDocument();
    const video = rowOf('Media #11');
    expect(within(video).getByText('Video')).toBeInTheDocument();
    expect(within(video).getAllByText('0:48')).toHaveLength(2); // poster badge and the Durasi cell
    expect(within(video).getByText('18 MB')).toBeInTheDocument();
    expect(await screen.findByText(/dari 12 hasil/)).toBeInTheDocument();
    expect(rowOf('Media #8')).toHaveTextContent('1:12');
  });

  it('View opens the media page and remembers the list URL with its filters', async () => {
    setup({ url: `/creators/${GALLERY_CREATOR_ID}/gallery?kind=VIDEO&sort=size` });
    await userEvent.click(
      within(
        await screen.findByText('Media #11').then((e) => e.closest('tr') as HTMLElement),
      ).getByRole('button', { name: 'View Media #11' }),
    );
    expect(await screen.findByText('media page')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(`/gallery/${GALLERY_ROWS[1]?.asset_id}`);
    expect(screen.getByTestId('from')).toHaveTextContent(
      `/creators/${GALLERY_CREATOR_ID}/gallery?kind=VIDEO&sort=size`,
    );
  });

  it('filters, search, sort and size send their values, reset to page 1 and live in the URL', async () => {
    const { listCreatorGallery } = setup({
      url: `/creators/${GALLERY_CREATOR_ID}/gallery?page=2`,
    });
    await screen.findByText('Media #12');
    await userEvent.selectOptions(screen.getByLabelText('Jenis'), 'VIDEO');
    await waitFor(() =>
      expect(listCreatorGallery).toHaveBeenLastCalledWith(
        GALLERY_CREATOR_ID,
        expect.objectContaining({ kind: 'VIDEO', page: 1 }),
        expect.anything(),
      ),
    );
    expect(screen.getByTestId('where')).toHaveTextContent('kind=VIDEO');
    await userEvent.selectOptions(screen.getByLabelText('Diunggah'), '30');
    await waitFor(() =>
      expect(listCreatorGallery).toHaveBeenLastCalledWith(
        GALLERY_CREATOR_ID,
        expect.objectContaining({ uploaded: '30', kind: 'VIDEO' }),
        expect.anything(),
      ),
    );
    await userEvent.type(screen.getByRole('searchbox', { name: 'Cari media' }), '#12');
    await waitFor(
      () =>
        expect(listCreatorGallery).toHaveBeenLastCalledWith(
          GALLERY_CREATOR_ID,
          expect.objectContaining({ q: '#12', page: 1 }),
          expect.anything(),
        ),
      { timeout: 2000 },
    );
    await userEvent.click(
      screen.getByRole('columnheader', { name: /^Ukuran/ }).querySelector('button') as HTMLElement,
    );
    await waitFor(() =>
      expect(listCreatorGallery).toHaveBeenLastCalledWith(
        GALLERY_CREATOR_ID,
        expect.objectContaining({ sort: 'size' }),
        expect.anything(),
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: /Reset Filter/ }));
    await waitFor(() =>
      expect(listCreatorGallery).toHaveBeenLastCalledWith(
        GALLERY_CREATOR_ID,
        expect.objectContaining({ q: null, kind: 'all', uploaded: 'all', sort: 'size', page: 1 }),
        expect.anything(),
      ),
    );
  });

  it('shows empty, no-results and a retryable error state', async () => {
    setup({ list: async () => galleryPage([], { total: 0 }) });
    expect(await screen.findByText(/Belum ada/i)).toBeInTheDocument();
    cleanup();
    setup({
      url: `/creators/${GALLERY_CREATOR_ID}/gallery?kind=VIDEO`,
      list: async () => galleryPage([], { total: 0 }),
    });
    expect(await screen.findByRole('button', { name: /Reset Filter/ })).toBeInTheDocument();
    cleanup();
    let calls = 0;
    setup({
      list: async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return galleryPage(GALLERY_ROWS);
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: /Coba Lagi/ }));
    expect(await screen.findByText('Media #12')).toBeInTheDocument();
  });
});
