import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeMiniappApi,
  fakeSeen,
  fakeTelegram,
  maya,
  nadia,
  networkError,
} from '../../test/fake-miniapp-api';
import { createMiniappRoutes } from '../app/routes';

const salsa = { ...maya, display_name: 'Salsa Maheswari', bio: 'Suka masak' };

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function mount(
  user: typeof maya = salsa,
  api = createFakeMiniappApi({ login: [user], me: [user] }),
) {
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=1&hash=a'),
      seen: fakeSeen(true),
    }),
    { initialEntries: ['/settings/profile'] },
  );
  render(<RouterProvider router={router} />);
  return { api, router };
}

const save = () => screen.getByRole('button', { name: 'Simpan Perubahan' });

describe('/settings/profile (creator)', () => {
  it('shows the current values with no bottom navigation', async () => {
    mount();
    expect(await screen.findByLabelText('Nama tampil')).toHaveValue('Salsa Maheswari');
    expect(screen.getByLabelText('Bio singkat (opsional)')).toHaveValue('Suka masak');
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('saves through the creator endpoint and shows the toast', async () => {
    const { api } = mount();
    const name = await screen.findByLabelText('Nama tampil');
    await userEvent.clear(name);
    await userEvent.type(name, 'Salsa M');
    await userEvent.click(save());
    expect(await screen.findByRole('status')).toHaveTextContent('Perubahan disimpan');
    expect(api.updateCreatorCalls).toEqual([{ display_name: 'Salsa M', bio: 'Suka masak' }]);
    expect(api.updateProfileCalls).toHaveLength(1);
  });

  it('keeps the typed values and shows the banner when saving fails', async () => {
    const api = createFakeMiniappApi({
      login: [salsa],
      me: [salsa],
      updateProfile: [networkError()],
    });
    mount(salsa, api);
    const name = await screen.findByLabelText('Nama tampil');
    await userEvent.type(name, ' Baru');
    await userEvent.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('Perubahan belum tersimpan');
    expect(name).toHaveValue('Salsa Maheswari Baru');
  });

  it('rejects an empty name without calling the API', async () => {
    const { api } = mount();
    await userEvent.clear(await screen.findByLabelText('Nama tampil'));
    await userEvent.click(save());
    expect(await screen.findByText('Nama tampil wajib diisi.')).toBeInTheDocument();
    expect(api.updateProfileCalls).toHaveLength(0);
  });

  it('the back arrow returns to /settings', async () => {
    const { router } = mount();
    await userEvent.click(await screen.findByRole('link', { name: 'Kembali' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  });

  it('redirects a USER away from the creator page', async () => {
    const { router } = mount(nadia);
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
  });
});
