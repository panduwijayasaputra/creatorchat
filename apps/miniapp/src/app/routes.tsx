import { Outlet, type RouteObject } from 'react-router';
import { AuthProvider, type SeenFlag } from '../auth/AuthProvider';
import type { MiniappApi } from '../auth/api-client';
import { LandingRedirect, RequireRole, RequireSession } from '../auth/guards';
import type { TelegramEnv } from '../telegram/webapp';
import { ChatPage } from '../chat/ChatPage';
import { ChatMediaViewer } from '../chat/ChatMediaViewer';
import { CreatorLinkPage } from '../creator-link/CreatorLinkPage';
import { CustomerGalleryViewer } from '../creator-link/CustomerGalleryViewer';
import { HealthStatus } from '../components/HealthStatus';
import { GalleryPage } from '../gallery/GalleryPage';
import { GalleryViewer } from '../gallery/GalleryViewer';
import { NotImplemented } from '../components/NotImplemented';
import { BroadcastPage } from '../broadcast/BroadcastPage';
import { WelcomePage } from '../creator/welcome/WelcomePage';
import { CreatorEditProfilePage } from '../creator/CreatorEditProfilePage';
import { CreatorSettingsPage } from '../creator/CreatorSettingsPage';
import { CreatorTimezonePage } from '../creator/CreatorTimezonePage';
import { CreatorRequestPage, REQUEST_STATUS_PATH } from '../profile/CreatorRequestPage';
import { CreatorRequestStatusPage } from '../profile/CreatorRequestStatusPage';
import { EditProfilePage } from '../profile/EditProfilePage';
import { CreatorChatPage } from '../creator-chat/CreatorChatPage';
import { CreatorCustomerPage } from '../creator-chat/CreatorCustomerPage';
import { InboxPage } from '../inbox/InboxPage';
import { ChatListPage } from '../chats/ChatListPage';
import { UnreadProvider } from '../chats/UnreadProvider';
import { RealtimeProvider } from '../realtime/RealtimeProvider';
import type { RealtimeFactory } from '../realtime/types';
import { ExplorePage } from '../explore/ExplorePage';
import { SubscriptionsPage } from '../subscriptions/SubscriptionsPage';
import { ProfilePage } from '../profile/ProfilePage';
import { CreatorShell, CustomerShell } from '../components/shell/Shells';
import { CREATOR_NAV, CUSTOMER_NAV, type NavEntry } from './nav-config';

export interface MiniappRoutesOptions {
  /** The Mini App API client (token in memory). */
  api: MiniappApi;
  /** Test seams for Telegram and the "seen before" device hint. */
  telegram?: TelegramEnv;
  seen?: SeenFlag;
  /** No data source yet: the chat stories feed the real unread count. */
  unreadCount?: number;
  /** The socket factory (US-031); without it nothing connects, which is what most tests want. */
  realtime?: RealtimeFactory;
  /** Extra routes outside the shells (e.g. the dev-only component preview). */
  extraRoutes?: RouteObject[];
}

/** Settings rows whose screens belong to later stories. */
const LATER_SETTINGS = [
  ['persona', 'Persona AI'],
  ['price', 'Harga subscription'],
] as const;

function placeholder(entry: NavEntry, withHealth = false): RouteObject {
  return {
    path: entry.to.slice(1),
    element: (
      <NotImplemented title={entry.label}>{withHealth ? <HealthStatus /> : null}</NotImplemented>
    ),
  };
}

/**
 * Everything except the dev-only preview needs a signed-in account (US-004). `/` lands USER on Chat
 * and CREATOR on Inbox from the server's `/me`. Each shell is role-gated (US-006): a wrong-role URL
 * redirects to the account's own landing. This is a UX gate; the API enforces roles on every request.
 */
export function createMiniappRoutes({
  api,
  telegram,
  seen,
  unreadCount,
  realtime,
  extraRoutes = [],
}: MiniappRoutesOptions): RouteObject[] {
  return [
    {
      element: (
        <AuthProvider api={api} {...(telegram ? { telegram } : {})} {...(seen ? { seen } : {})}>
          <RealtimeProvider api={api} factory={realtime}>
            <UnreadProvider api={api}>
              <Outlet />
            </UnreadProvider>
          </RealtimeProvider>
        </AuthProvider>
      ),
      children: [
        {
          element: <RequireSession />,
          children: [
            { path: '/', element: <LandingRedirect /> },
            // Deep-link landing (US-005): the path survives login; the server resolves the code.
            {
              path: '/creators/:publicCode',
              element: <CreatorLinkPage api={api} />,
              // The subscriber's viewer is drawn over the profile, which stays mounted underneath.
              children: [
                { path: 'gallery/:assetId', element: <CustomerGalleryViewer api={api} /> },
              ],
            },
            {
              element: <RequireRole role="USER" />,
              children: [
                {
                  element: <CustomerShell unreadCount={unreadCount} />,
                  children: [
                    // Profile (US-007), Explore (US-022) and Langganan (US-025) and the chat list (US-027) are real; the other customer tabs are still placeholders.
                    ...CUSTOMER_NAV.flatMap((entry, index) =>
                      entry.to === '/profile' ||
                      entry.to === '/explore' ||
                      entry.to === '/subscriptions' ||
                      entry.to === '/chats'
                        ? []
                        : [placeholder(entry, index === 0)],
                    ),
                    { path: 'chats', element: <ChatListPage api={api} /> },
                    { path: 'explore', element: <ExplorePage api={api} /> },
                    { path: 'subscriptions', element: <SubscriptionsPage api={api} /> },
                    { path: 'profile', element: <ProfilePage api={api} /> },
                  ],
                },
                // Full-screen private chat (US-026, no bottom navigation); `/chats` is the list (US-027).
                {
                  path: 'chats/:conversationId',
                  element: <ChatPage api={api} />,
                  // A received file opens in a viewer drawn over the conversation (US-037).
                  children: [
                    { path: 'media/:attachmentId', element: <ChatMediaViewer api={api} /> },
                  ],
                },
                // Full-screen pages under Profil (no bottom navigation).
                {
                  path: 'profile/edit',
                  element: <EditProfilePage />,
                },
                { path: 'profile/creator-request', element: <CreatorRequestPage api={api} /> },
                {
                  path: REQUEST_STATUS_PATH.slice(1),
                  element: <CreatorRequestStatusPage api={api} />,
                },
              ],
            },
            {
              element: <RequireRole role="CREATOR" />,
              children: [
                {
                  element: <CreatorShell unreadCount={unreadCount} />,
                  children: [
                    // Inbox (US-028), Gallery (US-032), Broadcast (US-038) and Settings (US-008) are real; the other creator tabs are still placeholders.
                    ...CREATOR_NAV.filter(
                      (entry) =>
                        entry.to !== '/settings' &&
                        entry.to !== '/inbox' &&
                        entry.to !== '/gallery' &&
                        entry.to !== '/broadcast',
                    ).map((entry) => placeholder(entry)),
                    { path: 'inbox', element: <InboxPage api={api} /> },
                    { path: 'broadcast', element: <BroadcastPage api={api} /> },
                    {
                      path: 'gallery',
                      element: <GalleryPage api={api} />,
                      // The viewer is drawn over the grid, which stays mounted underneath.
                      children: [{ path: ':assetId', element: <GalleryViewer api={api} /> }],
                    },
                    { path: 'settings', element: <CreatorSettingsPage api={api} /> },
                    // Rows owned by later stories (persona, price).
                    ...LATER_SETTINGS.map(([path, title]) => ({
                      path: `settings/${path}`,
                      element: <NotImplemented title={title} />,
                    })),
                  ],
                },
                // Full-screen conversation and customer detail (US-029, no bottom navigation).
                { path: 'inbox/:conversationId', element: <CreatorChatPage api={api} /> },
                {
                  path: 'inbox/:conversationId/customer',
                  element: <CreatorCustomerPage api={api} />,
                },
                // Full-screen page under Pengaturan (no bottom navigation).
                { path: 'settings/profile', element: <CreatorEditProfilePage /> },
                { path: 'settings/timezone', element: <CreatorTimezonePage /> },
                { path: 'settings/welcome', element: <WelcomePage api={api} /> },
              ],
            },
            {
              path: '*',
              element: (
                <main>
                  <NotImplemented title="Halaman tidak ditemukan" />
                </main>
              ),
            },
          ],
        },
      ],
    },
    // Dev-only routes (the component preview) stay outside the auth gate.
    ...extraRoutes,
  ];
}
