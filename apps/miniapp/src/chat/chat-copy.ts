/** Indonesian copy of `Chat`, `ChatExpired` and `StatesAccess` (Chat · riwayat loading), verbatim. */
export const CHAT_COPY = {
  back: 'Kembali',
  options: 'Opsi percakapan',
  loadingHistory: 'Memuat riwayat…',
  composerLabel: 'Tulis pesan',
  send: 'Kirim pesan',
  attach: 'Lampirkan media',
  sending: 'Mengirim…',
  /** The pencil tag on the creator's own bubbles (CrChatManual). */
  manual: 'Manual',
  failed: 'Belum terkirim',
  retry: 'Kirim Ulang',
  read: 'Dibaca',
  accessUntil: (date: string) => `Akses aktif hingga ${date}`,
  expired: {
    subtitle: 'Akses telah berakhir',
    title: 'Akses telah berakhir',
    text: 'Riwayat chat tetap bisa kamu baca. Minta perpanjangan untuk melanjutkan percakapan.',
    action: 'Minta Perpanjangan Akses',
    endedAt: (when: string) => `Akses berakhir ${when}`,
  },
  /** Not designed (gap): the creator's account is blocked. No renewal button, because renewing cannot help. */
  creatorBlocked: {
    subtitle: 'Creator tidak tersedia',
    title: 'Creator tidak tersedia',
    text: 'Riwayat chat tetap bisa kamu baca.',
  },
  gap: {
    notYet: 'Fitur ini belum tersedia.',
    requestFailed: 'Permintaan belum terkirim. Coba lagi.',
    olderFailed: 'Riwayat belum termuat.',
    olderRetry: 'Coba lagi',
    notFound: 'Percakapan tidak ditemukan.',
    empty: 'Belum ada pesan.',
  },
} as const;
