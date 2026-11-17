import { useEffect, useRef, useState } from 'react';
import type { GrantableUsersResponse } from '@creatorchat/contracts';
import { SearchInput } from '@creatorchat/ui';
import { ACCESS_COPY as C } from '../../copy';
import type { AccessUser } from './AccessTarget';
import styles from './subscriptions.module.css';

type State =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; data: GrantableUsersResponse };

export interface UserPickerProps {
  /** Server-side search (max 20 results). */
  listUsers: (q: string | null, signal: AbortSignal) => Promise<GrantableUsersResponse>;
  value: AccessUser | null;
  onChange: (user: AccessUser | null) => void;
  open: boolean;
}

const SEARCH_DEBOUNCE_MS = 300;

/** Placeholder picker for Berikan Akses on the creator side (no board): a search box and a list. */
export function UserPicker({ listUsers, value, onChange, open }: UserPickerProps) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ status: 'loading' });
  const listRef = useRef(listUsers);
  listRef.current = listUsers;

  useEffect(() => {
    if (open) {
      setText('');
      setQuery(null);
    }
  }, [open]);

  useEffect(() => {
    const trimmed = text.trim() || null;
    if (trimmed === query) return;
    const timer = setTimeout(() => setQuery(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, query]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState({ status: 'loading' });
    listRef.current(query, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'failed' });
      },
    );
    return () => controller.abort();
  }, [open, query, attempt]);

  let list: React.ReactNode;
  if (state.status === 'loading') {
    list = <div className={styles.pickerMessage}>{C.picker.loading}</div>;
  } else if (state.status === 'failed') {
    list = (
      <div className={styles.pickerMessage} role="alert">
        {C.picker.failed}{' '}
        <button type="button" className={styles.retry} onClick={() => setAttempt((n) => n + 1)}>
          {C.picker.retry}
        </button>
      </div>
    );
  } else if (state.data.creator_status !== 'ACTIVE') {
    list = <div className={styles.pickerMessage}>{C.picker.blockedCreator}</div>;
  } else if (state.data.items.length === 0) {
    list = <div className={styles.pickerMessage}>{C.picker.empty}</div>;
  } else {
    list = (
      <div className={styles.results} role="listbox" aria-label={C.picker.label}>
        {state.data.items.map((u) => (
          <button
            key={u.id}
            type="button"
            role="option"
            aria-selected={value?.id === u.id}
            aria-pressed={value?.id === u.id}
            className={styles.option}
            onClick={() =>
              onChange({
                id: u.id,
                display_name: u.display_name,
                telegram_username: u.telegram_username,
                telegram_id: u.telegram_id,
              })
            }
          >
            <span>{u.display_name}</span>
            <span className={styles.optionMeta}>
              {u.telegram_username ? `@${u.telegram_username} · ` : ''}ID {u.telegram_id}
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.picker}>
      <div className={styles.fieldLabel}>{C.picker.label}</div>
      <SearchInput
        aria-label={C.picker.search}
        placeholder={C.picker.search}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {list}
    </div>
  );
}
