import type {
  CreatorApplication,
  CreatorRequestBlock,
  SubmitCreatorRequestData,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { findSubscriptionBlock } from './subscription-block.js';

/** The account is not an ACTIVE USER (blocked, promoted, or gone): nothing was written. */
export class CreatorRequestAccountNotActiveError extends Error {
  constructor() {
    super('Account is not an active user.');
    this.name = 'CreatorRequestAccountNotActiveError';
  }
}

/** The user still has an active or future customer subscription: nothing was written or changed. */
export class CreatorRequestBlockedError extends Error {
  constructor(readonly block: CreatorRequestBlock) {
    super('A customer subscription is still active or scheduled.');
    this.name = 'CreatorRequestBlockedError';
  }
}

export interface CreatorRequestState {
  request: CreatorApplication | null;
  blocked: CreatorRequestBlock | null;
}

type ApplicationRow = {
  id: string;
  status: CreatorApplication['status'];
  creatorName: string;
  instagramUrl: string;
  creatorType: CreatorApplication['creator_type'];
  description: string;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewReason: string | null;
};

export function toCreatorApplication(row: ApplicationRow): CreatorApplication {
  return {
    id: row.id,
    status: row.status,
    creator_name: row.creatorName,
    instagram_url: row.instagramUrl,
    creator_type: row.creatorType,
    description: row.description,
    created_at: row.createdAt.toISOString(),
    reviewed_at: row.reviewedAt?.toISOString() ?? null,
    review_reason: row.reviewReason,
  };
}

type Db = Pick<PrismaClient, 'creatorApplication' | 'subscription'>;

/** What a new request (and the approval re-check) shows: the creator and when access ends. */
async function findBlock(db: Db, userId: string, now: Date): Promise<CreatorRequestBlock | null> {
  const block = await findSubscriptionBlock(db, userId, now);
  return block ? { creator_name: block.creator_name, ends_at: block.ends_at } : null;
}

/**
 * A USER asks to become a creator. The caller passes their own id from the session; the API's
 * roles guard keeps creators out and the write re-checks it. Role, status and subscriptions are
 * never changed here: approval is a separate, admin-only flow.
 */
export class CreatorRequestService {
  constructor(
    private readonly prisma: Pick<
      PrismaClient,
      '$transaction' | 'creatorApplication' | 'subscription'
    >,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** The caller's latest request (any status) and the subscription that blocks a new one. */
  async getState(userId: string): Promise<CreatorRequestState> {
    const latest = await this.prisma.creatorApplication.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      request: latest ? toCreatorApplication(latest) : null,
      blocked: await findBlock(this.prisma, userId, this.clock()),
    };
  }

  /**
   * Stores a PENDING request. A second submit while one is pending (double tap, retry, two tabs)
   * returns the existing request and writes nothing. The user row is locked first, so concurrent
   * submits of one user are serialised and a block or role change cannot slip in between.
   */
  async submit(userId: string, input: SubmitCreatorRequestData): Promise<CreatorApplication> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users
        WHERE id = ${userId}::uuid AND status = 'ACTIVE' AND role = 'USER' FOR UPDATE`;
      if (locked.length === 0) throw new CreatorRequestAccountNotActiveError();

      const pending = await tx.creatorApplication.findFirst({
        where: { userId, status: 'PENDING' },
      });
      if (pending) return toCreatorApplication(pending);

      const block = await findBlock(tx, userId, this.clock());
      if (block) throw new CreatorRequestBlockedError(block);

      const created = await tx.creatorApplication.create({
        data: {
          userId,
          creatorName: input.creator_name,
          instagramUrl: input.instagram_url,
          creatorType: input.creator_type,
          description: input.description,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'USER',
          actorId: userId,
          action: 'creator.application.submitted',
          targetType: 'creator_application',
          targetId: created.id,
          changes: { creator_type: input.creator_type },
        },
      });
      return toCreatorApplication(created);
    });
  }
}
