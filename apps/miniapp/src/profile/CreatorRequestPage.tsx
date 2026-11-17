import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import {
  CREATOR_DESCRIPTION_MAX,
  CreatorRequestBlockSchema,
  SubmitCreatorRequestSchema,
  codePointLength,
  type CreatorApplication,
  type CreatorRequestBlock,
  type CreatorRequestStateResponse,
  type CreatorType,
} from '@creatorchat/contracts';
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  HourglassIcon,
  InfoCircleIcon,
  SendIcon,
} from '@creatorchat/ui';
import { ApiError, NetworkError, type MiniappApi } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import { REQUEST_GAP_COPY } from './creator-request-copy';
import styles from './creator-request.module.css';

export const REQUEST_STATUS_PATH = '/profile/creator-request/status';

type Api = Pick<MiniappApi, 'getCreatorRequestState' | 'submitCreatorRequest'>;
type Field = 'creator_name' | 'instagram_url' | 'description' | 'rights_confirmed';
type FieldErrors = Partial<Record<Field, string>>;
type Send = { status: 'idle' } | { status: 'sending' } | { status: 'failed'; offline: boolean };

const FIELD_ORDER: Field[] = ['creator_name', 'instagram_url', 'description', 'rights_confirmed'];

const TYPES: { value: CreatorType; title: string; detail: string }[] = [
  { value: 'HUMAN', title: 'Creator Asli', detail: 'Orang nyata yang mengelola akunnya sendiri.' },
  {
    value: 'AI_CHARACTER',
    title: 'Karakter AI',
    detail: 'Karakter atau persona yang kamu kelola.',
  },
];

/** First message per field from the shared schema (the server applies the same rules). */
function collect(issues: readonly { path: PropertyKey[]; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = FIELD_ORDER.find((name) => name === issue.path[0]);
    if (field) errors[field] ??= issue.message;
  }
  return errors;
}

/** Field errors out of a 400 `{ details: [{ path, message }] }`, or null when it has another shape. */
function serverFieldErrors(details: unknown): FieldErrors | null {
  if (!Array.isArray(details)) return null;
  const issues = details.flatMap((item: unknown) =>
    item && typeof item === 'object' && 'path' in item && 'message' in item
      ? [{ path: [String((item as { path: unknown }).path)], message: String(item.message) }]
      : [],
  );
  const errors = collect(issues);
  return Object.keys(errors).length > 0 ? errors : null;
}

interface FormProps {
  api: Api;
  /** The rejected request being fixed (`CreatorRequestRetry`), or null for a first request. */
  rejected: CreatorApplication | null;
  blocked: CreatorRequestBlock | null;
  onBlocked: (block: CreatorRequestBlock) => void;
}

function RequestForm({ api, rejected, blocked, onBlocked }: FormProps) {
  const { state } = useAuth();
  const navigate = useNavigate();
  // Retry: the rejected request's values come back; the rights statement is confirmed again.
  const [name, setName] = useState(
    rejected?.creator_name ?? (state.status === 'authenticated' ? state.user.display_name : ''),
  );
  const [url, setUrl] = useState(rejected?.instagram_url ?? '');
  const [type, setType] = useState<CreatorType>(rejected?.creator_type ?? 'HUMAN');
  const [description, setDescription] = useState(rejected?.description ?? '');
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [checked, setChecked] = useState(false);
  const [send, setSend] = useState<Send>({ status: 'idle' });
  const inFlight = useRef(false);
  const refs = useRef<Partial<Record<Field, HTMLElement | null>>>({});
  const radios = useRef<(HTMLButtonElement | null)[]>([]);

  const sending = send.status === 'sending';
  const inert = sending || blocked !== null;
  const length = codePointLength(description);

  const values = (over: Partial<Record<Field, unknown>> = {}) => ({
    creator_name: name,
    instagram_url: url,
    creator_type: type,
    description,
    rights_confirmed: agreed ? true : false,
    ...over,
  });
  // Once the user has tried to send, every edit re-checks, so an error clears as soon as it is fixed.
  const revalidate = (over: Partial<Record<Field, unknown>>) => {
    if (!checked) return;
    const result = SubmitCreatorRequestSchema.safeParse(values(over));
    setErrors(result.success ? {} : collect(result.error.issues));
  };

  const chooseType = (index: number) => {
    const option = TYPES[index];
    if (!option) return;
    setType(option.value);
    radios.current[index]?.focus();
  };
  const onRadioKey = (event: React.KeyboardEvent, index: number) => {
    const last = TYPES.length - 1;
    const next =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? (index + 1) % (last + 1)
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? (index + last) % (last + 1)
          : null;
    if (next === null) return;
    event.preventDefault();
    chooseType(next);
  };

  const focusFirst = (found: FieldErrors) => {
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) refs.current[first]?.focus();
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || blocked) return;
    const result = SubmitCreatorRequestSchema.safeParse(values());
    setChecked(true);
    if (!result.success) {
      const found = collect(result.error.issues);
      setErrors(found);
      focusFirst(found);
      return;
    }
    setErrors({});
    inFlight.current = true;
    setSend({ status: 'sending' });
    try {
      await api.submitCreatorRequest({
        creator_name: name,
        instagram_url: url,
        creator_type: type,
        description,
        rights_confirmed: true,
      });
      void navigate(REQUEST_STATUS_PATH, { replace: true });
    } catch (error) {
      // Everything typed stays. A lost session is handled by the auth layer, which replaces this page.
      if (error instanceof ApiError && error.code === 'CREATOR_REQUEST_BLOCKED') {
        const block = CreatorRequestBlockSchema.safeParse(error.details);
        setSend({ status: 'idle' });
        if (block.success) {
          onBlocked(block.data);
          return;
        }
      }
      const fields =
        error instanceof ApiError && error.status === 400 ? serverFieldErrors(error.details) : null;
      if (fields) {
        setErrors(fields);
        setSend({ status: 'idle' });
        focusFirst(fields);
      } else {
        setSend({
          status: 'failed',
          offline: error instanceof NetworkError || !(error instanceof ApiError),
        });
      }
    } finally {
      inFlight.current = false;
    }
  };

  const showCounter = !errors.description || length > 0;

  return (
    <form className={styles.page} onSubmit={(event) => void onSubmit(event)} noValidate>
      <header className={styles.header}>
        <Link to="/profile" className={styles.back} aria-label="Kembali">
          <ChevronLeftIcon size={24} strokeWidth={1.75} />
        </Link>
        <h1 className={styles.headerTitle}>Ajukan Jadi Creator</h1>
      </header>

      <div className={styles.scroll}>
        <div className={styles.body}>
          {rejected ? (
            // The reason is admin text: a plain text node, never HTML.
            <div className={styles.note}>
              <InfoCircleIcon size={18} strokeWidth={2} />
              <span>Alasan penolakan sebelumnya: {rejected.review_reason}</span>
            </div>
          ) : null}

          {blocked ? (
            <div role="status" className={`${styles.banner} ${styles.bannerBlocked}`}>
              <span className={`${styles.bannerDisc} ${styles.discBlocked}`}>
                <HourglassIcon size={22} strokeWidth={2} />
              </span>
              <div className={styles.bannerText}>
                <div className={styles.bannerTitle}>Belum bisa mengajukan</div>
                <div className={styles.bannerBody}>
                  Permintaan menjadi creator dapat diajukan setelah seluruh langganan pelanggan
                  berakhir.
                </div>
              </div>
            </div>
          ) : null}

          {send.status === 'failed' ? (
            <div role="alert" className={`${styles.banner} ${styles.bannerError}`}>
              <span className={`${styles.bannerDisc} ${styles.discError}`}>
                <AlertCircleIcon size={22} strokeWidth={2} />
              </span>
              <div className={styles.bannerText}>
                <div className={styles.bannerTitle}>Permintaan belum terkirim</div>
                <div className={styles.bannerBody}>
                  {send.offline
                    ? 'Koneksi terputus. Isianmu masih ada di sini. Coba kirim lagi.'
                    : REQUEST_GAP_COPY.submitFailedServer}
                </div>
              </div>
            </div>
          ) : null}

          <fieldset
            className={
              blocked
                ? `${styles.fields} ${styles.blocked}`
                : sending
                  ? `${styles.fields} ${styles.sending}`
                  : styles.fields
            }
            disabled={inert}
          >
            <div>
              <label htmlFor="creator-name" className={styles.label}>
                Nama creator
              </label>
              <input
                id="creator-name"
                ref={(node) => {
                  refs.current.creator_name = node;
                }}
                className={errors.creator_name ? `${styles.input} ${styles.invalid}` : styles.input}
                value={name}
                autoComplete="off"
                aria-invalid={errors.creator_name ? true : undefined}
                aria-describedby="creator-name-help"
                onChange={(event) => {
                  setName(event.target.value);
                  revalidate({ creator_name: event.target.value });
                }}
              />
              <div
                id="creator-name-help"
                className={errors.creator_name ? `${styles.help} ${styles.error}` : styles.help}
              >
                {errors.creator_name ?? 'Terisi dari nama tampilmu. Bisa diubah.'}
              </div>
            </div>

            <div>
              <label htmlFor="instagram-url" className={styles.label}>
                Link profil Instagram
              </label>
              <input
                id="instagram-url"
                ref={(node) => {
                  refs.current.instagram_url = node;
                }}
                className={
                  errors.instagram_url ? `${styles.input} ${styles.invalid}` : styles.input
                }
                value={url}
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://instagram.com/namaakun"
                aria-invalid={errors.instagram_url ? true : undefined}
                aria-describedby="instagram-url-help"
                onChange={(event) => {
                  setUrl(event.target.value);
                  revalidate({ instagram_url: event.target.value });
                }}
              />
              <div
                id="instagram-url-help"
                className={errors.instagram_url ? `${styles.help} ${styles.error}` : styles.help}
              >
                {errors.instagram_url ?? 'Dipakai admin untuk memeriksa akunmu.'}
              </div>
            </div>

            <div>
              <div className={styles.label} id="creator-type-label">
                Jenis creator
              </div>
              <div role="radiogroup" aria-labelledby="creator-type-label" className={styles.list}>
                {TYPES.map((option, index) => {
                  const on = option.value === type;
                  return (
                    <button
                      key={option.value}
                      ref={(node) => {
                        radios.current[index] = node;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      // Roving tabindex: one stop in the group, arrows move inside it.
                      tabIndex={on ? 0 : -1}
                      className={on ? `${styles.option} ${styles.optionOn}` : styles.option}
                      onClick={() => chooseType(index)}
                      onKeyDown={(event) => onRadioKey(event, index)}
                    >
                      <span className={on ? `${styles.radio} ${styles.radioOn}` : styles.radio}>
                        {on ? <span className={styles.dot} /> : null}
                      </span>
                      <span>
                        <span className={styles.optionTitle}>{option.title}</span>
                        <span className={styles.optionDetail}>{option.detail}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label htmlFor="description" className={styles.label}>
                Deskripsi singkat konten
              </label>
              <textarea
                id="description"
                ref={(node) => {
                  refs.current.description = node;
                }}
                className={
                  errors.description ? `${styles.textarea} ${styles.invalid}` : styles.textarea
                }
                value={description}
                rows={4}
                placeholder="Ceritakan konten yang kamu buat"
                aria-invalid={errors.description ? true : undefined}
                aria-describedby="description-help"
                onChange={(event) => {
                  setDescription(event.target.value);
                  revalidate({ description: event.target.value });
                }}
              />
              <div
                id="description-help"
                className={errors.description ? `${styles.help} ${styles.error}` : styles.help}
              >
                {errors.description ? `${errors.description} ` : ''}
                {showCounter ? (
                  <span aria-live="polite">
                    {length}/{CREATOR_DESCRIPTION_MAX}
                  </span>
                ) : null}
              </div>
            </div>

            <div>
              <label className={styles.agree}>
                <input
                  type="checkbox"
                  ref={(node) => {
                    refs.current.rights_confirmed = node;
                  }}
                  className={styles.checkbox}
                  checked={agreed}
                  aria-invalid={errors.rights_confirmed ? true : undefined}
                  aria-describedby={errors.rights_confirmed ? 'rights-error' : undefined}
                  onChange={(event) => {
                    setAgreed(event.target.checked);
                    revalidate({ rights_confirmed: event.target.checked });
                  }}
                />
                <span>Saya berhak mengelola identitas dan konten creator yang diajukan.</span>
              </label>
              {errors.rights_confirmed ? (
                <div
                  id="rights-error"
                  className={`${styles.help} ${styles.error} ${styles.agreeError}`}
                >
                  {errors.rights_confirmed}
                </div>
              ) : null}
            </div>
          </fieldset>

          <div className={styles.note}>
            <InfoCircleIcon size={18} strokeWidth={2} />
            <span>
              Permintaan akan ditinjau admin. Setelah disetujui, akun ini berubah menjadi akun
              creator dan tidak memiliki mode pelanggan.
            </span>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        {sending ? (
          <button type="submit" className={styles.saving} disabled aria-busy="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 44 44"
              aria-hidden="true"
              className={styles.spin}
            >
              <circle cx="22" cy="22" r="18" fill="none" stroke="#D8C0CA" strokeWidth="5" />
              <path
                d="M22 4a18 18 0 0 1 18 18"
                fill="none"
                stroke="#A83F67"
                strokeWidth="5"
                strokeLinecap="round"
              />
            </svg>
            Mengirim…
          </button>
        ) : (
          <button
            type="submit"
            className={styles.submit}
            disabled={blocked !== null}
            aria-disabled={blocked !== null ? true : undefined}
          >
            <SendIcon size={20} strokeWidth={2} />
            Kirim Permintaan
          </button>
        )}
      </div>
    </form>
  );
}

type Load =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; state: CreatorRequestStateResponse };

/**
 * `CreatorRequest` + `RequestStates` + `CreatorRequestBlocked` (USER only, no bottom navigation).
 * The request and subscription state comes from the server; a pending request sends the user to the
 * status screen, a rejected one shows the retry variant (`CreatorRequestRetry`: prefilled, with the
 * reason on top) and the server re-checks the block on every submit.
 */
export function CreatorRequestPage({ api }: { api: Api }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [blocked, setBlocked] = useState<CreatorRequestBlock | null>(null);

  const fetchState = useCallback(() => {
    setLoad({ status: 'loading' });
    api.getCreatorRequestState().then(
      (state) => {
        setBlocked(state.blocked);
        setLoad({ status: 'ready', state });
      },
      () => setLoad({ status: 'failed' }),
    );
  }, [api]);
  useEffect(fetchState, [fetchState]);

  if (load.status === 'ready') {
    if (load.state.request?.status === 'PENDING') {
      return <Navigate to={REQUEST_STATUS_PATH} replace />;
    }
    const latest = load.state.request;
    return (
      <RequestForm
        api={api}
        rejected={latest?.status === 'REJECTED' ? latest : null}
        blocked={blocked}
        onBlocked={setBlocked}
      />
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/profile" className={styles.back} aria-label="Kembali">
          <ChevronLeftIcon size={24} strokeWidth={1.75} />
        </Link>
        <h1 className={styles.headerTitle}>Ajukan Jadi Creator</h1>
      </header>
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
