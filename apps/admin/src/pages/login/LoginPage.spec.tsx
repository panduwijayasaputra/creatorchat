import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAdminApi, TEST_ADMIN, type FakeAdminApi } from '../../../test/fake-admin-api';
import { createAdminRoutes } from '../../app/routes';
import { ApiError, NetworkError } from '../../auth/api-client';
import { problemFrom } from './LoginPage';

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

const signedOut = () => new ApiError(401, 'UNAUTHENTICATED', 'Authentication is required.');

function newApi(overrides: Parameters<typeof createFakeAdminApi>[0] = {}) {
  return createFakeAdminApi({ me: async () => Promise.reject(signedOut()), ...overrides });
}

async function renderLogin(api: FakeAdminApi, path = '/login') {
  const router = createMemoryRouter(createAdminRoutes({ api }), { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: 'Masuk' });
  return router;
}

const username = () => screen.getByLabelText('Username');
const password = () => screen.getByLabelText('Password');
const submit = () => screen.getByRole('button', { name: /^(Masuk|Coba Lagi|Memeriksa…)$/ });

async function fill(user = 'nadia.admin', pass = 'a-secret-password') {
  await userEvent.type(username(), user);
  await userEvent.type(password(), pass);
}

describe('LoginPage (AdmLogin)', () => {
  it('shows the designed copy and nothing that is not designed', async () => {
    await renderLogin(newApi());
    expect(screen.getByText('Creator Chat')).toBeInTheDocument();
    expect(screen.getByText('Dashboard Admin')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Masuk' })).toBeInTheDocument();
    expect(screen.getByText('Gunakan username dan password admin.')).toBeInTheDocument();
    expect(username()).toHaveAttribute('placeholder', 'Masukkan username');
    expect(password()).toHaveAttribute('placeholder', 'Masukkan password');
    expect(
      screen.getByText('Akun admin dibuat oleh tim platform. Tidak ada pendaftaran admin publik.'),
    ).toBeInTheDocument();
    expect(submit()).toHaveTextContent('Masuk');
    // No sign-up and no "forgot password": the board has neither.
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/daftar(?!an)|lupa/i)).toBeNull();
  });

  it('associates labels with inputs and hints browsers about credentials', async () => {
    await renderLogin(newApi());
    expect(username()).toHaveAttribute('autocomplete', 'username');
    expect(password()).toHaveAttribute('autocomplete', 'current-password');
    expect(password()).toHaveAttribute('type', 'password');
  });

  it('toggles password visibility with "Tampilkan"', async () => {
    await renderLogin(newApi());
    await userEvent.type(password(), 'visible-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Tampilkan password' }));
    expect(password()).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Sembunyikan password' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sembunyikan password' }));
    expect(password()).toHaveAttribute('type', 'password');
  });
});

describe('validation', () => {
  it('shows both inline messages for empty fields, sends nothing and focuses the first field', async () => {
    const api = newApi();
    await renderLogin(api);
    await userEvent.click(submit());
    expect(screen.getByText('Username wajib diisi.')).toBeInTheDocument();
    expect(screen.getByText('Password wajib diisi.')).toBeInTheDocument();
    expect(username()).toHaveAttribute('aria-invalid', 'true');
    expect(password()).toHaveAttribute('aria-invalid', 'true');
    expect(username()).toHaveFocus();
    expect(api.login).not.toHaveBeenCalled();
  });

  it('flags only the empty field and focuses it', async () => {
    const api = newApi();
    await renderLogin(api);
    await userEvent.type(username(), 'nadia.admin');
    await userEvent.click(submit());
    expect(screen.queryByText('Username wajib diisi.')).toBeNull();
    expect(screen.getByText('Password wajib diisi.')).toBeInTheDocument();
    expect(password()).toHaveFocus();
  });

  it('treats a whitespace-only username as empty', async () => {
    const api = newApi();
    await renderLogin(api);
    await userEvent.type(username(), '   ');
    await userEvent.type(password(), 'x');
    await userEvent.click(submit());
    expect(screen.getByText('Username wajib diisi.')).toBeInTheDocument();
    expect(api.login).not.toHaveBeenCalled();
  });

  it('clears a field error as soon as the person types', async () => {
    await renderLogin(newApi());
    await userEvent.click(submit());
    await userEvent.type(username(), 'n');
    expect(screen.queryByText('Username wajib diisi.')).toBeNull();
    expect(screen.getByText('Password wajib diisi.')).toBeInTheDocument();
  });
});

describe('submitting (Memeriksa…)', () => {
  it('shows the busy button, sends once on a double click and locks the fields', async () => {
    let resolve!: (v: typeof TEST_ADMIN) => void;
    const api = newApi({ login: () => new Promise((r) => (resolve = r)) });
    await renderLogin(api);
    await fill();
    await userEvent.dblClick(submit());
    const busy = screen.getByRole('button', { name: 'Memeriksa…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(api.login).toHaveBeenCalledTimes(1);
    expect(api.login).toHaveBeenCalledWith({
      username: 'nadia.admin',
      password: 'a-secret-password',
    });
    expect(username()).toHaveAttribute('readonly');
    resolve(TEST_ADMIN);
    await screen.findByRole('navigation', { name: 'Menu admin' });
  });

  it('also guards the Enter key while a request is in flight', async () => {
    const api = newApi({ login: () => new Promise(() => undefined) });
    await renderLogin(api);
    await fill();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Enter}');
    expect(api.login).toHaveBeenCalledTimes(1);
  });

  it('trims the username but sends the password untouched', async () => {
    const api = newApi();
    await renderLogin(api);
    await userEvent.type(username(), '  nadia.admin  ');
    await userEvent.type(password(), ' spaced pass ');
    await userEvent.click(submit());
    expect(api.login).toHaveBeenCalledWith({ username: 'nadia.admin', password: ' spaced pass ' });
  });
});

describe('after success', () => {
  it('lands on the dashboard inside the shell', async () => {
    const router = await renderLogin(newApi());
    await fill();
    await userEvent.click(submit());
    expect(await screen.findByRole('navigation', { name: 'Menu admin' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('returns to the page the admin was trying to open', async () => {
    const router = await renderLogin(newApi(), '/creators');
    expect(router.state.location.pathname).toBe('/login');
    await fill();
    await userEvent.click(submit());
    await screen.findByRole('navigation', { name: 'Menu admin' });
    expect(router.state.location.pathname).toBe('/creators');
  });

  it('keeps credentials out of the URL and web storage', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const router = await renderLogin(newApi());
    await fill();
    await userEvent.click(submit());
    await screen.findByRole('navigation', { name: 'Menu admin' });
    expect(router.state.location.search).toBe('');
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });
});

describe('wrong credentials', () => {
  it('shows the attempt counter, keeps both values and returns focus to the password', async () => {
    const api = newApi({
      login: async () =>
        Promise.reject(new ApiError(401, 'INVALID_CREDENTIALS', 'x', { attempts: 2, max: 5 })),
    });
    await renderLogin(api);
    await fill('nadia.admin', 'wrong-password');
    await userEvent.click(submit());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Username atau password salah');
    expect(alert).toHaveTextContent(
      'Periksa kembali isian. Setelah 5 kali gagal, login dikunci 15 menit. Percobaan: 2 dari 5.',
    );
    expect(username()).toHaveValue('nadia.admin');
    expect(password()).toHaveValue('wrong-password');
    expect(submit()).toHaveTextContent('Masuk');
    expect(submit()).not.toHaveAttribute('aria-busy');
    expect(password()).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Coba Lagi' })).toBeNull();
  });

  it('never says which of the two was wrong', async () => {
    const api = newApi({
      login: async () =>
        Promise.reject(new ApiError(401, 'INVALID_CREDENTIALS', 'x', { attempts: 1, max: 5 })),
    });
    await renderLogin(api);
    await fill();
    await userEvent.click(submit());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/tidak ditemukan|tidak terdaftar|tidak ada/i);
  });

  it('lets the person try again and succeed', async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, 'INVALID_CREDENTIALS', 'x', { attempts: 1, max: 5 }))
      .mockResolvedValueOnce(TEST_ADMIN);
    await renderLogin(newApi({ login }));
    await fill();
    await userEvent.click(submit());
    await screen.findByRole('alert');
    await userEvent.click(submit());
    await screen.findByRole('navigation', { name: 'Menu admin' });
    expect(login).toHaveBeenCalledTimes(2);
  });
});

describe('connection failure', () => {
  it('shows the retry state, keeps the typed values and retries with the same input', async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValueOnce(TEST_ADMIN);
    await renderLogin(newApi({ login }));
    await fill('nadia.admin', 'typed-password');
    await userEvent.click(submit());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Tidak bisa terhubung ke server');
    expect(alert).toHaveTextContent(
      'Koneksi terputus. Isianmu tetap tersimpan. Coba lagi sebentar.',
    );
    expect(username()).toHaveValue('nadia.admin');
    expect(password()).toHaveValue('typed-password');
    const retry = screen.getByRole('button', { name: 'Coba Lagi' });
    await userEvent.click(retry);
    await screen.findByRole('navigation', { name: 'Menu admin' });
    expect(login).toHaveBeenNthCalledWith(2, {
      username: 'nadia.admin',
      password: 'typed-password',
    });
  });

  it('reads server errors and a rejected Origin the same way', async () => {
    for (const error of [
      new ApiError(503, 'SERVICE_UNAVAILABLE', 'x'),
      new ApiError(403, 'CSRF_FAILED', 'x'),
      new ApiError(500, 'INTERNAL_ERROR', 'x'),
    ]) {
      expect(problemFrom(error)).toEqual({ kind: 'network' });
    }
  });
});

describe('locked (no board yet)', () => {
  it('shows the lock with the remaining minutes and keeps the form usable', async () => {
    const api = newApi({
      login: async () =>
        Promise.reject(new ApiError(429, 'LOGIN_LOCKED', 'x', { retry_after_seconds: 900 })),
    });
    await renderLogin(api);
    await fill();
    await userEvent.click(submit());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Login dikunci sementara');
    expect(alert).toHaveTextContent('Terlalu banyak percobaan. Coba lagi dalam 15 menit.');
    expect(username()).toHaveValue('nadia.admin');
  });

  it('rounds the minutes up and handles a missing retry time', () => {
    expect(
      problemFrom(new ApiError(429, 'LOGIN_LOCKED', 'x', { retry_after_seconds: 61 })),
    ).toEqual({ kind: 'locked', minutes: 2 });
    expect(problemFrom(new ApiError(429, 'LOGIN_LOCKED', 'x', { retry_after_seconds: 5 }))).toEqual(
      {
        kind: 'locked',
        minutes: 1,
      },
    );
    expect(problemFrom(new ApiError(429, 'RATE_LIMITED', 'x'))).toEqual({
      kind: 'locked',
      minutes: null,
    });
  });
});

describe('panel semantics', () => {
  it('announces problems as an alert inside the form and replaces the previous one', async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, 'INVALID_CREDENTIALS', 'x', { attempts: 1, max: 5 }))
      .mockRejectedValueOnce(new NetworkError());
    await renderLogin(newApi({ login }));
    await fill();
    await userEvent.click(submit());
    const form = screen.getByRole('button', { name: 'Masuk' }).closest('form') as HTMLElement;
    await waitFor(() =>
      expect(within(form).getByRole('alert')).toHaveTextContent('Username atau password salah'),
    );
    await userEvent.click(submit());
    await waitFor(() =>
      expect(within(form).getByRole('alert')).toHaveTextContent('Tidak bisa terhubung'),
    );
    expect(within(form).getAllByRole('alert')).toHaveLength(1);
  });
});
