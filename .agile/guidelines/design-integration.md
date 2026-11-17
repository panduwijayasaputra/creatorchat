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
- **Admin Creator list** (US-014): the mobile (390 px) **Filter panel** has no board (built as a plain panel with the desktop Status / Jenis / Tanggal controls and Reset Filter), and the **Tanggal** options are not designed (placeholder: Semua / 7 / 30 / 90 hari terakhir). Needs designer confirmation.
- **Admin user block / unblock** (US-019): the `AdmDlgUserBlock` text says active subscriptions are "ditangguhkan, bukan dicabut, dan berlanjut setelah di-unblock", while `AdmDlgUserUnblock` says "tidak ada akses langganan yang dipulihkan secara otomatis". Implemented as: subscriptions are never touched; both texts verbatim. With no active subscription the second sentence of the block text is left out (placeholder). The conflict toast ("Status … sudah berubah") has no board.
- **Admin User list** (US-017): `AdmUsers` exists only at 1440 px. Tablet and mobile reuse the creator list's treatment (compact columns, plain Filter panel), and the **Bergabung** options are placeholders (Semua / 7 / 30 / 90 hari terakhir). Needs designer confirmation.
- **Admin user access** (US-020): the **Berakhir** filter options (placeholder: Semua / 7 hari ke depan / 30 hari ke depan / Sudah berakhir), the custom-date picker (a native date input over the date field), the conflict toast ("Status akses … sudah berubah"), the dialog failure banner, the empty creator picker ("Tidak ada creator yang bisa diberi akses.") and the disabled Berikan Akses for a BLOCKED user have no board. The grant and extend dialogs promise a Telegram notification that is not sent until Phase E (the outbox event is written, no handler). The user avatar colour differs per dialog on the boards; one rule is used. Needs designer confirmation.
- **Admin creator detail / History** (US-015): the History **Jenis** options (Semua / Akun / Pengajuan / Akses) and the Detail Log back-link wording from a person's History ("Kembali ke History Creator") are not designed (placeholders); the not-found / load-failed states of the detail and log pages, the "Ditolak n kali sebelumnya" and "n aktif" wordings of the request check are placeholders. The boards' **Kategori / Kota** rows have no data model and are omitted; conversation / message / media counts and AI usage show "–" until Phases C, D, F; **Lihat Usage** is inert.
- **Admin user detail** (US-018): the not-found state and the creator-id redirect of `/users/:id`, the Pengajuan Creator **Status** filter options (Semua / Menunggu / Ditolak), the banner text when a pending request has no blocking subscription ("Pengajuan menunggu peninjauan admin."), the Detail Log back-link wording from a user's History or a request ("Kembali ke History User", "Kembali ke Detail Pengajuan") and the load / not-found states of the request detail are placeholders. The Langganan tab is the "belum dibangun" panel until Phase C.
- **Admin subscription detail and creator Subscriber tab** (US-021): the **user picker** of Berikan Akses on the creator side (the `AdmDlgGrant` board only has a Creator select) is a placeholder: search box, result list, empty / failed / blocked-creator wording; the Berakhir filter options (shared with US-020); the Subscriber tab text for a pending request; the not-found / load-failed states of the subscription detail; the log back-link wording from a subscription ("Kembali ke Detail Langganan"). The boards show "Menampilkan 1–8 dari 58" (an 8-row page); the page shows the real range for the chosen page size.
- **Explore and creator profile** (US-022): the Explore **search box** ("Cari nama creator", on the board but not in the story: not built), the **category / city line** (no data model), the Explore "Muat lagi" pagination control and its loading / empty / error wording, the profile loading and load-failed states, the "Fitur ini belum tersedia." toast for actions of later stories (Minta Akses Uji Coba, Minta Perpanjangan Akses → US-023; Buka Chat, Lihat Riwayat Chat → US-026 / US-027), and the active-state gallery placeholder are placeholders. The boards' creator illustrations are replaced by the avatar or initials (no photo data) and the tile grids are deliberately not built (Resolved Conflict #1). Screenshots compare the top part of each profile board only.
- **Customer access request** (US-023): no board for the failed-request message (placeholder "Permintaan belum terkirim. Coba lagi.") or the sending label ("Mengirim…"); `StatesAccess` shows the result cards alone, so on the profile the rejected card sits above "Ajukan Lagi" (which replaces the trial / renewal button) and the approved card replaces the "Akses aktif hingga" strip.
- **Customer private chat** (US-026): no board for the **creator-blocked** state (placeholder panel "Creator tidak tersedia" / "Riwayat chat tetap bisa kamu baca.", no renewal button, subtitle "Creator tidak tersedia"), the **… (Opsi percakapan)** menu (the button only shows "Fitur ini belum tersedia."), the **load-failed / not-found** states of the chat (the app's network error screen; "Percakapan tidak ditemukan."), the empty conversation, a failed **older-history** page ("Riwayat belum termuat." / "Coba lagi"), the day-separator label for another year (year appended), and the header name while the first page loads (blank: the board shows the name, which the app cannot know before the fetch until US-027 passes it along). The send button's enabled state and the focus border come from `Main`. A refused send (access ended / creator blocked) just switches the composer; there is no failure text for it. The board's media bubbles are built in US-037 and the "Dibaca" tick in US-030.
- **Creator inbox** (US-028): the **search box** "Cari nama pelanggan" of `CrInbox` is not built (not in the story; the same call as Explore); the Manual / Perlu Perhatian chips and the AI Aktif / Balasan AI gagal / Manual row chips are Phase F; the Inbox bottom-nav badge belongs to US-030. No board for the empty result under **Belum Dibaca** (placeholder "Tidak ada pesan yang belum dibaca."), a failed **next page** ("Percakapan belum termuat." / "Coba lagi"), a failed or unconfigured **Salin Link Profil** (toasts), the label for yesterday (older days show "6 Nov"), and the hidden chips while offline (the offline frame shows none). The offline panel is driven by the browser's online / offline events until US-031.
- **Read receipts** (US-030): `Chat` shows the double tick **with** "Dibaca" under my message, `ChatExpired` shows the tick **without** the word. One rule is built for both: tick + "Dibaca" under my latest message the creator has read (the `ChatExpired` board differs by the word). The creator side shows no marker (none on `CrChatManual`). The creator's Inbox badge uses the board's "n percakapan belum dibaca" label; the customer's badge keeps "n pesan belum dibaca".
- **Admin review of customer access requests** (US-024): no boards for the pending-request **banner** on the Langganan tab, the **Tolak** dialog text ("Tolak permintaan akses?"), the toasts, the `/users` **Permintaan akses** chip and the **Akses** filter (Semua / Menunggu). Built from existing pieces with placeholder copy (`ACCESS_REQUEST_COPY`). The added filter makes the `/users` toolbar one control wider than `AdmUsers`, so Reset Filter wraps onto its own row at 1440 px (the shared `DataTable` toolbar now wraps instead of clipping).
- **Customer Langganan page** (US-025): the board has no loading / empty / error text (`StatesChats` is chat-specific): placeholder "Belum ada langganan", "Langganan gagal dimuat"; no note for a **blocked creator** (placeholder "Creator sedang tidak tersedia.", card without buttons); no sending / failure wording for the extend button; the avatars are initials, not the board's illustrations.
- **Customer chat list** (US-027): no board for the **Muat lagi** control and its failure text ("Percakapan belum termuat."), a conversation with **no message yet** (placeholder preview "Belum ada pesan", no time) or a **blocked creator** (placeholder chip "Creator tidak tersedia", the chat screen's wording). Avatars are initials, not the board's illustrations. The badge does not clear after reading until US-030 adds the read cursor writer.
- **Creator conversation** (US-029): the Manual / Aktifkan AI panel, the "Kamu mengambil alih" and "AI dijeda" notes, the composer hint ("Aktifkan AI dari panel di atas") and the AI card + footnote on `CrCustomer` are Phase F and the attach button Phase D: not built (the "Manual" tag on my own bubbles is). No board for the **ended-access `CrCustomer`** (placeholder: clock icon, "Akses telah berakhir", "Berakhir 6 Nov 2026 · dikelola admin"), a customer **without a Telegram username** ("dari Telegram" alone), or the load-failed / not-found states (reuse the customer chat's). Avatars are initials on the inbox tone. Screenshots differ from the boards by the omitted parts (manual 23%, customer 12%).
- **Realtime** (US-031): only the inbox has an offline panel (`CrStatesInbox`, "Koneksi terputus" / "Menyambungkan ulang…"); the chat and chat-list screens have no designed offline or reconnecting state and show nothing (they catch up silently). The panel now also appears when the socket drops after having connected, not only on the browser's offline event; it is never shown before the first successful connect. No "new message" indicator for a reader scrolled up in a chat (the bubble is added without moving the view).
- **Creator gallery** (US-032): no board for the message when a file is **refused before upload** (placeholder toasts for a wrong type / over the size limit) or **rejected by the server** (placeholder banner texts per reason: type, size, length, unreadable; the `CrStatesGallery` banner is only the lost-connection case), for the **gallery load-failed** state (reuses the app's error panel: "Galeri gagal dimuat") and for a failed next page. The board's `CrGalleryUploading` DEMO strip is not built; the failed-upload frame hides the count line and the note, as the board does. Tiles are not opened yet (viewer: US-033) and the board's illustrations are replaced by the real thumbnail or a neutral placeholder. No seed media: development galleries start empty. One file per Upload tap.
- **Creator gallery viewer** (US-033): no board for a viewer that cannot load (placeholder "Media belum termuat." with Coba Lagi, "Media tidak ditemukan." with Tutup), for the play state of a video that has not started (the play icon is the pause icon's counterpart; its label "Putar video" is a placeholder) or for swipe between items (buttons only, as on the boards; the boards show a single arrow because they are single frames, the viewer shows both where both neighbours exist). The video seek control is a visually hidden range input over the board's track. Screenshots differ by the flat stand-in image and the fixture video's length / play state.
- **Subscriber gallery** (US-034): the viewer boards `MediaPhoto` / `MediaVideo` show the **chat** viewer's footer (creator avatar, message text, relative time); the gallery viewer shows the placeholder "{creator} · Diunggah {date}". No board for the profile gallery's loading (pink 4:5 skeleton tiles), empty ("Belum ada media di galeri."), load-failed ("Galeri belum termuat." + Coba lagi) or next-page-failed lines, and no pagination control (the next page loads when the grid end scrolls into view). The board's category / city line stays out (no data model). The bottom nav does not highlight Jelajahi on `/creators/:code` (as in US-022). Screenshots compare the whole `CreatorActive` board now; they differ by the hero illustration, the missing category line and the stand-in tile art.
- **Admin creator gallery** (US-035): the **Diunggah** options (Semua / 7 / 30 / 90 hari terakhir) are placeholders like the other admin date filters; **search** matches only the media number ("12" or "#12"; media has no title, anything else finds nothing); the not-found, load-failed and preview-failed states of the media page are placeholders ("Media tidak ditemukan", "Media belum bisa dimuat.", "Pratinjau belum bisa dimuat."); the table shows the real range per page size (the board's "Menampilkan 1–8 dari 12 hasil" is an 8-row sample). The preview of a video uses the browser's own controls; the boards' illustrations are replaced by the real file (stand-in in screenshots).
- **Creator sends media** (US-036): no board for an **empty gallery in the picker** (placeholder "Galeri masih kosong" + a pointer to Upload Baru; Lanjut stays disabled), the picker's **load-failed / next-page-failed** lines, "Belum ada media dipilih" while nothing is chosen, the **upload progress and failure inside the preview** (a dark progress overlay and a red panel with "Unggahan gagal" / Coba Lagi, wording is a placeholder), the refused-file toasts, and the **"Foto" / "Video"** words for a media-only message in the chat list and inbox. The Phase F parts of `CrAttach`, `CrChatPreview`, `CrChatUpload` and `CrChatSent` are not built: the AI header chip ("AI Aktif" / "Manual" + Ambil Alih / Aktifkan AI), the takeover note, "Kamu membalas secara manual." and "Mengirim akan mengambil alih percakapan dari AI.". The media bubble is not tappable yet (US-037 adds the viewer for received files; no creator-side viewer of one's own chat media is designed). Screenshots differ from the boards by those parts and the stand-in artwork.
- **Customer chat media** (US-037): the viewer route is `/chats/:conversationId/media/:attachmentId` (the earlier proposal was `/media/:attachmentId`; scoping by conversation gives "n / N" and one ownership check), drawn over the conversation. "n / N" counts the conversation's files, oldest first. Footer: message text, "{creator} · Hari ini, 09.16 WIB" with the avatar illustration (the creator's photo is not in the answer). Bubbles use the `Chat` board's frame (238 × 100 photo, 238 × 120 video with a play button), not `CrChatSent`'s (240 × 150); the board labels an old message "Kemarin, 18.02" where the app shows the day separator and "18.02". No board for a viewer that cannot load or for a revoked / deleted file (placeholder "Media belum termuat." / "Media tidak ditemukan."). The video seek control and pause icon follow the creator viewer. No creator-side viewer of chat media is designed: the creator's own media bubble is not tappable.
- Customer notification preferences: `Profile` has a "Notifikasi" section (message notifications, show content); **per-creator mute** (brief §9) has no designed control.
- Invalid deep link: **designed** — `StatesProfile` "Creator tidak tersedia" (checked 2026-11-15, US-005). Still a gap: the "CREATOR opened another creator's link" explanation (brief §4) — neutral placeholder only.
- Customer media viewer states for revoked/deleted attachments.
- **Admin creator block** (US-016): no board for the list toast after a successful **block** (`AdmCrBlockedDone` is the detail page, US-015); placeholder "{name} diblokir.". The 409 conflict toast and the count-load failure copy are placeholders too.
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
