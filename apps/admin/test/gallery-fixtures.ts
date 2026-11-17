import type {
  AdminGalleryResponse,
  AdminGalleryRow,
  AdminMediaDetail,
} from '@creatorchat/contracts';

export const GALLERY_CREATOR_ID = 'c0000000-0000-4000-8000-0000000000aa';
const MB = 1_048_576;

const row = (
  n: number,
  kind: 'PHOTO' | 'VIDEO',
  duration: number | null,
  bytes: number,
  uploaded: string,
): AdminGalleryRow => ({
  asset_id: `44444444-0000-4000-8000-${String(n).padStart(12, '0')}`,
  number: n,
  kind,
  duration_seconds: duration,
  size_bytes: bytes,
  uploaded_at: uploaded,
  thumbnail_url: `http://localhost:3000/v1/dev-storage/m/t${n}?s=x`,
});

/** The rows of the `AdmCrGallery` board (12 items in the gallery, 8 shown). */
export const GALLERY_ROWS: AdminGalleryRow[] = [
  row(12, 'PHOTO', null, Math.round(2.4 * MB), '2026-11-12T00:00:00.000Z'),
  row(11, 'VIDEO', 48, 18 * MB, '2026-11-12T00:00:00.000Z'),
  row(10, 'PHOTO', null, Math.round(1.9 * MB), '2026-11-10T00:00:00.000Z'),
  row(9, 'PHOTO', null, Math.round(2.1 * MB), '2026-11-09T00:00:00.000Z'),
  row(8, 'VIDEO', 72, 26 * MB, '2026-11-07T00:00:00.000Z'),
  row(7, 'PHOTO', null, Math.round(2.8 * MB), '2026-11-05T00:00:00.000Z'),
  row(6, 'PHOTO', null, Math.round(2.0 * MB), '2026-11-02T00:00:00.000Z'),
  row(5, 'VIDEO', 36, 14 * MB, '2026-10-30T00:00:00.000Z'),
];

export const galleryPage = (
  items: AdminGalleryRow[],
  over: Partial<AdminGalleryResponse> = {},
): AdminGalleryResponse => ({ items, total: 12, page: 1, page_size: 10, ...over });

/** `AdmMediaDetail`: Media #11, a 48 s video. */
export const MEDIA_DETAIL: AdminMediaDetail = {
  asset_id: '44444444-0000-4000-8000-000000000011',
  short_id: 'med_8f21c04',
  number: 11,
  kind: 'VIDEO',
  duration_seconds: 48,
  size_bytes: 18 * MB,
  uploaded_at: '2026-11-11T23:41:00.000Z',
  creator: { id: GALLERY_CREATOR_ID, display_name: 'Salsa Maheswari' },
  shown_in: 'GALLERY',
  preview: {
    url: 'http://localhost:3000/v1/dev-storage/m/o11?s=x',
    expires_at: '2026-11-18T03:05:00.000Z',
  },
  poster_url: 'http://localhost:3000/v1/dev-storage/m/t11?s=x',
};
