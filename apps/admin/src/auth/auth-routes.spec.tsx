import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAdminApi, TEST_ADMIN, type FakeAdminApi } from '../../test/fake-admin-api';
import { createAdminRoutes } from '../app/routes';
import { ApiError } from './api-client';
import { destinationAfterLogin } from './guards';

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

const unauthenticated = () => new ApiError(401, 'UNAUTHENTICATED', 'Authentication is required.');

function renderAt(path: string, api: FakeAdminApi) {
  const router = createMemoryRouter(createAdminRoutes({ api }), { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('route protection', () => {
  it('sends an anonymous visitor from a deep link to /login and remembers where they were going', async () => {
    const api = createFakeAdminApi({ me: async () => Promise.reject(unauthenticated()) });
    const router = renderAt('/creators?page=2', api);
    await screen.findByRole('heading', { name: 'Masuk' });
    expect(router.state.location.pathname).toBe('/login');
    expect(destinationAfterLogin(router.state.location.state)).toBe('/creators?page=2');
    expect(screen.queryByRole('navigation', { name: 'Menu admin' })).toBeNull();
  });

  it('never renders the shell while the first session check is pending', async () => {
    let resolveMe!: (v: typeof TEST_ADMIN) => void;
    const api = createFakeAdminApi({ me: () => new Promise((r) => (resolveMe = r)) });
    renderAt('/', api);
    expect(screen.queryByRole('navigation', { name: 'Menu admin' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Masuk' })).toBeNull();
    await act(async () => resolveMe(TEST_ADMIN));
    expect(await screen.findByRole('navigation', { name: 'Menu admin' })).toBeInTheDocument();
  });

  it('treats an unreachable server on load as signed out (the login screen reports it later)', async () => {
    const api = createFakeAdminApi({ me: async () => Promise.reject(new TypeError('offline')) });
    renderAt('/', api);
    expect(await screen.findByRole('heading', { name: 'Masuk' })).toBeInTheDocument();
  });

  it('shows the shell with the signed-in admin identity', async () => {
    const api = createFakeAdminApi({
      me: async () => ({ ...TEST_ADMIN, username: 'nadia.admin' }),
    });
    renderAt('/users', api);
    expect(await screen.findByRole('link', { name: 'Menu akun nadia.admin' })).toBeInTheDocument();
    expect(screen.getByText('Administrator')).toBeInTheDocument();
  });

  it('sends a signed-in admin away from /login to the dashboard, or to where they were going', async () => {
    const router = renderAt('/login', createFakeAdminApi());
    await screen.findByRole('navigation', { name: 'Menu admin' });
    expect(router.state.location.pathname).toBe('/');
  });

  it('goes to /login as soon as the client reports a lost session', async () => {
    const api = createFakeAdminApi();
    const router = renderAt('/creators', api);
    await screen.findByRole('navigation', { name: 'Menu admin' });
    act(() => api.loseSession());
    await screen.findByRole('heading', { name: 'Masuk' });
    expect(router.state.location.pathname).toBe('/login');
  });

  it('ignores a "from" pointing back at /login', () => {
    expect(destinationAfterLogin({ from: { pathname: '/login', search: '', hash: '' } })).toBe('/');
    expect(destinationAfterLogin(null)).toBe('/');
  });
});

describe('logout', () => {
  async function openLogoutDialog(api: FakeAdminApi) {
    const router = renderAt('/', api);
    await screen.findByRole('navigation', { name: 'Menu admin' });
    await userEvent.click(screen.getByRole('button', { name: 'Logout' }));
    return { router, dialog: screen.getByRole('dialog', { name: 'Keluar dari dashboard?' }) };
  }

  it('calls the API once, then returns to /login', async () => {
    const api = createFakeAdminApi();
    const { router, dialog } = await openLogoutDialog(api);
    await userEvent.dblClick(within(dialog).getByRole('button', { name: 'Logout' }));
    await screen.findByRole('heading', { name: 'Masuk' });
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/login');
  });

  it('keeps the dialog open with its failure message when the server cannot be reached', async () => {
    const api = createFakeAdminApi({
      logout: async () => Promise.reject(new TypeError('offline')),
    });
    const { dialog } = await openLogoutDialog(api);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Logout' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Gagal keluar. Coba lagi.'),
    );
    expect(screen.getByRole('navigation', { name: 'Menu admin' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Masuk' })).toBeNull();
  });
});

describe('storage', () => {
  it('writes nothing to localStorage or sessionStorage', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    const api = createFakeAdminApi();
    renderAt('/', api);
    await screen.findByRole('navigation', { name: 'Menu admin' });
    await userEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Logout' }),
    );
    await screen.findByRole('heading', { name: 'Masuk' });
    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });
});
