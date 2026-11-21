import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WelcomeMessageResponse } from '@creatorchat/contracts';
import {
  createFakeMiniappApi,
  galleryPage,
  mediaAsset,
  networkError,
  type FakeMiniappApi,
} from '../../../test/fake-miniapp-api';
import { ApiError } from '../../auth/api-client';
import type { PutFile } from '../../gallery/upload-file';
import { WelcomePage } from './WelcomePage';

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.Telegram;
});

const okPut: PutFile = async (_t, _f, onProgress) => onProgress(100);
const BODY = 'Halo, selamat datang! Terima kasih sudah bergabung.';
const saved = (over: Partial<WelcomeMessageResponse> = {}): WelcomeMessageResponse => ({
  enabled: true,
  body: BODY,
  media: null,
  ...over,
});
const galleryMedia = {
  asset_id: mediaAsset(1).id,
  kind: 'PHOTO' as const,
  source: 'GALLERY' as const,
  duration_seconds: null,
  thumbnail_url: 'https://cdn.example.test/saved.webp',
};

const apiWith = (over: Parameters<typeof createFakeMiniappApi>[0] = {}) =>
  createFakeMiniappApi({
    gallery: [galleryPage([mediaAsset(1), mediaAsset(2, { kind: 'VIDEO', duration_seconds: 48 })])],
    ...over,
  });

function mount(api: FakeMiniappApi, put: PutFile = okPut) {
  render(
    <MemoryRouter initialEntries={['/settings/welcome']}>
      <Routes>
        <Route path="/settings/welcome" element={<WelcomePage api={api} put={put} pollMs={0} />} />
        <Route path="/settings" element={<div>pengaturan</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const file = (name = 'a.jpg', type = 'image/jpeg') =>
  new File([new Uint8Array(1000)], name, { type });
const saveButton = () => screen.getByRole('button', { name: /Simpan Pesan|Menyimpan/ });
const textbox = () => screen.findByRole('textbox', { name: 'Isi pesan' });

describe('loading', () => {
  it('shows the saved state: switch, text, media and the preview bubble', async () => {
    const api = apiWith({
      welcomeGet: [saved({ media: galleryMedia })],
    });
    mount(api);
    expect(await textbox()).toHaveValue(BODY);
    expect(screen.getByRole('switch', { name: 'Pesan selamat datang aktif' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      screen.getByText('Aktif. Dikirim sekali saat seseorang baru subscribe.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hapus Media/ })).toBeInTheDocument();
    expect(
      screen.getByText('Memakai media yang sama dari galeri. Tidak ada salinan baru.'),
    ).toBeInTheDocument();
    expect(screen.getByText('09.00')).toBeInTheDocument();
    expect(
      screen.getByText('Tampilan di chat pelanggan (seperti pesan biasa darimu)'),
    ).toBeInTheDocument();
    expect(screen.getByText(/tanpa label apa pun/)).toBeInTheDocument();
  });

  it('is off and empty for a creator who never saved one, with the two media options', async () => {
    mount(apiWith());
    expect(await textbox()).toHaveValue('');
    expect(screen.getByRole('switch', { name: 'Pesan selamat datang aktif' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByText('Belum ada media')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pilih Galeri/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload Baru/ })).toBeInTheDocument();
    expect(saveButton()).toBeEnabled(); // off + empty is a valid state to save
  });

  it('a failed load offers Coba Lagi and then shows the form', async () => {
    const api = apiWith({ welcomeGet: [networkError()] });
    mount(api);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pesan selamat datang belum termuat.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await textbox()).toBeInTheDocument();
    expect(api.welcomeGetCalls).toBe(2);
  });

  it('the back link goes to the settings', async () => {
    mount(apiWith());
    await textbox();
    await userEvent.click(screen.getByRole('link', { name: 'Kembali' }));
    expect(await screen.findByText('pengaturan')).toBeInTheDocument();
  });
});

describe('the text and the switch', () => {
  it('the save button needs text while the switch is on, and a draft is allowed while it is off', async () => {
    mount(apiWith());
    const box = await textbox();
    await userEvent.click(screen.getByRole('switch', { name: 'Pesan selamat datang aktif' }));
    expect(saveButton()).toBeDisabled();
    await userEvent.type(box, '   ');
    expect(saveButton()).toBeDisabled();
    await userEvent.type(box, 'Halo');
    expect(saveButton()).toBeEnabled();
    await userEvent.click(screen.getByRole('switch', { name: 'Pesan selamat datang aktif' }));
    expect(saveButton()).toBeEnabled();
  });

  it('shows the typed text in the preview bubble as it is written', async () => {
    mount(apiWith());
    await userEvent.type(await textbox(), 'Selamat datang di dapurku');
    const preview = screen.getByText('Tampilan di chat pelanggan (seperti pesan biasa darimu)')
      .parentElement as HTMLElement;
    expect(within(preview).getByText('Selamat datang di dapurku')).toBeInTheDocument();
  });
});

describe('media', () => {
  it('Pilih Galeri uses the same file, with its note; Hapus Media goes back to the two options', async () => {
    const api = apiWith();
    mount(api);
    await textbox();
    await userEvent.click(screen.getByRole('button', { name: /Pilih Galeri/ }));
    expect(await screen.findByText('Pilih satu foto atau video dari galeri.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeDisabled();
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Pilih foto' }))[0] as HTMLElement,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(
      await screen.findByText('Memakai media yang sama dari galeri. Tidak ada salinan baru.'),
    ).toBeInTheDocument();
    expect(api.mediaInitCalls).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: /Hapus Media/ }));
    expect(screen.getByText('Belum ada media')).toBeInTheDocument();
  });

  it('Upload Baru uploads for the welcome message (purpose WELCOME, no conversation), shows its own note and is never in the gallery', async () => {
    let finish: () => void = () => undefined;
    const put: PutFile = (_t, _f, onProgress) =>
      new Promise<void>((resolve) => {
        onProgress(40);
        finish = resolve;
      });
    const api = apiWith();
    mount(api, put);
    await textbox();
    await userEvent.upload(screen.getByTestId('welcome-file-input') as HTMLInputElement, file(), {
      applyAccept: false,
    });
    expect(await screen.findByRole('progressbar', { name: 'Mengunggah' })).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(api.mediaInitCalls[0]).toMatchObject({ purpose: 'WELCOME', kind: 'PHOTO' });
    expect(api.mediaInitCalls[0]).not.toHaveProperty('conversation_id');
    finish();
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(
      screen.getByText('Media ini hanya tersimpan di pesan selamat datang. Tidak masuk ke galeri.'),
    ).toBeInTheDocument();
  });

  it('refuses a wrong file type without any request; a failed upload offers Coba Lagi with the same id', async () => {
    const put = vi.fn<PutFile>().mockRejectedValueOnce(new Error('drop')).mockImplementation(okPut);
    const api = apiWith();
    mount(api, put);
    await textbox();
    const input = screen.getByTestId('welcome-file-input') as HTMLInputElement;
    await userEvent.upload(input, file('x.gif', 'image/gif'), { applyAccept: false });
    expect(await screen.findByText(/Jenis file tidak didukung/)).toBeInTheDocument();
    expect(api.mediaInitCalls).toHaveLength(0);
    await userEvent.upload(input, file(), { applyAccept: false });
    expect(await screen.findByText('Unggahan gagal')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(api.mediaInitCalls).toHaveLength(2);
    expect(api.mediaInitCalls[1]?.client_upload_id).toBe(api.mediaInitCalls[0]?.client_upload_id);
  });

  it('Telegram BackButton closes the picker', async () => {
    let handler: () => void = () => undefined;
    const button = {
      show: vi.fn(),
      hide: vi.fn(),
      onClick: vi.fn((h: () => void) => {
        handler = h;
      }),
      offClick: vi.fn(),
    };
    window.Telegram = { WebApp: { BackButton: button } as never };
    mount(apiWith());
    await textbox();
    await userEvent.click(screen.getByRole('button', { name: /Pilih Galeri/ }));
    await screen.findByText('Pilih satu foto atau video dari galeri.');
    act(() => handler());
    await waitFor(() =>
      expect(screen.queryByText('Pilih satu foto atau video dari galeri.')).toBeNull(),
    );
    expect(screen.getByRole('button', { name: /Pilih Galeri/ })).toBeInTheDocument();
  });
});

describe('Simpan Pesan', () => {
  it('saves the whole state with one PUT: switch, trimmed text and the file, then confirms', async () => {
    const api = apiWith();
    mount(api);
    const box = await textbox();
    await userEvent.type(box, '  Halo semua  ');
    await userEvent.click(screen.getByRole('switch', { name: 'Pesan selamat datang aktif' }));
    await userEvent.click(screen.getByRole('button', { name: /Pilih Galeri/ }));
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Pilih foto' }))[0] as HTMLElement,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    await userEvent.click(saveButton());
    await waitFor(() => expect(api.welcomeSaveCalls).toHaveLength(1));
    expect(api.welcomeSaveCalls[0]).toEqual({
      enabled: true,
      body: 'Halo semua',
      asset_id: mediaAsset(1).id,
    });
    expect(await screen.findByText('Pesan selamat datang disimpan.')).toBeInTheDocument();
    expect(box).toHaveValue('Halo semua');
  });

  it('sends no file when none is chosen, and a double tap saves once', async () => {
    let release: () => void = () => undefined;
    const api = apiWith();
    const gate = new Promise<WelcomeMessageResponse>((resolve) => {
      release = () => resolve(saved({ body: 'Halo' }));
    });
    api.welcomeSaveResults.push(gate);
    mount(api);
    await userEvent.type(await textbox(), 'Halo');
    await userEvent.dblClick(saveButton());
    expect(api.welcomeSaveCalls).toHaveLength(1);
    expect(api.welcomeSaveCalls[0]?.asset_id).toBeNull();
    await act(async () => {
      release();
    });
    expect(await screen.findByText('Pesan selamat datang disimpan.')).toBeInTheDocument();
  });

  it('a failed save keeps text, switch and file on screen, shows the error, and the retry works', async () => {
    const api = apiWith({ welcomeSave: [networkError()] });
    mount(api);
    const box = await textbox();
    await userEvent.type(box, 'Halo semua');
    await userEvent.click(screen.getByRole('switch', { name: 'Pesan selamat datang aktif' }));
    await userEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pesan belum tersimpan. Isianmu masih ada di sini. Coba simpan lagi.',
    );
    expect(box).toHaveValue('Halo semua');
    expect(screen.getByRole('switch', { name: 'Pesan selamat datang aktif' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(saveButton());
    await waitFor(() => expect(api.welcomeSaveCalls).toHaveLength(2));
    expect(api.welcomeSaveCalls[1]).toEqual(api.welcomeSaveCalls[0]);
    expect(await screen.findByText('Pesan selamat datang disimpan.')).toBeInTheDocument();
  });

  it('says so when the file can no longer be used, or is still being processed', async () => {
    const gone = apiWith({
      welcomeSave: [new ApiError(404, 'MEDIA_NOT_FOUND', 'Not found.')],
    });
    mount(gone);
    await userEvent.type(await textbox(), 'Halo');
    await userEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Media ini tidak bisa dipakai. Pilih media lain.',
    );
    cleanup();
    const slow = apiWith({
      welcomeSave: [new ApiError(409, 'MEDIA_NOT_READY', 'The file is still being processed.')],
    });
    mount(slow);
    await userEvent.type(await textbox(), 'Halo');
    await userEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Media masih diproses. Coba lagi sebentar lagi.',
    );
  });
});
