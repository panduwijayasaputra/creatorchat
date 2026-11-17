import { useCallback } from 'react';
import { useOutletContext, useParams } from 'react-router';
import type { MiniappApi } from '../auth/api-client';
import { ItemViewer, type ViewerItem } from '../media/ItemViewer';

/** What the profile page hands to the viewer drawn over it. */
export interface ProfileOutletContext {
  displayName: string;
  /** Access ended while browsing: refetch the profile so the locked panel takes over. */
  onAccessLost: () => void;
}

/**
 * A subscriber's viewer at `/creators/:publicCode/gallery/:assetId`, over the profile (which stays
 * mounted). Footer "{creator} · Diunggah {date}" is a placeholder (the board shows the chat viewer's).
 */
export function CustomerGalleryViewer({
  api,
}: {
  api: Pick<MiniappApi, 'getCustomerGalleryItem'>;
}) {
  const { publicCode = '' } = useParams();
  const { displayName, onAccessLost } = useOutletContext<ProfileOutletContext>();
  const load = useCallback(
    async (assetId: string): Promise<ViewerItem> => {
      const d = await api.getCustomerGalleryItem(publicCode, assetId);
      return {
        kind: d.item.kind,
        durationSeconds: d.item.duration_seconds,
        url: d.original.url,
        uploadedAt: d.uploaded_at,
        position: d.position,
        total: d.total,
        previousId: d.previous_id,
        nextId: d.next_id,
      };
    },
    [api, publicCode],
  );
  return (
    <ItemViewer
      load={load}
      pathFor={(id) => `/creators/${publicCode}/gallery/${id}`}
      closeTo={`/creators/${publicCode}`}
      footerPrefix={`${displayName} · `}
      onAccessLost={onAccessLost}
    />
  );
}
