import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  ACCOUNT_SECURITY_CHANNEL,
  authorizeConnection,
  type ServerEnv,
  type UserAuthService,
} from '@creatorchat/backend-core';
import {
  REALTIME_PATH,
  RealtimeAuthSchema,
  userRoom,
  type RealtimeConnectError,
  type RealtimeEvents,
} from '@creatorchat/contracts';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import pg from 'pg';
import { Server } from 'socket.io';
import { USER_AUTH } from '../../common/auth/tokens.js';
import { ENV } from '../../common/infra/tokens.js';

/** Nothing is sent by clients: the server reads no events, so no client-supplied id can matter. */
type ClientEvents = Record<string, never>;
/** socket.io wants listener signatures, the contract has payload types. */
type ServerToClient = { [K in keyof RealtimeEvents]: (payload: RealtimeEvents[K]) => void };
interface SocketData {
  userId: string;
  role: string;
  token: string;
}

/** How often every open socket is re-authenticated (session, status, version, token expiry). */
const RECHECK_MS = 30_000;
const LISTEN_RETRY_MS = 2_000;

const refusal = (code: RealtimeConnectError) =>
  Object.assign(new Error('refused'), { data: { code } });

/**
 * The Socket.IO gateway (US-031). A socket is accepted only with a valid app session
 * (`authorizeConnection`, the same rules as HTTP) and joins exactly one room, `user:<its own id>`,
 * chosen by the server. Events arrive through the Redis adapter from the worker's publisher; the
 * socket carries signals only and has no write path. A block or role change drops the user's
 * sockets at once (PostgreSQL NOTIFY, delivered on commit); a periodic recheck covers everything
 * else, including expired tokens.
 */
/**
 * The Redis adapter fires its subscribe / publish commands without awaiting them, so a rejection
 * (Redis down, or the client closing) would be an unhandled rejection, which ends a Node process.
 * These are signals that clients recover over HTTP, so a failed command is dropped quietly.
 */
function quiet(client: Redis): void {
  for (const name of [
    'subscribe',
    'psubscribe',
    'unsubscribe',
    'punsubscribe',
    'publish',
  ] as const) {
    const original = client[name].bind(client) as (...args: unknown[]) => Promise<unknown>;
    (client as unknown as Record<string, unknown>)[name] = (...args: unknown[]) =>
      original(...args).catch(() => undefined);
  }
}

@Injectable()
export class RealtimeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(RealtimeService.name);
  private io: Server<ClientEvents, ServerToClient, Record<string, never>, SocketData> | null = null;
  private redis: Redis[] = [];
  private listener: pg.Client | null = null;
  private timer: NodeJS.Timeout | undefined;
  private closing = false;

  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(USER_AUTH) private readonly auth: UserAuthService | null,
    @Inject(HttpAdapterHost) private readonly host: HttpAdapterHost,
  ) {}

  onApplicationBootstrap(): void {
    // Without the session secrets nobody can sign in, so there is nothing to serve.
    if (!this.auth) return;
    const auth = this.auth;
    const prefix = this.env.NODE_ENV === 'test' ? 'test:socket.io' : 'socket.io';
    const pub = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: 1 });
    // The subscriber waits for its connection instead of failing after one retry, so the adapter's
    // startup subscriptions still happen once Redis is reachable.
    const sub = pub.duplicate({ maxRetriesPerRequest: null });
    for (const client of [pub, sub]) {
      client.on('error', () => undefined);
      quiet(client);
    }
    this.redis = [pub, sub];

    const allowed = new Set(this.env.ALLOWED_ORIGINS);
    const io = new Server<ClientEvents, ServerToClient, Record<string, never>, SocketData>(
      this.host.httpAdapter.getHttpServer(),
      {
        path: REALTIME_PATH,
        serveClient: false,
        maxHttpBufferSize: 1_000,
        cors: { origin: this.env.ALLOWED_ORIGINS },
        // The WebSocket transport is not covered by CORS: check the Origin a browser sends.
        allowRequest: (req, callback) => {
          const origin = req.headers.origin;
          callback(null, origin === undefined || allowed.has(origin));
        },
        adapter: createAdapter(pub, sub, { key: prefix }),
      },
    );
    this.io = io;

    io.use((socket, next) => {
      const parsed = RealtimeAuthSchema.safeParse(socket.handshake.auth);
      if (!parsed.success) return next(refusal('UNAUTHENTICATED'));
      void authorizeConnection(auth, parsed.data.token, { roles: ['USER', 'CREATOR'] }).then(
        (decision) => {
          if (!decision.ok) {
            return next(
              refusal(decision.reason === 'forbidden_role' ? 'FORBIDDEN_ROLE' : 'UNAUTHENTICATED'),
            );
          }
          socket.data = {
            userId: decision.user.user.id,
            role: decision.user.role,
            token: parsed.data.token,
          };
          next();
        },
        () => next(refusal('UNAUTHENTICATED')),
      );
    });
    io.on('connection', (socket) => {
      void socket.join(userRoom(socket.data.userId));
    });

    this.timer = setInterval(() => void this.recheckAll(), RECHECK_MS);
    this.timer.unref();
    void this.listen();
  }

  /** Re-authenticates every open socket; a stale one gets `session.ended` and is disconnected. */
  async recheckAll(): Promise<void> {
    if (!this.io || !this.auth) return;
    for (const socket of await this.io.fetchSockets()) {
      const data = socket.data;
      let still: boolean;
      try {
        const user = await this.auth.authenticate(data.token);
        still = user !== null && user.role === data.role && user.user.id === data.userId;
      } catch {
        still = true; // a database hiccup must not log everyone out; the next tick retries
      }
      if (!still) {
        this.io.to(socket.id).emit('session.ended', {});
        socket.disconnect(true);
      }
    }
  }

  /** Drops every open socket of the user (all processes, through the adapter). */
  disconnectUser(userId: string): void {
    this.io?.in(userRoom(userId)).disconnectSockets(true);
  }

  /** The NOTIFY listener: its own connection, retried until closed. */
  private async listen(): Promise<void> {
    if (this.closing) return;
    const client = new pg.Client({ connectionString: this.env.DATABASE_URL });
    client.on('error', () => undefined);
    client.on('end', () => {
      if (this.listener === client) this.listener = null;
      if (!this.closing) setTimeout(() => void this.listen(), LISTEN_RETRY_MS).unref();
    });
    client.on('notification', (message) => {
      if (message.channel === ACCOUNT_SECURITY_CHANNEL && message.payload) {
        this.disconnectUser(message.payload);
      }
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${ACCOUNT_SECURITY_CHANNEL}`);
      this.listener = client;
      if (this.closing) await client.end();
    } catch {
      this.log.warn('account-security listener not connected; the periodic recheck still applies');
      await client.end().catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    const listener = this.listener;
    this.listener = null;
    await listener?.end().catch(() => undefined);
    if (this.io) {
      this.io.disconnectSockets(true);
      // Not io.close(): that would also close the HTTP server Fastify owns.
      this.io.engine.close();
    }
    for (const client of this.redis) client.disconnect();
  }
}
