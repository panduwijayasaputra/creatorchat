import {
  AdminGalleryQuerySchema,
  DEFAULT_ADMIN_GALLERY_QUERY,
  type AdminGalleryQuery,
} from '@creatorchat/contracts';
import { adminGallerySearch } from '../../../auth/api-client';

/** Each URL value is checked alone; an invalid one falls back to its default. */
export function parseGallerySearch(params: URLSearchParams): AdminGalleryQuery {
  const raw: Record<string, string> = {};
  for (const key of Object.keys(AdminGalleryQuerySchema.shape)) {
    const value = params.get(key);
    if (value !== null && AdminGalleryQuerySchema.safeParse({ [key]: value }).success) {
      raw[key] = value;
    }
  }
  return AdminGalleryQuerySchema.parse(raw);
}

export function gallerySearchParams(query: AdminGalleryQuery): URLSearchParams {
  return new URLSearchParams(adminGallerySearch(query).slice(1));
}

export function isDefaultGalleryFilter(query: AdminGalleryQuery): boolean {
  const d = DEFAULT_ADMIN_GALLERY_QUERY;
  return query.q === null && query.kind === d.kind && query.uploaded === d.uploaded;
}

/** Filters back to default; sort and page size stay. */
export function resetGalleryFilters(query: AdminGalleryQuery): AdminGalleryQuery {
  const d = DEFAULT_ADMIN_GALLERY_QUERY;
  return { ...query, q: null, kind: d.kind, uploaded: d.uploaded, page: 1 };
}
