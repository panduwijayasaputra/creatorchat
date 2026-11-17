import { useEffect, useState } from 'react';
import { useRealtimeStatus } from '../realtime/RealtimeProvider';

/**
 * Whether the inbox should look connected: the browser is online and, once the socket has
 * connected, it has not dropped (US-031). Before the first connect, or with realtime off, only the
 * browser's own state counts.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  const { status, hasConnected } = useRealtimeStatus();
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online && !(hasConnected && status === 'disconnected');
}
