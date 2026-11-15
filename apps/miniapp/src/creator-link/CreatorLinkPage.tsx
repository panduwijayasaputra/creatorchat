import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { CreatorLinkResponse } from '@creatorchat/contracts';
import { Button, ChevronLeftIcon, InfoCircleIcon, UserOffIcon } from '@creatorchat/ui';
import { ApiError, type MiniappApi } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import { ErrorScreen } from '../auth/screens/AuthGate';
import { NotImplemented } from '../components/NotImplemented';
import styles from './creator-link.module.css';

type Lookup =
  | { status: 'loading' }
  | { status: 'found'; creator: CreatorLinkResponse }
  | { status: 'unavailable' }
  | { status: 'customers-only' }
  | { status: 'error' };

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <div className={styles.back}>
      <button type="button" className={styles.backLink} aria-label="Kembali" onClick={onClick}>
        <ChevronLeftIcon size={24} strokeWidth={1.75} />
      </button>
    </div>
  );
}

/** StatesProfile → "Creator tidak tersedia" (unknown, malformed, blocked or inactive creator). */
export function CreatorUnavailable({
  onExplore,
  onBack,
}: {
  onExplore: () => void;
  onBack: () => void;
}) {
  return (
    <main className={styles.page}>
      <BackButton onClick={onBack} />
      <div className={styles.center}>
        <span className={styles.disc}>
          <UserOffIcon size={40} strokeWidth={1.75} />
        </span>
        <h1 className={styles.title}>Creator tidak tersedia</h1>
        <p className={styles.text}>Profil ini sedang tidak bisa dibuka atau sudah tidak aktif.</p>
        <div className={styles.action}>
          <Button size="lg" fullWidth onClick={onExplore}>
            Kembali ke Jelajahi
          </Button>
        </div>
      </div>
    </main>
  );
}

/**
 * DESIGN GAP: "a CREATOR opened another creator's link" is not designed. This is a neutral
 * placeholder built from existing pieces, not a final screen. Placeholder copy.
 */
export function CustomersOnly({ onInbox }: { onInbox: () => void }) {
  return (
    <main className={styles.page}>
      <div className={styles.center}>
        <span className={styles.disc}>
          <InfoCircleIcon size={40} strokeWidth={1.75} />
        </span>
        <h1 className={styles.title}>Link ini untuk pelanggan</h1>
        <p className={styles.text}>Kamu masuk sebagai creator.</p>
        <div className={styles.action}>
          <Button size="lg" fullWidth onClick={onInbox}>
            Ke Inbox
          </Button>
        </div>
      </div>
    </main>
  );
}

/**
 * Landing for `/creators/:publicCode`. The code only picks a destination: the server resolves it
 * after login and grants nothing. The creator profile itself is a later story, so a valid code
 * shows a neutral stub.
 */
export function CreatorLinkPage({ api }: { api: MiniappApi }) {
  const { publicCode = '' } = useParams();
  const navigate = useNavigate();
  const { state } = useAuth();
  const isCreator = state.status === 'authenticated' && state.user.role === 'CREATOR';
  const [lookup, setLookup] = useState<Lookup>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // The server is the authority; for a CREATOR it would answer 403, so skip the request.
    if (isCreator) return;
    let cancelled = false;
    setLookup({ status: 'loading' });
    api
      .resolveCreator(publicCode)
      .then((creator) => {
        if (!cancelled) setLookup({ status: 'found', creator });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.code === 'CREATOR_NOT_FOUND') {
          setLookup({ status: 'unavailable' });
        } else if (error instanceof ApiError && error.code === 'FORBIDDEN_ROLE') {
          setLookup({ status: 'customers-only' });
        } else {
          setLookup({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, publicCode, isCreator, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const goExplore = () => void navigate('/explore', { replace: true });
  const goBack = () => void navigate(-1);

  if (isCreator || lookup.status === 'customers-only') {
    return <CustomersOnly onInbox={() => void navigate('/inbox', { replace: true })} />;
  }
  switch (lookup.status) {
    case 'loading':
      return (
        <main className={styles.page} role="status" aria-live="polite">
          <div className={styles.center}>
            <p className={styles.loading}>Memuat…</p>
          </div>
        </main>
      );
    case 'unavailable':
      return <CreatorUnavailable onExplore={goExplore} onBack={goBack} />;
    case 'error':
      return <ErrorScreen kind="network" onRetry={retry} />;
    case 'found':
      return (
        <main className={styles.page}>
          <NotImplemented title={lookup.creator.display_name}>
            <p className={styles.text}>Profil creator belum dibangun.</p>
          </NotImplemented>
        </main>
      );
  }
}
