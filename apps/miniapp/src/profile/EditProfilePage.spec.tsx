import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  createFakeMiniappApi,
  fakeSeen,
  fakeTelegram,
  nadia,
  networkError,
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
  window.localStorage.clear();
});

const withPhotos = {
  ...nadia,
  bio: 'Pecinta masak',
  avatar_url: 'https://cdn.example/custom.png',
  telegram_avatar_url: 'https://t.me/i/userpic/nadia.jpg',
};

async function mount(options: { user?: typeof nadia; api?: FakeMiniappApi } = {}) {
  const user = options.user ?? nadia;
  const api = options.api ?? createFakeMiniappApi({ login: [user], me: [user] });
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=1&hash=a'),
      seen: fakeSeen(true),
    }),
    { initialEntries: ['/profile/edit'] },
  );
  render(<RouterProvider router={router} />);
  const name = await screen.findByLabelText('Nama tampil');
  return {
    api,
    router,
    name: name as HTMLInputElement,
    bio: screen.getByLabelText('Bio singkat (opsional)') as HTMLTextAreaElement,
  };
}

const save = () => screen.getByRole('button', { name: /Simpan Perubahan|Menyimpan/ });

describe('/profile/edit', () => {
  it('shows the current values, the helper texts, the read-only username and the info note', async () => {
    const { name, bio } = await mount({ user: withPhotos });
    expect(name).toHaveValue('Nadia Putri');
    expect(bio).toHaveValue('Pecinta masak');
    expect(
      screen.getByText('Awalnya dari nama Telegram. Maksimal 40 karakter.'),
    ).toBeInTheDocument();
    expect(screen.getByText('13/160')).toBeInTheDocument();
    expect(screen.getByText('@nadia')).toBeInTheDocument();
    expect(screen.getByText('Hanya tampil, tidak bisa diubah.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Perubahan hanya berlaku pada profil aplikasi, tidak mengubah akun Telegram.',
      ),
    ).toBeInTheDocument();
    // Full-screen page: no bottom navigation.
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('hides the username field when the account has none', async () => {
    await mount({ user: { ...nadia, telegram_username: null } });
    expect(screen.queryByText('Username Telegram')).toBeNull();
  });

  it('updates the live counter while typing', async () => {
    const { bio } = await mount();
    await userEvent.type(bio, 'halo');
    expect(screen.getByText('4/160')).toBeInTheDocument();
  });

  it('blocks an empty name with the inline message, focuses it and sends nothing', async () => {
    const { api, name } = await mount();
    await userEvent.clear(name);
    await userEvent.click(save());
    expect(await screen.findByText('Nama tampil wajib diisi.')).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveFocus();
    expect(api.updateProfileCalls).toHaveLength(0);
    // Fixing it clears the error live.
    await userEvent.type(name, 'Maya');
    expect(screen.queryByText('Nama tampil wajib diisi.')).toBeNull();
  });

  it('treats a whitespace-only name as empty', async () => {
    const { api, name } = await mount();
    await userEvent.clear(name);
    await userEvent.type(name, '   ');
    await userEvent.click(save());
    expect(await screen.findByText('Nama tampil wajib diisi.')).toBeInTheDocument();
    expect(api.updateProfileCalls).toHaveLength(0);
  });

  it('rejects a 41-character name and a 161-character bio, accepts 40 and 160', async () => {
    const { api, name, bio } = await mount();
    await userEvent.clear(name);
    await userEvent.type(name, 'a'.repeat(41));
    await userEvent.click(save());
    expect(await screen.findByText('Nama tampil maksimal 40 karakter.')).toBeInTheDocument();
    await userEvent.clear(name);
    await userEvent.type(name, 'a'.repeat(40));
    await userEvent.click(bio);
    await userEvent.paste('b'.repeat(161));
    await userEvent.click(save());
    expect(await screen.findByText(/Bio maksimal 160 karakter\./)).toBeInTheDocument();
    expect(api.updateProfileCalls).toHaveLength(0);
    await userEvent.clear(bio);
    await userEvent.click(bio);
    await userEvent.paste('b'.repeat(160));
    await userEvent.click(save());
    await waitFor(() => expect(api.updateProfileCalls).toHaveLength(1));
  });

  it('saves the typed values, shows the toast and keeps the saved values on the page', async () => {
    const { api, router, name, bio } = await mount();
    await userEvent.clear(name);
    await userEvent.type(name, '  Maya L  ');
    await userEvent.type(bio, 'Pecinta masak');
    await userEvent.click(save());
    expect(await screen.findByRole('status')).toHaveTextContent('Perubahan disimpan');
    expect(api.updateProfileCalls).toEqual([{ display_name: '  Maya L  ', bio: 'Pecinta masak' }]);
    expect(api.updateCreatorCalls).toHaveLength(0);
    expect(name).toHaveValue('Maya L');
    expect(router.state.location.pathname).toBe('/profile/edit');
    expect(save()).toHaveTextContent('Simpan Perubahan');
  });

  it('shows "Menyimpan…", disables the button and sends one request on a double click', async () => {
    let finish: (user: typeof nadia) => void = () => undefined;
    const api = createFakeMiniappApi({ login: [nadia], me: [nadia] });
    api.updateProfile = (input) => {
      api.updateProfileCalls.push(input);
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    await mount({ api });
    const button = save();
    await userEvent.dblClick(button);
    expect(await screen.findByRole('button', { name: /Menyimpan/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Menyimpan/ })).toHaveAttribute('aria-busy', 'true');
    expect(api.updateProfileCalls).toHaveLength(1);
    finish({ ...nadia, display_name: 'Nadia Putri' });
    expect(await screen.findByRole('status')).toHaveTextContent('Perubahan disimpan');
  });

  it('on a lost connection shows the banner, keeps what was typed and retry succeeds', async () => {
    const api = createFakeMiniappApi({
      login: [nadia],
      me: [nadia],
      updateProfile: [networkError()],
    });
    const { name, bio } = await mount({ api });
    await userEvent.clear(name);
    await userEvent.type(name, 'Maya L');
    await userEvent.type(bio, 'tetap ada');
    await userEvent.click(save());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Perubahan belum tersimpan');
    expect(alert).toHaveTextContent(
      'Koneksi terputus. Isianmu masih ada di sini. Coba simpan lagi.',
    );
    expect(name).toHaveValue('Maya L');
    expect(bio).toHaveValue('tetap ada');
    await userEvent.click(save());
    expect(await screen.findByRole('status')).toHaveTextContent('Perubahan disimpan');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.updateProfileCalls).toHaveLength(2);
  });

  it('on a server error shows the banner with the placeholder copy and keeps the input', async () => {
    const api = createFakeMiniappApi({
      login: [nadia],
      me: [nadia],
      updateProfile: [apiError(500, 'INTERNAL_ERROR')],
    });
    const { name } = await mount({ api });
    await userEvent.type(name, ' Baru');
    await userEvent.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('Perubahan belum tersimpan');
    expect(name).toHaveValue('Nadia Putri Baru');
  });

  it('Ganti Foto uploads nothing and only shows the placeholder notice', async () => {
    const { api } = await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Ganti Foto' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Ganti foto belum tersedia.');
    expect(api.updateProfileCalls).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('Pakai Foto Telegram previews the Telegram photo and sends reset_avatar only on save', async () => {
    const { api } = await mount({ user: withPhotos });
    expect(screen.getByRole('img', { name: 'Foto profil' })).toHaveAttribute(
      'src',
      'https://cdn.example/custom.png',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pakai Foto Telegram' }));
    expect(screen.getByRole('img', { name: 'Foto profil' })).toHaveAttribute(
      'src',
      'https://t.me/i/userpic/nadia.jpg',
    );
    expect(api.updateProfileCalls).toHaveLength(0);
    await userEvent.click(save());
    await waitFor(() => expect(api.updateProfileCalls).toHaveLength(1));
    expect(api.updateProfileCalls[0]).toMatchObject({ reset_avatar: true });
  });

  it('does not send reset_avatar when the photo was not reset', async () => {
    const { api } = await mount({ user: withPhotos });
    expect(screen.getByRole('button', { name: 'Pakai Foto Telegram' })).toBeEnabled();
    await userEvent.click(save());
    await waitFor(() => expect(api.updateProfileCalls).toHaveLength(1));
    expect(api.updateProfileCalls[0]).not.toHaveProperty('reset_avatar');
  });

  it('the back arrow returns to /profile', async () => {
    const { router } = await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Kembali' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'));
  });
});
