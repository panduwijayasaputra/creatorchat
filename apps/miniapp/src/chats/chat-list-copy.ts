/** `Chats` and `StatesChats` copy (verbatim) and the placeholders that have no board. */
export const CHAT_LIST_COPY = {
  title: 'Chat',
  expired: 'Akses telah berakhir',
  discover: { title: 'Cari creator lain', text: 'Lihat profil dan minta akses uji coba.' },
  empty: {
    title: 'Belum ada percakapan',
    text: 'Percakapan muncul di sini setelah kamu mendapat akses ke creator.',
    action: 'Jelajahi Creator',
  },
  error: {
    title: 'Chat gagal dimuat',
    text: 'Terjadi gangguan saat mengambil percakapanmu. Coba lagi sebentar.',
    action: 'Coba Lagi',
  },
  unread: (n: number) => `${n} pesan belum dibaca`,
  /**
   * DESIGN GAPS: no board for the "load more" control and its failure, a conversation that has no
   * message yet, or a conversation whose creator is blocked (the chat screen's placeholder wording).
   */
  gap: {
    more: 'Muat lagi',
    loadingMore: 'Memuat…',
    moreFailed: 'Percakapan belum termuat.',
    noMessage: 'Belum ada pesan',
    creatorBlocked: 'Creator tidak tersedia',
    loading: 'Memuat percakapan…',
  },
} as const;
