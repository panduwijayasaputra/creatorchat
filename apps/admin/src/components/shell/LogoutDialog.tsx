import { ConfirmDialog, XIcon } from '@creatorchat/ui';

/** Logout confirmation, copy verbatim from AdmLogoutDlg. */
export function LogoutDialog({
  open,
  onConfirm,
  onClose,
}: {
  open: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      width={480}
      title="Keluar dari dashboard?"
      icon={<XIcon size={22} strokeWidth={2} />}
      consequence="Sesi di perangkat ini berakhir dan kamu kembali ke halaman login. Perubahan yang belum disimpan hilang."
      confirmLabel="Logout"
      failureMessage="Gagal keluar. Coba lagi."
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
