/**
 * DESIGN GAPS (US-007): there is no board for these. Placeholder wording, kept in one place until
 * the product owner supplies the final copy. Everything else on the profile screens is verbatim
 * from the `Profile`, `EditProfile` and `EditStates` boards.
 */
export const PROFILE_GAP_COPY = {
  /** "Ganti Foto" tap: avatar upload ships with the media phase (Phase D). */
  changePhotoSoon: 'Ganti foto belum tersedia.',
  /** "Kebijakan Privasi" tap: the page is not designed yet. */
  privacyPolicySoon: 'Kebijakan Privasi belum tersedia.',
  /** A Notifikasi switch could not be saved (US-043); the switch goes back to its saved state. */
  notificationSaveFailed: 'Pengaturan belum tersimpan.',
  /** Edit save failed with a server response (EditStates 4 only covers a lost connection). */
  saveFailedServer: 'Terjadi kendala di server. Isianmu masih ada di sini. Coba simpan lagi.',
} as const;
