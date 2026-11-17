import type {
  AdminCreatorRequest,
  ApprovalBlock,
  CreatorRequestReviewResponse,
} from '@creatorchat/contracts';

/** Fictional applicants from the design boards (Maya = clear, Raka = blocked by a subscription). */
export const REQUEST_ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';

export const MAYA: AdminCreatorRequest = {
  id: REQUEST_ID,
  status: 'PENDING',
  creator_name: 'Maya Lestari',
  instagram_url: 'https://instagram.com/maya.lestari',
  creator_type: 'HUMAN',
  description: 'Resep dan tips masak rumahan untuk pemula.',
  created_at: '2026-11-14T05:00:00.000Z',
  reviewed_at: null,
  review_reason: null,
  user: {
    id: '5b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e11',
    display_name: 'Maya Lestari',
    telegram_username: 'mayalestari',
    telegram_id: '582917403',
    role: 'USER',
    status: 'ACTIVE',
  },
};

export const LUNA: AdminCreatorRequest = {
  ...MAYA,
  id: '2e3f4a5b-2222-4333-8444-555566667777',
  creator_name: 'Luna Aurora',
  creator_type: 'AI_CHARACTER',
  user: {
    ...MAYA.user,
    id: '9c1f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e22',
    display_name: 'Luna Aurora',
    telegram_username: 'lunaaurora',
    telegram_id: '774120936',
  },
};

export const RAKA: AdminCreatorRequest = {
  ...MAYA,
  id: '3f4a5b6c-3333-4444-8555-666677778888',
  creator_name: 'Raka Putra',
  user: {
    ...MAYA.user,
    id: '7d1f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e33',
    display_name: 'Raka Putra',
    telegram_username: 'rakaputra',
    telegram_id: '691042285',
  },
};

/** 14 Nov 2026, 15.02 WIB. */
export const CHECKED_AT = '2026-11-14T08:02:00.000Z';

export const SALSA_BLOCK: ApprovalBlock = {
  count: 1,
  creator_name: 'Salsa Maheswari',
  ends_at: '2026-11-27T00:00:00.000Z',
};

export const review = (
  request: AdminCreatorRequest,
  block: ApprovalBlock | null = null,
): CreatorRequestReviewResponse => ({ request, check: { block, checked_at: CHECKED_AT } });
