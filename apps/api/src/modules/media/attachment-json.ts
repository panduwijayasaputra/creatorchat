import type { StoredAttachment } from '@creatorchat/backend-core';
import type { ChatAttachment } from '@creatorchat/contracts';

/** A message's file for the wire: id, kind, length and a short-lived thumbnail link; nothing else. */
export const toAttachmentJson = (a: StoredAttachment): ChatAttachment => ({
  id: a.id,
  kind: a.kind,
  duration_seconds: a.durationSeconds,
  thumbnail_url: a.thumbnailUrl,
});
