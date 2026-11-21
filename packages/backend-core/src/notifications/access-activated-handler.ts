import { BOT_COPY } from '../creator-link/bot-copy.js';
import { ACCESS_TEMPLATES, renderTemplate } from './access-templates.js';
import { formatAccessDate } from './access-date.js';
import type { NotificationHandler, Resolution } from './handler.js';
import { buildBotMessage } from './message-builder.js';

export const ACCESS_ACTIVATED_EVENT_TYPES = [
  'subscription.granted',
  'subscription.extended',
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id of the access event the outbox row points at; anything else is not trusted. */
function accessEventId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const id = (payload as Record<string, unknown>).event_id;
  return typeof id === 'string' && UUID.test(id) ? id : null;
}

/**
 * "Akses diaktifkan" (US-044): tells the customer that an admin granted or extended access, until
 * when, with a button to the chat. The recipient, the creator's name and the date come from the
 * database by id; the payload only names the access event, and that event must belong to the
 * subscription the outbox row is about. The access itself is never touched.
 */
export const accessActivatedHandler: NotificationHandler = {
  types: ACCESS_ACTIVATED_EVENT_TYPES,
  async resolve(event, ctx): Promise<Resolution> {
    const eventId = accessEventId(event.payload);
    if (!eventId) return { kind: 'fail', code: 'event_missing' };
    const access = await ctx.prisma.subscriptionEvent.findUnique({
      where: { id: eventId },
      select: { subscriptionId: true, type: true, newEndsAt: true },
    });
    const expectedType = event.type === 'subscription.granted' ? 'GRANT' : 'EXTEND';
    if (
      !access ||
      access.subscriptionId !== event.aggregateId ||
      access.type !== expectedType ||
      !access.newEndsAt
    ) {
      return { kind: 'fail', code: 'event_missing' };
    }

    const subscription = await ctx.prisma.subscription.findUnique({
      where: { id: access.subscriptionId },
      select: {
        creatorId: true,
        revokedAt: true,
        endsAt: true,
        customer: {
          select: {
            id: true,
            telegramId: true,
            status: true,
            botBlockedAt: true,
            displayName: true,
            timezone: true,
          },
        },
        creator: {
          select: { status: true, user: { select: { status: true, displayName: true } } },
        },
      },
    });
    if (!subscription) return { kind: 'fail', code: 'event_missing' };

    const customer = subscription.customer;
    const dedupeKey = `subscription_event:${eventId}:telegram`;
    const skip = (reason: string): Resolution => ({
      kind: 'skip',
      recipientId: customer.id,
      deliveryKind: 'access_activated',
      dedupeKey,
      reason,
    });
    if (subscription.revokedAt) return skip('revoked');
    if (subscription.endsAt <= ctx.now) return skip('ended');
    if (
      subscription.creator.status === 'BLOCKED' ||
      subscription.creator.user.status === 'BLOCKED'
    ) {
      return skip('creator_blocked');
    }

    const conversation = await ctx.prisma.conversation.findUnique({
      where: {
        customerId_creatorId: { customerId: customer.id, creatorId: subscription.creatorId },
      },
      select: { id: true },
    });
    const text = renderTemplate(ACCESS_TEMPLATES.activated, {
      nama: customer.displayName,
      creator: subscription.creator.user.displayName,
      tanggal: formatAccessDate(access.newEndsAt, customer.timezone),
    });
    return {
      kind: 'send',
      recipient: customer,
      deliveryKind: 'access_activated',
      dedupeKey,
      message: buildBotMessage({
        text,
        buttonText: BOT_COPY.menuButton,
        miniAppUrl: ctx.miniAppUrl,
        path: conversation ? `/chats/${conversation.id}` : '/subscriptions',
      }),
    };
  },
};
