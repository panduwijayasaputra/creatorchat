import type { UserProfile } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { toUserProfile } from '../user-auth/user-auth.service.js';

export interface CreatorSettings {
  profile: UserProfile;
  publicCode: string;
}

/** Reads the caller's own creator settings; the user id comes from the session, never the client. */
export class CreatorSettingsService {
  constructor(private readonly prisma: Pick<PrismaClient, 'creator'>) {}

  /** Null when the account has no ACTIVE creator row (a CREATOR role alone is not enough). */
  async get(userId: string): Promise<CreatorSettings | null> {
    const creator = await this.prisma.creator.findFirst({
      where: { userId, status: 'ACTIVE', user: { status: 'ACTIVE', role: 'CREATOR' } },
      select: { publicCode: true, user: true },
    });
    if (!creator) return null;
    return { profile: toUserProfile(creator.user), publicCode: creator.publicCode };
  }
}
