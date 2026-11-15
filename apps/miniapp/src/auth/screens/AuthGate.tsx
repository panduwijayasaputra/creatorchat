import {
  ArrowUpRightIcon,
  Button,
  ChatIcon,
  ClockIcon,
  RefreshIcon,
  SendIcon,
  UserOffIcon,
  WifiIcon,
} from '@creatorchat/ui';
import type { ReactNode } from 'react';
import { botUrl } from '../../telegram/webapp';
import { useAuth, type AuthErrorKind } from '../AuthProvider';
import { AuthHero } from './AuthHero';
import styles from './auth-screens.module.css';

/** The copy under the button is the only difference between the two entry screens. */
function EntryScreen({ helper, action }: { helper: string; action: ReactNode }) {
  return (
    <main className={styles.page}>
      <AuthHero />
      <div className={styles.body}>
        <h1 className={styles.title}>Masuk dan mulai terhubung.</h1>
        <p className={styles.lead}>
          Chat dengan creator favoritmu dan nikmati konten khusus subscriber.
        </p>
        <div className={styles.action}>{action}</div>
        <div className={styles.helper}>{helper}</div>
        <div className={styles.terms}>
          {/* "Syarat Layanan" / "Kebijakan Privasi" pages are not designed yet (reported gap). */}
          Dengan melanjutkan, kamu menyetujui{' '}
          <span className={styles.termsLink}>Syarat Layanan</span> dan{' '}
          <span className={styles.termsLink}>Kebijakan Privasi</span>.
        </div>
      </div>
    </main>
  );
}

/** AuthLogin: inside Telegram, first launch. */
export function LoginScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <EntryScreen
      helper="Masuk memakai identitas Telegram-mu. Tidak ada email, kata sandi, atau OTP."
      action={
        <Button
          size="lg"
          fullWidth
          icon={<SendIcon size={20} strokeWidth={2} />}
          onClick={onContinue}
        >
          Lanjutkan dengan Telegram
        </Button>
      }
    />
  );
}

/** AuthOutside: no initData. The only way in is the bot link; there is no web login. */
export function OutsideScreen({ botUsername }: { botUsername: string | undefined }) {
  const href = botUrl(botUsername);
  return (
    <EntryScreen
      helper="Login tetap dilakukan lewat bot dan Mini App Telegram. Tidak ada email atau kata sandi."
      action={
        <a
          className={styles.linkButton}
          href={href ?? undefined}
          aria-disabled={href === null || undefined}
          {...(href ? { rel: 'noopener noreferrer' } : {})}
        >
          <ArrowUpRightIcon size={20} strokeWidth={2} />
          Buka di Telegram
        </a>
      }
    />
  );
}

function StatePanel({
  tone,
  icon,
  title,
  text,
  action,
}: {
  tone: 'brand' | 'error' | 'expired';
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  const disc = { brand: styles.discBrand, error: styles.discError, expired: styles.discExpired }[
    tone
  ];
  return (
    <main className={styles.state}>
      <span className={`${styles.disc} ${disc}`}>{icon}</span>
      <h1 className={styles.stateTitle}>{title}</h1>
      <p className={styles.stateText}>{text}</p>
      {action ? <div className={styles.stateAction}>{action}</div> : null}
    </main>
  );
}

/** AuthStates 1: "Memuat". The board's text sits on the line under the app name. */
export function ConnectingScreen() {
  return (
    <main className={styles.state} role="status" aria-live="polite">
      <span className={`${styles.disc} ${styles.discBrand}`}>
        <ChatIcon size={40} />
      </span>
      <div className={styles.stateTitle}>Creator Chat</div>
      <p className={styles.stateText}>Menghubungkan ke Telegram…</p>
      <svg className={styles.spinner} width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r="18" fill="none" stroke="#F5DCE5" strokeWidth="4" />
        <path
          d="M22 4a18 18 0 0 1 18 18"
          fill="none"
          stroke="#A83F67"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    </main>
  );
}

/** PLACEHOLDER copy (design gap): the one place to replace when the blocked-account message is designed. */
export const BLOCKED_COPY = {
  title: 'Belum bisa masuk',
  text: 'Akun ini sedang tidak aktif, jadi belum bisa dipakai. Hubungi dukungan jika kamu merasa ini keliru.',
} as const;

const RETRY = (onRetry: () => void) => (
  <Button size="lg" fullWidth icon={<RefreshIcon size={20} strokeWidth={2} />} onClick={onRetry}>
    Coba Lagi
  </Button>
);

/**
 * AuthStates 2 and 3. A server that is down uses the designed "Belum bisa masuk" copy. A blocked
 * account keeps that panel's layout with placeholder copy (not designed yet: see design-integration.md).
 */
export function ErrorScreen({ kind, onRetry }: { kind: AuthErrorKind; onRetry: () => void }) {
  if (kind === 'expired') {
    return (
      <StatePanel
        tone="expired"
        icon={<ClockIcon size={40} />}
        title="Sesi Telegram berakhir"
        text="Buka ulang aplikasi dari bot Telegram untuk melanjutkan. Kamu tidak perlu mengisi apa pun."
        action={RETRY(onRetry)}
      />
    );
  }
  if (kind === 'blocked') {
    return (
      <StatePanel
        tone="error"
        icon={<UserOffIcon size={40} />}
        title={BLOCKED_COPY.title}
        text={BLOCKED_COPY.text}
        action={RETRY(onRetry)}
      />
    );
  }
  return (
    <StatePanel
      tone="error"
      icon={<WifiIcon size={40} />}
      title="Belum bisa masuk"
      text="Koneksi terputus saat menghubungkan ke Telegram. Periksa jaringan lalu coba lagi."
      action={RETRY(onRetry)}
    />
  );
}

/** Picks the screen for every state that is not "signed in". */
export function AuthGate() {
  const { state, continueWithTelegram, retry } = useAuth();
  switch (state.status) {
    case 'connecting':
      return <ConnectingScreen />;
    case 'login-required':
      return <LoginScreen onContinue={continueWithTelegram} />;
    case 'outside-telegram':
      return <OutsideScreen botUsername={import.meta.env.VITE_TELEGRAM_BOT_USERNAME} />;
    case 'error':
      return <ErrorScreen kind={state.kind} onRetry={retry} />;
    case 'authenticated':
      return null;
  }
}
