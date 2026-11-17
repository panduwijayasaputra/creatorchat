/**
 * Copy for the creator review dialogs. Everything is verbatim from the boards (`AdmDlgApprove*`,
 * `AdmDlgReject*`, `AdmCrApproved`, `AdmCreatorsToastRej`) except `REVIEW_GAP_COPY`, which has no board
 * (placeholder wording until the product owner supplies it).
 */
export const APPROVE_COPY = {
  title: 'Setujui permintaan creator?',
  confirm: 'Setujui Creator',
  pending: 'Memproses…',
  failTitle: 'Tidak bisa disetujui',
  failNote: 'Kamu masih bisa menolak permintaan dengan alasan.',
  notify: 'Pemberitahuan dikirim ke user melalui bot Telegram. Tindakan dicatat di audit log.',
} as const;

export const REJECT_COPY = {
  title: 'Tolak permintaan creator?',
  consequence:
    'Permintaan ditolak dan dicatat di History. Akun tetap USER dan dapat mengajukan lagi. Alasan dikirim ke user melalui Telegram.',
  reasonLabel: 'Alasan penolakan (wajib)',
  reasonPlaceholder: 'Tulis alasan singkat',
  reasonHint: 'Alasan dicatat di audit log.',
  confirm: 'Tolak Permintaan',
} as const;

export const BLOCK_COPY = {
  title: 'Block creator?',
  /** `{count}` is rendered bold by the dialog: "58 subscriber aktif". */
  before: 'Akses creator dinonaktifkan: percakapan baru dan balasan AI dihentikan, dan ',
  after: ' kehilangan akses selama diblokir. Riwayat dan data tetap tersimpan.',
  count: (n: number) => `${n} subscriber aktif`,
  reasonLabel: 'Alasan block (wajib)',
  reasonPlaceholder: 'Tulis alasan singkat',
  reasonHint: 'Alasan dicatat di audit log.',
  confirm: 'Block Creator',
} as const;

export const UNBLOCK_COPY = {
  title: 'Unblock creator?',
  consequence:
    'Creator kembali Active. Subscriber lama tidak otomatis mendapat akses kembali. Akses harus diberikan ulang oleh admin.',
  reasonLabel: 'Alasan unblock (wajib)',
  reasonPlaceholder: 'Tulis alasan singkat',
  reasonHint: 'Alasan dicatat di audit log.',
  confirm: 'Unblock Creator',
} as const;

/** `AdmCreatorsToastUnblock` is verbatim; the block toast has no board (DESIGN GAP, placeholder). */
export const unblockedToast = (name: string) => `${name} kembali Active`;
export const blockedToast = (name: string) => `${name} diblokir.`;
/** DESIGN GAP: another admin changed the status first (409 CREATOR_STATUS_CONFLICT). */
export const statusConflictToast = (name: string) =>
  `Status ${name} sudah berubah. Daftar diperbarui.`;
export const BLOCK_GAP_COPY = {
  loadFailed: 'Jumlah subscriber belum bisa dimuat.',
  retry: 'Coba Lagi',
  failed: 'Gagal memproses. Coba lagi.',
} as const;

/** Host-page messages (shown by the creator list / detail once they exist: US-014, US-015). */
export const rejectedToast = (name: string) => `Permintaan ${name} ditolak dan dicatat`;
export const approvedBanner = (name: string) => `${name} kini Creator Active`;

/** DESIGN GAPS: no board for these. */
export const REVIEW_GAP_COPY = {
  loading: 'Memuat permintaan…',
  loadFailed: 'Permintaan belum bisa dimuat.',
  retry: 'Coba Lagi',
  /** The account is blocked or no longer a plain user (409 ACCOUNT_NOT_ELIGIBLE). */
  notEligible: 'Akun ini tidak bisa disetujui karena diblokir atau bukan akun USER.',
  /** Any other failure of the decision call (the thrown message is never shown). */
  failed: 'Gagal memproses. Coba lagi.',
} as const;

/** The Creator list (`AdmCreators*`, `AdmTableStates`): verbatim from the boards unless noted. */
export const LIST_COPY = {
  intro:
    'Default menampilkan request menunggu serta creator Active dan Blocked. Pengajuan yang ditolak tercatat di History dan detail user.',
  search: 'Cari nama atau Telegram ID',
  searchMobile: 'Cari creator',
  filterMobile: 'Filter',
  scrollHint: 'Geser tabel ke samping untuk melihat seluruh kolom.',
  activeSubscription: 'Langganan aktif',
  /** DESIGN GAP: the Tanggal options and the mobile filter panel have no board. */
  dateOptions: {
    all: 'Semua',
    '7d': '7 hari terakhir',
    '30d': '30 hari terakhir',
    '90d': '90 hari terakhir',
  },
  typeOptions: { all: 'Semua', human: 'Creator Asli', ai_character: 'Karakter AI' },
} as const;

/** The creator detail page (`AdmCrReq`, `AdmCrActive`, `AdmCrBlocked`): verbatim from the boards unless noted. */
export const DETAIL_COPY = {
  title: 'Detail Creator',
  tabs: [
    { id: 'ringkasan', label: 'Ringkasan' },
    { id: 'subscribers', label: 'Subscriber' },
    { id: 'gallery', label: 'Galeri' },
    { id: 'persona', label: 'Persona AI' },
    { id: 'history', label: 'History' },
  ],
  request: {
    descriptionTitle: 'Deskripsi pengajuan',
    name: 'Nama creator',
    instagram: 'Instagram',
    type: 'Jenis creator',
    rights: 'Pernyataan hak',
    rightsValue: 'Dikonfirmasi: berhak mengelola identitas dan konten.',
    checkTitle: 'Pemeriksaan sebelum menyetujui',
    subscription: 'Langganan pelanggan aktif',
    none: 'Tidak ada',
    role: 'Role saat ini',
    history: 'Riwayat pengajuan',
    first: 'Pertama kali',
    note: 'Pemeriksaan diulang saat Setujui ditekan. Persetujuan mengubah role akun yang sama.',
  },
  creator: {
    subscribers: 'Subscriber aktif',
    conversations: 'Percakapan',
    messages: 'Pesan',
    media: 'Media galeri',
    bioTitle: 'Bio dan deskripsi pengajuan',
    instagram: 'Instagram',
    aiTitle: 'Ringkasan penggunaan AI',
    aiRange: '30 hari terakhir',
    aiRows: ['Request AI', 'Token', 'Estimasi biaya', 'Tingkat gagal'],
    aiButton: 'Lihat Usage',
  },
  dateLabels: { request: 'Diajukan', active: 'Aktif sejak', blocked: 'Diblokir' },
  /** DESIGN GAPS: no board. */
  gap: {
    /** Earlier rejections, e.g. "Ditolak 2 kali sebelumnya". */
    rejections: (n: number) => `Ditolak ${n} kali sebelumnya`,
    subscriptionCount: (n: number) => `${n} aktif`,
    subscriptionUntil: (creator: string, date: string) => `${creator}, hingga ${date}`,
    notFoundTitle: 'Creator tidak ditemukan',
    notFoundBack: 'Kembali ke daftar creator',
    loading: 'Memuat detail…',
    loadFailed: 'Detail belum bisa dimuat.',
    retry: 'Coba Lagi',
    inertUsage: 'Tersedia di pembaruan berikutnya',
  },
} as const;

/** History tab (`AdmCrHistory`) and Detail Log (`AdmLogDetail`). */
export const HISTORY_COPY = {
  search: 'Cari tindakan',
  /** DESIGN GAP: the Jenis options have no board. */
  typeOptions: { all: 'Semua', account: 'Akun', application: 'Pengajuan', access: 'Akses' },
  statusOptions: { all: 'Semua', success: 'Berhasil', failed: 'Gagal' },
  /** DESIGN GAP: back-link wording from a person's History. */
  backToCreatorHistory: 'Kembali ke History Creator',
  backToUserHistory: 'Kembali ke History User',
} as const;

export const LOG_COPY = {
  title: 'Detail Log',
  back: 'Kembali ke Audit Admin',
  summaryTitle: 'Ringkasan kejadian',
  fullTime: 'Waktu lengkap',
  actor: 'Aktor',
  kind: 'Jenis',
  target: 'Target',
  status: 'Status',
  summary: 'Ringkasan',
  reason: 'Alasan',
  requestId: 'Request ID',
  changesTitle: 'Nilai sebelum dan sesudah',
  before: 'SEBELUM',
  after: 'SESUDAH',
  privacy: 'Password, token, API key, dan isi pesan pribadi tidak pernah dicatat di log.',
  immutable: 'Entri audit tidak bisa diubah atau dihapus.',
  /** DESIGN GAPS. */
  notFoundTitle: 'Log tidak ditemukan',
  loadFailed: 'Log belum bisa dimuat.',
  retry: 'Coba Lagi',
  noChanges: '–',
} as const;

/** The creator's Subscriber tab (`AdmCrSubs`): verbatim from the board unless noted. */
export const SUBSCRIBERS_COPY = {
  search: 'Cari nama atau Telegram ID',
  columns: {
    subscriber: 'Subscriber',
    telegram: 'Telegram',
    status: 'Status akses',
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
  extend: 'Perpanjang',
  revoke: 'Cabut',
  regrant: 'Berikan Ulang',
  gap: {
    grantBlocked: 'Creator diblokir: akses tidak bisa diberikan.',
    requestEmpty: 'Belum ada subscriber. Pengajuan ini belum menjadi creator.',
  },
} as const;

/** The creator's Galeri tab and the media detail (`AdmCrGallery`, `AdmMediaDetail`): verbatim from the boards unless noted. */
export const GALLERY_COPY = {
  note: 'Hanya media galeri yang tampil di sini. Lampiran chat privat tidak ditampilkan dan tidak bisa dibuka secara massal.',
  search: 'Cari media',
  kindLabel: 'Jenis',
  uploadedLabel: 'Diunggah',
  kindOptions: { all: 'Semua', PHOTO: 'Foto', VIDEO: 'Video' },
  /** DESIGN GAP: the Diunggah options have no board (same placeholders as the other date filters). */
  uploadedOptions: {
    all: 'Semua',
    '7': '7 hari terakhir',
    '30': '30 hari terakhir',
    '90': '90 hari terakhir',
  },
  columns: {
    thumbnail: 'Thumbnail',
    kind: 'Jenis',
    duration: 'Durasi',
    size: 'Ukuran',
    uploaded: 'Diunggah',
    actions: 'Aksi',
  },
  number: (n: number) => `Media #${n}`,
  kind: { PHOTO: 'Foto', VIDEO: 'Video' },
  detail: {
    title: 'Detail Media',
    back: 'Kembali ke Galeri',
    info: 'Informasi media',
    rows: {
      kind: 'Jenis',
      duration: 'Durasi',
      size: 'Ukuran',
      uploaded: 'Diunggah',
      creator: 'Creator',
      shownIn: 'Tampil di',
      id: 'ID media',
    },
    shownIn: 'Galeri, untuk subscriber aktif',
    note: 'Tampilan admin hanya untuk media galeri. Lampiran chat privat tidak bisa dibuka dari sini.',
  },
  /** DESIGN GAPS: no board. */
  gap: {
    notFound: 'Media tidak ditemukan',
    loading: 'Memuat media…',
    loadFailed: 'Media belum bisa dimuat.',
    retry: 'Coba Lagi',
    previewFailed: 'Pratinjau belum bisa dimuat.',
  },
} as const;
