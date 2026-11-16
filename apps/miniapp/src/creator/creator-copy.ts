/**
 * DESIGN GAPS (US-008): no board for these strings. Placeholder wording until the product owner
 * supplies the final copy. Everything else on the creator settings screens is verbatim from
 * `CrSettings` / `CrEditProfile`.
 */
export const CREATOR_GAP_COPY = {
  /** Toast after "Salin Link Profil" succeeded. */
  linkCopied: 'Link disalin',
  /** Toast when neither clipboard path worked. */
  linkCopyFailed: 'Link belum bisa disalin. Salin manual dari kotak di atas.',
  /** The bot username is not configured, so there is no link to show. */
  linkNotConfigured: 'Link bot belum diatur. Hubungi admin.',
  /** The settings could not be loaded. */
  loadFailedTitle: 'Pengaturan belum bisa dimuat',
  loadFailedBody: 'Periksa koneksimu, lalu coba lagi.',
  retry: 'Coba Lagi',
  /** Toast after the timezone was saved (no board covers it). */
  timezoneSaved: 'Zona waktu disimpan',
  /** Timezone save failed (no board covers it). */
  timezoneFailedTitle: 'Zona waktu belum tersimpan',
  timezoneFailedBody: 'Pilihanmu masih ada di sini. Coba simpan lagi.',
} as const;
