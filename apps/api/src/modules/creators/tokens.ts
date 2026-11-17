/** DI token for what a customer sees of creators (`CreatorAccessService`, US-022). */
export const CREATOR_ACCESS = Symbol('CREATOR_ACCESS');

/** DI token for customers asking for access (`AccessRequestService`, US-023). */
export const ACCESS_REQUESTS = Symbol('ACCESS_REQUESTS');

/** DI token for a customer's view of a creator's gallery (`CustomerGalleryService`, US-034; null without storage). */
export const CUSTOMER_GALLERY = Symbol('CUSTOMER_GALLERY');
