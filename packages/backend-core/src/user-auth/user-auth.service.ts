import { USER_SESSION_TTL_SECONDS, type UserProfile, type UserRole } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import type { FixedWindowLimiter } from './rate-limiter.js';
import { validateInitData, type TelegramUser } from './telegram-init-data.js';
import { MIN_USER_SECRET_LENGTH, signUserToken, verifyUserToken } from './user-tokens.js';

export interface UserAuthConfig {
  botToken: string;
  sessionSecret: string;
  maxAgeSeconds: number;
  /** Default 60 minutes. */
  sessionTtlSeconds?: number;
  /** All login attempts per IP per window (default 20 per 60 s). */
  attemptsPerWindow?: number;
  /** Invalid initData per IP per window (default 5 per 60 s). */
  invalidPerWindow?: number;
  windowSeconds?: number;
}

export interface UserAuthDeps {
  prisma: PrismaClient;
  limiter: FixedWindowLimiter;
  config: UserAuthConfig;
  clock?: () => Date;
}

export interface UserRequestContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

export type UserLoginOutcome =
  | { kind: 'ok'; accessToken: string; expiresIn: number; user: UserProfile }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'blocked' }
  | { kind: 'rate_limited'; retryAfterSeconds: number };

export interface AuthenticatedUser {
  user: UserProfile;
  role: UserRole;
  sessionId: string;
}

interface UserRow {
  id: string;
  telegramId: bigint;
  role: UserRole;
  displayName: string;
  telegramUsername: string | null;
  avatarUrl: string | null;
}

export class UserAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserAuthConfigError';
  }
}

/** True when login can work: a bot token and a session secret of at least 32 characters. */
export function isUserAuthConfigured(config: {
  botToken?: string | undefined;
  sessionSecret?: string | undefined;
}): config is { botToken: string; sessionSecret: string } {
  return (
    typeof config.botToken === 'string' &&
    config.botToken.length > 0 &&
    typeof config.sessionSecret === 'string' &&
    config.sessionSecret.length >= MIN_USER_SECRET_LENGTH
  );
}

export function toUserProfile(user: UserRow): UserProfile {
  return {
    id: user.id,
    telegram_id: user.telegramId.toString(),
    role: user.role,
    status: 'ACTIVE',
    display_name: user.displayName,
    telegram_username: user.telegramUsername,
    avatar_url: user.avatarUrl,
  };
}

function displayNameOf(user: TelegramUser): string {
  return [user.firstName, user.lastName]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .trim()
    .slice(0, 100);
}

/** Only an https URL is kept as the initial avatar; anything else is dropped. */
function avatarOf(photoUrl: string | undefined): string | null {
  if (!photoUrl || photoUrl.length > 2048) return null;
  try {
    return new URL(photoUrl).protocol === 'https:' ? photoUrl : null;
  } catch {
    return null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}

export class UserAuthService {
  private readonly prisma: PrismaClient;
  private readonly limiter: FixedWindowLimiter;
  private readonly now: () => Date;
  private readonly botToken: string;
  private readonly secret: string;
  private readonly maxAge: number;
  private readonly ttl: number;
  private readonly attempts: number;
  private readonly invalidLimit: number;
  private readonly window: number;

  constructor(deps: UserAuthDeps) {
    if (!isUserAuthConfigured({ ...deps.config })) {
      throw new UserAuthConfigError(
        `Telegram bot token and a session secret of at least ${MIN_USER_SECRET_LENGTH} characters are required.`,
      );
    }
    this.prisma = deps.prisma;
    this.limiter = deps.limiter;
    this.now = deps.clock ?? (() => new Date());
    this.botToken = deps.config.botToken;
    this.secret = deps.config.sessionSecret;
    this.maxAge = deps.config.maxAgeSeconds;
    this.ttl = deps.config.sessionTtlSeconds ?? USER_SESSION_TTL_SECONDS;
    this.attempts = deps.config.attemptsPerWindow ?? 20;
    this.invalidLimit = deps.config.invalidPerWindow ?? 5;
    this.window = deps.config.windowSeconds ?? 60;
  }

  async loginWithTelegram(
    input: { initData: string },
    context: UserRequestContext = {},
  ): Promise<UserLoginOutcome> {
    const ip = context.ip ?? 'unknown';
    const total = await this.limiter.hit(`ip:${ip}`, this.attempts, this.window);
    if (!total.allowed) return { kind: 'rate_limited', retryAfterSeconds: total.retryAfterSeconds };
    const bad = await this.limiter.peek(`bad:${ip}`, this.invalidLimit);
    if (!bad.allowed) return { kind: 'rate_limited', retryAfterSeconds: bad.retryAfterSeconds };

    const now = this.now();
    const result = validateInitData(input.initData, this.botToken, now, this.maxAge);
    if (!result.ok) {
      if (result.reason === 'expired') return { kind: 'expired' };
      await this.limiter.record(`bad:${ip}`, this.window);
      return { kind: 'invalid' };
    }

    const user = await this.findOrCreate(result.user, context);
    if (user.status !== 'ACTIVE') {
      await this.prisma.auditLog.create({
        data: {
          actorType: 'USER',
          actorId: user.id,
          action: 'user.login.blocked',
          targetType: 'user',
          targetId: user.id,
          requestId: context.requestId ?? null,
        },
      });
      return { kind: 'blocked' };
    }

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        sessionVersion: user.sessionVersion,
        expiresAt: new Date(now.getTime() + this.ttl * 1000),
        lastUsedAt: now,
        createdAt: now,
      },
    });
    const accessToken = await signUserToken(
      this.secret,
      { userId: user.id, sessionId: session.id, sessionVersion: user.sessionVersion },
      now,
      this.ttl,
    );
    return { kind: 'ok', accessToken, expiresIn: this.ttl, user: toUserProfile(user) };
  }

  /**
   * Resolves the session behind a token from the database on every call: the session row, the
   * account status and `session_version` are all re-read, so a block, a role change or a revoked
   * session takes effect on the very next request.
   */
  async authenticate(token: string): Promise<AuthenticatedUser | null> {
    const now = this.now();
    const claims = await verifyUserToken(this.secret, token, now);
    if (!claims) return null;
    const session = await this.prisma.session.findUnique({
      where: { id: claims.sessionId },
      include: { user: true },
    });
    const user = session?.user;
    if (!session || !user) return null;
    if (session.userId !== claims.userId || session.adminId !== null) return null;
    if (session.revokedAt !== null || session.expiresAt.getTime() <= now.getTime()) return null;
    if (user.status !== 'ACTIVE') return null;
    if (session.sessionVersion !== user.sessionVersion) return null;
    if (claims.sessionVersion !== user.sessionVersion) return null;
    return { user: toUserProfile(user), role: user.role, sessionId: session.id };
  }

  /** `telegram_id` is the identity. Profile fields are written once, at creation. */
  private async findOrCreate(telegram: TelegramUser, context: UserRequestContext) {
    const existing = await this.prisma.user.findUnique({
      where: { telegramId: telegram.telegramId },
    });
    if (existing) {
      // Only the informational Telegram username follows Telegram; the app profile is never overwritten.
      const username = telegram.username ?? null;
      if (existing.telegramUsername === username) return existing;
      return this.prisma.user.update({
        where: { id: existing.id },
        data: { telegramUsername: username },
      });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            telegramId: telegram.telegramId,
            displayName: displayNameOf(telegram),
            telegramUsername: telegram.username ?? null,
            avatarUrl: avatarOf(telegram.photoUrl),
          },
        });
        await tx.auditLog.create({
          data: {
            actorType: 'SYSTEM',
            action: 'user.account.created',
            targetType: 'user',
            targetId: created.id,
            requestId: context.requestId ?? null,
          },
        });
        return created;
      });
    } catch (error) {
      // Two first logins raced: the other one created the row.
      if (!isUniqueViolation(error)) throw error;
      return this.prisma.user.findUniqueOrThrow({ where: { telegramId: telegram.telegramId } });
    }
  }
}
