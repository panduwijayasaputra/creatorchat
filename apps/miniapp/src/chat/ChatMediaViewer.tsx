import { useCallback } from 'react';
import { useParams } from 'react-router';
import { Avatar } from '@creatorchat/ui';
import { useAuth } from '../auth/AuthProvider';
import type { MiniappApi } from '../auth/api-client';
import { formatTime, zoneLabel } from '../format/date-time';
import { ItemViewer, type ViewerItem } from '../media/ItemViewer';
import styles from '../media/media-viewer.module.css';
import { dayLabel } from './chat-model';

/**
 * The customer's viewer for a file of the chat (`MediaPhoto`, `MediaVideo`) at
 * `/chats/:conversationId/media/:attachmentId`, drawn over the conversation. "n / N" counts the
 * conversation's files, oldest first. The footer shows the message text, the creator and when it was
 * sent. Received files open after the access ended too.
 */
export function ChatMediaViewer({ api }: { api: Pick<MiniappApi, 'getChatMediaItem'> }) {
  const { conversationId = '' } = useParams();
  const { state: auth } = useAuth();
  const timeZone = auth.status === 'authenticated' ? auth.user.timezone : 'Asia/Jakarta';

  const load = useCallback(
    async (attachmentId: string): Promise<ViewerItem> => {
      const d = await api.getChatMediaItem(conversationId, attachmentId);
      const when = `${dayLabel(d.message.created_at, timeZone, new Date())}, ${formatTime(d.message.created_at, timeZone)} ${zoneLabel(timeZone)}`;
      return {
        kind: d.item.kind,
        durationSeconds: d.item.duration_seconds,
        url: d.original.url,
        uploadedAt: d.message.created_at,
        position: d.position,
        total: d.total,
        previousId: d.previous_id,
        nextId: d.next_id,
        footer: (
          <div className={styles.chatFooter}>
            <Avatar size={40} src={null} />
            <div>
              {d.message.body ? (
                <div className={styles.chatFooterTitle}>{d.message.body}</div>
              ) : null}
              <div className={styles.chatFooterMeta}>{`${d.creator.display_name} · ${when}`}</div>
            </div>
          </div>
        ),
      };
    },
    [api, conversationId, timeZone],
  );

  return (
    <ItemViewer
      load={load}
      paramName="attachmentId"
      pathFor={(id) => `/chats/${conversationId}/media/${id}`}
      closeTo={`/chats/${conversationId}`}
    />
  );
}
