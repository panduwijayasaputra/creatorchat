/**
 * Indonesian copy of `CrWelcome`, `CrWelcomePick`, `CrWelcomeGallery` and `CrWelcomeUpload`, verbatim.
 * `gap` entries have no board and are placeholders (see design-integration.md, Known Gaps).
 */
export const WELCOME_COPY = {
  title: 'Pesan selamat datang',
  back: 'Kembali',
  switchTitle: 'Kirim pesan selamat datang',
  switchOn: 'Aktif. Dikirim sekali saat seseorang baru subscribe.',
  switchLabel: 'Pesan selamat datang aktif',
  bodyLabel: 'Isi pesan',
  bodyHint: 'Pesan ini muncul di chat privat pelanggan baru, ditulis atas namamu.',
  mediaLabel: 'Media (opsional)',
  noMedia: 'Belum ada media',
  gallery: 'Pilih Galeri',
  upload: 'Upload Baru',
  remove: 'Hapus Media',
  change: 'Ganti Media',
  noteGallery: 'Memakai media yang sama dari galeri. Tidak ada salinan baru.',
  noteUpload: 'Media ini hanya tersimpan di pesan selamat datang. Tidak masuk ke galeri.',
  previewLabel: 'Tampilan di chat pelanggan (seperti pesan biasa darimu)',
  previewTime: '09.00',
  footnote:
    'Dikirim sekali untuk setiap pelanggan yang baru subscribe. Tidak dikirim ulang saat perpanjangan. Tampil sebagai pesan biasa darimu, tanpa label apa pun, dan tidak mengubah mode AI atau Manual.',
  save: 'Simpan Pesan',
  // design gap: no board for these
  gap: {
    switchOff: 'Mati. Tidak dikirim ke subscriber baru.',
    saved: 'Pesan selamat datang disimpan.',
    saving: 'Menyimpan…',
    saveFailed: 'Pesan belum tersimpan. Isianmu masih ada di sini. Coba simpan lagi.',
    mediaGone: 'Media ini tidak bisa dipakai. Pilih media lain.',
    notReady: 'Media masih diproses. Coba lagi sebentar lagi.',
    loadFailed: 'Pesan selamat datang belum termuat.',
    retry: 'Coba Lagi',
    loading: 'Memuat…',
  },
} as const;
