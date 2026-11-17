/** `Subscriptions` board copy (verbatim) and the placeholders that have no board. */
export const SUBSCRIPTIONS_COPY = {
  title: 'Langganan',
  chips: { ACTIVE: 'Aktif', PENDING: 'Menunggu', EXPIRED: 'Berakhir' },
  activeUntil: 'Akses aktif hingga',
  requested: 'Diminta',
  waiting: 'menunggu persetujuan admin',
  endedAt: 'Akses telah berakhir',
  openChat: 'Buka Chat',
  profile: 'Profil',
  extend: 'Minta Perpanjangan Akses',
  /** `{zone}` is the account's zone label and `{offset}` its UTC offset: "WIB (UTC+7)". */
  footer: 'Setiap creator punya periode akses sendiri. Semua waktu memakai',
  /**
   * DESIGN GAPS: the board has no loading / empty / error text (`StatesChats` is chat-specific), no
   * note for a blocked creator and no sending / failure wording for the extend button.
   */
  gap: {
    emptyTitle: 'Belum ada langganan',
    emptyText: 'Creator yang kamu minta aksesnya akan muncul di sini.',
    emptyAction: 'Jelajahi Creator',
    errorTitle: 'Langganan gagal dimuat',
    errorText: 'Terjadi gangguan saat mengambil langgananmu. Coba lagi sebentar.',
    retry: 'Coba Lagi',
    loading: 'Memuat langganan…',
    unavailable: 'Creator sedang tidak tersedia.',
    sending: 'Mengirim…',
    requestFailed: 'Permintaan belum terkirim. Coba lagi.',
    notYet: 'Fitur ini belum tersedia.',
  },
} as const;
