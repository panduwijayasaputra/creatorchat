import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { timezoneSummary, type CreatorSettingsResponse } from '@creatorchat/contracts';
import {
  Avatar,
  BookmarkIcon,
  ChatIcon,
  ChevronRightIcon,
  CopyIcon,
  GlobeIcon,
  HelpCircleIcon,
  PencilIcon,
  SparkleIcon,
  StatusChip,
  UserIcon,
} from '@creatorchat/ui';
import type { MiniappApi } from '../auth/api-client';
import { BottomToast, useFlashMessage } from '../components/BottomToast';
import { botUrl, openTelegramLink } from '../telegram/webapp';
import { CREATOR_GAP_COPY } from './creator-copy';
import { copyToClipboard } from './copy-to-clipboard';
import styles from './creator-settings.module.css';

type Load =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; settings: CreatorSettingsResponse };

interface RowProps {
  icon: ReactNode;
  title: string;
  hint?: string;
  /** In-app destination. */
  to?: string;
  /** External (Telegram) destination, opened through the WebApp when available. */
  href?: string;
  /** The status shown before the chevron (`CrSettings`: "Aktif"). */
  chip?: ReactNode;
}

function Row({ icon, title, hint, to, href, chip }: RowProps) {
  const body = (
    <>
      <span className={styles.disc}>{icon}</span>
      <span className={styles.rowText}>
        <span className={styles.rowTitle}>{title}</span>
        {hint ? <span className={styles.rowHint}>{hint}</span> : null}
      </span>
      {chip}
      {to || href ? (
        <ChevronRightIcon size={20} strokeWidth={2} className={styles.chevron} />
      ) : null}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={styles.row}>
        {body}
      </Link>
    );
  }
  if (href) {
    return (
      <a
        href={href}
        className={styles.row}
        onClick={(event) => {
          event.preventDefault();
          openTelegramLink(href);
        }}
      >
        {body}
      </a>
    );
  }
  return <div className={styles.row}>{body}</div>;
}

/** `CrSettings`: the signed-in CREATOR's settings, public-profile preview and bio link. */
export function CreatorSettingsPage({ api }: { api: Pick<MiniappApi, 'getCreatorSettings'> }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [flash, showFlash] = useFlashMessage();
  const [flashKind, setFlashKind] = useState<'success' | 'info'>('success');
  const adminUrl = botUrl(import.meta.env.VITE_TELEGRAM_BOT_USERNAME);

  const fetchSettings = useCallback(() => {
    setLoad({ status: 'loading' });
    api.getCreatorSettings().then(
      (settings) => setLoad({ status: 'ready', settings }),
      () => setLoad({ status: 'failed' }),
    );
  }, [api]);
  useEffect(fetchSettings, [fetchSettings]);

  if (load.status !== 'ready') {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Pengaturan</h1>
        {load.status === 'failed' ? (
          <div role="alert" className={styles.state}>
            <h2 className={styles.stateTitle}>{CREATOR_GAP_COPY.loadFailedTitle}</h2>
            <p className={styles.stateBody}>{CREATOR_GAP_COPY.loadFailedBody}</p>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={fetchSettings}
            >
              {CREATOR_GAP_COPY.retry}
            </button>
          </div>
        ) : (
          <div className={styles.state} role="status" aria-busy="true" aria-label="Memuat" />
        )}
      </div>
    );
  }

  const { profile, bio_link: bioLink, welcome_enabled: welcomeEnabled } = load.settings;
  const shownLink = bioLink?.replace(/^https:\/\//, '') ?? null;

  const copy = async () => {
    if (!bioLink) return;
    const ok = await copyToClipboard(bioLink);
    setFlashKind(ok ? 'success' : 'info');
    showFlash(ok ? CREATOR_GAP_COPY.linkCopied : CREATOR_GAP_COPY.linkCopyFailed);
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Pengaturan</h1>

      <div className={styles.identity}>
        <Avatar src={profile.avatar_url} size={64} />
        <div className={styles.identityText}>
          <div className={styles.name}>{profile.display_name}</div>
          <div className={styles.username}>
            {profile.telegram_username ? `@${profile.telegram_username} · ` : ''}dari Telegram
          </div>
          <div className={styles.chipLine}>
            <StatusChip status="active" label="Creator · disetujui admin" />
          </div>
        </div>
      </div>

      <section className={styles.section} aria-label="Profil">
        <h2 className={styles.label}>Profil</h2>
        {/* No category/city line: there is no designed input for it (gap), so nothing is invented. */}
        <div className={styles.preview}>
          <Avatar src={profile.avatar_url} size={72} height={96} radius={14} />
          <div className={styles.previewText}>
            <div className={styles.previewLabel}>Preview profil</div>
            <div className={styles.previewName}>{profile.display_name}</div>
            {profile.bio ? <div className={styles.previewBio}>{profile.bio}</div> : null}
          </div>
        </div>
        <Link to="/settings/profile" className={`${styles.button} ${styles.outline}`}>
          <PencilIcon size={18} strokeWidth={2} />
          Edit Profil
        </Link>
      </section>

      <section className={styles.section} aria-label="Link bio">
        <h2 className={styles.label}>Link bio</h2>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Link bot untuk bio Instagram</div>
          <div className={styles.link} data-testid="bio-link">
            {shownLink ?? CREATOR_GAP_COPY.linkNotConfigured}
          </div>
          <div className={styles.hint}>Pelanggan masuk lewat bot, lalu langsung ke profilmu.</div>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            disabled={!bioLink}
            onClick={() => void copy()}
          >
            <CopyIcon size={20} strokeWidth={2} />
            Salin Link Profil
          </button>
        </div>
      </section>

      <section className={styles.section} aria-label="Persona, sambutan, harga, dan zona waktu">
        <h2 className={styles.label}>Persona, sambutan, harga, dan zona waktu</h2>
        {/* Later stories build these: no status chips or saved values until they exist. */}
        <div className={styles.list}>
          <Row
            to="/settings/persona"
            icon={<SparkleIcon size={22} />}
            title="Persona AI"
            hint="Gaya bicara, contoh, dan batas topik"
          />
          <div className={styles.divider} />
          <Row
            to="/settings/welcome"
            icon={<ChatIcon size={22} />}
            title="Pesan selamat datang"
            hint="Terkirim otomatis ke subscriber baru"
            chip={
              welcomeEnabled ? (
                <StatusChip status="active" label="Aktif" />
              ) : (
                // design gap: the board only shows the switched-on state
                <StatusChip status="none" label="Mati" />
              )
            }
          />
          <div className={styles.divider} />
          <Row to="/settings/price" icon={<BookmarkIcon size={22} />} title="Harga subscription" />
          <div className={styles.divider} />
          <Row
            to="/settings/timezone"
            icon={<GlobeIcon size={22} />}
            title="Zona waktu"
            hint={timezoneSummary(profile.timezone)}
          />
        </div>
      </section>

      <section className={styles.section} aria-label="Akun dan bantuan">
        <h2 className={styles.label}>Akun dan bantuan</h2>
        <div className={styles.list}>
          <Row
            icon={<UserIcon size={22} />}
            title="Akun Telegram"
            hint="Masuk melalui Telegram. Role diatur admin."
          />
          {adminUrl ? (
            <>
              <div className={styles.divider} />
              <Row
                href={adminUrl}
                icon={<HelpCircleIcon size={22} />}
                title="Bantuan"
                hint="Hubungi admin lewat bot Telegram"
              />
            </>
          ) : null}
        </div>
      </section>
      <BottomToast message={flash} bottom={104} kind={flashKind} />
    </div>
  );
}
