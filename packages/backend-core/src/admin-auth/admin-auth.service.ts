import { ADMIN_LOGIN_LOCK_SECONDS, type AdminProfile } from '@creatorchat/contracts';
import { verifyDummyPassword, verifyPassword, type PrismaClient } from '@creatorchat/db';
import type { LoginLimiter } from './login-limiter.js';
import {
  generateOpaqueToken,
  hashRefreshToken,
  MIN_SECRET_BYTES,
  signAccessToken,
  usernameFingerprint,
  verifyAccessToken,
} from './tokens.js';

export interface AdminAuthConfig {
  accessSecret: string;
  refreshSecret: string;
  /** Default 15 minutes. */
  accessTtlSeconds?: number;
  /** Idle lifetime of a refresh token, default 7 days. */
  refreshIdleSeconds?: number;
  /** Absolute cap from the session start, default 30 days. */
  refreshAbsoluteSeconds?: number;
  /** An already-rotated token presented within this window reads as a racing tab, default 10 s. */
  reuseGraceSeconds?: number;
}

export interface AdminAuthDeps {
  prisma: PrismaClient;
  limiter: LoginLimiter;
  config: AdminAuthConfig;
  clock?: () => Date;
}

export interface RequestContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

export interface IssuedTokens {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export type LoginOutcome =
  | { ok: true; admin: AdminProfile; tokens: IssuedTokens }
  | { ok: false; reason: 'invalid'; attempts: number }
  | { ok: false; reason: 'locked'; retryAfterSeconds: number }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number };

export type RefreshOutcome =
  | { ok: true; admin: AdminProfile; tokens: IssuedTokens }
  /** The token is unknown, expired, revoked or reused: the caller clears its cookies. */
  | { ok: false; reason: 'invalid' }
  /** A token rotated moments ago: probably another tab. Do not touch the cookies. */
  | { ok: false; reason: 'race' };

export interface AuthenticatedAdmin {
  admin: AdminProfile;
  sessionId: string;
}

export class AdminAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminAuthConfigError';
  }
}

interface AdminRow {
  id: string;
  username: string;
}

const DAY = 24 * 60 * 60;

export function toAdminProfile(admin: AdminRow): AdminProfile {
  return { id: admin.id, username: admin.username, role: 'Administrator' };
}

/** Validates secrets without constructing the service (used by the API to decide on a 503). */
export function isAdminAuthConfigured(secrets: {
  accessSecret?: string | undefined;
  refreshSecret?: string | undefined;
}): secrets is { accessSecret: string; refreshSecret: string } {
  const { accessSecret, refreshSecret } = secrets;
  return (
    accessSecret !== undefined &&
    refreshSecret !== undefined &&
    accessSecret.length >= MIN_SECRET_BYTES &&
    refreshSecret.length >= MIN_SECRET_BYTES &&
    accessSecret !== refreshSecret
  );
}

export class AdminAuthService {
  private readonly prisma: PrismaClient;
  private readonly limiter: LoginLimiter;
  private readonly now: () => Date;
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTtl: number;
  private readonly refreshIdle: number;
  private readonly refreshAbsolute: number;
  private readonly graceMs: number;

  constructor(deps: AdminAuthDeps) {
    if (!isAdminAuthConfigured(deps.config)) {
      throw new AdminAuthConfigError(
        `Admin token secrets must be set, at least ${MIN_SECRET_BYTES} characters and different from each other.`,
      );
    }
    this.prisma = deps.prisma;
    this.limiter = deps.limiter;
    this.now = deps.clock ?? (() => new Date());
    this.accessSecret = deps.config.accessSecret;
    this.refreshSecret = deps.config.refreshSecret;
    this.accessTtl = deps.config.accessTtlSeconds ?? 15 * 60;
    this.refreshIdle = deps.config.refreshIdleSeconds ?? 7 * DAY;
    this.refreshAbsolute = deps.config.refreshAbsoluteSeconds ?? 30 * DAY;
    this.graceMs = (deps.config.reuseGraceSeconds ?? 10) * 1000;
  }

  async login(
    input: { username: string; password: string },
    context: RequestContext = {},
  ): Promise<LoginOutcome> {
    const username = input.username.trim().toLowerCase();
    const fingerprint = usernameFingerprint(username);

    // Counters are checked before any hashing so a locked account costs no CPU.
    const verdict = await this.limiter.check(fingerprint, context.ip);
    if (verdict.lockedSeconds > 0) {
      return { ok: false, reason: 'locked', retryAfterSeconds: verdict.lockedSeconds };
    }
    if (verdict.ipBlockedSeconds > 0) {
      return { ok: false, reason: 'rate_limited', retryAfterSeconds: verdict.ipBlockedSeconds };
    }

    const admin = await this.prisma.adminAccount.findUnique({ where: { username } });
    // Same Argon2id work whether or not the account exists, so timing does not reveal it.
    const passwordOk = admin
      ? await verifyPassword(admin.passwordHash, input.password)
      : await verifyDummyPassword(input.password);

    if (!admin || !passwordOk || admin.status !== 'ACTIVE') {
      const failure = await this.limiter.recordFailure(fingerprint, context.ip);
      await this.audit({
        actorId: admin?.id ?? null,
        action: failure.locked ? 'admin.login.locked' : 'admin.login.failed',
        targetId: admin?.id ?? null,
        changes: { attempt: failure.attempts, usernameFingerprint: fingerprint.slice(0, 12) },
        context,
      });
      return failure.locked
        ? { ok: false, reason: 'locked', retryAfterSeconds: ADMIN_LOGIN_LOCK_SECONDS }
        : { ok: false, reason: 'invalid', attempts: failure.attempts };
    }

    await this.limiter.reset(fingerprint);
    const now = this.now();
    const refreshToken = generateOpaqueToken();
    const refreshExpiresAt = new Date(now.getTime() + this.refreshIdle * 1000);
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          adminId: admin.id,
          refreshTokenHash: hashRefreshToken(this.refreshSecret, refreshToken),
          expiresAt: refreshExpiresAt,
          lastUsedAt: now,
          createdAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'admin.login.succeeded',
          targetType: 'admin_account',
          targetId: admin.id,
          requestId: context.requestId ?? null,
        },
      });
      return created;
    });

    return {
      ok: true,
      admin: toAdminProfile(admin),
      tokens: await this.issue(admin.id, session.id, refreshToken, refreshExpiresAt, now),
    };
  }

  async refresh(refreshToken: string, context: RequestContext = {}): Promise<RefreshOutcome> {
    const now = this.now();
    const oldHash = hashRefreshToken(this.refreshSecret, refreshToken);
    const nextToken = generateOpaqueToken();
    const nextHash = hashRefreshToken(this.refreshSecret, nextToken);
    const idleExpiry = new Date(now.getTime() + this.refreshIdle * 1000);

    // One atomic statement: two concurrent refreshes with the same token cannot both win.
    const rotated = await this.prisma.$queryRaw<
      { id: string; admin_id: string; expires_at: Date }[]
    >`
      UPDATE sessions
      SET previous_refresh_token_hash = refresh_token_hash,
          refresh_token_hash = ${nextHash},
          rotated_at = ${now}::timestamptz,
          last_used_at = ${now}::timestamptz,
          expires_at = LEAST(
            ${idleExpiry}::timestamptz,
            created_at + make_interval(secs => ${this.refreshAbsolute}::double precision)
          )
      WHERE refresh_token_hash = ${oldHash}
        AND user_id IS NULL
        AND admin_id IS NOT NULL
        AND revoked_at IS NULL
        AND expires_at > ${now}::timestamptz
        AND created_at + make_interval(secs => ${this.refreshAbsolute}::double precision) > ${now}::timestamptz
        AND EXISTS (
          SELECT 1 FROM admin_accounts a WHERE a.id = sessions.admin_id AND a.status = 'ACTIVE'
        )
      RETURNING id, admin_id, expires_at`;

    const row = rotated[0];
    if (row) {
      const admin = await this.prisma.adminAccount.findUniqueOrThrow({
        where: { id: row.admin_id },
      });
      return {
        ok: true,
        admin: toAdminProfile(admin),
        tokens: await this.issue(admin.id, row.id, nextToken, new Date(row.expires_at), now),
      };
    }

    // No live match. Was this a token that was already rotated away?
    const reused = await this.prisma.session.findUnique({
      where: { previousRefreshTokenHash: oldHash },
    });
    if (reused && reused.adminId && reused.revokedAt === null) {
      const rotatedAt = reused.rotatedAt?.getTime() ?? 0;
      if (now.getTime() - rotatedAt <= this.graceMs) return { ok: false, reason: 'race' };
      await this.revoke(reused.id, reused.adminId, 'admin.refresh.reuse_detected', context);
      return { ok: false, reason: 'invalid' };
    }

    // Known but unusable (disabled admin, expired, over the absolute cap): close it for good.
    const current = await this.prisma.session.findUnique({
      where: { refreshTokenHash: oldHash },
    });
    if (current && current.adminId && current.revokedAt === null) {
      await this.revoke(current.id, current.adminId, null, context);
    }
    return { ok: false, reason: 'invalid' };
  }

  /** Validates an access token and the live session behind it. Null means "401". */
  async authenticate(accessToken: string): Promise<AuthenticatedAdmin | null> {
    const now = this.now();
    const claims = await verifyAccessToken(this.accessSecret, accessToken, now);
    if (!claims) return null;
    const session = await this.prisma.session.findFirst({
      where: {
        id: claims.sessionId,
        adminId: claims.adminId,
        userId: null,
        revokedAt: null,
        expiresAt: { gt: now },
        admin: { is: { status: 'ACTIVE' } },
      },
      include: { admin: true },
    });
    if (!session?.admin) return null;
    return { admin: toAdminProfile(session.admin), sessionId: session.id };
  }

  /** Identifies the session by id (valid access token) or by refresh token. Idempotent. */
  async logout(
    target: { sessionId?: string | undefined; refreshToken?: string | undefined },
    context: RequestContext = {},
  ): Promise<void> {
    let session = null;
    if (target.sessionId) {
      session = await this.prisma.session.findFirst({
        where: { id: target.sessionId, userId: null, adminId: { not: null } },
      });
    } else if (target.refreshToken) {
      session = await this.prisma.session.findFirst({
        where: {
          refreshTokenHash: hashRefreshToken(this.refreshSecret, target.refreshToken),
          userId: null,
          adminId: { not: null },
        },
      });
    }
    if (session?.adminId && session.revokedAt === null) {
      await this.revoke(session.id, session.adminId, 'admin.logout', context);
    }
  }

  private async issue(
    adminId: string,
    sessionId: string,
    refreshToken: string,
    refreshExpiresAt: Date,
    now: Date,
  ): Promise<IssuedTokens> {
    return {
      sessionId,
      accessToken: await signAccessToken(
        this.accessSecret,
        { adminId, sessionId },
        now,
        this.accessTtl,
      ),
      refreshToken,
      csrfToken: generateOpaqueToken(),
      accessExpiresAt: new Date(now.getTime() + this.accessTtl * 1000),
      refreshExpiresAt,
    };
  }

  /** Revokes one session (only if still open) and writes the audit row in the same transaction. */
  private async revoke(
    sessionId: string,
    adminId: string,
    action: string | null,
    context: RequestContext,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: this.now() },
      });
      if (count === 0 || action === null) return;
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: adminId,
          action,
          targetType: 'session',
          targetId: sessionId,
          requestId: context.requestId ?? null,
        },
      });
    });
  }

  private async audit(entry: {
    actorId: string | null;
    action: string;
    targetId: string | null;
    changes: Record<string, string | number>;
    context: RequestContext;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorType: entry.actorId ? 'ADMIN' : 'SYSTEM',
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetId ? 'admin_account' : null,
        targetId: entry.targetId,
        changes: entry.changes,
        requestId: entry.context.requestId ?? null,
      },
    });
  }
}
