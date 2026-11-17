/** DI token for the object storage (`ObjectStorage | null`; null while the driver lacks settings). */
export const STORAGE = Symbol('STORAGE');
/** DI token for creator uploads and the gallery listing (`MediaUploadService | null`, US-032). */
export const MEDIA_UPLOAD = Symbol('MEDIA_UPLOAD');
