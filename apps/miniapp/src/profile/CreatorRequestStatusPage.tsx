import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { instagramHandle, type CreatorApplication, type CreatorType } from '@creatorchat/contracts';
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  HourglassIcon,
  InfoCircleIcon,
  RefreshIcon,
  StatusChip,
} from '@creatorchat/ui';
import type { MiniappApi } from '../auth/api-client';
import { REQUEST_GAP_COPY } from './creator-request-copy';
import styles from './creator-request-status.module.css';

const FORM_PATH = '/profile/creator-request';
const TYPE_LABEL: Record<CreatorType, string> = {
  HUMAN: 'Creator Asli',
  AI_CHARACTER: 'Karakter AI',
};

type Load =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; request: CreatorApplication | null };

function Header() {
  return (
    <header className={styles.header}>
      <Link to="/profile" className={styles.back} aria-label="Kembali">
        <ChevronLeftIcon size={24} strokeWidth={1.75} />
      </Link>
      <h1 className={styles.headerTitle}>Status permintaan</h1>
    </header>
  );
}

function Pending({ request }: { request: CreatorApplication }) {
  return (
    <div className={styles.body}>
      <div className={styles.hero}>
        <span className={`${styles.disc} ${styles.discPending}`}>
          <HourglassIcon size={36} strokeWidth={1.75} />
        </span>
        <StatusChip status="request" label="Sedang Ditinjau" />
        <p className={styles.heroText}>Hasil peninjauan akan dikirim melalui Telegram.</p>
      </div>

      <dl className={styles.values} aria-label="Isian permintaan">
        <div className={styles.row}>
          <dt className={styles.key}>Nama creator</dt>
          <dd className={styles.val}>{request.creator_name}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.key}>Instagram</dt>
          <dd className={styles.val}>{instagramHandle(request.instagram_url)}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.key}>Jenis</dt>
          <dd className={styles.val}>{TYPE_LABEL[request.creator_type]}</dd>
        </div>
        <div className={styles.rowLast}>
          <dt className={styles.key}>Deskripsi</dt>
          <dd className={styles.about}>{request.description}</dd>
        </div>
      </dl>

      <div className={styles.note}>
        <InfoCircleIcon size={18} strokeWidth={2} />
        <span>
          Akunmu tetap USER dan dapat memakai fitur pelanggan. Permintaan kedua tidak bisa dibuat
          selama masih ditinjau.
        </span>
      </div>

      <Link to="/profile" className={styles.secondary}>
        Kembali ke Profil
      </Link>
    </div>
  );
}

function Rejected({ request }: { request: CreatorApplication }) {
  return (
    <div className={styles.body}>
      <div className={styles.hero}>
        <span className={`${styles.disc} ${styles.discRejected}`}>
          <AlertCircleIcon size={36} strokeWidth={1.75} />
        </span>
        <StatusChip status="failed" label="Ditolak" />
        <p className={styles.heroText}>Permintaan menjadi creator belum bisa disetujui.</p>
      </div>

      {/* The reason is admin text: rendered as a plain text node, never as HTML. */}
      <div className={styles.reason}>
        <p className={styles.reasonLabel}>Alasan dari admin</p>
        <p className={styles.reasonText}>{request.review_reason}</p>
      </div>

      <div className={styles.note}>
        <InfoCircleIcon size={18} strokeWidth={2} />
        <span>Akunmu tetap USER. Kamu bisa memperbaiki isian lalu mengajukan lagi.</span>
      </div>

      <Link to={FORM_PATH} className={styles.primary}>
        <RefreshIcon size={20} strokeWidth={2} />
        Perbaiki dan Ajukan Lagi
      </Link>
      <Link to="/profile" className={styles.secondary}>
        Kembali ke Profil
      </Link>
    </div>
  );
}

/**
 * `RequestPending` / `RequestRejected` (USER only, no bottom navigation). The latest request comes
 * from the server on every open and no id is sent. No request, or an approved one (the account is
 * about to become a creator), goes back to the profile. The DEMO strip of the board is not built.
 */
export function CreatorRequestStatusPage({
  api,
}: {
  api: Pick<MiniappApi, 'getCreatorRequestState'>;
}) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const fetchState = useCallback(() => {
    setLoad({ status: 'loading' });
    api.getCreatorRequestState().then(
      (state) => setLoad({ status: 'ready', request: state.request }),
      () => setLoad({ status: 'failed' }),
    );
  }, [api]);
  useEffect(fetchState, [fetchState]);

  if (load.status === 'ready') {
    const { request } = load;
    if (request?.status === 'PENDING' || request?.status === 'REJECTED') {
      return (
        <div className={styles.page}>
          <Header />
          <div className={styles.scroll}>
            {request.status === 'PENDING' ? (
              <Pending request={request} />
            ) : (
              <Rejected request={request} />
            )}
          </div>
        </div>
      );
    }
    return <Navigate to="/profile" replace />;
  }

  return (
    <div className={styles.page}>
      <Header />
      {load.status === 'failed' ? (
        <div role="alert" className={styles.state}>
          <h2 className={styles.stateTitle}>{REQUEST_GAP_COPY.loadFailedTitle}</h2>
          <p className={styles.stateBody}>{REQUEST_GAP_COPY.loadFailedBody}</p>
          <button type="button" className={styles.retry} onClick={fetchState}>
            {REQUEST_GAP_COPY.retry}
          </button>
        </div>
      ) : (
        <div role="status" aria-busy="true" aria-label="Memuat" className={styles.scroll} />
      )}
    </div>
  );
}
