/**
 * DESIGN GAPS (US-010): no board for these strings. Placeholder wording until the product owner
 * supplies the final copy. Everything else on the creator request form is verbatim from
 * `CreatorRequest`, `RequestStates` and `CreatorRequestBlocked`.
 */
export const REQUEST_GAP_COPY = {
  /** The form could not load its state (the request / subscription check). */
  loadFailedTitle: 'Form belum bisa dimuat',
  loadFailedBody: 'Periksa koneksimu, lalu coba lagi.',
  retry: 'Coba Lagi',
  /** The server answered with an error (the board only shows the lost-connection text). */
  submitFailedServer: 'Terjadi kendala di server. Isianmu masih ada di sini. Coba kirim lagi.',
} as const;
