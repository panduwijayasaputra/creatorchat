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
  maya,
  nadia,
  networkError,
  type FakeMiniappApi,
} from '../../test/fake-miniapp-api';
import { createMiniappRoutes } from '../app/routes';

const salsa = { ...maya, display_name: 'Salsa Maheswari' };

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

function mount(options: { user?: typeof maya; api?: FakeMiniappApi; path?: string } = {}) {
  const user = options.user ?? salsa;
  const api =
    options.api ?? createFakeMiniappApi({ login: [user], me: [user], creatorSettings: [] });
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=1&hash=a'),
      seen: fakeSeen(true),
    }),
    { initialEntries: [options.path ?? '/settings/timezone'] },
  );
  render(<RouterProvider router={router} />);
  return { api, router };
}

const radio = (name: RegExp | string) => screen.getByRole('radio', { name });
const save = () => screen.getByRole('button', { name: /Simpan Zona Waktu|Menyimpan/ });

describe('/settings/timezone', () => {
  it('shows the five options with the current one marked and the info card', async () => {
    mount();
    expect(
      await screen.findByRole('heading', { name: 'Zona waktu', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(radio(/WIB · Jakarta/)).toHaveAttribute('aria-checked', 'true');
    expect(radio(/WITA · Makassar/)).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Asia/Jakarta · UTC+7')).toBeInTheDocument();
    expect(screen.getByText(/^Asia\/Singapore · UTC\+8$/)).toBeInTheDocument();
    expect(screen.getByText(/^Australia\/Sydney · UTC\+1[01]$/)).toBeInTheDocument();
    expect(screen.getByText('Apa yang berubah?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Mengganti zona hanya mengubah tampilan jam di aplikasi, seperti waktu pesan di chat.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('marks the saved zone and nothing for a zone outside the list', async () => {
    mount({ user: { ...salsa, timezone: 'Asia/Jayapura' } });
    expect(await screen.findByRole('radio', { name: /WIT · Jayapura/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    cleanup();
    mount({ user: { ...salsa, timezone: 'Asia/Tokyo' } });
    await screen.findByRole('radiogroup');
    for (const item of screen.getAllByRole('radio')) {
      expect(item).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('choosing another zone changes nothing until Simpan, then saves once and shows the toast', async () => {
    const { api } = mount();
    await userEvent.click(await screen.findByRole('radio', { name: /WITA · Makassar/ }));
    expect(radio(/WITA · Makassar/)).toHaveAttribute('aria-checked', 'true');
    expect(api.timezoneCalls).toHaveLength(0);
    await userEvent.click(save());
    expect(await screen.findByRole('status')).toHaveTextContent('Zona waktu disimpan');
    expect(api.timezoneCalls).toEqual(['Asia/Makassar']);
  });

  it('shows Menyimpan… and sends one request on a double click', async () => {
    let finish: (user: typeof maya) => void = () => undefined;
    const api = createFakeMiniappApi({ login: [salsa], me: [salsa] });
    api.updateCreatorTimezone = (timezone) => {
      api.timezoneCalls.push(timezone);
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    mount({ api });
    await userEvent.click(await screen.findByRole('radio', { name: /Singapura/ }));
    await userEvent.dblClick(save());
    expect(await screen.findByRole('button', { name: /Menyimpan/ })).toBeDisabled();
    expect(api.timezoneCalls).toHaveLength(1);
    finish({ ...salsa, timezone: 'Asia/Singapore' });
    expect(await screen.findByRole('status')).toHaveTextContent('Zona waktu disimpan');
  });

  it('on a failure shows the banner, keeps the selection and a retry succeeds', async () => {
    const api = createFakeMiniappApi({
      login: [salsa],
      me: [salsa],
      timezone: [networkError()],
    });
    mount({ api });
    await userEvent.click(await screen.findByRole('radio', { name: /WIT · Jayapura/ }));
    await userEvent.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('Zona waktu belum tersimpan');
    expect(radio(/WIT · Jayapura/)).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(save());
    expect(await screen.findByRole('status')).toHaveTextContent('Zona waktu disimpan');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.timezoneCalls).toEqual(['Asia/Jayapura', 'Asia/Jayapura']);
  });

  it('shows the same banner for a server error', async () => {
    const api = createFakeMiniappApi({
      login: [salsa],
      me: [salsa],
      timezone: [apiError(500, 'INTERNAL_ERROR')],
    });
    mount({ api });
    await userEvent.click(await screen.findByRole('radio', { name: /Sydney/ }));
    await userEvent.click(save());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('arrow keys move the selection inside the group', async () => {
    mount();
    const first = await screen.findByRole('radio', { name: /WIB · Jakarta/ });
    first.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(radio(/WITA · Makassar/)).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(radio(/Sydney/)).toHaveAttribute('aria-checked', 'true');
  });

  it('the back arrow returns to /settings without saving', async () => {
    const { api, router } = mount();
    await userEvent.click(await screen.findByRole('radio', { name: /Sydney/ }));
    await userEvent.click(screen.getByRole('link', { name: 'Kembali' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(api.timezoneCalls).toHaveLength(0);
  });

  it('sends a USER to their own landing and never calls the creator API', async () => {
    const api = createFakeMiniappApi({ login: [nadia], me: [nadia] });
    const { router } = mount({ user: nadia, api });
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
    expect(api.timezoneCalls).toHaveLength(0);
  });

  it('the /settings row shows the saved zone', async () => {
    const user = { ...salsa, timezone: 'Asia/Makassar' };
    const api = createFakeMiniappApi({
      login: [user],
      me: [user],
      creatorSettings: [{ profile: user, public_code: 'salsa234', bio_link: null }],
    });
    mount({ api, path: '/settings' });
    expect(await screen.findByText('WITA · Asia/Makassar (UTC+8)')).toBeInTheDocument();
  });
});
