import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreatorListRow } from '@creatorchat/contracts';
import { ApiError } from '../auth/api-client';
import { BlockCreatorDialog } from './BlockCreatorDialog';
import { UnblockCreatorDialog } from './UnblockCreatorDialog';

afterEach(cleanup);

const ROW: CreatorListRow = {
  kind: 'creator',
  id: '1b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e44',
  status: 'ACTIVE',
  creator_name: 'Salsa Maheswari',
  avatar_url: null,
  telegram_username: 'salsa.maheswari',
  telegram_id: '100200301',
  instagram_url: null,
  creator_type: 'HUMAN',
  subscriber_count: 58,
  has_active_subscription: false,
  date: '2026-09-21T00:00:00.000Z',
};

function blockSetup(
  block = vi.fn(async () => ({
    creator: { id: ROW.id, status: 'BLOCKED' as const },
    active_subscribers: 58,
  })),
) {
  const api = {
    getBlockCheck: vi.fn(async () => ({
      creator_status: 'ACTIVE' as const,
      active_subscribers: 58,
      checked_at: '2026-11-16T08:00:00.000Z',
    })),
    blockCreator: block,
  };
  const onDecided = vi.fn();
  render(<BlockCreatorDialog row={ROW} open api={api} onClose={vi.fn()} onDecided={onDecided} />);
  return { api, onDecided };
}

describe('BlockCreatorDialog', () => {
  it('shows the board: identity, live count, required reason', async () => {
    blockSetup();
    expect(await screen.findByRole('dialog', { name: 'Block creator?' })).toBeVisible();
    expect(await screen.findByText('58 subscriber aktif')).toBeInTheDocument();
    expect(screen.getByText('@salsa.maheswari · ID 100200301 · Creator Asli')).toBeInTheDocument();
    expect(screen.getByText('Alasan block (wajib)')).toBeInTheDocument();
  });

  it('does not call the API for an empty reason', async () => {
    const { api } = blockSetup();
    await screen.findByText('58 subscriber aktif');
    await userEvent.click(screen.getByRole('button', { name: 'Block Creator' }));
    expect(api.blockCreator).not.toHaveBeenCalled();
  });

  it('blocks once, even on a double click', async () => {
    // A slow call: the dialog stays pending, so the second click must not send again.
    const { api, onDecided } = blockSetup(
      vi.fn(
        () =>
          new Promise<{ creator: { id: string; status: 'BLOCKED' }; active_subscribers: number }>(
            (resolve) =>
              setTimeout(
                () =>
                  resolve({ creator: { id: ROW.id, status: 'BLOCKED' }, active_subscribers: 58 }),
                50,
              ),
          ),
      ),
    );
    await screen.findByText('58 subscriber aktif');
    await userEvent.type(screen.getByRole('textbox'), ' Pelanggaran ');
    const button = screen.getByRole('button', { name: 'Block Creator' });
    await userEvent.dblClick(button);
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith({ kind: 'blocked' }));
    expect(api.blockCreator).toHaveBeenCalledTimes(1);
    expect(api.blockCreator).toHaveBeenCalledWith(ROW.id, 'Pelanggaran');
  });

  it('keeps the dialog and the reason when the call fails', async () => {
    const { onDecided } = blockSetup(vi.fn(async () => Promise.reject(new Error('boom'))));
    await screen.findByText('58 subscriber aktif');
    await userEvent.type(screen.getByRole('textbox'), 'Pelanggaran');
    await userEvent.click(screen.getByRole('button', { name: 'Block Creator' }));
    expect(await screen.findByText('Gagal memproses. Coba lagi.')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Pelanggaran');
    expect(onDecided).not.toHaveBeenCalled();
  });

  it('reports a status conflict', async () => {
    const { onDecided } = blockSetup(
      vi.fn(async () => {
        throw new ApiError(409, 'CREATOR_STATUS_CONFLICT', 'x', { status: 'BLOCKED' });
      }),
    );
    await screen.findByText('58 subscriber aktif');
    await userEvent.type(screen.getByRole('textbox'), 'Pelanggaran');
    await userEvent.click(screen.getByRole('button', { name: 'Block Creator' }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith({ kind: 'conflict' }));
  });

  it('offers a retry when the count cannot load, and keeps confirm inert', async () => {
    const getBlockCheck = vi
      .fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce({ creator_status: 'ACTIVE', active_subscribers: 3, checked_at: 'x' });
    render(
      <BlockCreatorDialog
        row={ROW}
        open
        api={{ getBlockCheck, blockCreator: vi.fn() }}
        onClose={vi.fn()}
        onDecided={vi.fn()}
      />,
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Block Creator' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByText('3 subscriber aktif')).toBeInTheDocument();
  });
});

describe('UnblockCreatorDialog', () => {
  it('shows the board text and sends the trimmed reason once', async () => {
    const unblockCreator = vi.fn(async () => ({
      creator: { id: ROW.id, status: 'ACTIVE' as const },
    }));
    const onDecided = vi.fn();
    render(
      <UnblockCreatorDialog
        row={{ ...ROW, status: 'BLOCKED' }}
        open
        api={{ unblockCreator }}
        onClose={vi.fn()}
        onDecided={onDecided}
      />,
    );
    expect(await screen.findByText(/Subscriber lama tidak otomatis mendapat akses/)).toBeVisible();
    expect(screen.getByText('Alasan unblock (wajib)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unblock Creator' }));
    expect(unblockCreator).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole('textbox'), ' Banding diterima. ');
    await userEvent.click(screen.getByRole('button', { name: 'Unblock Creator' }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith({ kind: 'unblocked' }));
    expect(unblockCreator).toHaveBeenCalledWith(ROW.id, 'Banding diterima.');
  });
});
