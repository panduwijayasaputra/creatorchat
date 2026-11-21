/**
 * Indonesian copy of `CrBroadcast`, `CrBroadcastPick`, `CrBroadcastReady`, `CrBroadcastUpload`,
 * `CrBroadcastUploadSaved`, `CrBroadcastConfirm` and `CrBroadcastDone`, verbatim. `gap` entries have
 * no board and are placeholders (see design-integration.md, Known Gaps).
 */
export const BROADCAST_COPY = {
  title: 'Broadcast',
  target: { title: 'Semua Subscriber Aktif', text: 'Target selalu seluruh subscriber aktif.' },
  empty: 'Pilih media untuk dikirim',
  gallery: 'Pilih Galeri',
  upload: 'Upload Baru',
  change: 'Ganti Media',
  fieldLabel: 'Teks pesan broadcast',
  placeholder: 'Tulis pesan broadcast',
  saveToGallery: 'Simpan juga ke galeri',
  noteGallery: 'Memakai media yang sama dari galeri. Tidak ada salinan baru.',
  noteUnchecked:
    'Tidak dicentang: media hanya tersimpan di pesan broadcast pada riwayat chat penerima. Tidak masuk ke galeri.',
  noteChecked:
    'Dicentang: file yang sama dipakai untuk broadcast dan galeri. Tidak ada salinan, dan terlihat oleh subscriber aktif.',
  send: 'Kirim Broadcast',
  confirm: {
    title: 'Kirim media ini ke seluruh subscriber aktif?',
    text: 'Setiap pelanggan menerima pesan di percakapan privatnya. Pesan yang sudah terkirim tidak bisa ditarik.',
    cancel: 'Batal',
  },
  done: 'Broadcast terkirim ke semua subscriber aktif',
  // design gap: no board for these
  gap: {
    noSubscribers: 'Belum ada subscriber aktif.',
    failed: 'Broadcast belum terkirim. Coba lagi.',
    notReady: 'Media masih diproses. Coba lagi sebentar lagi.',
    mediaGone: 'Media ini tidak bisa dikirim. Pilih media lain.',
    rateLimited: 'Terlalu banyak broadcast. Coba lagi nanti.',
    refusedType: 'Jenis file tidak didukung. Pilih foto JPEG, PNG, WebP, atau video MP4 / MOV.',
    refusedSize: (mb: number) => `File terlalu besar. Batasnya ${mb} MB.`,
    sending: 'Mengirim…',
  },
} as const;
