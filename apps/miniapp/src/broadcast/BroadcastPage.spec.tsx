import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeMiniappApi,
  galleryPage,
  mediaAsset,
  networkError,
  type FakeMiniappApi,
} from '../../test/fake-miniapp-api';
import { ApiError } from '../auth/api-client';
import type { PutFile } from '../gallery/upload-file';
import { BroadcastPage } from './BroadcastPage';

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

const apiWith = (over: Parameters<typeof createFakeMiniappApi>[0] = {}) =>
  createFakeMiniappApi({
    gallery: [galleryPage([mediaAsset(1), mediaAsset(2, { kind: 'VIDEO', duration_seconds: 48 })])],
    ...over,
  });

function mount(api: FakeMiniappApi, put: PutFile = okPut) {
  render(
    <MemoryRouter>
      <BroadcastPage api={api} put={put} pollMs={0} />
    </MemoryRouter>,
  );
}

const file = (name = 'a.jpg', type = 'image/jpeg') =>
  new File([new Uint8Array(1000)], name, { type });
const send = () => screen.getByRole('button', { name: 'Kirim Broadcast' });

async function pickFromGallery() {
  await userEvent.click(screen.getByRole('button', { name: /Pilih Galeri/ }));
  await userEvent.click(
    (await screen.findAllByRole('button', { name: 'Pilih foto' }))[0] as HTMLElement,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
}

async function uploadNew(api?: FakeMiniappApi) {
  await userEvent.upload(screen.getByTestId('broadcast-file-input') as HTMLInputElement, file(), {
    applyAccept: false,
  });
  await waitFor(() => expect(send()).toBeEnabled());
  void api;
}

describe('the empty composer (CrBroadcast)', () => {
  it('shows the target, the two options and a disabled Kirim Broadcast, with no target or schedule control', async () => {
    mount(apiWith());
    expect(screen.getByRole('heading', { level: 1, name: 'Broadcast' })).toBeInTheDocument();
    expect(screen.getByText('Semua Subscriber Aktif')).toBeInTheDocument();
    expect(screen.getByText('Target selalu seluruh subscriber aktif.')).toBeInTheDocument();
    expect(screen.getByText('Pilih media untuk dikirim')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pilih Galeri/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload Baru/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Tulis pesan broadcast')).toBeInTheDocument();
    expect(send()).toBeDisabled();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(document.body.textContent).not.toMatch(/jadwal|segmen|draft/i);
  });
});

describe('Pilih Galeri', () => {
  it('shows the same-media note and no save box, then sends the gallery asset after the confirmation', async () => {
    const api = apiWith();
    mount(api);
    await userEvent.click(screen.getByRole('button', { name: /Pilih Galeri/ }));
    expect(await screen.findByText('Pilih satu foto atau video dari galeri.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeDisabled();
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Pilih foto' }))[0] as HTMLElement,
    );
    expect(screen.getByText('1 media dipilih')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));

    expect(
      await screen.findByText('Memakai media yang sama dari galeri. Tidak ada salinan baru.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ganti Media' })).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('Tulis pesan broadcast'), '  Promo hari ini ');
    expect(send()).toBeEnabled();
    await userEvent.click(send());

    const dialog = await screen.findByRole('dialog', {
      name: 'Kirim media ini ke seluruh subscriber aktif?',
    });
    expect(
      within(dialog).getByText(
        'Setiap pelanggan menerima pesan di percakapan privatnya. Pesan yang sudah terkirim tidak bisa ditarik.',
      ),
    ).toBeInTheDocument();
    expect(api.broadcastCalls).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kirim Broadcast' }));

    await waitFor(() => expect(api.broadcastCalls).toHaveLength(1));
    expect(api.broadcastCalls[0]).toMatchObject({
      attachment: { asset_id: mediaAsset(1).id },
      body: 'Promo hari ini',
      save_to_gallery: false,
    });
    expect(api.mediaInitCalls).toHaveLength(0);
    expect(
      await screen.findByText('Broadcast terkirim ke semua subscriber aktif'),
    ).toBeInTheDocument();
    // back to the empty composer, nothing kept as a draft
    expect(screen.getByText('Pilih media untuk dikirim')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Tulis pesan broadcast')).toHaveValue('');
    expect(send()).toBeDisabled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the empty gallery text and keeps Lanjut disabled', async () => {
    mount(apiWith({ gallery: [galleryPage([])] }));
    await userEvent.click(screen.getByRole('button', { name: /Pilih Galeri/ }));
    expect(await screen.findByText('Galeri masih kosong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeDisabled();
  });

  it('Ganti Media goes back to the two options', async () => {
    mount(apiWith());
    await pickFromGallery();
    await userEvent.click(await screen.findByRole('button', { name: 'Ganti Media' }));
    expect(screen.getByText('Pilih media untuk dikirim')).toBeInTheDocument();
    expect(send()).toBeDisabled();
  });
});

describe('Upload Baru', () => {
  it('uploads for a broadcast, shows the unchecked box with its note, and sends without saving to the gallery', async () => {
    let finish: () => void = () => undefined;
    const put: PutFile = (_t, _f, onProgress) =>
      new Promise<void>((resolve) => {
        onProgress(40);
        finish = resolve;
      });
    const api = apiWith();
    mount(api, put);
    await userEvent.upload(screen.getByTestId('broadcast-file-input') as HTMLInputElement, file(), {
      applyAccept: false,
    });
    expect(await screen.findByRole('progressbar', { name: 'Mengunggah' })).toBeInTheDocument();
    expect(send()).toBeDisabled();
    expect(api.mediaInitCalls[0]).toMatchObject({ purpose: 'BROADCAST', kind: 'PHOTO' });
    expect(api.mediaInitCalls[0]).not.toHaveProperty('conversation_id');

    finish();
    await waitFor(() => expect(send()).toBeEnabled());
    const box = screen.getByRole('checkbox', { name: 'Simpan juga ke galeri' });
    expect(box).not.toBeChecked();
    expect(
      screen.getByText(
        'Tidak dicentang: media hanya tersimpan di pesan broadcast pada riwayat chat penerima. Tidak masuk ke galeri.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(send());
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Kirim Broadcast' }),
    );
    await waitFor(() => expect(api.broadcastCalls).toHaveLength(1));
    expect(api.broadcastCalls[0]).toMatchObject({
      attachment: { asset_id: mediaAsset(900).id },
      save_to_gallery: false,
    });
    expect(api.broadcastCalls[0]).not.toHaveProperty('body');
  });

  it('ticking the box changes the note and sends save_to_gallery', async () => {
    const api = apiWith();
    mount(api);
    await uploadNew();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Simpan juga ke galeri' }));
    expect(
      screen.getByText(
        'Dicentang: file yang sama dipakai untuk broadcast dan galeri. Tidak ada salinan, dan terlihat oleh subscriber aktif.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(send());
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Kirim Broadcast' }),
    );
    await waitFor(() => expect(api.broadcastCalls).toHaveLength(1));
    expect(api.broadcastCalls[0]?.save_to_gallery).toBe(true);
  });

  it('the box starts unticked again for the next upload and never applies to a gallery file', async () => {
    mount(apiWith());
    await uploadNew();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Simpan juga ke galeri' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ganti Media' }));
    await uploadNew();
    expect(screen.getByRole('checkbox', { name: 'Simpan juga ke galeri' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Ganti Media' }));
    await pickFromGallery();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('refuses a wrong file type without any request, and a failed upload offers Coba Lagi with the same id', async () => {
    const put = vi.fn<PutFile>().mockRejectedValueOnce(new Error('drop')).mockImplementation(okPut);
    const api = apiWith();
    mount(api, put);
    const input = screen.getByTestId('broadcast-file-input') as HTMLInputElement;
    await userEvent.upload(input, file('x.gif', 'image/gif'), { applyAccept: false });
    expect(await screen.findByText(/Jenis file tidak didukung/)).toBeInTheDocument();
    expect(api.mediaInitCalls).toHaveLength(0);

    await userEvent.upload(input, file(), { applyAccept: false });
    expect(await screen.findByText('Unggahan gagal')).toBeInTheDocument();
    expect(send()).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    await waitFor(() => expect(send()).toBeEnabled());
    expect(api.mediaInitCalls).toHaveLength(2);
    expect(api.mediaInitCalls[1]?.client_upload_id).toBe(api.mediaInitCalls[0]?.client_upload_id);
  });
});

describe('the confirmation', () => {
  it('Batal sends nothing and keeps the composer as it was', async () => {
    const api = apiWith();
    mount(api);
    await pickFromGallery();
    await userEvent.type(screen.getByPlaceholderText('Tulis pesan broadcast'), 'Halo');
    await userEvent.click(send());
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Batal' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.broadcastCalls).toHaveLength(0);
    expect(screen.getByPlaceholderText('Tulis pesan broadcast')).toHaveValue('Halo');
    expect(send()).toBeEnabled();
  });

  it('a double tap on the confirm button sends once', async () => {
    let release: () => void = () => undefined;
    const api = apiWith();
    const original = api.createBroadcast.bind(api);
    api.createBroadcast = (body) =>
      new Promise((resolve, reject) => {
        release = () => original(body).then(resolve, reject);
      });
    mount(api);
    await pickFromGallery();
    await userEvent.click(send());
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Kirim Broadcast',
    });
    await userEvent.dblClick(confirm);
    expect(confirm).toBeDisabled();
    await act(async () => {
      release();
    });
    await waitFor(() => expect(api.broadcastCalls).toHaveLength(1));
    // Let the send finish before the test ends, so nothing outlives the render.
    expect(
      await screen.findByText('Broadcast terkirim ke semua subscriber aktif'),
    ).toBeInTheDocument();
  });

  it('Telegram BackButton closes the picker, then the confirmation', async () => {
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
    // The picker is opened twice, and each opening loads the gallery again.
    mount(
      apiWith({
        gallery: [galleryPage([mediaAsset(1)]), galleryPage([mediaAsset(1)])],
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Pilih Galeri/ }));
    await screen.findByText('Pilih satu foto atau video dari galeri.');
    act(() => handler());
    await waitFor(() =>
      expect(screen.queryByText('Pilih satu foto atau video dari galeri.')).toBeNull(),
    );
    await pickFromGallery();
    await userEvent.click(send());
    await screen.findByRole('dialog');
    act(() => handler());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('failures keep what was entered', () => {
  async function ready(api: FakeMiniappApi) {
    mount(api);
    await pickFromGallery();
    await userEvent.type(screen.getByPlaceholderText('Tulis pesan broadcast'), 'Halo semua');
    await userEvent.click(send());
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Kirim Broadcast' }),
    );
  }

  it('a network failure shows the error, keeps media and text, and the retry reuses the same client id', async () => {
    const api = apiWith();
    api.broadcastResults.push(networkError());
    await ready(api);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Broadcast belum terkirim. Coba lagi.',
    );
    expect(screen.getByPlaceholderText('Tulis pesan broadcast')).toHaveValue('Halo semua');
    expect(screen.getByRole('button', { name: 'Ganti Media' })).toBeInTheDocument();
    expect(screen.queryByText('Broadcast terkirim ke semua subscriber aktif')).toBeNull();
    await userEvent.click(send());
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Kirim Broadcast' }),
    );
    await waitFor(() => expect(api.broadcastCalls).toHaveLength(2));
    expect(api.broadcastCalls[1]).toEqual(api.broadcastCalls[0]);
    expect(
      await screen.findByText('Broadcast terkirim ke semua subscriber aktif'),
    ).toBeInTheDocument();
  });

  it('changing the text after a failure is a new broadcast with a new client id', async () => {
    const api = apiWith();
    api.broadcastResults.push(networkError());
    await ready(api);
    await screen.findByRole('alert');
    await userEvent.type(screen.getByPlaceholderText('Tulis pesan broadcast'), '!');
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(send());
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Kirim Broadcast' }),
    );
    await waitFor(() => expect(api.broadcastCalls).toHaveLength(2));
    expect(api.broadcastCalls[1]?.client_broadcast_id).not.toBe(
      api.broadcastCalls[0]?.client_broadcast_id,
    );
  });

  it('no active subscribers shows the notice and keeps the composer', async () => {
    const api = apiWith();
    api.broadcastResults.push(
      new ApiError(409, 'NO_ACTIVE_SUBSCRIBERS', 'There are no active subscribers.'),
    );
    await ready(api);
    expect(await screen.findByText('Belum ada subscriber aktif.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByPlaceholderText('Tulis pesan broadcast')).toHaveValue('Halo semua');
    expect(send()).toBeEnabled();
  });

  it('a file that can no longer be sent says so; a rate limit says so', async () => {
    const gone = apiWith();
    gone.broadcastResults.push(new ApiError(404, 'MEDIA_NOT_FOUND', 'Not found.'));
    await ready(gone);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Media ini tidak bisa dikirim. Pilih media lain.',
    );
    cleanup();

    const limited = apiWith();
    limited.broadcastResults.push(new ApiError(429, 'RATE_LIMITED', 'Too many broadcasts.'));
    await ready(limited);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Terlalu banyak broadcast. Coba lagi nanti.',
    );
  });
});
