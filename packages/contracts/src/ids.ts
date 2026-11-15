import { z } from 'zod';

/** Telegram IDs are BigInt in the database and strings in JSON (they exceed 2^53 in theory). */
export const TelegramIdSchema = z.string().regex(/^[1-9][0-9]{0,19}$/, 'Invalid Telegram ID');
export type TelegramId = z.infer<typeof TelegramIdSchema>;

export function telegramIdToString(id: bigint): string {
  return id.toString();
}

export function parseTelegramId(value: string): bigint {
  return BigInt(TelegramIdSchema.parse(value));
}
