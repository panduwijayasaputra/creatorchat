import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { TIMEZONE_OPTIONS, timezoneDetail, type TimezoneId } from '@creatorchat/contracts';
import { AlertCircleIcon, CheckIcon, ChevronLeftIcon, HourglassIcon } from '@creatorchat/ui';
import { useAuth } from '../auth/AuthProvider';
import { BottomToast, useFlashMessage } from '../components/BottomToast';
import { CREATOR_GAP_COPY } from './creator-copy';
import styles from './creator-timezone.module.css';

type Save = 'idle' | 'saving' | 'failed';

/** `CrTimezone`: the creator's display timezone (display only; stored times stay UTC). */
export function CreatorTimezonePage() {
  const { state, updateTimezone } = useAuth();
  const [flash, showFlash] = useFlashMessage();
  const user = state.status === 'authenticated' ? state.user : null;
  // A saved zone outside the list (not created by the app) simply starts with nothing marked.
  const [selected, setSelected] = useState<string>(user?.timezone ?? '');
  const [save, setSave] = useState<Save>('idle');
  const inFlight = useRef(false);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  if (!user) return null;
  const saving = save === 'saving';
  const now = new Date();

  const choose = (index: number) => {
    const option = TIMEZONE_OPTIONS[index];
    if (!option) return;
    setSelected(option.id);
    refs.current[index]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = TIMEZONE_OPTIONS.length - 1;
    const next =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? (index + 1) % (last + 1)
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? (index + last) % (last + 1)
          : null;
    if (next === null) return;
    event.preventDefault();
    choose(next);
  };

  const onSave = async () => {
    if (inFlight.current || !selected) return;
    inFlight.current = true;
    setSave('saving');
    try {
      await updateTimezone(selected as TimezoneId);
      setSave('idle');
      showFlash(CREATOR_GAP_COPY.timezoneSaved);
    } catch {
      // The selection stays as chosen; a lost session is handled by the auth layer.
      setSave('failed');
    } finally {
      inFlight.current = false;
    }
  };

  const selectedIndex = TIMEZONE_OPTIONS.findIndex((option) => option.id === selected);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/settings" className={styles.back} aria-label="Kembali">
          <ChevronLeftIcon size={24} strokeWidth={1.75} />
        </Link>
        <h1 className={styles.headerTitle}>Zona waktu</h1>
      </header>

      <div className={styles.scroll}>
        <div className={saving ? `${styles.body} ${styles.dimmed}` : styles.body}>
          {save === 'failed' ? (
            <div role="alert" className={styles.banner}>
              <span className={styles.bannerDisc}>
                <AlertCircleIcon size={22} strokeWidth={2} />
              </span>
              <div>
                <div className={styles.bannerTitle}>{CREATOR_GAP_COPY.timezoneFailedTitle}</div>
                <div className={styles.bannerBody}>{CREATOR_GAP_COPY.timezoneFailedBody}</div>
              </div>
            </div>
          ) : null}

          <div role="radiogroup" aria-label="Zona waktu" className={styles.list}>
            {TIMEZONE_OPTIONS.map((option, index) => {
              const checked = option.id === selected;
              return (
                <button
                  key={option.id}
                  ref={(node) => {
                    refs.current[index] = node;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  // Roving tabindex: one stop in the group, arrows move inside it.
                  tabIndex={checked || (selectedIndex === -1 && index === 0) ? 0 : -1}
                  className={styles.option}
                  onClick={() => choose(index)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                >
                  <span className={checked ? `${styles.radio} ${styles.radioOn}` : styles.radio}>
                    {checked ? <span className={styles.dot} /> : null}
                  </span>
                  <span className={styles.optionText}>
                    <span className={styles.optionTitle}>{option.label}</span>
                    <span className={styles.optionDetail}>{timezoneDetail(option.id, now)}</span>
                  </span>
                  {checked ? (
                    <CheckIcon size={20} strokeWidth={2.4} className={styles.check} />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className={styles.note}>
            <span className={styles.noteDisc}>
              <HourglassIcon size={22} strokeWidth={2} />
            </span>
            <div className={styles.noteText}>
              <div className={styles.noteTitle}>Apa yang berubah?</div>
              <div className={styles.noteBody}>
                Mengganti zona hanya mengubah tampilan jam di aplikasi, seperti waktu pesan di chat.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        {saving ? (
          <button type="button" className={styles.saving} disabled aria-busy="true">
            Menyimpan…
          </button>
        ) : (
          <button
            type="button"
            className={styles.submit}
            disabled={!selected}
            onClick={() => void onSave()}
          >
            Simpan Zona Waktu
          </button>
        )}
      </div>
      <BottomToast message={flash} bottom={112} />
    </div>
  );
}
