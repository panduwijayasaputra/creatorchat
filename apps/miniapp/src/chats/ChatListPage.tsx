import { Link } from 'react-router';
import type { ChatListItem } from '@creatorchat/contracts';
import {
  AlertCircleIcon,
  ChatIcon,
  ChevronRightIcon,
  CompassIcon,
  RefreshIcon,
  StatusChip,
} from '@creatorchat/ui';
import type { MiniappApi } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import { previewLabel } from '../chat/preview-label';
import { formatBadge } from '../components/BottomNav';
import { formatDateTime, formatTime } from '../format/date-time';
import { CHAT_LIST_COPY as C } from './chat-list-copy';
import styles from './chat-list.module.css';
import { useChatList } from './useChatList';

/** The disc colours the boards use for different people (background, letters). */
const PALETTE = [
  { bg: '#E6C3B5', fg: '#8E5B48' },
  { bg: '#F0D3B8', fg: '#8E6B48' },
  { bg: '#D9C3D6', fg: '#6B5578' },
] as const;

function paletteFor(code: string) {
  let sum = 0;
  for (const char of code) sum += char.charCodeAt(0);
  return PALETTE[sum % PALETTE.length] ?? PALETTE[0];
}

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase() || '?';

const dayOf = (iso: string, zone: string) =>
  formatDateTime(iso, zone, { year: 'numeric', month: 'numeric', day: 'numeric' });

/** `09.14` for today in the account zone, `6 Nov` for anything older. */
function timeOf(iso: string, zone: string, now: Date): string {
  return dayOf(iso, zone) === dayOf(now.toISOString(), zone)
    ? formatTime(iso, zone)
    : formatDateTime(iso, zone, { day: 'numeric', month: 'short' });
}

function Row({ item, zone, now }: { item: ChatListItem; zone: string; now: Date }) {
  const colour = paletteFor(item.public_code);
  const last = item.last_message;
  const state =
    item.access === 'EXPIRED' ? (
      <div className={styles.chip}>
        <StatusChip status="expired" label={C.expired} />
      </div>
    ) : item.access === 'CREATOR_BLOCKED' ? (
      <div className={styles.chip}>
        <StatusChip status="expired" label={C.gap.creatorBlocked} />
      </div>
    ) : null;
  return (
    <Link to={`/chats/${item.conversation_id}`} className={styles.row}>
      <div
        className={styles.disc}
        style={{ background: colour.bg, color: colour.fg }}
        aria-hidden="true"
      >
        {item.avatar_url ? (
          <img src={item.avatar_url} alt="" referrerPolicy="no-referrer" />
        ) : (
          initialsOf(item.display_name)
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.top}>
          <span className={styles.name}>{item.display_name}</span>
          {last ? <span className={styles.time}>{timeOf(last.at, zone, now)}</span> : null}
        </div>
        <div className={styles.bottom}>
          <span className={styles.preview}>
            {last ? previewLabel(last.preview, last.media_kind) : C.gap.noMessage}
          </span>
          {item.access === 'ACTIVE' && item.unread_count > 0 ? (
            <span className={styles.badge} aria-label={C.unread(item.unread_count)}>
              {formatBadge(item.unread_count)}
            </span>
          ) : null}
        </div>
        {state}
      </div>
    </Link>
  );
}

/**
 * `Chats` (`/chats`): my conversations, newest activity first, from the server. Rows open
 * `/chats/:conversationId`. Loading, empty and error follow `StatesChats`.
 */
export function ChatListPage({ api }: { api: Pick<MiniappApi, 'listChats'> }) {
  const { state, retry, loadMore } = useChatList(api);
  const auth = useAuth();
  const zone = auth.state.status === 'authenticated' ? auth.state.user.timezone : 'Asia/Jakarta';
  const now = new Date();

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>{C.title}</h1>
      </div>
      {state.status === 'loading' ? (
        <div role="status" aria-label={C.gap.loading}>
          {[0, 1, 2, 3].map((n) => (
            <div key={n}>
              <div className={styles.skeletonRow} aria-hidden="true">
                <div className={styles.skeletonDisc} />
                <div className={styles.skeletonBars}>
                  <div className={styles.skeletonBarA} />
                  <div className={styles.skeletonBarB} />
                </div>
              </div>
              <div className={styles.divider} aria-hidden="true" />
            </div>
          ))}
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div className={styles.panel} role="alert">
          <span className={`${styles.panelDisc} ${styles.panelDiscError}`}>
            <AlertCircleIcon size={36} strokeWidth={2} />
          </span>
          <div className={styles.panelTitle}>{C.error.title}</div>
          <div className={styles.panelText}>{C.error.text}</div>
          <div className={styles.panelAction}>
            <button type="button" className={styles.primary} onClick={retry}>
              <RefreshIcon size={20} strokeWidth={2} />
              {C.error.action}
            </button>
          </div>
        </div>
      ) : null}
      {state.status === 'ready' && state.items.length === 0 ? (
        <div className={styles.panel}>
          <span className={styles.panelDisc}>
            <ChatIcon size={36} strokeWidth={2} />
          </span>
          <div className={styles.panelTitle}>{C.empty.title}</div>
          <div className={styles.panelText}>{C.empty.text}</div>
          <div className={styles.panelAction}>
            <Link to="/explore" className={styles.primary}>
              {C.empty.action}
            </Link>
          </div>
        </div>
      ) : null}
      {state.status === 'ready' && state.items.length > 0 ? (
        <>
          <ul className={styles.list}>
            {state.items.map((item) => (
              <li key={item.conversation_id}>
                <Row item={item} zone={zone} now={now} />
                <div className={styles.divider} aria-hidden="true" />
              </li>
            ))}
          </ul>
          {state.nextCursor ? (
            <div className={styles.more}>
              <button
                type="button"
                className={styles.moreButton}
                disabled={state.more === 'loading'}
                onClick={loadMore}
              >
                {state.more === 'loading' ? C.gap.loadingMore : C.gap.more}
              </button>
              {state.more === 'failed' ? (
                <p className={styles.moreError} role="alert">
                  {C.gap.moreFailed}
                </p>
              ) : null}
            </div>
          ) : null}
          <Link to="/explore" className={styles.discover}>
            <span className={styles.discoverIcon}>
              <CompassIcon size={22} strokeWidth={2} />
            </span>
            <span className={styles.discoverText}>
              <span className={styles.discoverTitle}>{C.discover.title}</span>
              <span className={styles.discoverSub}>{C.discover.text}</span>
            </span>
            <ChevronRightIcon size={20} strokeWidth={2} />
          </Link>
        </>
      ) : null}
    </main>
  );
}
