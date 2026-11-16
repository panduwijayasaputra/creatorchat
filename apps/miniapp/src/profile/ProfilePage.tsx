import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { CreatorRequestBlock } from '@creatorchat/contracts';
import {
  ArrowUpRightIcon,
  Avatar,
  CheckCircleIcon,
  HelpCircleIcon,
  LockIcon,
  PencilIcon,
  ShieldIcon,
  Switch,
} from '@creatorchat/ui';
import type { MiniappApi } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import { formatDateTime } from '../format/date-time';
import { BottomToast, useFlashMessage } from '../components/BottomToast';
import { botUrl, openTelegramLink } from '../telegram/webapp';
import { PROFILE_GAP_COPY } from './profile-copy';
import styles from './profile.module.css';

/** `Profile` board: the signed-in USER's profile, creator invitation, notifications, privacy and help. */
export function ProfilePage({ api }: { api: Pick<MiniappApi, 'getCreatorRequestState'> }) {
  const { state } = useAuth();
  const [flash, showFlash] = useFlashMessage();
  // The server decides (ProfileBlocked); until it answers, or if it cannot, the normal card stays.
  // The submit call re-checks the rule, so a missed block is refused there.
  const [blocked, setBlocked] = useState<CreatorRequestBlock | null>(null);
  useEffect(() => {
    let current = true;
    api.getCreatorRequestState().then(
      (result) => {
        if (current) setBlocked(result.blocked);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [api]);
  if (state.status !== 'authenticated') return null;
  const { user } = state;
  const adminUrl = botUrl(import.meta.env.VITE_TELEGRAM_BOT_USERNAME);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Profil</h1>

      <section className={styles.card} aria-label="Profil kamu">
        <div className={styles.identity}>
          <Avatar src={user.avatar_url} size={72} />
          <div className={styles.identityText}>
            <div className={styles.name}>{user.display_name}</div>
            {user.telegram_username ? (
              <div className={styles.username}>@{user.telegram_username}</div>
            ) : null}
            <div className={styles.fromTelegram}>
              <LockIcon size={14} strokeWidth={2} />
              Dari Telegram, tidak bisa diubah
            </div>
          </div>
        </div>
        <Link to="/profile/edit" className={`${styles.action} ${styles.secondary}`}>
          <PencilIcon size={18} strokeWidth={2} />
          Edit Profil
        </Link>
      </section>

      <section className={styles.creatorCard} aria-label="Jadi creator">
        <h2 className={styles.creatorTitle}>Ingin menjadi creator?</h2>
        {blocked ? (
          <>
            <p className={styles.creatorText}>
              Permintaan menjadi creator dapat diajukan setelah seluruh langganan pelanggan
              berakhir.
            </p>
            <div className={styles.activeSub}>
              <CheckCircleIcon size={16} strokeWidth={2} />
              Langganan aktif: {blocked.creator_name}, hingga{' '}
              {formatDateTime(blocked.ends_at, user.timezone, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </div>
            <button type="button" className={styles.blockedAction} disabled aria-disabled="true">
              Ajukan Jadi Creator
            </button>
          </>
        ) : (
          <>
            <p className={styles.creatorText}>
              Ajukan akunmu. Setelah disetujui admin, akun ini berubah menjadi akun creator.
            </p>
            <Link to="/profile/creator-request" className={`${styles.action} ${styles.primary}`}>
              Ajukan Jadi Creator
            </Link>
          </>
        )}
      </section>

      <h2 className={styles.sectionLabel}>Notifikasi</h2>
      <section className={styles.group} aria-label="Notifikasi">
        {/* Not saved until Phase E: shown in the designed state, not interactive. */}
        <div className={styles.toggleRow}>
          <div className={styles.toggleText}>
            <div className={styles.rowTitle}>Notifikasi pesan</div>
            <div className={styles.rowHint}>Kabar saat creator membalas.</div>
          </div>
          <Switch checked label="Notifikasi pesan" disabled />
        </div>
        <div className={styles.divider} />
        <div className={styles.toggleRow}>
          <div className={styles.toggleText}>
            <div className={styles.rowTitle}>Tampilkan isi pesan</div>
            <div className={styles.rowHint}>Mati secara default. Isi pesan disembunyikan.</div>
          </div>
          <Switch checked={false} label="Tampilkan isi pesan di notifikasi" disabled />
        </div>
      </section>

      <h2 className={styles.sectionLabel}>Privasi dan bantuan</h2>
      <div className={styles.stack}>
        <section className={`${styles.card} ${styles.infoCard}`} aria-label="Privasi">
          <ShieldIcon size={24} className={styles.infoIcon} />
          <div>
            <div className={styles.rowTitle}>Privasi</div>
            <div className={styles.infoText}>
              Chat dengan setiap creator bersifat privat. Kebijakan Privasi menjelaskan data apa
              yang kami simpan.
            </div>
            {/* DESIGN GAP: the policy page is not designed; placeholder feedback only. */}
            <button
              type="button"
              className={styles.link}
              onClick={() => showFlash(PROFILE_GAP_COPY.privacyPolicySoon)}
            >
              Kebijakan Privasi
            </button>
          </div>
        </section>
        <section className={`${styles.card} ${styles.infoCard}`} aria-label="Bantuan">
          <HelpCircleIcon size={24} className={styles.infoIcon} />
          <div className={styles.grow}>
            <div className={styles.rowTitle}>Bantuan</div>
            <div className={styles.infoText}>
              Kendala akses atau perpanjangan? Hubungi admin lewat bot Telegram.
            </div>
            {adminUrl ? (
              <a
                href={adminUrl}
                className={styles.link}
                onClick={(event) => {
                  event.preventDefault();
                  openTelegramLink(adminUrl);
                }}
              >
                Hubungi Admin
                <ArrowUpRightIcon size={16} strokeWidth={2} />
              </a>
            ) : null}
          </div>
        </section>
      </div>
      <BottomToast message={flash} bottom={104} kind="info" />
    </div>
  );
}
