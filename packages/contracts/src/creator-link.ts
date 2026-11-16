import { z } from 'zod';

/** Public creator codes: 8 chars of lowercase base32 (a-z, 2-7). Server-generated, immutable. */
export const PUBLIC_CODE_LENGTH = 8;
export const PUBLIC_CODE_PATTERN = /^[a-z2-7]{8}$/;
export const PublicCodeSchema = z.string().regex(PUBLIC_CODE_PATTERN);

/** `/start c_<public_code>`: the bot link payload prefix (brief §4). */
export const START_PAYLOAD_PREFIX = 'c_';

/**
 * What the bot accepts. Deliberately wider than `PublicCodeSchema`: a well-formed but unknown code
 * still opens the Mini App and gets the designed "Creator tidak tersedia" state from the server.
 * Telegram limits start payloads to [A-Za-z0-9_-], 64 chars.
 */
export const StartPayloadSchema = z.string().regex(/^c_[A-Za-z0-9_-]{1,62}$/);

export const CREATOR_LINK_PATH_PREFIX = '/creators';

/** Mini App route for a creator code. The code only picks a destination; it grants nothing. */
export function creatorPath(code: string): string {
  return `${CREATOR_LINK_PATH_PREFIX}/${encodeURIComponent(code)}`;
}

/** API path that resolves a code (the caller must be a signed-in customer). */
export function creatorByCodePath(code: string): string {
  return `/v1/creators/by-code/${encodeURIComponent(code)}`;
}

/** Everything a deep-link landing may learn about a creator: no ids, role, status or media. */
export const CreatorLinkResponseSchema = z.strictObject({
  public_code: PublicCodeSchema,
  display_name: z.string(),
  bio: z.string().nullable(),
  avatar_url: z.string().nullable(),
});
export type CreatorLinkResponse = z.infer<typeof CreatorLinkResponseSchema>;
