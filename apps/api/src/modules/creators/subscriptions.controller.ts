import { Controller, Get, Header, Inject, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser, CreatorAccessService } from '@creatorchat/backend-core';
import type { SubscriptionItem, SubscriptionsResponse } from '@creatorchat/contracts';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { CurrentUser, UserJwtGuard } from '../../common/auth/user-jwt.guard.js';
import { CREATOR_ACCESS } from './tokens.js';

/**
 * The Langganan page (US-025): the signed-in customer's own relations, one card per creator. The
 * viewer comes from the session only; the request has no id and no parameters (a query string is
 * ignored). Read-only; no creator ids, counts, other customers or media.
 */
@Controller('subscriptions')
@UseGuards(UserJwtGuard, RolesGuard)
export class SubscriptionsController {
  constructor(@Inject(CREATOR_ACCESS) private readonly access: CreatorAccessService) {}

  @Get()
  @Roles('USER')
  @Header('Cache-Control', 'no-store')
  async list(@CurrentUser() current: AuthenticatedUser): Promise<SubscriptionsResponse> {
    const { items } = await this.access.subscriptions(current.user.id);
    return {
      items: items.map((card): SubscriptionItem => {
        const a = card.access;
        return {
          public_code: card.publicCode,
          display_name: card.displayName,
          avatar_url: card.avatarUrl,
          access:
            a.state === 'ACTIVE'
              ? { state: 'ACTIVE', ends_at: a.endsAt.toISOString() }
              : a.state === 'PENDING'
                ? {
                    state: 'PENDING',
                    requested_at: a.requestedAt.toISOString(),
                    request_type: a.type,
                  }
                : { state: 'EXPIRED', ended_at: a.endedAt.toISOString(), revoked: a.revoked },
          creator_available: card.creatorAvailable,
          conversation_id: card.conversationId,
        };
      }),
    };
  }
}
