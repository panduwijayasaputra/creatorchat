# Feature: broadcast

**Phase:** E — Broadcast & notifications
**Roles:** CREATOR, USER, System
**Brief refs:** §6 (only active subscribers receive new broadcasts; entitlement re-checked at dispatch), §8C (broadcast media: Pilih Galeri = same file, no checkbox; Upload Baru = "Simpan juga ke galeri", default off), §8D (no scheduling, segmentation, drafts, analytics), §8E, §9 (immediate, all active subscribers, confirm, snapshot, re-check per delivery, one message per conversation linked to the broadcast, recipient states for safe retry, replies stay private, no AI trigger), §14 (outbox, transactional per recipient), §17 (retries create one message per intended delivery)
**Design refs:** `CrBroadcast`, `CrBroadcastPick`, `CrBroadcastReady`, `CrBroadcastUpload`, `CrBroadcastUploadSaved`, `CrBroadcastConfirm`, `CrBroadcastDone`, `CrMain` (storage notes)

## Overview

The creator sends one photo or video, with an optional text ("Tulis pesan broadcast"), to every active subscriber at once. The media comes from the gallery (same asset, no copy) or is uploaded new; a new upload can also be saved to the gallery with the checkbox (one asset, one gallery item). After the confirmation the API records the broadcast and returns; the worker snapshots the recipients, re-checks each one's access and writes one creator message per private conversation, idempotently. Customers see it as a normal message in their private chat and reply privately. Reuses the upload pipeline (US-032), the gallery picker (US-036) and the message write path, outbox and realtime (US-026, US-029, US-031).

## Stories

| ID | Title | Priority |
|----|-------|----------|
| US-038 | Creator composes and sends a broadcast | high |
| US-039 | Broadcast delivery to every active subscriber | high |

## Depends on

- US-032 / US-036 (upload, verification, gallery picker, media message type), US-037 (customer media bubble and viewer), US-031 (realtime `message.created`).
- The broadcast's Telegram notification is US-042.

## Decisions to confirm with the Tech Lead

- One media item per broadcast, required (`CrBroadcast`: "Pilih media untuk dikirim"; Kirim Broadcast stays disabled without media). Text is optional (brief §8C "caption opsional"), limited like a chat message (1–2000).
- Recipient snapshot = customers with ACTIVE access when the worker starts the fan-out; each delivery re-checks access, account status and creator status in its own transaction.
- A broadcast message does not change the conversation's AI/Manual mode and does not enqueue an AI reply (§9).

## Design gaps

- **How a broadcast message looks in the customer's chat**: no board. `Main` lists a "broadcast label" for chat bubbles, but no board shows it. Placeholder: a normal creator media bubble with no label on the customer side (the welcome-message board says creator messages carry no label). Creator side label: not designed.
- **Zero active subscribers**: no board (placeholder: Kirim Broadcast disabled with a note, or a toast "Belum ada subscriber aktif.").
- **Progress / partial result**: `CrBroadcastDone` shows only the success toast "Broadcast terkirim ke semua subscriber aktif". No board for "still sending", a send failure before the broadcast is recorded, or a summary with skipped recipients. Brief §9 allows a short result only.
- Upload progress / failure inside the composer: reuse US-036's placeholders.
