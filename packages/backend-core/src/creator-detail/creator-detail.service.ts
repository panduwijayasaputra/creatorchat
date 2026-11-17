import type { CreatorDetail, CreatorDetailResponse } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { countEntitledSubscribers } from '../subscription-access/entitlement-sql.js';
import { findSubscriptionBlock } from '../creator-request/subscription-block.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who a detail / history `:id` stands for. */
export interface ResolvedPerson {
  userId: string;
  creatorId: string | null;
  /** The id of a pending request, or the creator id: what the page URL should show. */
  canonicalId: string;
  pendingApplicationId: string | null;
  applicationIds: string[];
}

const https = (url: string | null) => (url?.startsWith('https://') ? url : null);

/**
 * Creator detail (US-015). `:id` is a creator id, or the id of a PENDING application, or the id of
 * an APPROVED application (which resolves to that applicant's creator). A rejected application, a
 * user id, an unknown or malformed id is "not found", with no hint which.
 */
export class CreatorDetailService {
  private readonly clock: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    options: { clock?: () => Date } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async resolve(id: string): Promise<ResolvedPerson | null> {
    if (!UUID.test(id)) return null;
    const creator = await this.prisma.creator.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    let userId = creator?.userId ?? null;
    let creatorId = creator?.id ?? null;
    let pending: string | null = null;
    if (!creator) {
      const app = await this.prisma.creatorApplication.findUnique({
        where: { id },
        select: { status: true, userId: true },
      });
      if (!app || app.status === 'REJECTED') return null;
      userId = app.userId;
      if (app.status === 'PENDING') {
        pending = id;
      } else {
        const own = await this.prisma.creator.findUnique({
          where: { userId: app.userId },
          select: { id: true },
        });
        if (!own) return null;
        creatorId = own.id;
      }
    }
    if (!userId) return null;
    const apps = await this.prisma.creatorApplication.findMany({
      where: { userId },
      select: { id: true },
    });
    return {
      userId,
      creatorId,
      canonicalId: creatorId ?? (pending as string),
      pendingApplicationId: pending,
      applicationIds: apps.map((a) => a.id),
    };
  }

  async get(id: string): Promise<CreatorDetailResponse | null> {
    const person = await this.resolve(id);
    if (!person) return null;
    const now = this.clock();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: person.userId },
      select: {
        displayName: true,
        avatarUrl: true,
        telegramUsername: true,
        telegramId: true,
        role: true,
        bio: true,
      },
    });
    const identity = {
      avatar_url: https(user.avatarUrl),
      telegram_username: user.telegramUsername,
      telegram_id: user.telegramId.toString(),
    };

    let detail: CreatorDetail;
    if (person.creatorId) {
      const creator = await this.prisma.creator.findUniqueOrThrow({
        where: { id: person.creatorId },
        select: {
          id: true,
          status: true,
          publicCode: true,
          creatorType: true,
          instagramUrl: true,
          createdAt: true,
        },
      });
      const approved = await this.prisma.creatorApplication.findFirst({
        where: { userId: person.userId, status: 'APPROVED' },
        orderBy: { createdAt: 'desc' },
        select: { description: true },
      });
      const subscribers = await countEntitledSubscribers(this.prisma, creator.id, now);
      let blockedAt: string | null = null;
      if (creator.status === 'BLOCKED') {
        const row = await this.prisma.auditLog.findFirst({
          where: { action: 'creator.blocked', targetType: 'creator', targetId: creator.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        blockedAt = row?.createdAt.toISOString() ?? null;
      }
      detail = {
        kind: 'creator',
        id: creator.id,
        status: creator.status,
        creator_name: user.displayName,
        ...identity,
        instagram_url: creator.instagramUrl,
        creator_type: creator.creatorType,
        since: creator.createdAt.toISOString(),
        blocked_at: blockedAt,
        request: null,
        creator: {
          public_code: creator.publicCode,
          subscriber_count: subscribers,
          bio: user.bio,
          description: approved?.description ?? null,
        },
      };
    } else {
      const app = await this.prisma.creatorApplication.findUniqueOrThrow({
        where: { id: person.pendingApplicationId as string },
      });
      const earlier = await this.prisma.creatorApplication.count({
        where: { userId: person.userId, status: 'REJECTED' },
      });
      detail = {
        kind: 'request',
        id: app.id,
        status: 'REQUEST',
        creator_name: app.creatorName,
        ...identity,
        instagram_url: app.instagramUrl,
        creator_type: app.creatorType,
        since: app.createdAt.toISOString(),
        blocked_at: null,
        request: {
          id: app.id,
          description: app.description,
          user_role: user.role,
          previous_rejections: earlier,
          subscription_block: await findSubscriptionBlock(this.prisma, person.userId, now),
        },
        creator: null,
      };
    }
    return { detail, checked_at: now.toISOString() };
  }
}
