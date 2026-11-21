import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { CreatorRequestStateResponse } from '@creatorchat/contracts';
import {
  ArrowUpRightIcon,
  Avatar,
  CheckCircleIcon,
  HelpCircleIcon,
  LockIcon,
  PencilIcon,
  ShieldIcon,
  StatusChip,
  Switch,
} from '@creatorchat/ui';
import type { MiniappApi } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import { formatDateTime } from '../format/date-time';
import { BottomToast, useFlashMessage } from '../components/BottomToast';
import { botUrl, openTelegramLink } from '../telegram/webapp';
import { PROFILE_GAP_COPY } from './profile-copy';
import { DEFAULT_PREFERENCES, useNotificationPreferences } from './useNotificationPreferences';
import styles from './profile.module.css';

/** `Profile` board: the signed-in USER's profile, creator invitation, notifications, privacy and help. */
export function ProfilePage({
  api,
}: {
  api: Pick<
    MiniappApi,
    'getCreatorRequestState' | 'getNotificationPreferences' | 'updateNotificationPreferences'
  >;
}) {
  const { state } = useAuth();
  const [flash, showFlash] = useFlashMessage();
  const preferences = useNotificationPreferences(api, () =>
    showFlash(PROFILE_GAP_COPY.notificationSaveFailed),
  );
  const values =
    preferences.state.status === 'ready' ? preferences.state.values : DEFAULT_PREFERENCES;
  // The switches wait for the server's answer; if it never comes they stay as they are.
  const switchesReady = preferences.state.status === 'ready';
  // The server decides which card shows (pending, blocked, rejected); until it answers, or if it
  // cannot, the normal invitation stays. The submit call re-checks the rules, so a missed state
  // is refused there.
  const [requestState, setRequestState] = useState<CreatorRequestStateResponse | null>(null);
  useEffect(() => {
    let current = true;
    api.getCreatorRequestState().then(
      (result) => {
        if (current) setRequestState(result);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [api]);
  if (state.status !== 'authenticated') return null;
  const { user } = state;
  const request = requestState?.request ?? null;
  const blocked = requestState?.blocked ?? null;
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
        {request?.status === 'PENDING' ? (
          <>
            <div className={styles.creatorHead}>
              <h2 className={styles.creatorTitle}>Permintaan creator</h2>
              <StatusChip status="request" label="Sedang Ditinjau" />
            </div>
            <p className={styles.creatorText}>
              Hasil peninjauan akan dikirim melalui Telegram. Kamu tetap bisa memakai fitur
              pelanggan.
            </p>
            <Link to="/profile/creator-request/status" className={styles.outline}>
              Lihat Status
            </Link>
          </>
        ) : blocked ? (
          <>
            <h2 className={styles.creatorTitle}>Ingin menjadi creator?</h2>
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
        ) : request?.status === 'REJECTED' ? (
          <>
            <div className={styles.creatorHead}>
              <h2 className={styles.creatorTitle}>Permintaan creator</h2>
              <StatusChip status="failed" label="Ditolak" />
            </div>
            {/* Admin text: a plain text node, never HTML. */}
            <p className={styles.creatorText}>{request.review_reason}</p>
            <Link to="/profile/creator-request" className={`${styles.action} ${styles.primary}`}>
              Perbaiki dan Ajukan Lagi
            </Link>
          </>
        ) : (
          <>
            <h2 className={styles.creatorTitle}>Ingin menjadi creator?</h2>
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
        <div className={styles.toggleRow}>
          <div className={styles.toggleText}>
            <div className={styles.rowTitle}>Notifikasi pesan</div>
            <div className={styles.rowHint}>Kabar saat creator membalas.</div>
          </div>
          <Switch
            checked={values.messages_enabled}
            label="Notifikasi pesan"
            disabled={!switchesReady}
            onChange={(checked) => preferences.toggle('messages_enabled', checked)}
          />
        </div>
        <div className={styles.divider} />
        <div className={styles.toggleRow}>
          <div className={styles.toggleText}>
            <div className={styles.rowTitle}>Tampilkan isi pesan</div>
            <div className={styles.rowHint}>Mati secara default. Isi pesan disembunyikan.</div>
          </div>
          <Switch
            checked={values.show_content}
            label="Tampilkan isi pesan"
            disabled={!switchesReady}
            onChange={(checked) => preferences.toggle('show_content', checked)}
          />
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
