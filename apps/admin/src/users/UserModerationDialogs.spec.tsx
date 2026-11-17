import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserListRow } from '@creatorchat/contracts';
import { ApiError } from '../auth/api-client';
import { BlockUserDialog } from './BlockUserDialog';
import { UnblockUserDialog } from './UnblockUserDialog';

afterEach(cleanup);

const ROW: UserListRow = {
  id: '1b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e44',
  display_name: 'Raka Putra',
  avatar_url: null,
  telegram_username: 'rakaputra',
  telegram_id: '691042285',
  status: 'ACTIVE',
  active_subscription_count: 1,
  creator_request_status: 'PENDING',
  pending_access_count: 0,
  joined_at: '2026-10-20T00:00:00.000Z',
};

const check = (n: number) => ({
  user_status: 'ACTIVE' as const,
  role: 'USER' as const,
  active_subscriptions: n,
  checked_at: '2026-11-16T08:00:00.000Z',
});

function blockSetup(
  options: {
    count?: number;
    block?: () => Promise<unknown>;
    getCheck?: () => Promise<unknown>;
  } = {},
) {
  const api = {
    getUserBlockCheck: vi.fn(options.getCheck ?? (async () => check(options.count ?? 1))),
    blockUser: vi.fn(
      options.block ?? (async () => ({ user: { id: ROW.id, status: 'BLOCKED' as const } })),
    ),
  } as never as Parameters<typeof BlockUserDialog>[0]['api'] & {
    getUserBlockCheck: ReturnType<typeof vi.fn>;
    blockUser: ReturnType<typeof vi.fn>;
  };
  const onDecided = vi.fn();
  const onClose = vi.fn();
  render(<BlockUserDialog row={ROW} open api={api} onClose={onClose} onDecided={onDecided} />);
  return { api, onDecided, onClose };
}

describe('BlockUserDialog (AdmDlgUserBlock)', () => {
  it('shows the board: identity, consequence with the live count, required reason', async () => {
    blockSetup();
    expect(await screen.findByRole('dialog', { name: 'Block user?' })).toBeVisible();
    expect(await screen.findByText('(1)')).toBeInTheDocument();
    expect(
      screen.getByText(/User tidak bisa membuka aplikasi selama diblokir\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ditangguhkan, bukan dicabut, dan berlanjut setelah di-unblock\./),
    ).toBeInTheDocument();
    expect(screen.getByText('@rakaputra · ID 691042285')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Alasan block (wajib)')).toBeInTheDocument();
    expect(screen.getByText('Alasan dicatat di audit log.')).toBeInTheDocument();
  });

  it('leaves the subscription sentence out when there is none', async () => {
    blockSetup({ count: 0 });
    await screen.findByText(/User tidak bisa membuka aplikasi/);
    expect(screen.queryByText(/ditangguhkan/)).toBeNull();
  });

  it('keeps the button inert until the pre-check is in', async () => {
    blockSetup({ getCheck: () => new Promise(() => undefined) });
    expect(await screen.findByRole('button', { name: 'Block User' })).toBeDisabled();
  });

  it('does not call the API for an empty reason and shows the board message', async () => {
    const { api } = blockSetup();
    await screen.findByText('(1)');
    await userEvent.click(screen.getByRole('button', { name: 'Block User' }));
    expect(api.blockUser).not.toHaveBeenCalled();
    expect(await screen.findByText('Alasan wajib diisi.')).toBeInTheDocument();
  });

  it('blocks once with the trimmed reason, even on a double click', async () => {
    const { api, onDecided } = blockSetup({
      block: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ user: { id: ROW.id, status: 'BLOCKED' } }), 50),
        ),
    });
    await screen.findByText('(1)');
    await userEvent.type(screen.getByRole('textbox'), '  Spam berulang  ');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Block User' }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith({ kind: 'blocked' }));
    expect(api.blockUser).toHaveBeenCalledTimes(1);
    expect(api.blockUser).toHaveBeenCalledWith(ROW.id, 'Spam berulang');
  });

  it('keeps the dialog and the typed reason when the call fails, without the thrown message', async () => {
    const { onDecided } = blockSetup({
      block: async () => {
        throw new ApiError(500, 'INTERNAL_ERROR', 'secret stack');
      },
    });
    await screen.findByText('(1)');
    await userEvent.type(screen.getByRole('textbox'), 'Alasan saya');
    await userEvent.click(screen.getByRole('button', { name: 'Block User' }));
    expect(await screen.findByText('Gagal memproses. Coba lagi.')).toBeInTheDocument();
    expect(screen.queryByText(/secret stack/)).toBeNull();
    expect(screen.getByRole('textbox')).toHaveValue('Alasan saya');
    expect(onDecided).not.toHaveBeenCalled();
  });

  it('reports a status or role conflict as a conflict decision', async () => {
    for (const [code, details] of [
      ['USER_STATUS_CONFLICT', { status: 'BLOCKED' }],
      ['USER_ROLE_CONFLICT', { role: 'CREATOR' }],
    ] as const) {
      const { onDecided } = blockSetup({
        block: async () => {
          throw new ApiError(409, code, 'x', details);
        },
      });
      await screen.findByText('(1)');
      await userEvent.type(screen.getByRole('textbox'), 'x');
      await userEvent.click(screen.getByRole('button', { name: 'Block User' }));
      await waitFor(() => expect(onDecided).toHaveBeenCalledWith({ kind: 'conflict' }));
      cleanup();
    }
  });

  it('shows a retry when the pre-check fails and loads again', async () => {
    let fail = true;
    const { api } = blockSetup({
      getCheck: async () => {
        if (fail) throw new Error('down');
        return check(2);
      },
    });
    expect(await screen.findByText('Jumlah langganan belum bisa dimuat.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByText('(2)')).toBeInTheDocument();
    expect(api.getUserBlockCheck).toHaveBeenCalledTimes(2);
  });

  it('renders the user name as text, never as markup', async () => {
    const evil = { ...ROW, display_name: '<img src=x onerror=alert(1)>' };
    render(
      <BlockUserDialog
        row={evil}
        open
        api={{
          getUserBlockCheck: async () => check(0),
          blockUser: async () => ({ user: { id: ROW.id, status: 'BLOCKED' as const } }),
        }}
        onClose={vi.fn()}
        onDecided={vi.fn()}
      />,
    );
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('UnblockUserDialog (AdmDlgUserUnblock)', () => {
  const blocked = { ...ROW, status: 'BLOCKED' as const, display_name: 'Dimas Aditya' };

  function setup(
    unblock = vi.fn(async () => ({ user: { id: ROW.id, status: 'ACTIVE' as const } })),
  ) {
    const onDecided = vi.fn();
    render(
      <UnblockUserDialog
        row={blocked}
        open
        api={{ unblockUser: unblock }}
        onClose={vi.fn()}
        onDecided={onDecided}
      />,
    );
    return { unblock, onDecided };
  }

  it('shows the board text and a required reason, and unblocks once', async () => {
    const { unblock, onDecided } = setup();
    expect(await screen.findByRole('dialog', { name: 'Unblock user?' })).toBeVisible();
    expect(
      screen.getByText(
        'User dapat membuka aplikasi kembali. Tidak ada akses langganan yang dipulihkan secara otomatis.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unblock User' }));
    expect(unblock).not.toHaveBeenCalled();
    expect(await screen.findByText('Alasan wajib diisi.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), '  Banding diterima  ');
    await userEvent.click(screen.getByRole('button', { name: 'Unblock User' }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith({ kind: 'unblocked' }));
    expect(unblock).toHaveBeenCalledTimes(1);
    expect(unblock).toHaveBeenCalledWith(ROW.id, 'Banding diterima');
  });

  it('reports a conflict and keeps the failure message generic', async () => {
    const conflict = setup(
      vi.fn(async () => {
        throw new ApiError(409, 'USER_STATUS_CONFLICT', 'x', { status: 'ACTIVE' });
      }),
    );
    await userEvent.type(screen.getByRole('textbox'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Unblock User' }));
    await waitFor(() => expect(conflict.onDecided).toHaveBeenCalledWith({ kind: 'conflict' }));
    cleanup();
    setup(
      vi.fn(async () => {
        throw new ApiError(500, 'INTERNAL_ERROR', 'boom');
      }),
    );
    await userEvent.type(screen.getByRole('textbox'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Unblock User' }));
    expect(await screen.findByText('Gagal memproses. Coba lagi.')).toBeInTheDocument();
    expect(screen.queryByText('boom')).toBeNull();
  });
});
