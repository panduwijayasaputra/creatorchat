import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { InboxFilter, InboxItem } from '@creatorchat/contracts';
import {
  AlertCircleIcon,
  ChatIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  HourglassIcon,
  RefreshIcon,
} from '@creatorchat/ui';
import { previewLabel } from '../chat/preview-label';
import type { MiniappApi } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import { BottomToast, useFlashMessage } from '../components/BottomToast';
import { copyToClipboard } from '../creator/copy-to-clipboard';
import { avatarTone, initialsOf, timeLabel } from './inbox-model';
import { INBOX_COPY as COPY } from './inbox-copy';
import { useInbox } from './useInbox';
import { useOnline } from './useOnline';
import styles from './inbox.module.css';

function Avatar({ item }: { item: InboxItem }) {
  const [failed, setFailed] = useState(false);
  const url = item.customer.avatar_url;
  return (
    <div className={styles.avatar} style={{ background: avatarTone(item.conversation_id) }}>
      {url && !failed ? (
        <img src={url} alt="" onError={() => setFailed(true)} />
      ) : (
        initialsOf(item.customer.display_name)
      )}
    </div>
  );
}

function Row({ item, timeZone }: { item: InboxItem; timeZone: string }) {
  return (
    <Link to={`/inbox/${item.conversation_id}`} className={styles.row}>
      <Avatar item={item} />
      <div className={styles.body}>
        <div className={styles.top}>
          <span className={styles.name}>{item.customer.display_name}</span>
          <span className={styles.time}>
            {timeLabel(item.last_message_at, timeZone, new Date())}
          </span>
        </div>
        <div className={styles.bottom}>
          <span className={styles.preview}>
            {previewLabel(item.preview, item.preview_media_kind)}
          </span>
          {item.unread_count > 0 ? (
            <span className={styles.badge} aria-label={COPY.unreadLabel(item.unread_count)}>
              {item.unread_count}
            </span>
          ) : null}
        </div>
        {!item.access_active ? (
          <div className={styles.tags}>
            <span className={styles.expired}>
              <ClockIcon size={16} strokeWidth={2} />
              {COPY.expired}
            </span>
          </div>
        ) : null}
      </div>
    </Link>
  );
}

function Skeleton() {
  return (
    <div role="status" aria-label="Memuat" aria-busy="true">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} aria-hidden="true">
          <div className={styles.skeletonRow}>
            <div className={styles.skeletonAvatar} />
            <div style={{ flex: 1 }}>
              <div className={styles.skeletonLine1} />
              <div className={styles.skeletonLine2} />
            </div>
          </div>
          <div className={styles.divider} />
        </div>
      ))}
    </div>
  );
}

function Chips({
  filter,
  unreadConversations,
  onChange,
}: {
  filter: InboxFilter;
  unreadConversations: number;
  onChange: (f: InboxFilter) => void;
}) {
  const unreadLabel =
    unreadConversations > 0 ? `${COPY.filters.unread} ${unreadConversations}` : COPY.filters.unread;
  return (
    <div className={styles.chips} role="group" aria-label="Filter">
      <button
        type="button"
        className={`${styles.chip} ${filter === 'all' ? styles.chipOn : ''}`}
        aria-pressed={filter === 'all'}
        onClick={() => onChange('all')}
      >
        {filter === 'all' ? <CheckIcon size={16} strokeWidth={2.4} /> : null}
        {COPY.filters.all}
      </button>
      <button
        type="button"
        className={`${styles.chip} ${filter === 'unread' ? styles.chipOn : ''}`}
        aria-pressed={filter === 'unread'}
        onClick={() => onChange('unread')}
      >
        {filter === 'unread' ? <CheckIcon size={16} strokeWidth={2.4} /> : null}
        {unreadLabel}
      </button>
    </div>
  );
}

function OfflinePanel() {
  return (
    <div className={styles.offlineWrap}>
      <div className={styles.offline} role="status">
        <span className={styles.offlineIcon}>
          <HourglassIcon size={22} strokeWidth={2} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className={styles.offlineTitle}>{COPY.offline.title}</div>
          <div className={styles.offlineText}>{COPY.offline.text}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * The creator's inbox (US-028): `CrInbox` and the four `CrStatesInbox` panels. Newest activity
 * first, server-paginated and loaded as the list scrolls. The Phase F chips and row chips, the
 * search box (a design gap) and the bottom-nav badge (US-030) are not here.
 */
export function InboxPage({ api }: { api: MiniappApi }) {
  const { state: auth } = useAuth();
  const timeZone = auth.status === 'authenticated' ? auth.user.timezone : 'Asia/Jakarta';
  const [filter, setFilter] = useState<InboxFilter>('all');
  const { state, loadMore, retry } = useInbox(api, filter);
  const online = useOnline();
  const [flash, showFlash] = useFlashMessage();
  const copying = useRef(false);

  // Load the next page when the end of the list scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  const canLoadMore =
    state.status === 'ready' && state.nextCursor !== null && state.more === 'idle';
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canLoadMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [canLoadMore, loadMore]);

  const copyLink = useCallback(async () => {
    if (copying.current) return;
    copying.current = true;
    try {
      const { bio_link: link } = await api.getCreatorSettings();
      if (!link) return showFlash(COPY.gap.linkNotConfigured);
      showFlash((await copyToClipboard(link)) ? COPY.gap.linkCopied : COPY.gap.linkCopyFailed);
    } catch {
      showFlash(COPY.gap.linkCopyFailed);
    } finally {
      copying.current = false;
    }
  }, [api, showFlash]);

  const heading = <h1 className={styles.title}>{COPY.title}</h1>;

  if (state.status === 'loading') {
    return (
      <div className={styles.page}>
        {heading}
        <Skeleton />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className={styles.page}>
        {heading}
        <div className={styles.state}>
          <span className={styles.stateIcon} style={{ background: 'var(--err-bg)' }}>
            <AlertCircleIcon size={40} strokeWidth={2} color="var(--err-fg)" />
          </span>
          <div className={styles.stateTitle}>{COPY.error.title}</div>
          <p className={styles.stateText}>{COPY.error.text}</p>
          <div className={styles.actionWrap}>
            <button type="button" className={styles.action} onClick={retry}>
              <RefreshIcon size={18} strokeWidth={2} />
              {COPY.error.action}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (filter === 'all' && state.items.length === 0) {
    return (
      <div className={styles.page}>
        {heading}
        <div className={styles.state}>
          <span className={styles.stateIcon} style={{ background: 'var(--pink)' }}>
            <ChatIcon size={36} strokeWidth={2} color="var(--rose)" />
          </span>
          <div className={styles.stateTitle}>{COPY.empty.title}</div>
          <p className={styles.stateText}>{COPY.empty.text}</p>
          <div className={styles.actionWrap}>
            <button type="button" className={styles.action} onClick={() => void copyLink()}>
              <CopyIcon size={18} strokeWidth={2} />
              {COPY.empty.action}
            </button>
          </div>
        </div>
        <BottomToast message={flash} bottom={112} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {heading}
      {!online ? <OfflinePanel /> : null}
      {online ? (
        <Chips
          filter={filter}
          unreadConversations={state.unreadConversations}
          onChange={setFilter}
        />
      ) : null}
      {state.items.length === 0 ? (
        <p className={styles.note}>{COPY.gap.noUnread}</p>
      ) : (
        <div className={`${styles.list} ${!online ? styles.dim : ''}`}>
          {state.items.map((item, index) => (
            <div key={item.conversation_id}>
              {index > 0 ? <div className={styles.divider} /> : null}
              <Row item={item} timeZone={timeZone} />
            </div>
          ))}
        </div>
      )}
      {state.more === 'loading' ? <div className={styles.more}>{COPY.gap.loadingMore}</div> : null}
      {state.more === 'failed' ? (
        <div className={styles.more}>
          {COPY.gap.moreFailed}
          <button type="button" className={styles.moreButton} onClick={loadMore}>
            {COPY.gap.moreRetry}
          </button>
        </div>
      ) : null}
      <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
      <BottomToast message={flash} bottom={112} />
    </div>
  );
}
