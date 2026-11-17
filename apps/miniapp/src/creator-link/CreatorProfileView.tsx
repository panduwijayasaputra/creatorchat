import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type {
  CreatorAccess,
  CreatorAccessReview,
  CreatorProfileResponse,
} from '@creatorchat/contracts';
import {
  ChatIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ClockIcon,
  HourglassIcon,
  LockIcon,
  RefreshIcon,
} from '@creatorchat/ui';
import { formatDateTime, formatTime, zoneLabel } from '../format/date-time';
import { PROFILE_COPY as C } from './profile-copy';
import styles from './profile.module.css';

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

const dateOf = (iso: string, zone: string) =>
  formatDateTime(iso, zone, { day: 'numeric', month: 'short', year: 'numeric' });
const clockOf = (iso: string, zone: string) => `${formatTime(iso, zone)} ${zoneLabel(zone)}`;

function Locked({ text }: { text: string }) {
  return (
    <>
      <h2 className={styles.galleryTitle}>{C.gallery}</h2>
      <div className={styles.locked}>
        <span className={styles.lockDisc}>
          <LockIcon size={22} strokeWidth={2} />
        </span>
        <div>
          <div className={styles.lockedTitle}>{C.lockedTitle}</div>
          <div className={styles.lockedText}>{text}</div>
        </div>
      </div>
    </>
  );
}

export interface CreatorProfileViewProps {
  profile: CreatorProfileResponse;
  /** The viewer's display zone (`user.timezone`). */
  timezone: string;
  onBack: () => void;
  /** A tap on an action whose story is not built yet. */
  onUnavailable: () => void;
  /** "Minta Akses Uji Coba" / "Minta Perpanjangan Akses" / "Ajukan Lagi". */
  onRequestAccess: () => void;
  /** A request is being sent: the buttons are disabled. */
  sending?: boolean;
  /** Inline failure message under the request button; the button stays enabled. */
  requestError?: string | null;
  /** The Galeri section of an ACTIVE profile (tiles); other states show the locked panel instead. */
  gallery?: ReactNode;
}

function ResultCard({
  tone,
  title,
  text,
  dateLabel,
  date,
}: {
  tone: 'approved' | 'rejected';
  title: string;
  text: string;
  dateLabel: string;
  date: string;
}) {
  return (
    <div
      className={`${styles.resultCard} ${tone === 'approved' ? styles.resultApproved : styles.resultRejected}`}
    >
      <span className={styles.resultIcon}>
        {tone === 'approved' ? (
          <CheckCircleIcon size={22} strokeWidth={2} />
        ) : (
          <ClockIcon size={22} strokeWidth={2} />
        )}
      </span>
      <div className={styles.resultBody}>
        <div className={styles.resultTitle}>{title}</div>
        <div className={styles.resultText}>{text}</div>
        <div className={styles.resultDate}>
          {dateLabel} {date}
        </div>
      </div>
    </div>
  );
}

function State({
  access,
  review,
  name,
  conversationId,
  timezone,
  onUnavailable,
  onRequestAccess,
  sending,
  requestError,
}: {
  access: CreatorAccess;
  review: CreatorAccessReview | undefined;
  name: string;
  /** The viewer's own conversation with this creator, or null (US-027). */
  conversationId: string | null;
  timezone: string;
  onUnavailable: () => void;
  onRequestAccess: () => void;
  sending: boolean;
  requestError: string | null;
}) {
  const rejected = review?.status === 'REJECTED' ? review : null;
  const rejectedCard = rejected ? (
    <div className={styles.block}>
      <ResultCard
        tone="rejected"
        title={C.result.rejectedTitle}
        text={C.result.rejectedText}
        dateLabel={C.result.reviewed}
        date={`${dateOf(rejected.reviewed_at, timezone)}, ${clockOf(rejected.reviewed_at, timezone)}`}
      />
    </div>
  ) : null;
  const requestButton = (label: string, variant: 'primary' | 'outline') => (
    <>
      <button
        type="button"
        className={styles[variant]}
        disabled={sending}
        aria-disabled={sending}
        onClick={onRequestAccess}
      >
        {variant === 'outline' && !sending ? <RefreshIcon size={20} strokeWidth={2} /> : null}
        {sending ? C.gap.sending : label}
      </button>
      {requestError ? (
        <div className={styles.requestError} role="alert">
          {requestError}
        </div>
      ) : null}
    </>
  );
  switch (access.state) {
    case 'GUEST':
      return (
        <>
          {rejectedCard}
          <div className={styles.block}>
            {rejected
              ? requestButton(C.result.again, 'outline')
              : requestButton(C.guest.cta, 'primary')}
            {rejected ? null : <div className={styles.note}>{C.guest.note}</div>}
          </div>
        </>
      );
    case 'PENDING':
      return (
        <>
          <div className={`${styles.block} ${styles.pendingCard}`}>
            <span className={styles.pendingIcon}>
              <HourglassIcon size={22} strokeWidth={2} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className={styles.pendingTitle}>{C.pending.title}</div>
              <div className={styles.pendingText}>{C.pending.text}</div>
              <div className={styles.pendingSent}>
                {C.pending.sent} {dateOf(access.requested_at, timezone)},{' '}
                {clockOf(access.requested_at, timezone)}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" className={styles.waiting} disabled aria-disabled="true">
              <HourglassIcon size={20} strokeWidth={2} />
              {C.pending.status}
            </button>
          </div>
        </>
      );
    case 'ACTIVE':
      return (
        <>
          {review?.status === 'APPROVED' ? (
            <div className={styles.block}>
              <ResultCard
                tone="approved"
                title={C.result.approvedTitle}
                text={C.result.approvedText.replace('{name}', name)}
                dateLabel={C.result.approvedUntil}
                date={`${dateOf(access.ends_at, timezone)}, ${clockOf(access.ends_at, timezone)}`}
              />
            </div>
          ) : (
            <div className={`${styles.block} ${styles.status} ${styles.statusActive}`}>
              <CheckCircleIcon size={24} strokeWidth={2} />
              <div>
                <div className={styles.statusTitle}>
                  {C.active.until} {dateOf(access.ends_at, timezone)}
                </div>
                <div className={styles.statusText}>
                  {C.active.endsAt} {clockOf(access.ends_at, timezone)}
                </div>
              </div>
            </div>
          )}
          <div className={styles.block}>
            {conversationId ? (
              <Link to={`/chats/${conversationId}`} className={styles.primary}>
                <ChatIcon size={20} strokeWidth={2} />
                {C.active.cta}
              </Link>
            ) : (
              <button type="button" className={styles.primary} onClick={onUnavailable}>
                <ChatIcon size={20} strokeWidth={2} />
                {C.active.cta}
              </button>
            )}
          </div>
        </>
      );
    case 'EXPIRED':
      return (
        <>
          <div className={`${styles.block} ${styles.status} ${styles.statusExpired}`}>
            <ClockIcon size={24} strokeWidth={2} />
            <div>
              <div className={styles.statusTitle}>{C.expired.title}</div>
              <div className={styles.statusText}>
                {C.expired.since} {dateOf(access.ended_at, timezone)},{' '}
                {clockOf(access.ended_at, timezone)}. {C.expired.kept}
              </div>
            </div>
          </div>
          {rejectedCard}
          <div className={styles.stack}>
            <div>
              {rejected
                ? requestButton(C.result.again, 'outline')
                : requestButton(C.expired.cta, 'primary')}
            </div>
            {conversationId ? (
              <Link to={`/chats/${conversationId}`} className={styles.outline}>
                <ChatIcon size={20} strokeWidth={2} />
                {C.expired.history}
              </Link>
            ) : (
              <button type="button" className={styles.outline} onClick={onUnavailable}>
                <ChatIcon size={20} strokeWidth={2} />
                {C.expired.history}
              </button>
            )}
          </div>
        </>
      );
  }
}

/**
 * The creator profile for exactly one access state (`CreatorGuest|Pending|Active|Expired`). The
 * profile response has no media: a locked state shows the panel, an active one shows the `gallery`
 * slot (US-034). The board's category / city line is not built.
 */
export function CreatorProfileView({
  profile,
  timezone,
  onBack,
  onUnavailable,
  onRequestAccess,
  sending = false,
  requestError = null,
  gallery = null,
}: CreatorProfileViewProps) {
  const colour = paletteFor(profile.public_code);
  const { access } = profile;
  return (
    <div>
      <div className={styles.hero} style={{ background: colour.bg, color: colour.fg }}>
        {profile.avatar_url ? (
          <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span aria-hidden="true">{initialsOf(profile.display_name)}</span>
        )}
        <button type="button" className={styles.back} aria-label={C.back} onClick={onBack}>
          <ChevronLeftIcon size={24} strokeWidth={1.75} />
        </button>
      </div>
      <div className={styles.sheet}>
        <h1 className={styles.name}>{profile.display_name}</h1>
        {profile.bio ? <p className={styles.bio}>{profile.bio}</p> : null}
        <State
          access={access}
          review={profile.last_review}
          name={profile.display_name}
          conversationId={profile.conversation_id}
          timezone={timezone}
          onUnavailable={onUnavailable}
          onRequestAccess={onRequestAccess}
          sending={sending}
          requestError={requestError}
        />
        {access.state === 'GUEST' ? <Locked text={C.guest.gallery} /> : null}
        {access.state === 'PENDING' ? <Locked text={C.pending.gallery} /> : null}
        {access.state === 'EXPIRED' ? <Locked text={C.expired.gallery} /> : null}
        {access.state === 'ACTIVE' ? (
          <>
            <h2 className={styles.galleryTitle}>{C.gallery}</h2>
            {gallery}
          </>
        ) : null}
      </div>
    </div>
  );
}
