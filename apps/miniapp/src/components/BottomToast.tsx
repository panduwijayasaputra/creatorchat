import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircleIcon, InfoCircleIcon } from '@creatorchat/ui';
import styles from './BottomToast.module.css';

/**
 * The Mini App toast (`EditStates` 3): a dark bar above the bottom action area, not the admin's
 * top-right toast. Controlled by `message`; `null` renders nothing.
 */
export function BottomToast({
  message,
  bottom = 112,
  kind = 'success',
}: {
  message: string | null;
  bottom?: number;
  /** `info` is for "not available yet" notices; `success` confirms a save. */
  kind?: 'success' | 'info';
}) {
  if (message === null) return null;
  const Icon = kind === 'info' ? InfoCircleIcon : CheckCircleIcon;
  return (
    <div role="status" className={styles.toast} style={{ bottom }}>
      <Icon size={20} strokeWidth={2} />
      {message}
    </div>
  );
}

/** A message that clears itself after `duration` ms; showing a new one restarts the timer. */
export function useFlashMessage(duration = 4000) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback(
    (next: string) => {
      if (timer.current) clearTimeout(timer.current);
      setMessage(next);
      timer.current = setTimeout(() => setMessage(null), duration);
    },
    [duration],
  );

  return [message, show] as const;
}
