import { BOT_COPY } from '../creator-link/bot-copy.js';
import { formatAccessDate } from './access-date.js';
import { ACCESS_TEMPLATES, renderTemplate } from './access-templates.js';
import type { NotificationHandler, Resolution } from './handler.js';
import { buildBotMessage } from './message-builder.js';

export const ACCESS_REMINDER_EVENT_TYPES = [
  'subscription.reminder_due',
  'subscription.ended',
] as const;

/** The end time the event was written for (from the payload); anything else is not trusted. */
function endsAtOf(payload: unknown): Date | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as Record<string, unknown>).ends_at;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "Pengingat akses" and "Akses berakhir" (US-045). The scheduler decided that a notice is due; this
 * decides, at delivery time, whether it still is: the subscription and the customer are loaded by id
 * and the notice is skipped when the access was revoked or extended meanwhile, when a reminder would
 * come after the end (or an ended notice before it), or when the creator is blocked (the runner also
 * skips a blocked customer or one who blocked the bot). The payload only names the end time the event
 * was written for. The access itself is never touched, and a failed send changes nothing about it.
 */
export const accessReminderHandler: NotificationHandler = {
  types: ACCESS_REMINDER_EVENT_TYPES,
  async resolve(event, ctx): Promise<Resolution> {
    const writtenFor = endsAtOf(event.payload);
    if (!writtenFor) return { kind: 'fail', code: 'event_missing' };
    const reminder = event.type === 'subscription.reminder_due';
    const kind = reminder ? 'reminder' : 'ended';

    const subscription = await ctx.prisma.subscription.findUnique({
      where: { id: event.aggregateId },
      select: {
        endsAt: true,
        revokedAt: true,
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
    const skip = (reason: string): Resolution => ({
      kind: 'skip',
      recipientId: customer.id,
      deliveryKind: reminder ? 'access_reminder' : 'access_ended',
      dedupeKey: `subscription:${event.aggregateId}:ends:${writtenFor.getTime()}:${kind}:telegram`,
      reason,
    });
    if (subscription.revokedAt) return skip('revoked');
    // Extended (or changed) since the scan: that end date has its own notices.
    if (subscription.endsAt.getTime() !== writtenFor.getTime()) return skip('extended');
    const ended = subscription.endsAt <= ctx.now;
    if (reminder && ended) return skip('already_ended');
    if (!reminder && !ended) return skip('not_ended');
    if (
      subscription.creator.status === 'BLOCKED' ||
      subscription.creator.user.status === 'BLOCKED'
    ) {
      return skip('creator_blocked');
    }

    const text = renderTemplate(reminder ? ACCESS_TEMPLATES.reminder : ACCESS_TEMPLATES.ended, {
      nama: customer.displayName,
      creator: subscription.creator.user.displayName,
      tanggal: formatAccessDate(subscription.endsAt, customer.timezone),
    });
    return {
      kind: 'send',
      recipient: customer,
      deliveryKind: reminder ? 'access_reminder' : 'access_ended',
      dedupeKey: `subscription:${event.aggregateId}:ends:${writtenFor.getTime()}:${kind}:telegram`,
      message: buildBotMessage({
        text,
        buttonText: BOT_COPY.menuButton,
        miniAppUrl: ctx.miniAppUrl,
        path: '/subscriptions',
      }),
    };
  },
};
