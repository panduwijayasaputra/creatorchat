# Technical Plan: US-037 — Customer receives and opens chat media

## Architecture Overview

Vertical slice: contracts (conversation media list + attachment original URL) → `ChatMediaService` (backend-core; recipient path of `MediaAccessService`) → `GET /v1/chats/:conversationId/media` and `GET /v1/chats/:conversationId/media/:attachmentId` → Mini App: tappable `MediaBubble` in the customer chat, viewer route `/chats/:conversationId/media/:attachmentId` with `MediaViewer`.

Brief refs: §6 (received attachments stay readable after expiry; not when the account is blocked), §8B, §8E (the attachment keeps the receiver's read right; signed URL after the check; no object keys), §15 (IDOR), §17 ("Expiry locks sending/gallery while preserving received attachments"). Design refs: `Chat` (photo bubble with text, video bubble with duration), `ChatExpired`, `MediaPhoto`, `MediaVideo`.

Defaults applied (flag if you disagree):

- **Route** `/chats/:conversationId/media/:attachmentId` (the design-integration proposal was `/media/:attachmentId`; scoping by conversation gives the "n / N" set and one ownership check). Nested under the chat route as an overlay, so the thread and its scroll stay mounted.
- **"n / N"** = position among all attachments of this conversation, oldest = 1 (chat order, as `MediaPhoto` "1 / 2" then `MediaVideo` "2 / 2"). Detail returns position, total and previous / next attachment ids, like the gallery viewer.
- **Footer**: the message's pesan text (if any) and "{creator name} · {Hari ini, 09.16 WIB}" with the app's existing relative-day formatting.
- **Blocked creator / expired access**: attachments still open (brief §6; the creator block hides discovery and stops new activity, received history stays). Only a blocked or promoted customer account is refused (401 by the guard).
- **Load failure**: neutral error with "Coba lagi" in the bubble and the viewer (placeholder copy; revoked/deleted attachment state is a Known Gap).

## Authorization & Data Rules

- `UserJwtGuard` + `@Roles('USER')` (CREATOR → 403).
- Every query joins `message_attachments → messages → conversations` with `conversations.customer_id = me` and `conversations.id = :conversationId`. Unknown, malformed, another customer's attachment, an asset id passed as an attachment id, or an attachment of another conversation → the same 404 `NOT_FOUND` as the chat (existing code).
- No entitlement check on these reads (received attachments survive expiry, backend.md rule 6c); account status is enforced by the guard.
- The original URL is issued by `MediaAccessService.originalUrl` only after the scoped lookup; 5-minute lifetime; `no-store`. Responses carry attachment ids, never asset ids or keys.
- Nothing is written.

## Dependencies

- US-036 (attachments, MEDIA messages, `MediaBubble`, attachments in the customer history), US-033 (`MediaViewer`), US-026 / US-030 / US-031 (customer chat, read marker, realtime).

## Risks

- Large videos on mobile data → `preload="metadata"`, poster shown first; no transcoding (accepted).
- A customer can keep a signed URL for 5 minutes after being blocked → accepted, short lifetime.

## Tasks

### TASK-214: Contracts and `ChatMediaService`

Contracts (`packages/contracts/src/chat.ts`):

```ts
export const ChatMediaItemSchema = z.strictObject({ id: z.uuid(), kind: MediaKindSchema, duration_seconds: z.int().nullable(), thumbnail_url: z.url() });
export const ChatMediaListResponseSchema = z.strictObject({ items: z.array(ChatMediaItemSchema) }); // oldest first, max 500
export const ChatMediaDetailSchema = z.strictObject({
  item: ChatMediaItemSchema, original: MediaOriginalSchema,
  message: z.strictObject({ body: z.string().nullable(), created_at: z.iso.datetime() }),
  creator: z.strictObject({ display_name: z.string() }),
  position: z.int().positive(), total: z.int().positive(), previous_id: z.uuid().nullable(), next_id: z.uuid().nullable(),
});
export const chatMediaPath = (conversationId: string) => `/v1/chats/${encodeURIComponent(conversationId)}/media`;
export const chatMediaItemPath = (conversationId: string, attachmentId: string) => `${chatMediaPath(conversationId)}/${encodeURIComponent(attachmentId)}`;
```

Backend-core `packages/backend-core/src/media/chat-media.service.ts`:

```ts
export class ChatMediaService {
  constructor(prisma, access: MediaAccessService);
  list(customerId: string, conversationId: string): Promise<{ kind: 'ok'; items } | { kind: 'not_found' }>;
  detail(customerId: string, conversationId: string, attachmentId: string): Promise<{ kind: 'ok'; detail } | { kind: 'not_found' }>;
}
```

Order by `messages.seq, message_attachments.position`. `// shortcut: list capped at 500 items, page it if a conversation ever holds more`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/contracts/src/chat.ts` (+ spec) | Schemas, paths |
| CREATE | `packages/backend-core/src/media/chat-media.service.ts` (+ `.int.spec.ts`) | Recipient reads |
| MODIFY | `packages/backend-core/src/media/index.ts`, `src/index.ts` | Exports |

**Testing (integration):** own attachment → detail with a working URL; after the subscription ends, is revoked, or the creator is blocked → still ok; another customer's attachment id, a gallery asset id never sent, an attachment of my other conversation → `not_found`; position / neighbours over three attachments; the response has no asset id.

---

### TASK-215: API — customer chat media endpoints

In `apps/api/src/modules/chat/` (the module serving `/v1/chats/...`; locate it from `ChatController`):

| Method | Path | Guard | Response |
|---|---|---|---|
| GET | `/v1/chats/:conversationId/media` | `@Roles('USER')` | 200 `ChatMediaListResponse`; 404 |
| GET | `/v1/chats/:conversationId/media/:attachmentId` | `@Roles('USER')` | 200 `ChatMediaDetail`; 404 |

`no-store`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | the customer chat controller + module (provider `CHAT_MEDIA`) | Routes |
| CREATE | `apps/api/test/chat-media.int.spec.ts` | Tests |

**Testing:** IDOR matrix over HTTP; blocked customer → 401; promoted (now CREATOR) → 401/403 per the session rules; expired access still 200; malformed ids → 404.

---

### TASK-216: Mini App customer media bubbles and viewer

- Customer `ChatPage` renders `MediaBubble` (US-036) for MEDIA messages as in `Chat`: photo with pesan under it and time; video poster with "0:42". Tapping → `/chats/:conversationId/media/:attachmentId`. Works in `ChatExpired` too.
- `ChatMediaViewer.tsx`: nested overlay route; `api.chatMedia(conversationId, attachmentId)`; `MediaViewer` with position "n / N", previous / next, footer = pesan + "{creator} · {formatted time}" (exact layout from `MediaPhoto` / `MediaVideo`); Telegram BackButton; media error → one refetch, then the placeholder error.
- The creator-side bubble stays non-tappable (US-036 decision).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/chat/ChatMediaViewer.tsx` (+ spec) | Viewer screen |
| MODIFY | `apps/miniapp/src/chat/ChatPage.tsx`, `ChatThread.tsx`, `MediaBubble.tsx` | Tappable bubbles (customer side) |
| MODIFY | `apps/miniapp/src/app/routes.tsx`, `apps/miniapp/src/auth/api-client.ts` (+ spec) | Route, calls |

**Testing:** bubble renders photo / video variants from history fixtures; tap opens the viewer at the right position; prev / next walk the conversation's media; expired chat still opens media; viewer error state on a failing URL; no AI wording anywhere on the customer screens (existing assertion extended).

---

### TASK-217: Visual check and docs

- `pnpm visual` at 390 × 844: `Chat` (now including the photo and video bubbles; remove the "media bubbles not built" exclusion), `ChatExpired`, `MediaPhoto`, `MediaVideo`.
- `codebase-map.md` (endpoints, route), `design-integration.md` (route decision; remove the US-026 note that media bubbles are not built; viewer error copy gap), `CLAUDE.md`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `visual/` specs | Screenshots |
| MODIFY | `.agile/guidelines/codebase-map.md`, `design-integration.md`, `CLAUDE.md` | Docs |

**Testing:** full check suite; sheets reviewed.
