import { z } from 'zod';
import { CHAT_TEXT_MAX } from './chat.js';

/** A creator sends one photo or video, with an optional text, to every active subscriber (US-038). */
export const creatorBroadcastsPath = '/v1/creator/broadcasts';

const codePoints = (s: string) => [...s].length;

/**
 * The attachment is required (the boards have no send without media). It names a gallery asset of the
 * creator's own, or an "Upload Baru" made for a broadcast (`purpose: BROADCAST`); the server checks it.
 * `save_to_gallery` is only valid with an upload: a gallery asset is already in the gallery.
 * `client_broadcast_id` makes a retried send return the same broadcast.
 */
export const CreateBroadcastBodySchema = z.strictObject({
  client_broadcast_id: z.uuid(),
  attachment: z.strictObject({ asset_id: z.uuid() }),
  body: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => codePoints(s) >= 1, 'Pesan tidak boleh kosong.')
    .refine((s) => codePoints(s) <= CHAT_TEXT_MAX, `Pesan maksimal ${CHAT_TEXT_MAX} karakter.`)
    .optional(),
  save_to_gallery: z.boolean().default(false),
});
export type CreateBroadcastBody = z.infer<typeof CreateBroadcastBodySchema>;

export const BROADCAST_STATUSES = ['QUEUED', 'FANNING_OUT', 'COMPLETED'] as const;
export const BroadcastStatusSchema = z.enum(BROADCAST_STATUSES);

export const BroadcastSchema = z.strictObject({
  id: z.uuid(),
  status: BroadcastStatusSchema,
  created_at: z.iso.datetime(),
});
export type BroadcastView = z.infer<typeof BroadcastSchema>;
