/** Indonesian copy of `CrInbox` and `CrStatesInbox`, verbatim, plus placeholders marked `gap`. */
export const INBOX_COPY = {
  title: 'Inbox',
  filters: { all: 'Semua', unread: 'Belum Dibaca' },
  expired: 'Akses berakhir',
  unreadLabel: (n: number) => `${n} pesan belum dibaca`,
  empty: {
    title: 'Belum ada percakapan',
    text: 'Bagikan link profilmu di bio Instagram agar pelanggan bisa mulai chat.',
    action: 'Salin Link Profil',
  },
  error: {
    title: 'Inbox gagal dimuat',
    text: 'Terjadi gangguan saat mengambil percakapan. Coba lagi sebentar.',
    action: 'Coba Lagi',
  },
  offline: {
    title: 'Koneksi terputus',
    text: 'Menyambungkan ulang… Pesan yang kamu kirim akan dicoba lagi otomatis.',
  },
  /** DESIGN GAPS (US-028): no board for these strings; placeholder wording. */
  gap: {
    noUnread: 'Tidak ada pesan yang belum dibaca.',
    moreFailed: 'Percakapan belum termuat.',
    moreRetry: 'Coba lagi',
    linkCopied: 'Link disalin',
    linkCopyFailed: 'Link belum bisa disalin. Coba lagi.',
    linkNotConfigured: 'Link bot belum diatur. Hubungi admin.',
    loadingMore: 'Memuat…',
  },
} as const;
