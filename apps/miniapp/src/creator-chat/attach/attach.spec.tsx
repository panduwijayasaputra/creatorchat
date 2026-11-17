import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeMiniappApi,
  creatorChatHistory,
  creatorChatMessage,
  galleryPage,
  mediaAsset,
  networkError,
  type FakeMiniappApi,
} from '../../../test/fake-miniapp-api';
import { CreatorChatPage } from '../CreatorChatPage';
import type { PutFile } from '../../gallery/upload-file';

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'authenticated', user: { timezone: 'Asia/Jakarta' } } }),
}));

const CONV = '66666666-0000-4000-8000-000000000001';

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

function mount(api: FakeMiniappApi, put: PutFile = okPut) {
  render(
    <MemoryRouter initialEntries={[`/inbox/${CONV}`]}>
      <Routes>
        <Route
          path="/inbox/:conversationId"
          element={<CreatorChatPage api={api} put={put} pollMs={0} />}
        />
        <Route path="/inbox" element={<div>inbox</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const apiWith = (over: Parameters<typeof createFakeMiniappApi>[0] = {}) =>
  createFakeMiniappApi({
    creatorChatHistory: [creatorChatHistory([creatorChatMessage(1, { body: 'Halo' })])],
    gallery: [galleryPage([mediaAsset(1), mediaAsset(2, { kind: 'VIDEO', duration_seconds: 48 })])],
    ...over,
  });

async function openSheet() {
  await userEvent.click(await screen.findByRole('button', { name: 'Lampirkan media' }));
  return screen.findByRole('dialog', { name: 'Kirim media ke Rani' });
}
const file = (name = 'a.jpg', type = 'image/jpeg') =>
  new File([new Uint8Array(1000)], name, { type });

describe('attach sheet', () => {
  it('offers Pilih Galeri and Upload Baru with the board texts, and closes by tapping outside', async () => {
    mount(apiWith());
    const sheet = await openSheet();
    expect(within(sheet).getByText('Pilih Galeri')).toBeInTheDocument();
    expect(within(sheet).getByText('Memakai file yang sama, tanpa salinan')).toBeInTheDocument();
    expect(within(sheet).getByText('Upload Baru')).toBeInTheDocument();
    expect(
      within(sheet).getByText('Hanya tersimpan di percakapan ini, tidak masuk galeri'),
    ).toBeInTheDocument();
    document.querySelector<HTMLElement>('[aria-hidden="true"][class*="backdrop"]')?.click();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Pilih Galeri', () => {
  it('sends the picked gallery asset with a message, never calls the upload API, and confirms with a toast', async () => {
    const api = apiWith();
    mount(api);
    await openSheet();
    await userEvent.click(screen.getByRole('button', { name: /Pilih Galeri/ }));
    expect(await screen.findByText('Pilih satu foto atau video dari galeri.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeDisabled();
    await userEvent.click(screen.getAllByRole('button', { name: 'Pilih foto' })[0] as HTMLElement);
    expect(screen.getByText('1 media dipilih')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));

    expect(await screen.findByText('Kirim ke Rani Anggraini')).toBeInTheDocument();
    expect(
      screen.getByText('Memakai media yang sama dari galeri. Tidak ada salinan baru.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Mengirim akan mengambil alih/)).toBeNull();
    await userEvent.type(screen.getByPlaceholderText('Tulis pesan (opsional)'), 'Ini tepungnya');
    await userEvent.click(screen.getByRole('button', { name: 'Kirim' }));

    await waitFor(() => expect(api.creatorChatSendCalls).toHaveLength(1));
    expect(api.creatorChatSendCalls[0]).toMatchObject({
      body: 'Ini tepungnya',
      attachment: { asset_id: mediaAsset(1).id },
    });
    expect(api.mediaInitCalls).toHaveLength(0);
    expect(await screen.findByText('Media terkirim')).toBeInTheDocument();
    expect(screen.queryByText('Kirim ke Rani Anggraini')).toBeNull();
    expect(await screen.findByTestId('media-bubble')).toBeInTheDocument();
  });

  it('shows the empty gallery text and keeps Lanjut disabled', async () => {
    mount(apiWith({ gallery: [galleryPage([])] }));
    await openSheet();
    await userEvent.click(screen.getByRole('button', { name: /Pilih Galeri/ }));
    expect(await screen.findByText('Galeri masih kosong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeDisabled();
  });

  it('Ganti goes back to the two options', async () => {
    mount(apiWith());
    await openSheet();
    await userEvent.click(screen.getByRole('button', { name: /Pilih Galeri/ }));
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Pilih foto' }))[0] as HTMLElement,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ganti' }));
    expect(await screen.findByRole('dialog', { name: 'Kirim media ke Rani' })).toBeInTheDocument();
  });
});

describe('Upload Baru', () => {
  it('uploads for this conversation, enables Kirim only when READY, then sends that asset', async () => {
    let finish: () => void = () => undefined;
    const put: PutFile = (_t, _f, onProgress) =>
      new Promise<void>((resolve) => {
        onProgress(40);
        finish = resolve;
      });
    const api = apiWith();
    mount(api, put);
    await openSheet();
    await userEvent.upload(screen.getByTestId('attach-file-input') as HTMLInputElement, file(), {
      applyAccept: false,
    });

    expect(await screen.findByText('Kirim ke Rani Anggraini')).toBeInTheDocument();
    expect(await screen.findByRole('progressbar', { name: 'Mengunggah' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kirim' })).toBeDisabled();
    expect(api.mediaInitCalls[0]).toMatchObject({
      purpose: 'CHAT',
      conversation_id: CONV,
      kind: 'PHOTO',
    });
    expect(
      screen.getByText(
        'Media ini hanya tersimpan di percakapan ini. Tidak masuk ke galeri dan tidak tersedia untuk pelanggan lain.',
      ),
    ).toBeInTheDocument();

    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kirim' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Kirim' }));
    await waitFor(() => expect(api.creatorChatSendCalls).toHaveLength(1));
    expect(api.creatorChatSendCalls[0]?.attachment?.asset_id).toBe(mediaAsset(900).id);
    expect(api.creatorChatSendCalls[0]?.body).toBeUndefined();
  });

  it('refuses a wrong file type without any request, and a failed upload offers Coba Lagi with the same id', async () => {
    const put = vi.fn<PutFile>().mockRejectedValueOnce(new Error('drop')).mockImplementation(okPut);
    const api = apiWith();
    mount(api, put);
    await openSheet();
    const input = screen.getByTestId('attach-file-input') as HTMLInputElement;
    await userEvent.upload(input, file('x.gif', 'image/gif'), { applyAccept: false });
    expect(await screen.findByText(/Jenis file tidak didukung/)).toBeInTheDocument();
    expect(api.mediaInitCalls).toHaveLength(0);

    await userEvent.upload(input, file(), { applyAccept: false });
    expect(await screen.findByText('Unggahan gagal')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kirim' })).toBeEnabled());
    expect(api.mediaInitCalls).toHaveLength(2);
    expect(api.mediaInitCalls[1]?.client_upload_id).toBe(api.mediaInitCalls[0]?.client_upload_id);
  });
});

describe('sending and going back', () => {
  it('a failed send keeps the media, and Kirim Ulang resends the same message id and asset', async () => {
    const api = apiWith({ creatorChatSend: [networkError()] });
    mount(api);
    await openSheet();
    await userEvent.click(screen.getByRole('button', { name: /Pilih Galeri/ }));
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Pilih foto' }))[0] as HTMLElement,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Kirim' }));
    expect(await screen.findByText('Belum terkirim')).toBeInTheDocument();
    expect(screen.getByTestId('media-bubble')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kirim Ulang' }));
    await waitFor(() => expect(api.creatorChatSendCalls).toHaveLength(2));
    expect(api.creatorChatSendCalls[1]).toEqual(api.creatorChatSendCalls[0]);
    expect(api.creatorChatSendCalls[1]?.attachment?.asset_id).toBe(mediaAsset(1).id);
  });

  it('Telegram BackButton steps back one level at a time', async () => {
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
    await openSheet();
    await userEvent.click(screen.getByRole('button', { name: /Pilih Galeri/ }));
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Pilih foto' }))[0] as HTMLElement,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    await screen.findByText('Kirim ke Rani Anggraini');
    act(() => handler());
    expect(await screen.findByText('Pilih satu foto atau video dari galeri.')).toBeInTheDocument();
    act(() => handler());
    expect(await screen.findByRole('dialog', { name: 'Kirim media ke Rani' })).toBeInTheDocument();
    act(() => handler());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(button.hide).toHaveBeenCalled();
  });

  it('shows no AI takeover note anywhere in the flow', async () => {
    mount(apiWith());
    await openSheet();
    await userEvent.click(screen.getByRole('button', { name: /Pilih Galeri/ }));
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Pilih foto' }))[0] as HTMLElement,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    await screen.findByText('Kirim ke Rani Anggraini');
    expect(document.body.textContent).not.toMatch(/\bAI\b|mengambil alih/);
  });
});
