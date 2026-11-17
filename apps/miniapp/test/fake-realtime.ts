import type { RealtimeConnection, RealtimeFactory } from '../src/realtime/types';

type Handler = (...args: unknown[]) => void;

/** A scripted socket: tests call `serverEmit`, `drop` and `refuse` the way the server would. */
export class FakeSocket implements RealtimeConnection {
  private handlers = new Map<string, Set<Handler>>();
  connectCalls = 0;
  disconnectCalls = 0;
  /** What `getToken()` returned at each connect call. */
  tokens: (string | null)[] = [];
  constructor(private readonly getToken: () => string | null) {}

  on(event: string, handler: Handler) {
    const set = this.handlers.get(event) ?? new Set();
    this.handlers.set(event, set);
    set.add(handler);
  }
  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler);
  }
  connect() {
    this.connectCalls += 1;
    this.tokens.push(this.getToken());
  }
  disconnect() {
    this.disconnectCalls += 1;
  }

  private fire(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.forEach((h) => h(...args));
  }
  /** The handshake succeeded. */
  open() {
    this.fire('connect');
  }
  serverEmit(event: string, payload: unknown) {
    this.fire(event, payload);
  }
  /** The transport dropped (Socket.IO reconnects by itself). */
  drop(reason = 'transport close') {
    this.fire('disconnect', reason);
  }
  /** The server hung up (block, role change, expired token). */
  serverHangup() {
    this.fire('disconnect', 'io server disconnect');
  }
  refuse(code: 'UNAUTHENTICATED' | 'FORBIDDEN_ROLE') {
    this.fire('connect_error', Object.assign(new Error('refused'), { data: { code } }));
  }
  /** A network failure while connecting (no `data`). */
  networkError() {
    this.fire('connect_error', new Error('xhr poll error'));
  }
}

export function createFakeRealtime(): {
  factory: RealtimeFactory;
  sockets: FakeSocket[];
  last: () => FakeSocket;
} {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    last: () => sockets[sockets.length - 1]!,
    factory: ({ getToken }) => {
      const socket = new FakeSocket(getToken);
      sockets.push(socket);
      return socket;
    },
  };
}
