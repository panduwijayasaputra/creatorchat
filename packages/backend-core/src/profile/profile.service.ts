import type { TimezoneId, UpdateProfileData, UserProfile } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { toUserProfile } from '../user-auth/user-auth.service.js';

/** The account is not ACTIVE (blocked, or gone): nothing was written. */
export class ProfileAccountNotActiveError extends Error {
  constructor() {
    super('Account is not active.');
    this.name = 'ProfileAccountNotActiveError';
  }
}

type ProfileRole = 'USER' | 'CREATOR';

/**
 * Which row a self-service write may touch: the caller's own, ACTIVE, with the expected role. A
 * creator edit also needs an ACTIVE creators row. A block or role change that lands between the
 * guard and the write makes the update match nothing instead of overwriting.
 */
function ownActiveRow(userId: string, role: ProfileRole) {
  return {
    id: userId,
    status: 'ACTIVE' as const,
    role,
    ...(role === 'CREATOR' ? { creator: { is: { status: 'ACTIVE' as const } } } : {}),
  };
}

/**
 * Self-service profile edit: the caller passes their own id from the session. Only display name,
 * bio, the app photo and the display timezone can change; role, status and the Telegram fields
 * never do. The caller's role is enforced by the API's roles guard, and again by the write.
 */
export class ProfileService {
  constructor(private readonly prisma: Pick<PrismaClient, '$transaction'>) {}

  /**
   * Writes the full desired profile. Saving the same values twice gives the same row.
   */
  async updateOwnProfile(
    userId: string,
    input: UpdateProfileData,
    role: ProfileRole = 'USER',
  ): Promise<UserProfile> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: ownActiveRow(userId, role),
        data: { displayName: input.display_name, bio: input.bio },
      });
      if (count === 0) throw new ProfileAccountNotActiveError();
      if (input.reset_avatar) {
        // The row lock taken by the update above is held until commit, so this cannot race a block.
        await tx.$executeRaw`UPDATE "users" SET "avatar_url" = "telegram_avatar_url" WHERE "id" = ${userId}::uuid AND "status" = 'ACTIVE'`;
      }
      return toUserProfile(await tx.user.findUniqueOrThrow({ where: { id: userId } }));
    });
  }

  /**
   * Sets the display timezone (display only: stored timestamps stay UTC and nothing is rewritten).
   * The caller validates the zone against the allowed list; the column is plain text on purpose so
   * the list can grow without a migration.
   */
  async updateOwnTimezone(
    userId: string,
    timezone: TimezoneId,
    role: ProfileRole = 'CREATOR',
  ): Promise<UserProfile> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: ownActiveRow(userId, role),
        data: { timezone },
      });
      if (count === 0) throw new ProfileAccountNotActiveError();
      return toUserProfile(await tx.user.findUniqueOrThrow({ where: { id: userId } }));
    });
  }
}
