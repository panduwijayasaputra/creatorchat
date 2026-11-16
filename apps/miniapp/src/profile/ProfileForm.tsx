import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  UpdateProfileRequestSchema,
  codePointLength,
} from '@creatorchat/contracts';
import {
  AlertCircleIcon,
  Avatar,
  ChevronLeftIcon,
  InfoCircleIcon,
  LockIcon,
  UploadIcon,
} from '@creatorchat/ui';
import { ApiError, NetworkError } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import { BottomToast, useFlashMessage } from '../components/BottomToast';
import { PROFILE_GAP_COPY } from './profile-copy';
import styles from './edit-profile.module.css';

interface FieldErrors {
  name?: string;
  bio?: string;
}

type Save = { status: 'idle' } | { status: 'saving' } | { status: 'failed'; offline: boolean };

/** Reads the first validation message per field from the shared schema (same rules as the server). */
function validate(name: string, bio: string): { errors: FieldErrors; ok: boolean } {
  const result = UpdateProfileRequestSchema.safeParse({ display_name: name, bio });
  if (result.success) return { errors: {}, ok: true };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] === 'bio' ? 'bio' : 'name';
    errors[field] ??= issue.message;
  }
  return { errors, ok: false };
}

/**
 * `EditProfile` / `CrEditProfile` + `EditStates`: menyimpan, validasi, berhasil, gagal (isian
 * dipertahankan). The customer and creator edit pages share it; only the back link differs, and
 * `useAuth().updateProfile` picks the endpoint from the signed-in role.
 */
export function ProfileForm({ backTo }: { backTo: string }) {
  const { state, updateProfile } = useAuth();
  const [flash, showFlash] = useFlashMessage();
  const [flashKind, setFlashKind] = useState<'success' | 'info'>('success');
  const user = state.status === 'authenticated' ? state.user : null;

  const [name, setName] = useState(user?.display_name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  // "Pakai Foto Telegram" only previews; the reset is sent with Simpan Perubahan.
  const [resetAvatar, setResetAvatar] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [checked, setChecked] = useState(false);
  const [save, setSave] = useState<Save>({ status: 'idle' });
  const nameRef = useRef<HTMLInputElement>(null);
  const bioRef = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);

  if (!user) return null;

  const saving = save.status === 'saving';
  const previewUrl = resetAvatar ? user.telegram_avatar_url : user.avatar_url;
  const bioLength = codePointLength(bio);

  const revalidate = (nextName: string, nextBio: string) => {
    if (checked) setErrors(validate(nextName, nextBio).errors);
  };

  const flashMessage = (message: string, kind: 'success' | 'info') => {
    setFlashKind(kind);
    showFlash(message);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    const { errors: found, ok } = validate(name, bio);
    setChecked(true);
    setErrors(found);
    if (!ok) {
      (found.name ? nameRef : bioRef).current?.focus();
      return;
    }
    inFlight.current = true;
    setSave({ status: 'saving' });
    try {
      const saved = await updateProfile({
        display_name: name,
        bio,
        ...(resetAvatar ? { reset_avatar: true } : {}),
      });
      setName(saved.display_name);
      setBio(saved.bio ?? '');
      setResetAvatar(false);
      setSave({ status: 'idle' });
      flashMessage('Perubahan disimpan', 'success');
    } catch (error) {
      // Input stays as typed. A lost session is handled by the auth layer, which replaces this page.
      setSave({
        status: 'failed',
        offline: error instanceof NetworkError || !(error instanceof ApiError),
      });
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <form className={styles.page} onSubmit={(event) => void onSubmit(event)} noValidate>
      <header className={styles.header}>
        <Link to={backTo} className={styles.back} aria-label="Kembali">
          <ChevronLeftIcon size={24} strokeWidth={1.75} />
        </Link>
        <h1 className={styles.headerTitle}>Edit Profil</h1>
      </header>

      <div className={styles.scroll}>
        <div className={saving ? `${styles.body} ${styles.dimmed}` : styles.body}>
          {save.status === 'failed' ? (
            <div role="alert" className={styles.banner}>
              <span className={styles.bannerDisc}>
                <AlertCircleIcon size={22} strokeWidth={2} />
              </span>
              <div className={styles.bannerText}>
                <div className={styles.bannerTitle}>Perubahan belum tersimpan</div>
                <div className={styles.bannerBody}>
                  {save.offline
                    ? 'Koneksi terputus. Isianmu masih ada di sini. Coba simpan lagi.'
                    : PROFILE_GAP_COPY.saveFailedServer}
                </div>
              </div>
            </div>
          ) : null}

          <div className={styles.photo}>
            <Avatar src={previewUrl} size={96} alt="Foto profil" />
            <div className={styles.photoActions}>
              <button
                type="button"
                className={styles.outlineButton}
                onClick={() => flashMessage(PROFILE_GAP_COPY.changePhotoSoon, 'info')}
              >
                <UploadIcon size={18} strokeWidth={2} />
                Ganti Foto
              </button>
              <button
                type="button"
                className={styles.textButton}
                onClick={() => setResetAvatar(true)}
              >
                Pakai Foto Telegram
              </button>
            </div>
          </div>

          <div className={styles.fields}>
            <div>
              <label htmlFor="display-name" className={styles.label}>
                Nama tampil
              </label>
              <input
                id="display-name"
                ref={nameRef}
                className={errors.name ? `${styles.input} ${styles.invalid}` : styles.input}
                value={name}
                placeholder="Nama tampil"
                autoComplete="off"
                aria-invalid={errors.name ? true : undefined}
                aria-describedby="display-name-help"
                onChange={(event) => {
                  setName(event.target.value);
                  revalidate(event.target.value, bio);
                }}
              />
              <div
                id="display-name-help"
                className={errors.name ? `${styles.help} ${styles.error}` : styles.help}
              >
                {errors.name ??
                  `Awalnya dari nama Telegram. Maksimal ${DISPLAY_NAME_MAX} karakter.`}
              </div>
            </div>

            <div>
              <label htmlFor="bio" className={styles.label}>
                Bio singkat (opsional)
              </label>
              <textarea
                id="bio"
                ref={bioRef}
                className={errors.bio ? `${styles.textarea} ${styles.invalid}` : styles.textarea}
                value={bio}
                rows={3}
                placeholder="Ceritakan dirimu secara singkat"
                aria-invalid={errors.bio ? true : undefined}
                aria-describedby="bio-help"
                onChange={(event) => {
                  setBio(event.target.value);
                  revalidate(name, event.target.value);
                }}
              />
              <div
                id="bio-help"
                className={errors.bio ? `${styles.help} ${styles.error}` : styles.help}
              >
                {errors.bio ? `${errors.bio} ` : ''}
                <span aria-live="polite">
                  {bioLength}/{BIO_MAX}
                </span>
              </div>
            </div>

            {user.telegram_username ? (
              <div>
                <div className={styles.label} id="username-label">
                  Username Telegram
                </div>
                <div className={styles.readonly} aria-labelledby="username-label">
                  <span>@{user.telegram_username}</span>
                  <LockIcon size={18} strokeWidth={2} />
                </div>
                <div className={styles.help}>Hanya tampil, tidak bisa diubah.</div>
              </div>
            ) : null}

            <div className={styles.note}>
              <InfoCircleIcon size={18} strokeWidth={2} />
              <span>
                Perubahan hanya berlaku pada profil aplikasi, tidak mengubah akun Telegram.
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        {saving ? (
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
            Menyimpan…
          </button>
        ) : (
          <button type="submit" className={styles.submit}>
            Simpan Perubahan
          </button>
        )}
      </div>
      <BottomToast message={flash} bottom={112} kind={flashKind} />
    </form>
  );
}
