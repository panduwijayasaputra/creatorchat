/** Indonesian copy of `CrAttach`, `CrChatPick`, `CrChatPreview`, `CrChatUpload`, `CrChatSent`, verbatim; `gap` entries are placeholders. */
export const ATTACH_COPY = {
  sheetTitle: (firstName: string) => `Kirim media ke ${firstName}`,
  gallery: { title: 'Pilih Galeri', text: 'Memakai file yang sama, tanpa salinan' },
  upload: {
    title: 'Upload Baru',
    text: 'Hanya tersimpan di percakapan ini, tidak masuk galeri',
  },
  back: 'Kembali',
  pick: {
    title: 'Pilih Galeri',
    hint: 'Pilih satu foto atau video dari galeri.',
    selected: '1 media dipilih',
    next: 'Lanjut',
  },
  preview: {
    title: (name: string) => `Kirim ke ${name}`,
    change: 'Ganti',
    placeholder: 'Tulis pesan (opsional)',
    fieldLabel: 'Teks pesan',
    send: 'Kirim',
    galleryNote: 'Memakai media yang sama dari galeri. Tidak ada salinan baru.',
    chatNote:
      'Media ini hanya tersimpan di percakapan ini. Tidak masuk ke galeri dan tidak tersedia untuk pelanggan lain.',
  },
  sent: 'Media terkirim',
  // design gap: no board for these
  gap: {
    nothingPicked: 'Belum ada media dipilih',
    emptyPicker: 'Galeri masih kosong',
    emptyPickerText: 'Upload foto atau video ke galeri dulu, atau pakai Upload Baru.',
    pickFailed: 'Galeri gagal dimuat.',
    pickRetry: 'Coba Lagi',
    loadingMore: 'Memuat…',
    uploadFailed: 'Unggahan gagal',
    uploadFailedNetwork: 'Koneksi terputus saat mengunggah. Coba lagi.',
    uploadFailedRejected: 'File ini tidak bisa dikirim. Pilih file lain.',
    refusedType: 'Jenis file tidak didukung. Pilih foto JPEG, PNG, WebP, atau video MP4 / MOV.',
    refusedSize: (mb: number) => `File terlalu besar. Batasnya ${mb} MB.`,
    retry: 'Coba Lagi',
    preparing: 'Menyiapkan…',
  },
} as const;
