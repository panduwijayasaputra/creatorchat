/** `Explore` board copy (verbatim) and the placeholders that have no board. */
export const EXPLORE_COPY = {
  title: 'Jelajahi',
  profile: 'Profil',
  chips: { ACTIVE: 'Aktif', PENDING: 'Menunggu', EXPIRED: 'Berakhir' },
  /** DESIGN GAPS: no board (pagination control, empty, loading, error). */
  gap: {
    more: 'Muat lagi',
    loadingMore: 'Memuat…',
    empty: 'Belum ada creator.',
    loading: 'Memuat creator…',
    failed: 'Daftar creator belum bisa dimuat.',
    retry: 'Coba Lagi',
  },
} as const;
