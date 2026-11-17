import { REALTIME_PATH } from '@creatorchat/contracts';
import { io } from 'socket.io-client';
import type { RealtimeFactory } from './types';

/**
 * The real Socket.IO client. The token goes in the handshake `auth` (never the URL) and is read
 * again for every attempt. WebSocket first, long-polling as the fallback. The client only listens:
 * HTTP stays the one way to read and write content.
 */
export function createSocketFactory(baseUrl: string): RealtimeFactory {
  return ({ getToken }) =>
    io(baseUrl.replace(/\/+$/, ''), {
      path: REALTIME_PATH,
      autoConnect: false,
      transports: ['websocket', 'polling'],
      withCredentials: false,
      auth: (callback) => callback({ token: getToken() ?? '' }),
    });
}
