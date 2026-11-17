# QA Report: TASK-211 — Mini App attach flow

**Result:** PASS (US-036, 2026-11-18)

## Built
Attach flow: `useAttachFlow` (sheet → picker | upload → preview), `AttachFlow` screens (`CrAttach`, `CrChatPick`, `CrChatPreview` / `CrChatUpload`), shared `uploadMedia` (also used by the gallery), `sendMedia` in the thread hook, composer attach button, `PaperclipIcon`, `GalleryTile` selected look.

## Verified
9 flow tests: the sheet texts; gallery path sends the picked asset id with the message, never touches the upload API and confirms with "Media terkirim"; empty picker and Ganti; upload path inits with `purpose: CHAT` and this conversation, keeps Kirim disabled until READY, then sends that asset; a wrong type is refused without any request and a failed upload retries with the same upload id; a failed send keeps the media and Kirim Ulang resends the identical message id and asset; Telegram BackButton walks back one step at a time; no AI wording anywhere. The 23 gallery tests still pass after the extraction of `uploadMedia`.

## Notes
Placeholder copy for the picker and upload failures is listed as design gaps. File input / XHR in a real Telegram WebView is not verified.
