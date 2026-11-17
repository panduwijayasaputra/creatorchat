import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import type { CreatorProfileResponse } from '@creatorchat/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  createFakeMiniappApi,
  customerDetail,
  customerGalleryPage,
  fakeSeen,
  fakeTelegram,
  networkError,
  publicItem,
  type FakeMiniappApi,
} from '../../test/fake-miniapp-api';
import { createMiniappRoutes } from '../app/routes';

const CODE = 'k4m5x2qa';
const A = publicItem(1);
const B = publicItem(2, { kind: 'VIDEO', duration_seconds: 48 });
const C = publicItem(3);

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

const profile = (access: CreatorProfileResponse['access']): CreatorProfileResponse => ({
  public_code: CODE,
  display_name: 'Salsa Maheswari',
  bio: null,
  avatar_url: null,
  conversation_id: null,
  access,
});
const ACTIVE = { state: 'ACTIVE', ends_at: '2026-12-31T16:59:59.000Z' } as const;
const EXPIRED = { state: 'EXPIRED', ended_at: '2026-11-06T16:59:59.000Z', revoked: false } as const;

function mount(api: FakeMiniappApi, path = `/creators/${CODE}`) {
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

describe('profile gallery', () => {
  it('an ACTIVE profile shows tiles, with the video length, and asks for the gallery once', async () => {
    const api = createFakeMiniappApi({
      resolve: [profile(ACTIVE)],
      customerGallery: [customerGalleryPage([C, B, A])],
    });
    mount(api);
    expect(await screen.findAllByRole('button', { name: 'Buka foto' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Buka video' })).toBeInTheDocument();
    expect(screen.getByText('0:48')).toBeInTheDocument();
    expect(api.customerGalleryCalls).toEqual([{ code: CODE, limit: 30 }]);
  });

  it.each([
    ['a guest', { state: 'GUEST' }],
    [
      'a pending request',
      { state: 'PENDING', requested_at: '2026-11-13T04:42:00.000Z', request_type: 'TRIAL' },
    ],
    ['expired access', EXPIRED],
  ] as const)('%s shows the locked panel and makes no gallery request', async (_name, access) => {
    const api = createFakeMiniappApi({ resolve: [profile(access)] });
    mount(api);
    expect(await screen.findByText('Galeri tersedia untuk subscriber aktif')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Buka (foto|video)/ })).toBeNull();
    expect(api.customerGalleryCalls).toHaveLength(0);
  });

  it('shows an empty line and a retryable failure line', async () => {
    const api = createFakeMiniappApi({
      resolve: [profile(ACTIVE)],
      customerGallery: [customerGalleryPage([])],
    });
    mount(api);
    expect(await screen.findByText('Belum ada media di galeri.')).toBeInTheDocument();
    cleanup();
    const failing = createFakeMiniappApi({
      resolve: [profile(ACTIVE)],
      customerGallery: [networkError(), customerGalleryPage([A])],
    });
    mount(failing);
    expect(await screen.findByText(/Galeri belum termuat\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByRole('button', { name: 'Buka foto' })).toBeInTheDocument();
  });

  it('a 403 from the list means access ended: the profile is refetched and the locked panel shows', async () => {
    const api = createFakeMiniappApi({
      resolve: [profile(ACTIVE), profile(EXPIRED)],
      customerGallery: [apiError(403, 'GALLERY_ACCESS_REQUIRED')],
    });
    mount(api);
    expect(await screen.findByText('Galeri tersedia untuk subscriber aktif')).toBeInTheDocument();
    expect(api.resolveCalls).toHaveLength(2);
  });
});

describe('subscriber viewer', () => {
  const detail = (item: typeof A, position: number, previous: string | null, next: string | null) =>
    customerDetail(item, { position, total: 3, previous_id: previous, next_id: next });

  it('opens over the profile with the creator in the footer, moves on, and Tutup returns without refetching', async () => {
    const api = createFakeMiniappApi({
      resolve: [profile(ACTIVE)],
      customerGallery: [customerGalleryPage([C, B, A])],
      customerGalleryItem: [detail(C, 1, null, B.id), detail(B, 2, C.id, A.id)],
    });
    const router = mount(api);
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Buka foto' }))[0] as HTMLElement,
    );
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('1 / 3')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Salsa Maheswari · Diunggah 12 Nov 2026, 06.41 WIB'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/creators/${CODE}/gallery/${C.id}`);
    expect(screen.getByRole('heading', { name: 'Salsa Maheswari' })).toBeInTheDocument(); // the profile stays
    expect(api.customerGalleryItemCalls[0]).toEqual({ code: CODE, assetId: C.id });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Media berikutnya' }));
    expect(await within(dialog).findByText('2 / 3')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/creators/${CODE}/gallery/${B.id}`);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Tutup' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.customerGalleryCalls).toHaveLength(1);
    expect(api.resolveCalls).toHaveLength(1);
  });

  it('a 403 while viewing closes the viewer and shows the locked panel', async () => {
    const api = createFakeMiniappApi({
      resolve: [profile(ACTIVE), profile(EXPIRED)],
      customerGallery: [customerGalleryPage([A])],
      customerGalleryItem: [apiError(403, 'GALLERY_ACCESS_REQUIRED')],
    });
    const router = mount(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Buka foto' }));
    expect(await screen.findByText('Galeri tersedia untuk subscriber aktif')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.pathname).toBe(`/creators/${CODE}`);
  });

  it('opened directly it loads the profile and the item', async () => {
    const api = createFakeMiniappApi({
      resolve: [profile(ACTIVE)],
      customerGallery: [customerGalleryPage([A])],
      customerGalleryItem: [detail(A, 1, null, null)],
    });
    mount(api, `/creators/${CODE}/gallery/${A.id}`);
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
  });
});
