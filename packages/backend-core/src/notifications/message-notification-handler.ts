import { BOT_COPY } from '../creator-link/bot-copy.js';
import { SkipDelivery, type NotificationHandler, type Resolution } from './handler.js';
import { buildBotMessage } from './message-builder.js';

export const MESSAGE_EVENT_TYPES = ['message.created'] as const;

/** An event older than this when it is claimed is history (worker down, an old backlog): not notified. */
export const STALE_MS = 10 * 60_000;
/** A shortened preview is cut after this many characters. */
export const PREVIEW_MAX = 80;

const fill = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{(nama|n|pratinjau)\}/g, (_m, key: string) => String(vars[key] ?? ''));

const shorten = (text: string): string => {
  const chars = [...text.trim().replace(/\s+/g, ' ')];
  return chars.length > PREVIEW_MAX ? `${chars.slice(0, PREVIEW_MAX).join('')}…` : chars.join('');
};

/**
 * "Pesan baru" (US-042): tells the other party of a conversation that a message arrived, with a
 * button to that conversation. It decides nothing about the message itself: the message is already
 * saved and stays so whatever happens here. Everything is read from the database by id (the event
 * only names the message); the text of a message is read at send time, only when the customer allows
 * it, and is never stored.
 *
 * Skipped without a Telegram call: the event is stale, the recipient already read the message, an
 * earlier notification already covered it (a burst becomes one notification), the creator is blocked,
 * the customer turned message notifications off or muted that creator. A retry of a delivery that
 * already exists is never skipped by the state that its first attempt changed.
 */
export const messageNotificationHandler: NotificationHandler = {
  types: MESSAGE_EVENT_TYPES,
  async resolve(event, ctx): Promise<Resolution> {
    const { prisma } = ctx;
    const message = await prisma.message.findUnique({
      where: { id: event.aggregateId },
      select: {
        id: true,
        seq: true,
        type: true,
        body: true,
        conversationId: true,
        senderUserId: true,
        attachments: { select: { asset: { select: { kind: true } } }, take: 1 },
        conversation: {
          select: {
            customerId: true,
            creatorId: true,
            creator: { select: { status: true, userId: true } },
          },
        },
      },
    });
    if (!message) return { kind: 'fail', code: 'message_missing' };

    const { conversation } = message;
    const creatorUserId = conversation.creator.userId;
    const customerId = conversation.customerId;
    let recipientId: string;
    let senderId: string;
    if (message.senderUserId === customerId) {
      recipientId = creatorUserId;
      senderId = customerId;
    } else if (message.senderUserId === creatorUserId) {
      recipientId = customerId;
      senderId = creatorUserId;
    } else {
      return { kind: 'fail', code: 'sender_unknown' };
    }
    const toCustomer = recipientId === customerId;

    const [recipient, sender] = await Promise.all([
      prisma.user.findUnique({
        where: { id: recipientId },
        select: { id: true, telegramId: true, status: true, botBlockedAt: true },
      }),
      prisma.user.findUnique({ where: { id: senderId }, select: { displayName: true } }),
    ]);
    if (!recipient || !sender) return { kind: 'fail', code: 'user_missing' };

    const dedupeKey = `message:${message.id}:telegram`;
    const skip = (reason: string): Resolution => ({
      kind: 'skip',
      recipientId: recipient.id,
      deliveryKind: 'chat_message',
      dedupeKey,
      reason,
    });
    const retry = ctx.existingDelivery !== null;

    if (!retry && ctx.now.getTime() - event.createdAt.getTime() > STALE_MS) return skip('stale');

    const creatorUser = await prisma.user.findUnique({
      where: { id: creatorUserId },
      select: { status: true },
    });
    if (conversation.creator.status === 'BLOCKED' || creatorUser?.status === 'BLOCKED') {
      return skip('creator_blocked');
    }

    // Creators have no setting yet: always on, never the content.
    let showContent = false;
    if (toCustomer) {
      const [preference, mute] = await Promise.all([
        prisma.notificationPreference.findUnique({
          where: { userId: recipient.id },
          select: { messagesEnabled: true, showContent: true },
        }),
        prisma.creatorMute.findUnique({
          where: {
            userId_creatorId: { userId: recipient.id, creatorId: conversation.creatorId },
          },
          select: { userId: true },
        }),
      ]);
      if (preference && !preference.messagesEnabled) return skip('disabled');
      if (mute) return skip('muted');
      showContent = preference?.showContent ?? false;
    }

    const [read, state] = await Promise.all([
      prisma.conversationRead.findUnique({
        where: {
          conversationId_userId: { conversationId: message.conversationId, userId: recipient.id },
        },
        select: { lastReadSeq: true },
      }),
      prisma.notificationState.findUnique({
        where: {
          conversationId_userId: { conversationId: message.conversationId, userId: recipient.id },
        },
        select: { lastNotifiedSeq: true },
      }),
    ]);
    const readSeq = read?.lastReadSeq ?? 0;
    const notifiedSeq = state?.lastNotifiedSeq ?? 0;
    if (!retry) {
      if (readSeq >= message.seq) return skip('read');
      if (notifiedSeq >= message.seq) return skip('coalesced');
    }

    // Everything the recipient has not seen and was not told about yet becomes one notification.
    const floor = retry ? readSeq : Math.max(readSeq, notifiedSeq);
    const unread = Math.max(
      1,
      await prisma.message.count({
        where: {
          conversationId: message.conversationId,
          senderUserId: { not: recipient.id },
          seq: { gt: floor },
        },
      }),
    );

    let text: string;
    if (unread > 1) {
      text = fill(BOT_COPY.newMessages, { n: unread, nama: sender.displayName });
    } else if (showContent) {
      const kind = message.attachments[0]?.asset.kind;
      const body = message.body?.trim();
      const preview = body
        ? shorten(body)
        : kind === 'VIDEO'
          ? BOT_COPY.previewVideo
          : BOT_COPY.previewPhoto;
      text = fill(BOT_COPY.newMessagePreview, { nama: sender.displayName, pratinjau: preview });
    } else {
      text = fill(BOT_COPY.newMessage, { nama: sender.displayName });
    }

    return {
      kind: 'send',
      recipient,
      deliveryKind: 'chat_message',
      dedupeKey,
      message: buildBotMessage({
        text,
        buttonText: BOT_COPY.menuButton,
        miniAppUrl: ctx.miniAppUrl,
        path: `${toCustomer ? '/chats/' : '/inbox/'}${message.conversationId}`,
      }),
      // In the transaction that creates the delivery: the burst is covered up to the newest message.
      // This is also the real decision, made atomically: several jobs for one conversation can run
      // at once, each having read "nothing told yet" before the first committed; the row lock and
      // the condition here let exactly one of them win, and the rest are skipped as covered.
      afterCreate: async (tx) => {
        const won = await tx.$queryRaw<{ one: number }[]>`
          INSERT INTO notification_state (conversation_id, user_id, last_notified_seq, updated_at)
          SELECT ${message.conversationId}::uuid, ${recipient.id}::uuid, c.last_message_seq, now()
          FROM conversations c WHERE c.id = ${message.conversationId}::uuid
          ON CONFLICT (conversation_id, user_id) DO UPDATE
          SET last_notified_seq = GREATEST(notification_state.last_notified_seq, EXCLUDED.last_notified_seq),
              updated_at = now()
          WHERE notification_state.last_notified_seq < ${message.seq}
          RETURNING 1 AS one`;
        if (won.length === 0) throw new SkipDelivery('coalesced');
      },
    };
  },
};
