import { SUBSCRIPTIONS_MAX, type ExploreQuery } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { isPublicCode } from '../creator-link/public-code.js';
import { accessStateOf, type AccessState } from './access-state.js';

export interface ExploreCreator {
  publicCode: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  /** The viewer's own state; `null` when there is no relation. */
  access: 'ACTIVE' | 'PENDING' | 'EXPIRED' | null;
}

export interface ExploreResult {
  items: ExploreCreator[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SubscriptionCard {
  publicCode: string;
  displayName: string;
  avatarUrl: string | null;
  access: Exclude<AccessState, { state: 'GUEST' }>;
  /** False for a blocked creator (or creator account): the card keeps its dates but has no actions. */
  creatorAvailable: boolean;
  /** The viewer's own conversation with this creator, or null (US-027). */
  conversationId: string | null;
  /** The viewer muted this creator's message and broadcast notifications (US-043). */
  muted: boolean;
}

export type ProfileOutcome =
  | {
      kind: 'ok';
      creator: {
        publicCode: string;
        displayName: string;
        bio: string | null;
        avatarUrl: string | null;
      };
      access: AccessState;
      /** The viewer's latest reviewed request for this creator (no reason, no admin). */
      lastReview: { status: 'APPROVED' | 'REJECTED'; reviewedAt: Date } | null;
      /** The viewer's own conversation with this creator, or null (US-027). */
      conversationId: string | null;
    }
  | { kind: 'not_found' };

const https = (url: string | null) => (url?.startsWith('https://') ? url : null);
const ACTIVE_CREATOR = { status: 'ACTIVE', user: { status: 'ACTIVE' } } as const;

/**
 * What a signed-in customer sees of creators (US-022): Explore and the profile, each with the
 * viewer's own access state. Read-only. The viewer id only ever comes from the session; the state
 * function is the single place the state is decided, so the two screens cannot disagree.
 */
export class CreatorAccessService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async explore(userId: string, query: ExploreQuery): Promise<ExploreResult> {
    const now = this.clock();
    const [total, creators] = await Promise.all([
      this.prisma.creator.count({ where: ACTIVE_CREATOR }),
      this.prisma.creator.findMany({
        where: ACTIVE_CREATOR,
        orderBy: [{ user: { displayName: 'asc' } }, { id: 'asc' }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
        select: {
          id: true,
          publicCode: true,
          user: { select: { displayName: true, bio: true, avatarUrl: true } },
        },
      }),
    ]);
    const ids = creators.map((c) => c.id);
    const [subs, pending] = ids.length
      ? await Promise.all([
          this.prisma.subscription.findMany({
            where: { customerId: userId, creatorId: { in: ids } },
            select: { creatorId: true, startsAt: true, endsAt: true, revokedAt: true },
          }),
          this.prisma.accessRequest.findMany({
            where: { customerId: userId, creatorId: { in: ids }, status: 'PENDING' },
            select: { creatorId: true, createdAt: true, type: true },
          }),
        ])
      : [[], []];
    const subOf = new Map(subs.map((s) => [s.creatorId, s]));
    const pendingOf = new Map(pending.map((p) => [p.creatorId, p]));

    return {
      items: creators.map((c) => {
        const result = accessStateOf(
          { subscription: subOf.get(c.id) ?? null, pending: pendingOf.get(c.id) ?? null },
          now,
        );
        return {
          publicCode: c.publicCode,
          displayName: c.user.displayName,
          bio: c.user.bio,
          avatarUrl: https(c.user.avatarUrl),
          access: result.state === 'GUEST' ? null : result.state,
        };
      }),
      total,
      page: query.page,
      pageSize: query.page_size,
    };
  }

  /** Unknown, malformed, blocked and inactive creators are indistinguishable (`not_found`). */
  async profile(userId: string, code: string): Promise<ProfileOutcome> {
    if (!isPublicCode(code)) return { kind: 'not_found' };
    const now = this.clock();
    const creator = await this.prisma.creator.findFirst({
      where: { publicCode: code, ...ACTIVE_CREATOR },
      select: {
        id: true,
        publicCode: true,
        user: { select: { displayName: true, bio: true, avatarUrl: true } },
      },
    });
    if (!creator) return { kind: 'not_found' };
    const [subscription, pending, review, conversation] = await Promise.all([
      this.prisma.subscription.findUnique({
        where: { customerId_creatorId: { customerId: userId, creatorId: creator.id } },
        select: { startsAt: true, endsAt: true, revokedAt: true },
      }),
      this.prisma.accessRequest.findFirst({
        where: { customerId: userId, creatorId: creator.id, status: 'PENDING' },
        select: { createdAt: true, type: true },
      }),
      this.prisma.accessRequest.findFirst({
        where: { customerId: userId, creatorId: creator.id, status: { not: 'PENDING' } },
        orderBy: [{ reviewedAt: 'desc' }, { id: 'asc' }],
        select: { status: true, reviewedAt: true },
      }),
      this.prisma.conversation.findUnique({
        where: { customerId_creatorId: { customerId: userId, creatorId: creator.id } },
        select: { id: true },
      }),
    ]);
    return {
      kind: 'ok',
      creator: {
        publicCode: creator.publicCode,
        displayName: creator.user.displayName,
        bio: creator.user.bio,
        avatarUrl: https(creator.user.avatarUrl),
      },
      access: accessStateOf({ subscription, pending }, now),
      conversationId: conversation?.id ?? null,
      lastReview:
        review && review.reviewedAt && review.status !== 'PENDING'
          ? { status: review.status, reviewedAt: review.reviewedAt }
          : null,
    };
  }

  /**
   * The viewer's own relations for the Langganan page (US-025): every creator with a subscription
   * (a revoked one counts) or a pending request, each through the one state function. Ordered
   * ACTIVE (soonest end) → PENDING (oldest request) → EXPIRED (latest end), then name and code.
   * Blocked creators stay in the list with `creatorAvailable: false`.
   */
  async subscriptions(userId: string): Promise<{ items: SubscriptionCard[] }> {
    const now = this.clock();
    const creatorSelect = {
      publicCode: true,
      status: true,
      user: { select: { displayName: true, avatarUrl: true, status: true } },
    } as const;
    const [subs, pending, conversations, mutes] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { customerId: userId },
        select: {
          creatorId: true,
          startsAt: true,
          endsAt: true,
          revokedAt: true,
          creator: { select: creatorSelect },
        },
      }),
      this.prisma.accessRequest.findMany({
        where: { customerId: userId, status: 'PENDING' },
        select: {
          creatorId: true,
          createdAt: true,
          type: true,
          creator: { select: creatorSelect },
        },
      }),
      this.prisma.conversation.findMany({
        where: { customerId: userId },
        select: { id: true, creatorId: true },
      }),
      this.prisma.creatorMute.findMany({ where: { userId }, select: { creatorId: true } }),
    ]);
    const mutedIds = new Set(mutes.map((m) => m.creatorId));
    const conversationOf = new Map(conversations.map((c) => [c.creatorId, c.id]));
    const subOf = new Map(subs.map((s) => [s.creatorId, s]));
    const pendingOf = new Map(pending.map((p) => [p.creatorId, p]));
    const ids = new Set([...subOf.keys(), ...pendingOf.keys()]);

    const cards: SubscriptionCard[] = [];
    for (const id of ids) {
      const sub = subOf.get(id) ?? null;
      const request = pendingOf.get(id) ?? null;
      const creator = (sub ?? request)!.creator;
      const access = accessStateOf({ subscription: sub, pending: request }, now);
      if (access.state === 'GUEST') continue;
      cards.push({
        publicCode: creator.publicCode,
        displayName: creator.user.displayName,
        avatarUrl: https(creator.user.avatarUrl),
        access,
        creatorAvailable: creator.status === 'ACTIVE' && creator.user.status === 'ACTIVE',
        conversationId: conversationOf.get(id) ?? null,
        muted: mutedIds.has(id),
      });
    }

    const GROUP = { ACTIVE: 0, PENDING: 1, EXPIRED: 2 } as const;
    const when = (c: SubscriptionCard): number =>
      c.access.state === 'ACTIVE'
        ? c.access.endsAt.getTime()
        : c.access.state === 'PENDING'
          ? c.access.requestedAt.getTime()
          : -c.access.endedAt.getTime(); // latest end first
    cards.sort(
      (a, b) =>
        GROUP[a.access.state] - GROUP[b.access.state] ||
        when(a) - when(b) ||
        a.displayName.localeCompare(b.displayName) ||
        a.publicCode.localeCompare(b.publicCode),
    );
    return { items: cards.slice(0, SUBSCRIPTIONS_MAX) };
  }
}
