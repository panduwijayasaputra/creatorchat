import { z } from 'zod';

/** Creator media upload and gallery (US-032). Photos and videos only; the server owns every key. */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime'] as const;
export const MEDIA_TYPES = [...PHOTO_TYPES, ...VIDEO_TYPES] as const;

export const CREATOR_MEDIA_LIMITS_PATH = '/v1/creator/media/limits';
export const CREATOR_MEDIA_UPLOADS_PATH = '/v1/creator/media/uploads';
export const creatorMediaCompletePath = (assetId: string): string =>
  `/v1/creator/media/uploads/${encodeURIComponent(assetId)}/complete`;
export const creatorMediaPath = (assetId: string): string =>
  `/v1/creator/media/${encodeURIComponent(assetId)}`;
export const CREATOR_GALLERY_PATH = '/v1/creator/gallery';
export const creatorGalleryItemPath = (assetId: string): string =>
  `/v1/creator/gallery/${encodeURIComponent(assetId)}`;

export const MediaKindSchema = z.enum(['PHOTO', 'VIDEO']);
export type MediaKind = z.infer<typeof MediaKindSchema>;
export const MediaStateSchema = z.enum(['PENDING', 'PROCESSING', 'READY', 'FAILED']);
export type MediaState = z.infer<typeof MediaStateSchema>;
export const MediaFailureSchema = z.enum([
  'TYPE_NOT_ALLOWED',
  'TOO_LARGE',
  'TOO_LONG',
  'UNREADABLE',
  'UPLOAD_MISSING',
]);
export type MediaFailure = z.infer<typeof MediaFailureSchema>;

export const isPhotoType = (type: string): boolean =>
  (PHOTO_TYPES as readonly string[]).includes(type);

export const MEDIA_PURPOSES = ['GALLERY', 'CHAT', 'BROADCAST', 'WELCOME'] as const;

export const MediaUploadInitBodySchema = z
  .strictObject({
    client_upload_id: z.uuid(),
    kind: MediaKindSchema,
    content_type: z.enum(MEDIA_TYPES),
    size_bytes: z.int().positive(),
    /** `CHAT` is "Upload Baru" in a conversation: it never reaches the gallery (US-036). */
    purpose: z.enum(MEDIA_PURPOSES).default('GALLERY'),
    /**
     * `BROADCAST` / `WELCOME` are "Upload Baru" in a broadcast (US-038) or the welcome message
     * (US-040): never in the gallery by themselves.
     * Required for `CHAT` (the conversation the file is for), not allowed for the others.
     */
    conversation_id: z.uuid().optional(),
  })
  .refine((b) => (b.kind === 'PHOTO') === isPhotoType(b.content_type), {
    path: ['content_type'],
    message: 'content_type does not match kind',
  })
  .refine((b) => (b.purpose === 'CHAT') === (b.conversation_id !== undefined), {
    path: ['conversation_id'],
    message: 'conversation_id is required for CHAT and not allowed otherwise',
  });
export type MediaUploadInitBody = z.infer<typeof MediaUploadInitBodySchema>;

/** What a client may know about an asset: never a storage key. */
export const MediaAssetViewSchema = z.strictObject({
  id: z.uuid(),
  kind: MediaKindSchema,
  state: MediaStateSchema,
  failure: MediaFailureSchema.nullable(),
  duration_seconds: z.int().nonnegative().nullable(),
  /** Short-lived signed link; READY only. */
  thumbnail_url: z.url().nullable(),
  created_at: z.iso.datetime(),
});
export type MediaAssetView = z.infer<typeof MediaAssetViewSchema>;

export const MediaUploadInitResponseSchema = z.strictObject({
  asset: MediaAssetViewSchema,
  /** `null` once the asset has left PENDING (nothing more to upload). */
  upload: z
    .strictObject({
      url: z.url(),
      method: z.literal('PUT'),
      headers: z.record(z.string(), z.string()),
      expires_at: z.iso.datetime(),
    })
    .nullable(),
});
export type MediaUploadInitResponse = z.infer<typeof MediaUploadInitResponseSchema>;

export const MediaAssetResponseSchema = z.strictObject({ asset: MediaAssetViewSchema });
export type MediaAssetResponse = z.infer<typeof MediaAssetResponseSchema>;

export const MediaLimitsSchema = z.strictObject({
  photo_max_bytes: z.int().positive(),
  video_max_bytes: z.int().positive(),
  video_max_seconds: z.int().positive(),
});
export type MediaLimits = z.infer<typeof MediaLimitsSchema>;

export const CreatorGalleryQuerySchema = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(30),
});
export type CreatorGalleryQuery = z.infer<typeof CreatorGalleryQuerySchema>;

export const CreatorGalleryItemSchema = z.strictObject({
  asset: MediaAssetViewSchema,
  added_at: z.iso.datetime(),
});
export type CreatorGalleryItem = z.infer<typeof CreatorGalleryItemSchema>;

export const CreatorGalleryResponseSchema = z.strictObject({
  /** Newest first. */
  items: z.array(CreatorGalleryItemSchema),
  total: z.int().nonnegative(),
  next_cursor: z.string().nullable(),
});
export type CreatorGalleryResponse = z.infer<typeof CreatorGalleryResponseSchema>;

/** A short-lived signed link to the file itself (5 minutes); never stored by clients. */
export const MediaOriginalSchema = z.strictObject({ url: z.url(), expires_at: z.iso.datetime() });
export type MediaOriginal = z.infer<typeof MediaOriginalSchema>;

/** One gallery item for the viewer (US-033): the file link, its place in the gallery and its neighbours. */
export const CreatorGalleryItemDetailSchema = z.strictObject({
  asset: MediaAssetViewSchema,
  original: MediaOriginalSchema,
  uploaded_at: z.iso.datetime(),
  /** 1 = newest. */
  position: z.int().positive(),
  total: z.int().positive(),
  /** The next newer item. */
  previous_id: z.uuid().nullable(),
  /** The next older item. */
  next_id: z.uuid().nullable(),
});
export type CreatorGalleryItemDetail = z.infer<typeof CreatorGalleryItemDetailSchema>;

/** What a subscriber may know of a gallery item: no state, failure or storage key. */
export const PublicMediaItemSchema = z.strictObject({
  id: z.uuid(),
  kind: MediaKindSchema,
  duration_seconds: z.int().nonnegative().nullable(),
  thumbnail_url: z.url(),
});
export type PublicMediaItem = z.infer<typeof PublicMediaItemSchema>;

export const CustomerGalleryQuerySchema = CreatorGalleryQuerySchema;
export type CustomerGalleryQuery = CreatorGalleryQuery;

export const CustomerGalleryResponseSchema = z.strictObject({
  /** Newest first. */
  items: z.array(PublicMediaItemSchema),
  total: z.int().nonnegative(),
  next_cursor: z.string().nullable(),
});
export type CustomerGalleryResponse = z.infer<typeof CustomerGalleryResponseSchema>;

export const CustomerGalleryItemDetailSchema = z.strictObject({
  item: PublicMediaItemSchema,
  original: MediaOriginalSchema,
  uploaded_at: z.iso.datetime(),
  position: z.int().positive(),
  total: z.int().positive(),
  previous_id: z.uuid().nullable(),
  next_id: z.uuid().nullable(),
});
export type CustomerGalleryItemDetail = z.infer<typeof CustomerGalleryItemDetailSchema>;

/** A customer's view of a creator's gallery (US-034); only for active subscribers. */
export const customerGalleryPath = (publicCode: string): string =>
  `/v1/creators/by-code/${encodeURIComponent(publicCode)}/gallery`;
export const customerGalleryItemPath = (publicCode: string, assetId: string): string =>
  `${customerGalleryPath(publicCode)}/${encodeURIComponent(assetId)}`;
