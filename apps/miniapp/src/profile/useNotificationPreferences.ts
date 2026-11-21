import type { NotificationPreferencesResponse } from '@creatorchat/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MiniappApi } from '../auth/api-client';

export type PreferenceKey = keyof NotificationPreferencesResponse;

type PreferencesApi = Pick<
  MiniappApi,
  'getNotificationPreferences' | 'updateNotificationPreferences'
>;

export type PreferencesState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; values: NotificationPreferencesResponse };

/** What the switches show until the server answers (and when it cannot): the defaults. */
export const DEFAULT_PREFERENCES: NotificationPreferencesResponse = {
  messages_enabled: true,
  show_content: false,
};

/**
 * The two Notifikasi switches of `/profile` (US-043). A tap shows at once and is saved with a
 * PATCH that names only that switch, so the other one is never overwritten. At most one request per
 * switch is in flight; taps made meanwhile only change what is wanted, and the last tap wins. A
 * refused save puts the switch back to what the server last confirmed and calls `onError`.
 */
export function useNotificationPreferences(api: PreferencesApi, onError: () => void) {
  const [state, setState] = useState<PreferencesState>({ status: 'loading' });
  const confirmed = useRef<NotificationPreferencesResponse | null>(null);
  const wanted = useRef<Partial<NotificationPreferencesResponse>>({});
  const sending = useRef<Partial<Record<PreferenceKey, boolean>>>({});
  const alive = useRef(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    alive.current = true;
    apiRef.current.getNotificationPreferences().then(
      (values) => {
        if (!alive.current) return;
        confirmed.current = values;
        setState({ status: 'ready', values });
      },
      () => {
        if (alive.current) setState({ status: 'failed' });
      },
    );
    return () => {
      alive.current = false;
    };
  }, []);

  const flush = useCallback(async (key: PreferenceKey) => {
    sending.current[key] = true;
    try {
      for (;;) {
        const want = wanted.current[key];
        const known = confirmed.current;
        if (want === undefined || !known || want === known[key]) return;
        try {
          const saved = await apiRef.current.updateNotificationPreferences({ [key]: want });
          confirmed.current = { ...(confirmed.current ?? saved), [key]: saved[key] };
        } catch {
          wanted.current[key] = undefined;
          if (!alive.current) return;
          const back = confirmed.current?.[key];
          if (back !== undefined) {
            setState((s) =>
              s.status === 'ready' ? { status: 'ready', values: { ...s.values, [key]: back } } : s,
            );
          }
          onErrorRef.current();
          return;
        }
      }
    } finally {
      sending.current[key] = false;
    }
  }, []);

  const toggle = useCallback(
    (key: PreferenceKey, value: boolean) => {
      wanted.current[key] = value;
      setState((s) =>
        s.status === 'ready' ? { status: 'ready', values: { ...s.values, [key]: value } } : s,
      );
      if (!sending.current[key]) void flush(key);
    },
    [flush],
  );

  return { state, toggle };
}
