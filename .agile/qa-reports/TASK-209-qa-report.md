# QA Report: TASK-209 — Backend-core — chat uploads, media send, attachments in history

**Result:** PASS (US-036, 2026-11-18)

## Built
`attachmentsFor` and `MediaAccessService.thumbnailUrlsForParticipant`; `MediaUploadService` CHAT init, READY without a gallery item and cleanup of unsent chat uploads; `CreatorChatService.send` with an attachment and attachments in both histories; list and inbox previews.

## Verified
15 + 3 + 1 integration tests: a gallery pick stores one MEDIA message pointing at the same asset with no new asset, gallery item or storage write; a chat upload attaches once in its own conversation and then is not found, is not found in another conversation of the creator, for another creator, outside the gallery, FAILED or malformed; PROCESSING is not ready; three parallel sends of one chat asset give exactly one message; replay with the same id and asset returns the stored message, another asset or text conflicts; neither text nor file, empty and too long text are invalid; expired and revoked customers get access_expired with nothing stored; both histories show the attachment and the customer still sees it after expiry; list and inbox give an empty preview and the media kind; a stranger gets no thumbnail link; CHAT init refuses another creator's, unknown, malformed or missing conversations and an ended chat; cleanup removes an unsent chat upload after a day and never a recent or an attached one; the worker makes a chat upload READY without a gallery item.

## Notes
The send locks the asset row (as the cleanup does) so a send racing the cleanup wins.
