# US-036: Creator sends a photo or video in chat

**Status:** ready_for_uat
**Priority:** high
**Feature:** chat-media
**Phase:** D
**Roles:** CREATOR, System
**Brief refs:** §6, §7, §8B, §8E, §14 (HTTP write path, outbox), §17 (chat upload never enters the gallery; gallery reuse does not duplicate the object; retries create one message)
**Design refs:** `CrAttach`, `CrChatPick`, `CrChatPreview`, `CrChatUpload`, `CrChatSent`, `CrMain`

## Description

As a CREATOR, I want to send a photo or video to one subscriber, either from my gallery or as a new upload, so that I can share content privately in the conversation.

## Acceptance Criteria

- [ ] The "Lampirkan media" button in the conversation opens the `CrAttach` sheet: "Kirim media ke {nama}", **Pilih Galeri** ("Memakai file yang sama, tanpa salinan") and **Upload Baru** ("Hanya tersimpan di percakapan ini, tidak masuk galeri").
- [ ] Pilih Galeri shows my gallery as in `CrChatPick` ("Pilih satu foto atau video dari galeri.", "1 media dipilih", Lanjut), then the preview `CrChatPreview` with Ganti, an optional pesan field, the note "Memakai media yang sama dari galeri. Tidak ada salinan baru." and Kirim. Sending creates a message with an attachment pointing to the same asset: no new object, no new gallery item.
- [ ] Upload Baru picks a file, uploads it with the same verification and limits as US-032, and shows `CrChatUpload` with "Media ini hanya tersimpan di percakapan ini. Tidak masuk ke galeri dan tidak tersedia untuk pelanggan lain." Kirim is enabled only once the upload is verified. The asset is never added to the gallery and cannot be attached to any other conversation.
- [ ] After Kirim the media bubble appears in the thread with the "Manual" tag and the toast "Media terkirim" (`CrChatSent`, without the Phase F AI panel). The send uses `client_message_id`: a retry after a timeout returns the stored message, never a second one; a failed send shows Belum terkirim / Kirim Ulang and keeps the chosen media.
- [ ] The server refuses (nothing stored) when: the customer's access is not active (403, same as text), the asset belongs to another creator or is another conversation's chat-only upload (404), or the asset is not finalized (409). A USER token → 403; another creator's conversation → 404.

## Tasks

### TASK-207: Migration — MEDIA messages, attachments, chat-only assets
**Status:** done

### TASK-208: Contracts — attachments, media send, previews
**Status:** done

### TASK-209: Backend-core — chat uploads, media send, attachments in history
**Status:** done

### TASK-210: API — creator send with attachment, chat upload init
**Status:** done

### TASK-211: Mini App attach flow
**Status:** done

### TASK-212: Media bubbles in the creator thread and media previews in lists
**Status:** done

### TASK-213: Visual check and docs
**Status:** done
