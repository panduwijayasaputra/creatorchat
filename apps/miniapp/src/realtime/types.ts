/** The few things the app needs of a Socket.IO client, so tests can swap in a fake. */
export interface RealtimeConnection {
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  off(event: string, handler: (...args: unknown[]) => void): unknown;
  connect(): unknown;
  disconnect(): unknown;
}

/** `getToken` is read at every (re)connect, so a renewed session token is picked up. */
export type RealtimeFactory = (options: { getToken: () => string | null }) => RealtimeConnection;
