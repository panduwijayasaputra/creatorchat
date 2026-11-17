export interface EntitlementWindow {
  startsAt: Date;
  endsAt: Date;
  revokedAt: Date | null;
}

/**
 * Brief §6: a subscription grants access while `starts_at <= now < ends_at` and it is not revoked.
 * The chat stories also check that customer and creator are ACTIVE.
 */
export const isEntitled = (sub: EntitlementWindow, now: Date): boolean =>
  sub.revokedAt === null && sub.startsAt <= now && now < sub.endsAt;
