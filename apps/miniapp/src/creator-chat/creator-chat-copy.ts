/** Indonesian copy of `CrChatManual`, `CrChatExpired` and `CrCustomer`, verbatim; `gap` entries are placeholders. */
export const CREATOR_CHAT_COPY = {
  back: 'Kembali',
  customerDetail: 'Detail pelanggan',
  loadingHistory: 'Memuat riwayat…',
  composerLabel: 'Tulis balasan',
  accessUntil: (date: string) => `Akses aktif hingga ${date}`,
  expired: {
    subtitle: 'Akses telah berakhir',
    title: 'Akses berakhir',
    text: 'AI tidak membalas dan broadcast baru tidak diterima.',
    endedAt: (when: string) => `Akses pelanggan berakhir ${when}`,
    panelTitle: 'Akses pelanggan telah berakhir.',
    panelText: 'Masa akses dikelola admin.',
  },
  customer: {
    title: 'Detail pelanggan',
    from: (username: string | null) =>
      username ? `@${username} · dari Telegram` : 'dari Telegram',
    activeUntil: (date: string) => `Akses aktif hingga ${date}`,
    endsAt: (time: string) => `Berakhir pukul ${time} · dikelola admin`,
    openChat: 'Buka Chat',
  },
  gap: {
    /** No board for an ended access on `CrCustomer`. */
    endedTitle: 'Akses telah berakhir',
    endedAt: (date: string) => `Berakhir ${date} · dikelola admin`,
    endedNoDate: 'Masa akses dikelola admin.',
    notFound: 'Percakapan tidak ditemukan.',
  },
} as const;
