import type { PrismaClient } from '@creatorchat/db';
import { isPublicCode } from './public-code.js';

export interface ResolvedCreatorLink {
  publicCode: string;
  displayName: string;
  avatarUrl: string | null;
}

export type CreatorLinkOutcome =
  { kind: 'ok'; creator: ResolvedCreatorLink } | { kind: 'not_found' };

/**
 * Resolves a creator deep-link code for a signed-in customer (the role is enforced by the API's roles guard). The code only picks a destination:
 * nothing is written, no access is granted. Unknown, malformed, blocked and inactive creators are
 * indistinguishable (`not_found`).
 */
export class CreatorLinkService {
  constructor(private readonly prisma: Pick<PrismaClient, 'creator'>) {}

  async resolve(input: { code: string }): Promise<CreatorLinkOutcome> {
    if (!isPublicCode(input.code)) return { kind: 'not_found' };
    const creator = await this.prisma.creator.findFirst({
      where: { publicCode: input.code, status: 'ACTIVE', user: { status: 'ACTIVE' } },
      select: { publicCode: true, user: { select: { displayName: true, avatarUrl: true } } },
    });
    if (!creator) return { kind: 'not_found' };
    return {
      kind: 'ok',
      creator: {
        publicCode: creator.publicCode,
        displayName: creator.user.displayName,
        avatarUrl: creator.user.avatarUrl,
      },
    };
  }
}
