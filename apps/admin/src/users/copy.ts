/** The User list (`AdmUsers`, `AdmTableStates`): verbatim from the boards unless noted. */
export const USER_LIST_COPY = {
  intro:
    'Hanya akun dengan role USER. Akun yang disetujui menjadi creator pindah ke daftar Creator.',
  search: 'Cari nama atau Telegram ID',
  searchMobile: 'Cari pengguna',
  filterMobile: 'Filter',
  scrollHint: 'Geser tabel ke samping untuk melihat seluruh kolom.',
  statusOptions: { all: 'Semua', active: 'Active', blocked: 'Blocked' },
  requestOptions: {
    all: 'Semua',
    none: 'Belum mengajukan',
    pending: 'Menunggu',
    rejected: 'Ditolak',
  },
  /** DESIGN GAP: the Bergabung options and the tablet / mobile layouts have no board. */
  joinedOptions: {
    all: 'Semua',
    '7d': '7 hari terakhir',
    '30d': '30 hari terakhir',
    '90d': '90 hari terakhir',
  },
} as const;

/** `AdmDlgUserBlock` / `AdmDlgUserUnblock`: verbatim from the boards unless noted. */
export const USER_BLOCK_COPY = {
  title: 'Block user?',
  intro: 'User tidak bisa membuka aplikasi selama diblokir.',
  /** DESIGN GAP: with no active subscription the board's second sentence is left out. */
  before: ' Langganan aktif ',
  count: (n: number) => `(${n})`,
  after: ' ditangguhkan, bukan dicabut, dan berlanjut setelah di-unblock.',
  reasonLabel: 'Alasan block (wajib)',
  reasonPlaceholder: 'Tulis alasan singkat',
  reasonHint: 'Alasan dicatat di audit log.',
  confirm: 'Block User',
} as const;

export const USER_UNBLOCK_COPY = {
  title: 'Unblock user?',
  consequence:
    'User dapat membuka aplikasi kembali. Tidak ada akses langganan yang dipulihkan secara otomatis.',
  reasonLabel: 'Alasan unblock (wajib)',
  reasonPlaceholder: 'Tulis alasan singkat',
  reasonHint: 'Alasan dicatat di audit log.',
  confirm: 'Unblock User',
} as const;

/** `AdmUsersToastUnblock` and the `AdmUserBlockedDone` toast are verbatim; the conflict toast is a gap. */
export const userUnblockedToast = (name: string) => `${name} kembali Active`;
export const userBlockedToast = (name: string) => `${name} diblokir`;
export const userConflictToast = (name: string) =>
  `Status ${name} sudah berubah. Daftar diperbarui.`;
export const USER_BLOCK_GAP_COPY = {
  loadFailed: 'Jumlah langganan belum bisa dimuat.',
  retry: 'Coba Lagi',
  failed: 'Gagal memproses. Coba lagi.',
} as const;

/** The user detail page (`AdmUserSummary`, `AdmUserBlocked`, `AdmUserRequest`, `AdmReqDetail*`): verbatim unless noted. */
export const USER_DETAIL_COPY = {
  tabs: [
    { id: 'ringkasan', label: 'Ringkasan' },
    { id: 'subscriptions', label: 'Langganan' },
    { id: 'requests', label: 'Pengajuan Creator' },
    { id: 'history', label: 'History' },
  ],
  summary: {
    profileTitle: 'Profil aplikasi',
    displayName: 'Nama tampil',
    bio: 'Bio',
    username: 'Username Telegram',
    role: 'Role',
    subsTitle: 'Ringkasan langganan',
    active: 'Langganan aktif',
    expired: 'Kedaluwarsa',
    nearest: 'Terdekat berakhir',
    manage: 'Kelola Langganan',
    requestTitle: 'Status pengajuan creator',
    submitted: 'Diajukan',
    rejected: 'Pernah ditolak',
    detail: 'Detail Pengajuan',
    privacy: 'Isi percakapan privat tidak ditampilkan di halaman detail user.',
    blockedTitle: 'Akun diblokir',
  },
  requests: {
    bannerTitle: 'Pengajuan sedang menunggu',
    search: 'Cari pengajuan',
    columns: { date: 'Diajukan', ordinal: 'Pengajuan', status: 'Status', summary: 'Ringkasan' },
    /** DESIGN GAP: the Status filter options. */
    statusOptions: { all: 'Semua', pending: 'Menunggu', rejected: 'Ditolak' },
  },
  detail: {
    back: 'Kembali ke Pengajuan Creator',
    title: 'Detail pengajuan',
    name: 'Nama creator',
    instagram: 'Instagram',
    type: 'Jenis creator',
    description: 'Deskripsi',
    rights: 'Pernyataan hak',
    rightsValue: 'Dikonfirmasi',
    reviewTitle: 'Status peninjauan',
    submitted: 'Diajukan',
    subscription: 'Pemeriksaan langganan',
    blockNote:
      'Tidak bisa disetujui sampai seluruh langganan pelanggan berakhir. Penolakan tetap bisa dilakukan dengan alasan.',
    resultTitle: 'Hasil peninjauan',
    reviewer: 'Ditinjau oleh',
    time: 'Waktu',
    reason: 'Alasan',
    viewLog: 'Lihat di Log',
  },
  /** DESIGN GAPS: no board. */
  gap: {
    blockedWithoutReason: 'Diblokir',
    bannerNoBlock: 'Pengajuan menunggu peninjauan admin.',
    notFoundTitle: 'User tidak ditemukan',
    notFoundBack: 'Kembali ke daftar user',
    loading: 'Memuat detail…',
    loadFailed: 'Detail belum bisa dimuat.',
    requestNotFound: 'Pengajuan tidak ditemukan',
    retry: 'Coba Lagi',
    subscriptionCount: (n: number) => `${n} langganan aktif`,
    backToUserHistory: 'Kembali ke History User',
    backToRequest: 'Kembali ke Detail Pengajuan',
    blockedLine: (at: string, admin: string | null, reason: string | null) =>
      `Diblokir ${at}${admin ? ` oleh ${admin}` : ''}.${reason ? ` Alasan: ${reason}.` : ''}`,
  },
} as const;

/** The Langganan tab and its dialogs (`AdmUserSubs`, `AdmDlgGrant|Extend|Revoke`): verbatim unless noted. */
export const ACCESS_COPY = {
  search: 'Cari creator',
  columns: {
    creator: 'Creator',
    status: 'Status',
    starts: 'Mulai',
    ends: 'Berakhir',
    actions: 'Aksi',
  },
  statusOptions: { all: 'Semua', active: 'Active', expired: 'Kedaluwarsa', revoked: 'Dicabut' },
  /** DESIGN GAP: the Berakhir options have no board. */
  endsOptions: {
    all: 'Semua',
    next7: '7 hari ke depan',
    next30: '30 hari ke depan',
    past: 'Sudah berakhir',
  },
  grant: 'Berikan Akses',
  regrant: 'Berikan Ulang',
  extend: 'Perpanjang',
  revoke: 'Cabut',
  note: 'Tidak ada transaksi pembayaran. Admin memberikan, memperpanjang, atau mencabut akses dengan alasan, dan setiap tindakan dicatat di audit log.',
  grantDialog: {
    title: 'Berikan akses?',
    creator: 'Creator',
    duration: 'Durasi',
    endDate: 'Tanggal berakhir',
    endHint: 'Dihitung dari hari ini. Bisa diganti dengan tanggal khusus.',
    reasonLabel: 'Alasan (wajib)',
    reasonHint: 'Alasan dicatat di audit log.',
    after:
      'User mendapat akses chat privat ke creator ini sampai tanggal berakhir. Tidak ada pembayaran. Notifikasi aktivasi dikirim lewat Telegram.',
    confirm: 'Berikan Akses',
  },
  extendDialog: {
    title: 'Perpanjang akses?',
    addDuration: 'Tambah durasi',
    endsAs: 'Berakhir menjadi',
    reasonLabel: 'Alasan (wajib)',
    reasonHint: 'Alasan dicatat di audit log.',
    after: 'Akses diperpanjang tanpa transaksi. User menerima notifikasi tanggal berakhir baru.',
    confirm: 'Perpanjang Akses',
    activeUntil: (date: string) => `Akses aktif hingga ${date}`,
  },
  revokeDialog: {
    title: 'Cabut akses?',
    before: 'Akses berakhir ',
    strong: 'sekarang',
    after:
      '. User tidak bisa mengirim pesan baru ke creator ini. Riwayat chat yang sudah diterima tetap bisa dibuka.',
    reasonLabel: 'Alasan pencabutan (wajib)',
    reasonHint: 'Alasan dicatat di audit log.',
    confirm: 'Cabut Akses',
  },
  durationOptions: [
    { value: '7', label: '7 hari' },
    { value: '30', label: '30 hari' },
    { value: '90', label: '90 hari' },
  ],
  customOption: { value: 'custom', label: 'Tanggal khusus' },
  /** The three toasts are verbatim from the boards. */
  grantedToast: (user: string, creator: string, date: string) =>
    `Akses ${user} ke ${creator} diberikan hingga ${date}`,
  extendedToast: (user: string, creator: string, date: string) =>
    `Akses ${user} ke ${creator} diperpanjang hingga ${date}`,
  revokedToast: (user: string, creator: string) => `Akses ${user} ke ${creator} dicabut`,
  /** DESIGN GAPS: no board. */
  gap: {
    conflictToast: (user: string) => `Status akses ${user} sudah berubah. Daftar diperbarui.`,
    failed: 'Gagal memproses. Coba lagi.',
    loadingCreators: 'Memuat creator…',
    creatorsFailed: 'Daftar creator belum bisa dimuat.',
    retry: 'Coba Lagi',
    noCreators: 'Tidak ada creator yang bisa diberi akses.',
    grantBlocked: 'Akun diblokir: akses tidak bisa diberikan.',
    endDateInvalid: 'Tanggal berakhir belum valid.',
  },
  /** DESIGN GAP: the Berikan Akses user picker on the creator side (no board). */
  picker: {
    label: 'User',
    search: 'Cari nama atau Telegram ID',
    empty: 'Tidak ada user yang bisa diberi akses.',
    blockedCreator: 'Creator diblokir: akses tidak bisa diberikan.',
    loading: 'Mencari…',
    failed: 'Daftar user belum bisa dimuat.',
    retry: 'Coba Lagi',
    choose: 'Pilih user',
  },
} as const;

/** The subscription detail (`AdmSubDetail`): verbatim from the board unless noted. */
export const SUB_DETAIL_COPY = {
  title: 'Detail Langganan',
  back: 'Kembali ke Langganan',
  card: (customer: string, creator: string) => `Langganan: ${customer} → ${creator}`,
  status: 'Status',
  starts: 'Mulai',
  ends: 'Berakhir',
  source: 'Sumber',
  sourceValue: 'Diberikan admin',
  createdBy: 'Dibuat oleh',
  payment: 'Pembayaran',
  paymentValue: 'Tidak ada transaksi',
  extend: 'Perpanjang',
  revoke: 'Cabut Akses',
  regrant: 'Berikan Ulang',
  eventsTitle: 'Riwayat akses',
  columns: {
    time: 'Waktu',
    actor: 'Aktor',
    action: 'Tindakan',
    summary: 'Ringkasan',
    status: 'Status',
  },
  /** DESIGN GAPS: no board. */
  gap: {
    notFound: 'Langganan tidak ditemukan',
    notFoundBack: 'Kembali ke Langganan',
    loading: 'Memuat detail…',
    loadFailed: 'Detail belum bisa dimuat.',
    retry: 'Coba Lagi',
    noLog: 'Catatan log tidak tersedia.',
    backToSubscription: 'Kembali ke Detail Langganan',
  },
} as const;

/**
 * DESIGN GAP (US-024): the pending access request banner, its reject dialog, the toasts and the
 * `/users` chip and filter have no boards. Placeholder copy built from the existing patterns.
 */
export const ACCESS_REQUEST_COPY = {
  banner: (creator: string, type: 'TRIAL' | 'RENEWAL') =>
    type === 'TRIAL'
      ? `Permintaan akses uji coba ke ${creator}`
      : `Permintaan perpanjangan akses ke ${creator}`,
  sent: 'Dikirim',
  approve: 'Setujui',
  reject: 'Tolak',
  approveBlocked: 'Akun diblokir: akses tidak bisa diberikan.',
  loadFailed: 'Permintaan akses belum bisa dimuat.',
  retry: 'Coba Lagi',
  rejectDialog: {
    title: 'Tolak permintaan akses?',
    consequence:
      'Permintaan ditolak dan dicatat di History. User bisa mengajukan lagi. Alasan dicatat di audit log.',
    reasonLabel: 'Alasan penolakan (wajib)',
    reasonPlaceholder: 'Tulis alasan singkat',
    reasonHint: 'Alasan dicatat di audit log.',
    confirm: 'Tolak Permintaan',
    failed: 'Gagal memproses. Coba lagi.',
  },
  rejectedToast: (user: string, creator: string) =>
    `Permintaan akses ${user} ke ${creator} ditolak`,
  reviewedToast: (user: string) => `Permintaan akses ${user} sudah ditinjau. Daftar diperbarui.`,
  chip: 'Permintaan akses',
  filterLabel: 'Akses',
  filterOptions: { any: 'Semua', pending: 'Menunggu' },
} as const;
