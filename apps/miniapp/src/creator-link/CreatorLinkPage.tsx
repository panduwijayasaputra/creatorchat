import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router';
import type { CreatorProfileResponse } from '@creatorchat/contracts';
import { Button, ChevronLeftIcon, InfoCircleIcon, UserOffIcon } from '@creatorchat/ui';
import { ApiError, type MiniappApi } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import { ErrorScreen } from '../auth/screens/AuthGate';
import { BottomToast, useFlashMessage } from '../components/BottomToast';
import { CustomerFrame } from '../components/shell/Shells';
import { CreatorProfileView } from './CreatorProfileView';
import { ProfileGallery } from './ProfileGallery';
import { PROFILE_COPY } from './profile-copy';
import styles from './creator-link.module.css';

type Lookup =
  | { status: 'loading' }
  | { status: 'found'; creator: CreatorProfileResponse }
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
 * Landing and profile for `/creators/:publicCode`. The code only picks a destination: the server
 * resolves it after login and grants nothing; the answer carries the viewer's own access state, and
 * the page shows exactly that one state (US-022).
 */
export function CreatorLinkPage({ api }: { api: MiniappApi }) {
  const { publicCode = '' } = useParams();
  const navigate = useNavigate();
  const { state } = useAuth();
  const [flash, showFlash] = useFlashMessage();
  const isCreator = state.status === 'authenticated' && state.user.role === 'CREATOR';
  const [lookup, setLookup] = useState<Lookup>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [sending, setSending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const inFlight = useRef(false);

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

  /** One request at a time; the server is idempotent, so a lost response can simply be retried. */
  const requestAccess = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setRequestError(null);
    try {
      try {
        await api.requestAccess(publicCode);
      } catch (error) {
        // Already active: nothing to retry, the refetch below shows the real state.
        if (!(error instanceof ApiError && error.code === 'ACCESS_ALREADY_ACTIVE')) throw error;
      }
      setLookup({ status: 'found', creator: await api.resolveCreator(publicCode) });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CREATOR_NOT_FOUND') {
        setLookup({ status: 'unavailable' });
      } else {
        setRequestError(PROFILE_COPY.gap.requestFailed);
      }
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }, [api, publicCode]);

  /** Access ended while browsing the gallery: the fresh profile shows the locked panel. */
  const refreshProfile = useCallback(async () => {
    try {
      setLookup({ status: 'found', creator: await api.resolveCreator(publicCode) });
    } catch (error) {
      setLookup(
        error instanceof ApiError && error.code === 'CREATOR_NOT_FOUND'
          ? { status: 'unavailable' }
          : { status: 'error' },
      );
    }
  }, [api, publicCode]);
  const onAccessLost = useCallback(() => void refreshProfile(), [refreshProfile]);

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
        <CustomerFrame>
          <CreatorProfileView
            profile={lookup.creator}
            timezone={state.status === 'authenticated' ? state.user.timezone : 'Asia/Jakarta'}
            onBack={goBack}
            onUnavailable={() => showFlash(PROFILE_COPY.gap.notYet)}
            onRequestAccess={() => void requestAccess()}
            sending={sending}
            requestError={requestError}
            gallery={
              lookup.creator.access.state === 'ACTIVE' ? (
                <ProfileGallery api={api} publicCode={publicCode} onAccessLost={onAccessLost} />
              ) : null
            }
          />
          <Outlet context={{ displayName: lookup.creator.display_name, onAccessLost }} />
          <BottomToast message={flash} kind="info" />
        </CustomerFrame>
      );
  }
}
