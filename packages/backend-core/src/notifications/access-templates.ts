/**
 * The default Telegram texts for access notifications, verbatim from the `AdmSetNotif` board. They
 * live in one place so the admin settings (Phase G) can later make them editable. `{nama}`,
 * `{creator}` and `{tanggal}` are filled in by `renderTemplate`.
 */
export const ACCESS_TEMPLATES = {
  activated: 'Halo {nama}, aksesmu ke {creator} sudah aktif sampai {tanggal}. Selamat mengobrol.',
  reminder:
    'Halo {nama}, aksesmu ke {creator} berakhir {tanggal}. Hubungi admin bila ingin memperpanjang.',
  ended: 'Halo {nama}, aksesmu ke {creator} sudah berakhir. Terima kasih sudah bergabung.',
} as const;

export interface TemplateVariables {
  nama: string;
  creator: string;
  tanggal?: string;
}

/**
 * Replaces the three known variables in one pass, so a name that itself contains `{creator}` is not
 * expanded again. Anything else in braces is left as written.
 */
export function renderTemplate(template: string, vars: TemplateVariables): string {
  return template.replace(
    /\{(nama|creator|tanggal)\}/g,
    (match, key: keyof TemplateVariables) => vars[key] ?? match,
  );
}
