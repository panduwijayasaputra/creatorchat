import { Prisma, type PrismaClient } from '@creatorchat/db';

export interface NotificationPreferences {
  messagesEnabled: boolean;
  showContent: boolean;
}

export interface PreferencesPatch {
  messagesEnabled?: boolean | undefined;
  showContent?: boolean | undefined;
}

const DEFAULTS: NotificationPreferences = { messagesEnabled: true, showContent: false };
/** Same shape as a public creator code (8 chars of lowercase base32). */
const PUBLIC_CODE = /^[a-z2-7]{8}$/;

/**
 * A customer's own Telegram notification choices and per-creator mute (US-043). Everything is keyed
 * by the user id from the session; no other user's row can be read or written, and a mute can only
 * name a creator the customer has a conversation with, so the route cannot be used to probe creators
 * or to store rows about strangers. The bot side (US-042) only reads these tables.
 */
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaClient) {}

  /** No row means the defaults: notifications on, the message text hidden. */
  async get(userId: string): Promise<NotificationPreferences> {
    const row = await this.prisma.notificationPreference.findUnique({
      where: { userId },
      select: { messagesEnabled: true, showContent: true },
    });
    return row ?? DEFAULTS;
  }

  /**
   * Changes only the given switches in one atomic statement (insert with the defaults for the rest,
   * or update just the named columns), so two quick toggles of different switches never overwrite
   * each other and the first write of a new user cannot race with another.
   */
  async update(userId: string, patch: PreferencesPatch): Promise<NotificationPreferences> {
    const sets: Prisma.Sql[] = [];
    if (patch.messagesEnabled !== undefined) {
      sets.push(Prisma.sql`messages_enabled = ${patch.messagesEnabled}`);
    }
    if (patch.showContent !== undefined) sets.push(Prisma.sql`show_content = ${patch.showContent}`);
    if (sets.length === 0) return this.get(userId);
    const [row] = await this.prisma.$queryRaw<
      { messages_enabled: boolean; show_content: boolean }[]
    >`
      INSERT INTO notification_preferences (user_id, messages_enabled, show_content, updated_at)
      VALUES (${userId}::uuid,
              COALESCE(${patch.messagesEnabled ?? null}::boolean, true),
              COALESCE(${patch.showContent ?? null}::boolean, false),
              now())
      ON CONFLICT (user_id) DO UPDATE SET ${Prisma.join([...sets, Prisma.sql`updated_at = now()`])}
      RETURNING messages_enabled, show_content`;
    return { messagesEnabled: row!.messages_enabled, showContent: row!.show_content };
  }

  /**
   * Mutes one creator: only a visible (ACTIVE creator and account) creator the customer has a
   * conversation with. Unknown, malformed, blocked and unrelated creators all answer `not_found`.
   * Muting twice is one row.
   */
  async mute(userId: string, publicCode: string): Promise<'ok' | 'not_found'> {
    if (!PUBLIC_CODE.test(publicCode)) return 'not_found';
    const [creator] = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id::text AS id FROM creators c
      JOIN users ou ON ou.id = c.user_id
      WHERE c.public_code = ${publicCode} AND c.status = 'ACTIVE' AND ou.status = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM conversations v
                    WHERE v.creator_id = c.id AND v.customer_id = ${userId}::uuid)`;
    if (!creator) return 'not_found';
    await this.prisma.$executeRaw`
      INSERT INTO creator_mutes (user_id, creator_id)
      VALUES (${userId}::uuid, ${creator.id}::uuid)
      ON CONFLICT DO NOTHING`;
    return 'ok';
  }

  /**
   * Undoes a mute. Needs only the relation (a creator who was blocked since can still be unmuted).
   * Unmuting twice is fine.
   */
  async unmute(userId: string, publicCode: string): Promise<'ok' | 'not_found'> {
    if (!PUBLIC_CODE.test(publicCode)) return 'not_found';
    const [creator] = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id::text AS id FROM creators c
      WHERE c.public_code = ${publicCode}
        AND EXISTS (SELECT 1 FROM conversations v
                    WHERE v.creator_id = c.id AND v.customer_id = ${userId}::uuid)`;
    if (!creator) return 'not_found';
    await this.prisma.$executeRaw`
      DELETE FROM creator_mutes WHERE user_id = ${userId}::uuid AND creator_id = ${creator.id}::uuid`;
    return 'ok';
  }
}
