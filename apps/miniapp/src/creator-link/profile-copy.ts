/** `CreatorGuest` / `CreatorPending` / `CreatorActive` / `CreatorExpired` copy: verbatim from the boards unless noted. */
export const PROFILE_COPY = {
  back: 'Kembali',
  gallery: 'Galeri',
  guest: {
    cta: 'Minta Akses Uji Coba',
    note: 'Admin akan meninjau permintaanmu, lalu memberi kabar melalui Telegram.',
    gallery:
      'Foto dan video creator terkunci sampai aksesmu aktif. Minta akses uji coba untuk membukanya.',
  },
  pending: {
    title: 'Permintaan akses terkirim',
    text: 'Permintaan akses sudah dikirim. Kami akan memberi kabar melalui Telegram setelah disetujui.',
    sent: 'Dikirim',
    status: 'Menunggu Persetujuan',
    gallery: 'Foto dan video terkunci sampai permintaan aksesmu disetujui.',
  },
  active: {
    until: 'Akses aktif hingga',
    endsAt: 'Berakhir pukul',
    cta: 'Buka Chat',
  },
  expired: {
    title: 'Akses telah berakhir',
    since: 'Sejak',
    kept: 'Media yang sudah ada di chat tetap bisa dibuka.',
    cta: 'Minta Perpanjangan Akses',
    history: 'Lihat Riwayat Chat',
    gallery:
      'Akses telah berakhir, jadi galeri terkunci. Media yang sudah kamu terima di chat tetap bisa dibuka.',
  },
  /** `StatesAccess`: the review result cards, verbatim. */
  result: {
    approvedTitle: 'Akses disetujui',
    approvedText: 'Permintaanmu sudah disetujui. Kamu bisa membuka chat dengan {name} sekarang.',
    approvedUntil: 'Berlaku hingga',
    rejectedTitle: 'Permintaan belum bisa disetujui',
    rejectedText:
      'Permintaan akses belum dapat disetujui saat ini. Kamu bisa mengajukan lagi nanti.',
    reviewed: 'Ditinjau',
    again: 'Ajukan Lagi',
  },
  tile: { photo: 'Buka foto', video: 'Buka video' },
  lockedTitle: 'Galeri tersedia untuk subscriber aktif',
  /** DESIGN GAPS: no board. */
  gap: {
    loading: 'Memuat…',
    sending: 'Mengirim…',
    requestFailed: 'Permintaan belum terkirim. Coba lagi.',
    notYet: 'Fitur ini belum tersedia.',
    galleryEmpty: 'Belum ada media di galeri.',
    galleryFailed: 'Galeri belum termuat.',
    galleryMoreFailed: 'Media berikutnya belum termuat.',
    galleryRetry: 'Coba lagi',
  },
} as const;
