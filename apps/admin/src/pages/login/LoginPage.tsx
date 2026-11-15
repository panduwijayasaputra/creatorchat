import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ADMIN_LOGIN_MAX_ATTEMPTS,
  AdminLoginRequestSchema,
  ErrorCode,
  LoginFailureDetailsSchema,
  LoginLockedDetailsSchema,
} from '@creatorchat/contracts';
import {
  AlertCircleIcon,
  Button,
  ChatIcon,
  Field,
  LockIcon,
  PasswordInput,
  RefreshIcon,
  TextInput,
} from '@creatorchat/ui';
import { useAuth } from '../../auth/AuthProvider';
import { ApiError } from '../../auth/api-client';
import styles from './login.module.css';

/** What the error panel above the fields shows. Copy is verbatim from AdmLoginStates. */
export type LoginProblem =
  | { kind: 'credentials'; attempts: number }
  | { kind: 'network' }
  /** No board exists for the locked state yet: the board's error panel with plain facts. */
  | { kind: 'locked'; minutes: number | null };

interface FieldErrors {
  username?: string;
  password?: string;
}

export function problemFrom(error: unknown): LoginProblem {
  if (error instanceof ApiError) {
    if (error.code === ErrorCode.INVALID_CREDENTIALS) {
      const details = LoginFailureDetailsSchema.safeParse(error.details);
      return { kind: 'credentials', attempts: details.success ? details.data.attempts : 1 };
    }
    if (error.code === ErrorCode.LOGIN_LOCKED) {
      const details = LoginLockedDetailsSchema.safeParse(error.details);
      return {
        kind: 'locked',
        minutes: details.success
          ? Math.max(1, Math.ceil(details.data.retry_after_seconds / 60))
          : null,
      };
    }
    if (error.code === ErrorCode.RATE_LIMITED) return { kind: 'locked', minutes: null };
  }
  // Offline, refused, 5xx, a misconfigured Origin: all read as "cannot reach the server".
  return { kind: 'network' };
}

function Spinner() {
  return (
    <svg className={styles.spinner} width="20" height="20" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="18" fill="none" stroke="#D8C0CA" strokeWidth="5" />
      <path
        d="M22 4a18 18 0 0 1 18 18"
        fill="none"
        stroke="#A83F67"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ProblemPanel({ problem }: { problem: LoginProblem }) {
  let title: string;
  let body: string;
  if (problem.kind === 'credentials') {
    title = 'Username atau password salah';
    body = `Periksa kembali isian. Setelah ${ADMIN_LOGIN_MAX_ATTEMPTS} kali gagal, login dikunci 15 menit. Percobaan: ${problem.attempts} dari ${ADMIN_LOGIN_MAX_ATTEMPTS}.`;
  } else if (problem.kind === 'network') {
    title = 'Tidak bisa terhubung ke server';
    body = 'Koneksi terputus. Isianmu tetap tersimpan. Coba lagi sebentar.';
  } else {
    title = 'Login dikunci sementara';
    body = problem.minutes
      ? `Terlalu banyak percobaan. Coba lagi dalam ${problem.minutes} menit.`
      : 'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.';
  }
  return (
    <div role="alert" className={styles.problem}>
      <span className={styles.problemIcon}>
        <AlertCircleIcon size={22} strokeWidth={2} />
      </span>
      <div className={styles.problemText}>
        <div className={styles.problemTitle}>{title}</div>
        <div className={styles.problemBody}>{body}</div>
      </div>
    </div>
  );
}

/** `/login`: AdmLogin + AdmLoginStates (Memeriksa…, validasi, kredensial salah, gagal terhubung). */
export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<LoginProblem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A ref, not state: two clicks in the same tick must still send one request.
    if (submittingRef.current) return;

    const parsed = AdminLoginRequestSchema.safeParse({ username, password });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'username' || key === 'password') && !errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      setProblem(null);
      (errors.username ? usernameRef : passwordRef).current?.focus();
      return;
    }

    setFieldErrors({});
    setProblem(null);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await login(parsed.data);
      // Success: the route guard moves the admin on; nothing more to do here.
    } catch (error) {
      if (!mounted.current) return;
      submittingRef.current = false;
      setSubmitting(false);
      const next = problemFrom(error);
      setProblem(next);
      if (next.kind === 'credentials') passwordRef.current?.focus();
    }
  }

  const retry = problem?.kind === 'network';

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.logo}>
            <ChatIcon size={24} strokeWidth={2} />
          </span>
          <div>
            <div className={styles.brandName}>Creator Chat</div>
            <div className={styles.brandSub}>Dashboard Admin</div>
          </div>
        </div>
        <h1 className={styles.title}>Masuk</h1>
        <p className={styles.lead}>Gunakan username dan password admin.</p>

        <form className={styles.form} onSubmit={submit} noValidate>
          {problem ? <ProblemPanel problem={problem} /> : null}
          <Field label="Username" error={fieldErrors.username}>
            <TextInput
              ref={usernameRef}
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Masukkan username"
              value={username}
              readOnly={submitting}
              onChange={(event) => {
                setUsername(event.target.value);
                if (fieldErrors.username) setFieldErrors((e) => ({ ...e, username: undefined }));
              }}
            />
          </Field>
          <Field label="Password" error={fieldErrors.password}>
            <PasswordInput
              ref={passwordRef}
              name="password"
              autoComplete="current-password"
              placeholder="Masukkan password"
              value={password}
              readOnly={submitting}
              onChange={(event) => {
                setPassword(event.target.value);
                if (fieldErrors.password) setFieldErrors((e) => ({ ...e, password: undefined }));
              }}
            />
          </Field>
          <Button
            type="submit"
            fullWidth
            loading={submitting}
            className={styles.submit}
            icon={
              submitting ? (
                <Spinner />
              ) : retry ? (
                <RefreshIcon size={18} strokeWidth={2} />
              ) : undefined
            }
          >
            {submitting ? 'Memeriksa…' : retry ? 'Coba Lagi' : 'Masuk'}
          </Button>
        </form>

        <div className={styles.notice}>
          <LockIcon size={18} strokeWidth={2} />
          <span>Akun admin dibuat oleh tim platform. Tidak ada pendaftaran admin publik.</span>
        </div>
      </div>
    </main>
  );
}
