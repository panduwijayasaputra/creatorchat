# Frontend Development Guidelines (React + Vite)

Covers `apps/miniapp` (Telegram Mini App, USER + CREATOR), `apps/admin` (web dashboard), and `packages/ui`.
Product rules: `.agile/.doc/Claude_Code_Project_Brief_and_Guide.md` (brief) as amended by `.agile/guidelines/design-integration.md`. Visual rules: the **Claude Design export** in `designs/creator-chat-design-handoff/design/`.

## Rule 0 — The Design Export Is the Visual Source of Truth

- Visual design follows the Claude Design export **100%**: layout, components, assets, fonts, icons, copy, spacing, colors, responsiveness, interactions.
- **Do not** redesign, re-theme, add an alternative design system, or swap export components for a UI library. Tailwind/shadcn only if the export already uses them.
- **Export location:** `designs/creator-chat-design-handoff/design/` (173 boards: `png/` visual reference, `html/` static HTML with exact inline values, `DESIGN.md`, `INDEX.md`). Read-only reference — never edit it or import it into builds.
- **Read `.agile/guidelines/design-integration.md` before any UI task.** It holds tokens, shared components, board → route maps, seed data, the **resolved design-vs-brief conflicts** (binding), and known gaps.
- Per screen: look at the PNG first, take exact values from the HTML, reuse shared components, then compare a Playwright screenshot at the board size against the PNG.
- If a board shows something overruled in design-integration.md (e.g. blurred locked tiles for non-subscribers) or a superseded feature (brief §20), **do not build it**; adapt the minimum using the same visual patterns.
- If a required screen/state is not designed, report the specific gap — don't invent a final screen.

## Integration Approach

1. Build the foundation first: CSS-variable tokens, Inter, icons, shared components (from `Main`, `CrMain`, `AdmMain`). Then one screen per step.
2. The HTML boards are static mockups with inline styles: **re-implement them as React components** with the same values — don't paste whole HTML files into the app.
3. Replace sample data with typed API clients. Never present a mock interaction as a real integration. Boards' sample names/numbers are fixtures, not hardcoded content.
4. Every screen implements the designed loading / empty / error / retry states (and reports a gap if the design lacks one).
5. UI copy is Indonesian, exactly as in the design. Don't add copy or features beyond the design, except the items decided in design-integration.md.

## Styling

- Tokens as CSS custom properties (names in design-integration.md) in one global stylesheet per app (shared via `packages/ui` when both apps use them).
- Component styles: CSS Modules (proposed — confirm at scaffold and record in tech-stack decisions log). No Tailwind/shadcn/component library — the design doesn't use them.
- Every button `white-space: nowrap`; status chips always icon + label; focus ring `2px solid var(--rose)` offset 2px.
- Icons: inline SVG components copied from the boards (outline 1.75–2 px), not an icon library unless it matches exactly.

## Structure

```
apps/miniapp/src/
├── main.tsx
├── app/                     # providers, router, Telegram bootstrap
├── telegram/                # WebApp wrapper: initData, theme, viewport/safe-area, BackButton, haptics
├── api/                     # typed HTTP client + socket client (types from packages/contracts)
├── features/
│   ├── auth/                # login screen, "Buka di Telegram" fallback, start_param destination
│   ├── customer/            # chat-list, explore, creator-profile, gallery, chat, subscriptions, profile, creator-request
│   └── creator/             # inbox, conversation (AI/manual), customer detail, gallery, broadcast, settings (profile, persona, welcome, price, timezone)
├── components/              # export components shared inside the app
└── styles/                  # export tokens/fonts

apps/admin/src/
├── app/                     # router, providers, auth bootstrap (cookie session)
├── api/
├── features/                # login, dashboard, creators, users, logs, ai, settings
└── components/              # export components: data-table, confirm-dialog, etc.
```

Feature folders hold their screens, hooks and local components. Filenames kebab-case; components PascalCase.

## Mandatory Patterns

- Function components + hooks; `strict` TypeScript, no `any`.
- Request/response types and schemas imported from `packages/contracts` — never redefine API types by hand.
- Server state through one data-fetching layer (proposed: TanStack Query — confirm at scaffold); no ad-hoc fetch in components.
- Every list/request has loading, empty, error (+ retry) handling.
- Render user content as text. Never `dangerouslySetInnerHTML` with user/creator content.
- No secrets in `VITE_*` variables — only public values (API base URL, bot username).
- No auth tokens in `localStorage`/`sessionStorage`.

## Telegram Mini App Rules

- Bootstrap: read `initData` from the Telegram WebApp, POST it to `/v1/auth/telegram`, keep the session token **in memory**; on reload re-exchange initData.
- Outside Telegram (no initData): show only the login page with **"Buka di Telegram"** linking to the bot. No alternative web login.
- Never derive identity/role from `initDataUnsafe`; the server response (`/v1/me`) decides role and navigation.
- `start_param` (`c_<public_code>`) is a destination hint, kept through login, resolved via API after auth. Invalid → "profil tidak tersedia" + link to Jelajahi.
- Role-based shell — no switcher:
  - USER tabs: **Chat, Jelajahi, Langganan, Profil**
  - CREATOR tabs: **Inbox, Galeri, Broadcast, Pengaturan**
  - CREATOR opening another creator's link: short explanation, back to the creator workspace.
- Respect safe areas, viewport height changes, virtual keyboard, Telegram BackButton (wire it to router back), scroll restoration, media viewer gestures. Test at mobile widths.
- Chat UI: optimistic send with `client_message_id`, states sending/failed/retry, cursor-based history loading, unread, timestamps. After socket reconnect, refetch missed messages over HTTP.
- Customer side shows **no** AI label, badge, button or text in chat; every reply looks like the creator's. The AI-assistance disclosure lives only in the service description (location is a design gap). Creator side shows AI/Manual/Broadcast labels and AI mode controls ("Ambil Alih", "Hanya terlihat olehmu").
- Non-subscriber gallery: show the "Galeri tersedia untuk subscriber aktif" panel only — **no tile grid**, no thumbnails, no blurred images, no durations or counts of hidden media (overrides `CreatorGuest`).
- Media URLs are short-lived signed URLs from the API; refetch on expiry, never persist them.
- Media attach flows (brief §8): "Pilih Galeri" / "Upload Baru"; preview + optional **pesan** before send (never "caption"). Broadcast "Upload Baru" shows "Simpan juga ke galeri" checkbox, **default unchecked**; hidden when picking from gallery. Broadcast requires a confirm step then shows a short result.
- Creator settings include persona, welcome message (`CrWelcome*`), subscription price (`CrPrice`, display/settings only — no payment UI), and display timezone (`CrTimezone`).
- No AI memory or summary UI anywhere.

## Admin Dashboard Rules (brief §11)

- Session in Secure/HttpOnly cookies (set by API); send CSRF token as the API requires. Never store tokens in JS-accessible storage.
- **Tables:** server-side search, filters, column sort, pagination 10/25/50, total + range, "Reset Filter", a **View** on every row that opens a real detail route, and loading/empty/no-results/error/retry states.
  - Table state (filters, sort, page, pageSize) lives in the URL query so it survives navigating to a detail page and back.
  - Changing a filter/search resets to page 1.
  - Never load everything then filter on the client.
- **Mutations** (grant/extend/revoke, approve/reject, block/unblock, config save, test connection, retry, revoke session, logout) go through the designed confirmation dialog: clear target, consequence, "Batal", specific confirm verb, in-flight disabled state, success/error feedback. Reject/block/revoke and sensitive changes require a reason field.
- View/search/filter/sort/pagination/tab switches are not mutations — no dialog.
- Form errors are inline; failed submits keep the user's input.
- Secret fields show masked "set/not set" state; leaving a secret field empty on save means "keep existing" — never submit placeholder asterisks.
- Charts: clear units and legends; costs labeled "estimasi". No revenue/payment charts.
- Admin must not surface private chats/attachments by default.

## Code Shape (illustrative — adapt to export structure)

```tsx
// features/customer/chat-list/use-conversations.ts
export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.conversations.list(), // typed from packages/contracts
  });
}

// features/customer/chat-list/chat-list-screen.tsx
export function ChatListScreen() {
  const { data, isPending, isError, refetch } = useConversations();
  if (isPending) return <ChatListSkeleton />;          // export component
  if (isError) return <ErrorState onRetry={refetch} />; // export component
  if (data.items.length === 0) return <ChatListEmpty />;
  return <ChatList items={data.items} />;             // export markup, now fed real data
}
```

## Forbidden

- Redesigning, restyling, or replacing export components with a library.
- Building superseded features (brief §20).
- Client-side authorization as the only guard; hiding a button is not access control.
- Blurred/locked tile grids or thumbnails for non-subscribers.
- Any AI wording in customer UI; AI memory/summary UI.
- Buttons that wrap to two lines; status shown by color only.
- Pasting board HTML wholesale into the app; editing files under `designs/`.
- Tokens in localStorage; secrets in `VITE_*`.
- `any`; hand-copied API types; `dangerouslySetInnerHTML` with user content.
- Fake checkout/payment UI.

## Testing

- Component/hook tests for non-trivial logic (send/retry state, table URL state, confirm dialog flow).
- Visual QA with Playwright screenshots at the board sizes in `INDEX.md` (miniapp 390×844 or board height; admin 1440, 1024, 390) compared against `design/png/...`. Review the rendered page yourself; don't claim pixel fidelity from a diff number alone. Also check keyboard/safe area in Telegram.
- Exact commands finalized at scaffold (e.g. `pnpm --filter miniapp test`, `pnpm --filter admin test`).
