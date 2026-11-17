import type { UserDetailResponse } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import {
  countEntitledForCustomer,
  nearestEntitledEnd,
} from '../subscription-access/entitlement-sql.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The admin User detail (US-018). `:id` resolves in `users` only: a USER gets the detail, a
 * CREATOR gets just the creator id to go to, anything else is "not found" (`null`).
 */
export class UserDetailService {
  private readonly clock: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    options: { clock?: () => Date } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async get(id: string): Promise<UserDetailResponse | null> {
    if (!UUID.test(id)) return null;
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        telegramUsername: true,
        telegramId: true,
        status: true,
        bio: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        creator: { select: { id: true } },
      },
    });
    if (!user) return null;
    if (user.role === 'CREATOR') {
      return user.creator ? { role: 'CREATOR', creator_id: user.creator.id } : null;
    }

    const now = this.clock();
    const live = { customerId: id, revokedAt: null };
    const [active, expired, nearest, latest, rejected] = await Promise.all([
      countEntitledForCustomer(this.prisma, id, now),
      this.prisma.subscription.count({ where: { ...live, endsAt: { lte: now } } }),
      nearestEntitledEnd(this.prisma, id, now),
      this.prisma.creatorApplication.findFirst({
        where: { userId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, status: true, createdAt: true },
      }),
      this.prisma.creatorApplication.findMany({
        where: { userId: id, status: 'REJECTED' },
        select: { reviewedAt: true, createdAt: true },
      }),
    ]);

    // A latest APPROVED application cannot exist for a USER (approval changes the role); show NONE.
    const status =
      latest?.status === 'PENDING' || latest?.status === 'REJECTED' ? latest.status : 'NONE';
    const lastRejected = rejected
      .map((r) => (r.reviewedAt ?? r.createdAt).getTime())
      .sort((a, b) => b - a)[0];

    let block: Extract<UserDetailResponse, { role: 'USER' }>['block'] = null;
    if (user.status === 'BLOCKED') {
      const entry = await this.prisma.auditLog.findFirst({
        where: { action: 'user.account.blocked', targetType: 'user', targetId: id },
        orderBy: { createdAt: 'desc' },
        select: { reason: true, actorType: true, actorId: true, createdAt: true },
      });
      let admin: string | null = null;
      if (entry?.actorType === 'ADMIN' && entry.actorId) {
        admin =
          (
            await this.prisma.adminAccount.findUnique({
              where: { id: entry.actorId },
              select: { username: true },
            })
          )?.username ?? null;
      }
      block = {
        reason: entry?.reason ?? null,
        admin_label: admin,
        at: (entry?.createdAt ?? user.updatedAt).toISOString(),
      };
    }

    return {
      role: 'USER',
      user: {
        id: user.id,
        display_name: user.displayName,
        avatar_url: user.avatarUrl?.startsWith('https://') ? user.avatarUrl : null,
        telegram_username: user.telegramUsername,
        telegram_id: user.telegramId.toString(),
        status: user.status,
        bio: user.bio,
        joined_at: user.createdAt.toISOString(),
      },
      subscriptions: {
        active_count: active,
        expired_count: expired,
        nearest_end: nearest
          ? {
              creator_name: nearest.creatorName,
              ends_at: nearest.endsAt.toISOString(),
            }
          : null,
      },
      creator_request: {
        status,
        submitted_at: status === 'NONE' ? null : (latest?.createdAt.toISOString() ?? null),
        rejection_count: rejected.length,
        last_rejected_at: lastRejected ? new Date(lastRejected).toISOString() : null,
        latest_request_id: status === 'NONE' ? null : (latest?.id ?? null),
      },
      block,
    };
  }
}
