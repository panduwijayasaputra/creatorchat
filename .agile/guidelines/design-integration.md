# Design Integration Guide

How to turn the Claude Design handoff into the real Mini App and admin dashboard, and the **resolved conflicts** between the design package and the brief. When this file disagrees with `designs/.../DESIGN.md` or the brief, **this file wins** (it records the user's decisions of 2026-11-14).

## Handoff Location

```
designs/creator-chat-design-handoff/design/
├── png/miniapp/<Board>.png   # visual reference, 2x (390 px boards → 780 px PNG)
├── png/admin/<Board>.png     # visual reference, 1x
├── html/<Board>.html         # static HTML, inline styles, no JS — EXACT values (color, spacing, radius, font size)
├── DESIGN.md                 # tokens, product rules, reusable patterns, flows, admin routes, seed data
├── INDEX.md                  # all 173 boards with title and board size
├── CLAUDE.md                 # designer's instructions for implementation (merged into this guide)
└── README.md
```

Below, `design/` means `designs/creator-chat-design-handoff/design/`. Treat the handoff as **read-only reference**: never edit it, never import it into app builds.

## How to Use the Handoff (per screen)

1. Look at `design/png/<app>/<Board>.png` first.
2. Take exact values from `design/html/<Board>.html` — don't guess from the image.
3. Reuse shared components; build a new one only if the pattern repeats.
4. UI text in Indonesian **exactly** as in the design. No extra features or copy beyond the design (except the resolved items below).
5. Verify with a Playwright screenshot at the board size from `INDEX.md` (miniapp 390 px wide, admin 1440/1024/390) and compare to the PNG. Fix differences before moving on.
6. Boards with several states (`*States`, `*Toast*`, `AdmDlg*`, `*Saved`, `*Tested`) are **states of one route**, not separate pages.
7. Demo-only elements are not product features: e.g. the "DEMO · bukan fitur produk" strip on `AuthLogin`, and the representative detail pages (Maya = Request, Salsa = Active, Citra = Blocked, Raka = User) — real detail pages load data by ID.

## Foundation (build first — reference boards `Main`, `CrMain`, `AdmMain`)

### Tokens (CSS variables)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#FFF9FB` | page background (60%) |
| `--pink` | `#F5DCE5` | surfaces, icons, soft accent (30%) |
| `--pink-soft` | `#FBEDF2` | row hover, info panels, table header, sidebar |
| `--rose` | `#A83F67` | primary action, active link, charts (10%) |
| `--rose-hover` | `#8E3255` | primary hover |
| `--ink` | `#30252C` | main text |
| `--ink-2` | `#75636D` | secondary text |
| `--ink-2-pressed` | `#66545E` | secondary text on pink |
| `--line` | `#E6D3DB` | subtle border |
| `--field` | `#D8C0CA` | input + outline-button border |
| `--ok-fg` / `--ok-bg` | `#24634A` / `#E1F0E7` | Active, Berhasil |
| `--warn-fg` / `--warn-bg` | `#7A4F0D` / `#FBEDD0` | Request, Menunggu |
| `--err-fg` / `--err-bg` | `#A3261D` / `#FBE3E0` | Blocked, Gagal, Ditolak |
| `--exp-fg` / `--exp-bg` | `#5E4E57` / `#EFE7EB` | Kedaluwarsa |

Secondary-button hover in HTML: `#EBC9D6`. Focus ring: `outline: 2px solid #A83F67; outline-offset: 2px`.

- Font **Inter** 400/500/600/700 (design loads Google Fonts; self-hosting is allowed if visually identical — record in decisions log). Fallback stack: `Inter, -apple-system, 'Segoe UI', Roboto, system-ui, sans-serif`; monospace `ui-monospace, Menlo, monospace`.
- Icons: outline, 1.75–2 px stroke, inline SVG copied from `html/`.
- Radius: button/input 12, card 16, dialog 20, chip 14 (pill).
- Shadows: `0 1px 2px rgba(48,37,44,.06)`, `0 4px 16px rgba(48,37,44,.08)`; dialog backdrop `rgba(48,37,44,.5)`.
- Control heights: button 40 (36 inside tables), input 44, mobile touch target ≥ 44.

### Hard visual rules
- **Buttons never wrap** (`white-space: nowrap` on every button).
- **Status always has icon + label**, never color only.
- Content field is called **"pesan"**, never "caption". Media actions are **"Pilih Galeri"** and **"Upload Baru"**.

### Shared components
Button (primary/secondary/outline/danger), input/textarea/select, status chip, card, stat card, kv-list, tabs (rose underline), toast (top-right, dark), dialog, data table, chart (title, legend, unit, tooltip, empty state), admin shell, miniapp bottom nav (customer + creator variants), gallery tile (photo/video/uploading %/failed/new/selected), chat bubble (incl. sending/failed/retry, broadcast label, internal AI/Manual labels on creator side), media viewer.

### Admin shell & table (DESIGN.md "Pola")
- Sidebar 248 (Dashboard, Creator, User, Log & History, AI, Pengaturan); topbar 84 (breadcrumb, title, admin identity, Logout). Tablet 1024: sidebar becomes 80 rail. Mobile 390: no sidebar.
- Data table: search, dropdown filters, Reset Filter, sortable headers with arrows, pagination `1 2 3 … N`, "Baris per halaman" 10/25/50, "Menampilkan a–b dari N hasil", View on every row, identity + action columns sticky on horizontal scroll. States per `AdmTableStates`: skeleton, empty, no results, error + "Coba Lagi".
- Action dialog: title, target identity box, specific consequence, Batal, explicit verb, processing state (no double click), success/failure toast. Reason required for reject, block, revoke and sensitive changes. No dialog for View/search/filter/sort/paging/tabs/opening a form.

## Resolved Conflicts (design vs brief) — binding

| # | Topic | Design says | Brief says | **Decision** |
|---|---|---|---|---|
| 1 | Non-subscriber gallery | `CreatorGuest` + DESIGN.md: blurred tiles (server low-res placeholder) | §8A/§20: no blur, no thumbnail, panel only. `CrMain` annotation agrees with brief | **Panel only.** Render the "Galeri tersedia untuk subscriber aktif" panel from `CreatorGuest`; **omit the locked tile grid** (no tiles, durations or counts). API returns no media data to non-subscribers. Same for `CreatorPending`/`CreatorExpired`. |
| 2 | AI disclosure to customers | "Pelanggan tidak tahu ada AI" — no AI text at all | §7: no per-message badge, but service description explains AI may assist | **Follow brief.** No AI badge/label/button in customer chat; all replies look like the creator's. A service description must state replies may be assisted by AI. Location/copy **not designed — gap** (candidate: the "Syarat Layanan" linked from `AuthLogin`, and/or creator profile). |
| 3 | AI memory & summaries | No per-customer memory or summary; chat history is the only context | §7/§13: ConversationMemory + ConversationSummary | **Follow design.** No memory, no summaries, no memory UI. AI context = current persona version + recent chat history (bounded window). Drop `ConversationMemory`/`ConversationSummary` from the data model. |
| 4 | Subscription price | `CrPrice`: creator sets monthly price; "Biaya aplikasi (10%)" breakdown | §2: no payments; Rp79.000 hypothesis; 70/30 share not implemented | **Store and display only.** Creator price is a saved setting shown in `CrPrice`/`CrSettings`. App-fee percentage is a platform setting (placeholder 10%), not hardcoded. **No checkout, billing, payout, or revenue reporting.** Admin still shows no revenue. |
| 5 | Welcome message | `CrWelcome*`: auto message (text + optional media) sent once to each new subscriber | Not in brief | **Build it.** Sent once per customer on first access grant (not on extend/renew/re-grant), idempotent, appears as a normal creator message with no label, does not change AI/Manual mode, not sent if access isn't active at delivery. Media follows chat-media rules (Pilih Galeri = same asset; Upload Baru = not in gallery). |
| 6 | Creator timezone | `CrTimezone`: per-creator display timezone | §13: IANA timezones for display | **Build it.** Display-only IANA timezone per account; storage stays UTC. |
| 7 | Admin edits persona | `AdmPersonaEdit` + `AdmDlgPersona`, reason required, audited | §11: persona shown on creator detail | **Build it** with reason + audit; creates a new persona version. |
| 8 | Build order | Design CLAUDE.md: admin first, then Mini App | §16 phases A–H | **Phases A–H stand.** Within each phase build shared foundation/components first; admin screens may lead where a phase covers both apps. |

## Known Gaps (not designed — do not invent final UI; report and ask)

- AI-assistance disclosure text/location (decision #2) and the "Syarat Layanan" / "Kebijakan Privasi" pages linked from `AuthLogin`.
- **Admin review of customer access requests** (Minta Akses Uji Coba / Minta Perpanjangan Akses): customer states exist (`CreatorPending`, `StatesAccess`, `Subscriptions`), but there is no admin list/queue or approve/reject dialog for them. Admin can grant via `AdmUserSubs` → `AdmDlgGrant`. Needs a decision: queue screen vs. linking requests into user detail.
- Customer notification preferences: `Profile` has a "Notifikasi" section (message notifications, show content); **per-creator mute** (brief §9) has no designed control.
- Invalid deep link: **designed** — `StatesProfile` "Creator tidak tersedia" (checked 2026-11-15, US-005). Still a gap: the "CREATOR opened another creator's link" explanation (brief §4) — neutral placeholder only.
- Customer media viewer states for revoked/deleted attachments.
- **Blocked-account message** (US-006): the Mini App shows the "Belum bisa masuk" panel layout with placeholder copy (`BLOCKED_COPY` in `AuthGate.tsx`, `UserOffIcon`). No board exists. Needs final wording, icon and whether a support contact is shown.

## Miniapp Board Map

| Area | Role | Boards |
|---|---|---|
| Auth | any | `AuthMain` (rules), `AuthLogin`, `AuthOutside`, `AuthStates` |
| Chat list | USER | `Chats`, `StatesChats` |
| Explore | USER | `Explore` |
| Creator profile | USER | `CreatorGuest`, `CreatorPending`, `CreatorActive`, `CreatorExpired`, `StatesProfile` |
| Private chat | USER | `Chat`, `ChatExpired`, `StatesAccess` |
| Media viewer | USER | `MediaPhoto`, `MediaVideo` |
| Subscriptions | USER | `Subscriptions` |
| Profile & edit | USER | `Profile`, `ProfilePending`, `ProfileRejected`, `ProfileBlocked`, `EditProfile`, `EditStates` |
| Creator request | USER | `CreatorRequest`, `CreatorRequestRetry`, `CreatorRequestBlocked`, `RequestStates`, `RequestPending`, `RequestApproved`, `RequestRejected` |
| Inbox | CREATOR | `CrInbox`, `CrStatesInbox` |
| Conversation | CREATOR | `CrChatAI`, `CrChatManual`, `CrChatFail`, `CrChatExpired`, `CrCustomer` |
| Chat media | CREATOR | `CrAttach`, `CrChatPick`, `CrChatPreview`, `CrChatUpload`, `CrChatSent` |
| Gallery | CREATOR | `CrGallery`, `CrGalleryUploading`, `CrGalleryDone`, `CrStatesGallery`, `CrViewerPhoto`, `CrViewerVideo` |
| Broadcast | CREATOR | `CrBroadcast`, `CrBroadcastPick`, `CrBroadcastReady`, `CrBroadcastUpload`, `CrBroadcastUploadSaved`, `CrBroadcastConfirm`, `CrBroadcastDone` |
| Settings | CREATOR | `CrSettings`, `CrEditProfile`, `CrPersona`, `CrPrice`, `CrPriceSaved`, `CrWelcome`, `CrWelcomePick`, `CrWelcomeGallery`, `CrWelcomeUpload`, `CrTimezone` |
| Foundation | — | `Main`, `CrMain` |

Proposed miniapp routes (confirm at Phase A): `/login`, `/chats`, `/chats/:conversationId`, `/explore`, `/creators/:publicCode`, `/subscriptions`, `/profile`, `/profile/edit`, `/profile/creator-request`, `/media/:attachmentId`; creator: `/inbox`, `/inbox/:conversationId`, `/inbox/:conversationId/customer`, `/gallery`, `/broadcast`, `/settings`, `/settings/{profile|persona|price|welcome|timezone}`.

## Admin Route Map (from DESIGN.md)

| Route | Boards |
|---|---|
| `/login` | `AdmLogin`, `AdmLoginStates` |
| `/` (`?period=today\|7\|30\|custom`) | `AdmDashboard`, `AdmDashToday`, `AdmDash30`, `AdmDashCustom`, `AdmDashPicker`, `AdmDashEmpty`, `AdmDashTablet`, `AdmDashMobile`, `AdmLogoutDlg` |
| `/creators` | `AdmCreators`, `AdmCreatorsTablet`, `AdmCreatorsMobile`, `AdmCreatorsToastRej`, `AdmCreatorsToastUnblock` |
| `/creators/:id` (tabs: ringkasan, subscribers, gallery, persona, history) | `AdmCrReq`, `AdmCrActive`, `AdmCrBlocked`, `AdmCrApproved`, `AdmCrBlockedDone`, `AdmCrSubs`, `AdmCrGallery`, `AdmCrPersona`, `AdmCrPersonaSaved`, `AdmPersonaEdit`, `AdmCrHistory` + dialogs `AdmDlgApprove*`, `AdmDlgReject*`, `AdmDlgBlock`, `AdmDlgUnblock`, `AdmDlgPersona` |
| `/creators/:id/gallery/:mediaId` | `AdmMediaDetail` |
| `/users`, `/users/:id` (tabs: ringkasan, subscriptions, creator-request, history) | `AdmUsers`, `AdmUsersToastUnblock`, `AdmUserSummary`, `AdmUserBlocked`, `AdmUserBlockedDone`, `AdmUserSubs*`, `AdmUserRequest`, `AdmUserHistory` + `AdmDlgUserBlock`, `AdmDlgUserUnblock`, `AdmDlgGrant`, `AdmDlgExtend`, `AdmDlgRevoke` |
| `/users/:id/subscriptions/:subId`, `/users/:id/requests/:reqId` | `AdmSubDetail`, `AdmReqDetail`, `AdmReqDetailRej` |
| `/logs/(audit\|system\|notifications\|access)`, `/logs/:id` | `AdmLogAudit`, `AdmLogSystem`, `AdmLogNotif`, `AdmLogAccess`, `AdmLogDetail`, `AdmLogNotifFail`, `AdmLogNotifFail2`, `AdmLogNotifRetried`, `AdmDlgRetry` |
| `/ai/(overview\|usage\|config\|history)`, `/ai/requests/:id`, `/ai/history/:id` | `AdmAiOverview`, `AdmAiUsage`, `AdmAiReqOk`, `AdmAiReqFail`, `AdmAiConfig*`, `AdmDlgAiTest`, `AdmDlgAiSave`, `AdmAiHistory`, `AdmAiHistDetail` |
| `/settings/(general\|telegram\|media\|notifications\|account)`, `/settings/sessions/:id` | `AdmSetGeneral`, `AdmSetEdit`, `AdmSetSaved`, `AdmSetTelegram*`, `AdmSetEditTg`, `AdmSetSavedTg`, `AdmSetMedia*`, `AdmSetEditMedia`, `AdmSetSavedMedia`, `AdmSetNotif`, `AdmSetEditNotif`, `AdmSetSavedNotif`, `AdmNotifPreview`, `AdmSetAccount*`, `AdmSessDetail*` + `AdmDlgSetSave*`, `AdmDlgTestTg`, `AdmDlgTestMedia`, `AdmDlgPass`, `AdmDlgSession` |
| (all tables) | `AdmTableStates` |

Notes from admin boards to honor in backend: AI config has provider, model, masked API key (no reveal), output token cap, timeout, retry limit, **monthly budget (notify at 80%, AI stops at 100%)**; provider/model names in the design are samples. Notification templates use `{nama}`, `{creator}`, `{tanggal}` variables.

## Seed Data (fictional — use for dev fixtures)

1.248 active users; 14 active creators; 3 pending creator requests (Maya Lestari, Raka Putra, Luna Aurora); 412 active subscriptions; 19 creators in the list (e.g. Salsa 58 subscribers, Kirana 46, Dinda 41). Raka Putra intentionally has 1 active subscription so his approval fails (`AdmDlgApproveFail`). Times displayed in WIB (Asia/Jakarta).
