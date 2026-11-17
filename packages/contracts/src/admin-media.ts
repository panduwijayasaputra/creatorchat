import { z } from 'zod';
import { CREATOR_LIST_PAGE_SIZES } from './creator-list.js';
import { MediaKindSchema, MediaOriginalSchema } from './media.js';

/** The admin view of a creator's gallery (US-035): a table and one media detail. Read-only. */
const PAGE_MAX = 100_000;
export const ADMIN_GALLERY_SEARCH_MAX = 20;
export const ADMIN_GALLERY_KINDS = ['all', 'PHOTO', 'VIDEO'] as const;
export const ADMIN_GALLERY_UPLOADED = ['all', '7', '30', '90'] as const;
export const ADMIN_GALLERY_SORT_FIELDS = [
  'number',
  'kind',
  'duration',
  'size',
  'uploaded',
] as const;
export type AdminGallerySort = (typeof ADMIN_GALLERY_SORT_FIELDS)[number];
export const ADMIN_GALLERY_PAGE_SIZES = CREATOR_LIST_PAGE_SIZES;

/** Strict, snake_case; every value is validated against an allowlist. */
export const AdminGalleryQuerySchema = z.strictObject({
  q: z
    .string()
    .max(ADMIN_GALLERY_SEARCH_MAX)
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : null)),
  kind: z
    .enum(ADMIN_GALLERY_KINDS)
    .optional()
    .transform((value) => value ?? 'all'),
  uploaded: z
    .enum(ADMIN_GALLERY_UPLOADED)
    .optional()
    .transform((value) => value ?? 'all'),
  sort: z
    .enum(ADMIN_GALLERY_SORT_FIELDS)
    .optional()
    .transform((value) => value ?? 'uploaded'),
  dir: z
    .enum(['asc', 'desc'])
    .optional()
    .transform((value) => value ?? 'desc'),
  page: z
    .string()
    .regex(/^\d{1,6}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(PAGE_MAX))
    .optional()
    .transform((value) => value ?? 1),
  page_size: z
    .enum(['10', '25', '50'])
    .transform(Number)
    .optional()
    .transform((value) => value ?? 10),
});
export type AdminGalleryQuery = z.output<typeof AdminGalleryQuerySchema>;
export const DEFAULT_ADMIN_GALLERY_QUERY: AdminGalleryQuery = AdminGalleryQuerySchema.parse({});

export const AdminGalleryRowSchema = z.strictObject({
  asset_id: z.uuid(),
  /** "Media #N": the permanent per-creator gallery number. */
  number: z.int().positive(),
  kind: MediaKindSchema,
  duration_seconds: z.int().nonnegative().nullable(),
  size_bytes: z.int().nonnegative(),
  uploaded_at: z.iso.datetime(),
  thumbnail_url: z.url(),
});
export type AdminGalleryRow = z.infer<typeof AdminGalleryRowSchema>;

export const AdminGalleryResponseSchema = z.strictObject({
  items: z.array(AdminGalleryRowSchema),
  total: z.int().nonnegative(),
  page: z.int().positive(),
  page_size: z.union([z.literal(10), z.literal(25), z.literal(50)]),
});
export type AdminGalleryResponse = z.infer<typeof AdminGalleryResponseSchema>;

export const AdminMediaDetailSchema = z.strictObject({
  asset_id: z.uuid(),
  /** `med_` + the first 7 hex characters of the id (display only). */
  short_id: z.string(),
  number: z.int().positive(),
  kind: MediaKindSchema,
  duration_seconds: z.int().nonnegative().nullable(),
  size_bytes: z.int().nonnegative(),
  uploaded_at: z.iso.datetime(),
  creator: z.strictObject({ id: z.uuid(), display_name: z.string() }),
  shown_in: z.literal('GALLERY'),
  /** A 5-minute link to the file for the preview. */
  preview: MediaOriginalSchema,
  /** A video's poster; `null` for a photo. */
  poster_url: z.url().nullable(),
});
export type AdminMediaDetail = z.infer<typeof AdminMediaDetailSchema>;

export const adminCreatorGalleryPath = (creatorId: string): string =>
  `/v1/admin/creators/${encodeURIComponent(creatorId)}/gallery`;
export const adminCreatorMediaPath = (creatorId: string, assetId: string): string =>
  `${adminCreatorGalleryPath(creatorId)}/${encodeURIComponent(assetId)}`;
