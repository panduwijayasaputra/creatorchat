import type { PrismaClient } from '@creatorchat/db';
import { TelegramDeliveryRunner, type NotifyResult } from './delivery-runner.js';
import type { NotificationHandler, Resolution } from './handler.js';
import { buildCreatorResultMessage } from './creator-result-message.js';
import { NotificationRouter } from './notification-router.js';
import type { TelegramSender } from './telegram-sender.js';

export const CREATOR_RESULT_EVENT_TYPES = [
  'creator_application.approved',
  'creator_application.rejected',
] as const;

export type { NotifyResult };

/**
 * The creator-request result (US-013): who the applicant is and what the message says. The
 * application and the user's role are never written; the recipient and the text are read from the
 * database by id, never from the event payload.
 */
export const creatorResultHandler: NotificationHandler = {
  types: CREATOR_RESULT_EVENT_TYPES,
  async resolve(event, ctx): Promise<Resolution> {
    const decision = event.type.endsWith('.approved') ? 'approved' : 'rejected';
    const application = await ctx.prisma.creatorApplication.findUnique({
      where: { id: event.aggregateId },
      select: {
        status: true,
        reviewReason: true,
        user: { select: { id: true, telegramId: true, status: true, botBlockedAt: true } },
      },
    });
    if (!application) return { kind: 'fail', code: 'application_missing' };
    const expected = decision === 'approved' ? 'APPROVED' : 'REJECTED';
    if (application.status !== expected) return { kind: 'fail', code: 'decision_mismatch' };

    return {
      kind: 'send',
      recipient: application.user,
      deliveryKind: 'creator_application_result',
      dedupeKey: `creator_application:${event.aggregateId}:decision:telegram`,
      message: buildCreatorResultMessage({
        decision,
        reason: application.reviewReason,
        miniAppUrl: ctx.miniAppUrl,
      }),
    };
  },
};

/** Kept for callers that only know the creator-result pipeline; new kinds go through the router. */
export class CreatorResultNotifier {
  private readonly router: NotificationRouter;

  constructor(
    prisma: PrismaClient,
    sender: TelegramSender,
    options: { miniAppUrl: string | undefined; clock?: () => Date },
  ) {
    this.router = new NotificationRouter(
      prisma,
      new TelegramDeliveryRunner(prisma, sender, options),
      [creatorResultHandler],
    );
  }

  process(eventId: string): Promise<NotifyResult> {
    return this.router.process(eventId);
  }
}
