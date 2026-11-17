import { useCallback } from 'react';
import type { MiniappApi } from '../auth/api-client';
import { ItemViewer, type ViewerItem } from '../media/ItemViewer';

/** The creator's viewer route `/gallery/:assetId` (`CrViewerPhoto`, `CrViewerVideo`), over the grid. */
export function GalleryViewer({ api }: { api: Pick<MiniappApi, 'getGalleryItem'> }) {
  const load = useCallback(
    async (assetId: string): Promise<ViewerItem> => {
      const d = await api.getGalleryItem(assetId);
      return {
        kind: d.asset.kind,
        durationSeconds: d.asset.duration_seconds,
        url: d.original.url,
        uploadedAt: d.uploaded_at,
        position: d.position,
        total: d.total,
        previousId: d.previous_id,
        nextId: d.next_id,
      };
    },
    [api],
  );
  return <ItemViewer load={load} pathFor={(id) => `/gallery/${id}`} closeTo="/gallery" />;
}
