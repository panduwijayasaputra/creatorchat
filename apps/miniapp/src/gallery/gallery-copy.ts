/** Indonesian copy of `CrGallery`, `CrGalleryDone` and `CrStatesGallery`, verbatim; `gap` entries are placeholders (no board). */
export const GALLERY_COPY = {
  title: 'Galeri',
  upload: 'Upload',
  count: (n: number) => `${n} foto dan video`,
  note: 'Galeri hanya terlihat oleh subscriber aktif.',
  uploaded: 'Media berhasil diunggah ke galeri',
  empty: {
    title: 'Galeri masih kosong',
    text: 'Upload foto atau video. Media galeri hanya terlihat oleh subscriber aktif.',
  },
  failedBanner: {
    title: 'Unggahan gagal',
    network: 'Koneksi terputus saat mengunggah. Media belum masuk ke galeri.',
  },
  tile: { photo: 'Foto', video: 'Video' },
  // design gap: no board for these
  gap: {
    loadFailed: {
      title: 'Galeri gagal dimuat',
      text: 'Terjadi gangguan saat mengambil galeri. Coba lagi sebentar.',
      action: 'Coba Lagi',
    },
    moreFailed: 'Galeri belum termuat.',
    moreRetry: 'Coba lagi',
    loadingMore: 'Memuat…',
    refused: {
      type: 'Jenis file tidak didukung. Pilih foto JPEG, PNG, WebP, atau video MP4 / MOV.',
      size: (mb: number) => `File terlalu besar. Batasnya ${mb} MB.`,
    },
    rejected: {
      TYPE_NOT_ALLOWED: 'Jenis file tidak didukung. Media belum masuk ke galeri.',
      TOO_LARGE: 'File terlalu besar. Media belum masuk ke galeri.',
      TOO_LONG: 'Video terlalu panjang. Media belum masuk ke galeri.',
      UNREADABLE: 'File tidak bisa dibaca. Media belum masuk ke galeri.',
      OTHER: 'Media belum masuk ke galeri.',
    },
  },
} as const;
