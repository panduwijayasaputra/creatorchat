/**
 * Bot message copy. NOT designed (the bot's chat messages are outside the design handoff), so these are
 * placeholder Indonesian strings kept in one place; the product owner supplies the final wording.
 */
export const BOT_COPY = {
  welcome: 'Selamat datang di Creator Chat. Ketuk tombol di bawah untuk membuka aplikasi.',
  creatorLink: 'Ketuk tombol di bawah untuk membuka profil creator.',
  openButton: 'Buka Creator Chat',
  /** The bot's menu button label (kept short: Telegram truncates long labels). */
  menuButton: 'Buka Aplikasi',
  /**
   * Creator request result (US-013). The approved text is verbatim from the `RequestApproved` board.
   * The rejected text is NOT designed: placeholder wording until the product owner supplies it.
   */
  requestApproved:
    'Selamat, permintaanmu disetujui. Akunmu sekarang akun creator. Buka aplikasi untuk masuk ke Inbox.',
  requestRejectedIntro: 'Permintaanmu menjadi creator belum bisa disetujui.',
  requestRejectedReason: 'Alasan dari admin:',
  requestRejectedOutro: 'Kamu bisa memperbaiki isian lalu mengajukan lagi.',
} as const;
