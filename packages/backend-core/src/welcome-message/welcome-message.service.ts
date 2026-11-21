import type { PrismaClient } from '@creatorchat/db';
import type { MediaAccessService } from '../media/media-access.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Same limit as a chat message. */
const BODY_MAX = 2000;

export interface WelcomeMedia {
  assetId: string;
  kind: 'PHOTO' | 'VIDEO';
  source: 'GALLERY' | 'UPLOAD';
  durationSeconds: number | null;
  thumbnailUrl: string | null;
}

export interface WelcomeMessage {
  enabled: boolean;
  /** Empty while the creator never wrote one. */
  body: string;
  media: WelcomeMedia | null;
}

export type GetWelcomeOutcome = { kind: 'ok'; welcome: WelcomeMessage } | { kind: 'not_found' };

export type SaveWelcomeOutcome =
  | { kind: 'saved'; welcome: WelcomeMessage }
  | { kind: 'invalid' }
  /** Not a creator, or the creator or the creator's account is not ACTIVE. */
  | { kind: 'not_found' }
  /** Unknown, malformed, another creator's, or a file that cannot be a welcome file. */
  | { kind: 'media_not_found' }
  | { kind: 'media_not_ready' };

interface AssetRow {
  state: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  purpose: 'GALLERY' | 'CHAT' | 'BROADCAST' | 'WELCOME';
  in_gallery: boolean;
}

/**
 * A creator's welcome message (US-040): one row per creator holding the switch, the text and an
 * optional file. Everything is scoped to the creator behind the session (no id comes from the
 * request but the asset, and that is looked up scoped to the creator), and a save replaces the
 * whole state, so a retried save changes nothing. The file is a gallery file of the creator (the
 * same asset, no copy) or an upload made for the welcome message (never in the gallery).
 */
export class WelcomeMessageService {
  constructor(
    private readonly prisma: PrismaClient,
    /** Signs the thumbnail of the file; without it the thumbnail link is null. */
    private readonly media: MediaAccessService | null = null,
  ) {}

  async get(creatorUserId: string): Promise<GetWelcomeOutcome> {
    const creator = await this.prisma.creator.findFirst({
      where: {
        userId: creatorUserId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE', role: 'CREATOR' },
      },
      select: { id: true },
    });
    if (!creator) return { kind: 'not_found' };
    return { kind: 'ok', welcome: await this.view(creatorUserId, creator.id) };
  }

  async save(
    creatorUserId: string,
    input: { enabled: boolean; body: string; assetId: string | null },
  ): Promise<SaveWelcomeOutcome> {
    const body = input.body.trim();
    if ([...body].length > BODY_MAX) return { kind: 'invalid' };
    if (input.enabled && body.length === 0) return { kind: 'invalid' };
    if (input.assetId !== null && !UUID.test(input.assetId)) return { kind: 'media_not_found' };

    const outcome = await this.prisma.$transaction(async (tx) => {
      const [creator] = await tx.$queryRaw<{ id: string }[]>`
        SELECT cr.id::text AS id FROM creators cr
        JOIN users ou ON ou.id = cr.user_id
        WHERE cr.user_id = ${creatorUserId}::uuid AND cr.status = 'ACTIVE'
          AND ou.status = 'ACTIVE' AND ou.role = 'CREATOR'
        FOR UPDATE OF cr`;
      if (!creator) return { kind: 'not_found' } as const;

      if (input.assetId !== null) {
        // The creator is part of the statement: another creator's asset looks like an unknown one.
        const [asset] = await tx.$queryRaw<AssetRow[]>`
          SELECT a.state::text AS state, a.purpose::text AS purpose,
                 EXISTS (SELECT 1 FROM gallery_items g WHERE g.asset_id = a.id) AS in_gallery
          FROM media_assets a
          WHERE a.id = ${input.assetId}::uuid AND a.creator_id = ${creator.id}::uuid
          FOR UPDATE OF a`;
        if (!asset) return { kind: 'media_not_found' } as const;
        if (asset.purpose === 'GALLERY') {
          if (!asset.in_gallery || asset.state !== 'READY')
            return { kind: 'media_not_found' } as const;
        } else if (asset.purpose === 'WELCOME') {
          if (asset.state === 'PENDING' || asset.state === 'PROCESSING') {
            return { kind: 'media_not_ready' } as const;
          }
          if (asset.state !== 'READY') return { kind: 'media_not_found' } as const;
        } else {
          return { kind: 'media_not_found' } as const;
        }
      }

      await tx.$executeRaw`
        INSERT INTO creator_welcome_messages (creator_id, enabled, body, asset_id, updated_at)
        VALUES (${creator.id}::uuid, ${input.enabled}, ${body === '' ? null : body},
                ${input.assetId}::uuid, now())
        ON CONFLICT (creator_id) DO UPDATE
        SET enabled = EXCLUDED.enabled, body = EXCLUDED.body, asset_id = EXCLUDED.asset_id,
            updated_at = now()`;
      return { kind: 'saved', creatorId: creator.id } as const;
    });
    if (outcome.kind !== 'saved') return outcome;
    return { kind: 'saved', welcome: await this.view(creatorUserId, outcome.creatorId) };
  }

  private async view(creatorUserId: string, creatorId: string): Promise<WelcomeMessage> {
    const row = await this.prisma.creatorWelcomeMessage.findUnique({
      where: { creatorId },
      select: {
        enabled: true,
        body: true,
        asset: {
          select: {
            id: true,
            kind: true,
            purpose: true,
            durationMs: true,
            thumbKey: true,
            state: true,
          },
        },
      },
    });
    if (!row) return { enabled: false, body: '', media: null };
    let media: WelcomeMedia | null = null;
    if (row.asset && row.asset.state === 'READY') {
      const urls = this.media
        ? await this.media.thumbnailUrlsForOwner(creatorUserId, [
            { id: row.asset.id, thumbKey: row.asset.thumbKey },
          ])
        : new Map<string, string>();
      media = {
        assetId: row.asset.id,
        kind: row.asset.kind,
        source: row.asset.purpose === 'WELCOME' ? 'UPLOAD' : 'GALLERY',
        durationSeconds:
          row.asset.durationMs === null ? null : Math.round(row.asset.durationMs / 1000),
        thumbnailUrl: urls.get(row.asset.id) ?? null,
      };
    }
    return { enabled: row.enabled, body: row.body ?? '', media };
  }
}
