/** DI token for the creator list service. */
export const CREATOR_LIST = Symbol('CREATOR_LIST');

/** DI token for the creator moderation (block / unblock) service. */
export const CREATOR_MODERATION = Symbol('CREATOR_MODERATION');

/** DI tokens for the creator detail and History services (US-015). */
export const CREATOR_DETAIL = Symbol('CREATOR_DETAIL');
export const CREATOR_HISTORY = Symbol('CREATOR_HISTORY');
/** DI token for the creator's subscribers and the Berikan Akses picker (US-021). */
export const CREATOR_SUBSCRIBERS = Symbol('CREATOR_SUBSCRIBERS');

/** DI token for the admin view of a creator's gallery (`AdminCreatorGalleryService`, US-035; null without storage). */
export const ADMIN_GALLERY = Symbol('ADMIN_GALLERY');
