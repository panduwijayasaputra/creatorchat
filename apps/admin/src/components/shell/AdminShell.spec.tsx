import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdminRoutes } from '../../app/routes';
import { createFakeAdminApi, TEST_ADMIN } from '../../../test/fake-admin-api';
import { initialsOf } from './route-handle';

beforeEach(() => {
  // HealthStatus (dashboard placeholder) calls fetch; keep it offline and quiet.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface RenderOptions {
  admin?: { name: string; role: string };
  onLogout?: () => Promise<void> | void;
}

/** Renders the app at a path with a signed-in fake API, and waits until the shell is on screen. */
async function renderAt(path: string, options: RenderOptions = {}) {
  const api = createFakeAdminApi({
    me: async () => ({
      ...TEST_ADMIN,
      ...(options.admin ? { username: options.admin.name } : {}),
    }),
    ...(options.onLogout ? { logout: async () => void (await options.onLogout?.()) } : {}),
  });
  const router = createMemoryRouter(createAdminRoutes({ api }), { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  await screen.findByRole('navigation', { name: 'Menu admin' });
  return router;
}

const NAV = [
  ['Dashboard', '/'],
  ['Creator', '/creators'],
  ['User', '/users'],
  ['Log & History', '/logs'],
  ['AI', '/ai'],
  ['Pengaturan', '/settings'],
] as const;

describe('AdminShell navigation', () => {
  it('lists the six destinations in order with their hrefs', async () => {
    await renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Menu admin' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('aria-label'))).toEqual(NAV.map(([label]) => label));
    expect(links.map((l) => l.getAttribute('href'))).toEqual(NAV.map(([, href]) => href));
  });

  it.each(NAV)('marks %s as the current page at %s and nothing else', async (label, path) => {
    await renderAt(path);
    const nav = screen.getByRole('navigation', { name: 'Menu admin' });
    const current = within(nav)
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(label);
  });

  it('shows the neutral placeholder for unbuilt destinations', async () => {
    await renderAt('/creators');
    expect(screen.getByTestId('not-implemented')).toHaveTextContent('Halaman ini belum dibangun');
  });

  it('renders unknown routes as a not-found placeholder inside the shell', async () => {
    await renderAt('/tidak-ada');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Halaman tidak ditemukan');
    expect(screen.getByRole('navigation', { name: 'Menu admin' })).toBeInTheDocument();
  });

  it('keeps the API health indicator on the dashboard placeholder', async () => {
    await renderAt('/');
    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
  });

  it('navigates by clicking a sidebar link', async () => {
    await renderAt('/');
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Menu admin' })).getByRole('link', {
        name: 'Creator',
      }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Creator');
  });

  it('offers a skip link to the main content', async () => {
    await renderAt('/');
    expect(screen.getByRole('link', { name: 'Lewati ke konten' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });
});

describe('AdminShell topbar', () => {
  it('derives title and breadcrumb from the route handle', async () => {
    await renderAt('/users');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('User');
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
    expect(within(crumbs).getByText('User')).toHaveAttribute('aria-current', 'page');
  });

  it('uses a single non-link crumb on the dashboard', async () => {
    await renderAt('/');
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).queryByRole('link')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dashboard');
  });

  it('shows the given admin identity and initials', async () => {
    await renderAt('/', { admin: { name: 'Nadia Pratama', role: 'Administrator' } });
    expect(screen.getByRole('link', { name: 'Menu akun Nadia Pratama' })).toBeInTheDocument();
    expect(screen.getByText('NP')).toBeInTheDocument();
    expect(screen.getByText('Administrator')).toBeInTheDocument();
  });

  it('does not hard-code a person: the default identity is neutral', async () => {
    await renderAt('/');
    expect(screen.queryByText(/Nadia/)).not.toBeInTheDocument();
  });

  it('computes initials safely', async () => {
    expect(initialsOf('Admin Nadia')).toBe('AN');
    expect(initialsOf('  solo ')).toBe('S');
    expect(initialsOf('')).toBe('?');
  });
});

describe('AdminShell logout', () => {
  it('opens the confirmation with the designed copy and Batal closes it', async () => {
    const onLogout = vi.fn();
    await renderAt('/', { onLogout });
    await userEvent.click(screen.getByRole('button', { name: 'Logout' }));
    const dialog = screen.getByRole('dialog', { name: 'Keluar dari dashboard?' });
    expect(dialog).toHaveTextContent(
      'Sesi di perangkat ini berakhir dan kamu kembali ke halaman login. Perubahan yang belum disimpan hilang.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('calls onLogout once even on a double click, then closes', async () => {
    let resolve!: () => void;
    const onLogout = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    await renderAt('/', { onLogout });
    await userEvent.click(screen.getByRole('button', { name: 'Logout' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.dblClick(within(dialog).getByRole('button', { name: 'Logout' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('AdminShell mobile menu', () => {
  it('is closed by default and toggles with aria-expanded', async () => {
    await renderAt('/');
    const button = screen.getByRole('button', { name: 'Menu navigasi' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Menu admin mobile' })).toBeNull();
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('navigation', { name: 'Menu admin mobile' });
    expect(
      within(menu)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(NAV.map(([label]) => label));
  });

  it('closes on Escape', async () => {
    await renderAt('/');
    await userEvent.click(screen.getByRole('button', { name: 'Menu navigasi' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Menu admin mobile' })).toBeNull();
  });

  it('closes after navigating', async () => {
    await renderAt('/');
    await userEvent.click(screen.getByRole('button', { name: 'Menu navigasi' }));
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Menu admin mobile' })).getByRole('link', {
        name: 'Creator',
      }),
    );
    expect(screen.queryByRole('navigation', { name: 'Menu admin mobile' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Creator');
  });

  it('offers Logout in the menu, which opens the same dialog', async () => {
    await renderAt('/');
    await userEvent.click(screen.getByRole('button', { name: 'Menu navigasi' }));
    const menu = screen.getByRole('navigation', { name: 'Menu admin mobile' })
      .parentElement as HTMLElement;
    await userEvent.click(within(menu).getByRole('button', { name: 'Logout' }));
    expect(screen.getByRole('dialog', { name: 'Keluar dari dashboard?' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Menu admin mobile' })).toBeNull();
  });
});
