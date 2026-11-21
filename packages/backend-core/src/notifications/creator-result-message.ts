import { BOT_COPY } from '../creator-link/bot-copy.js';
import { buildBotMessage } from './message-builder.js';

export interface BotMessage {
  /** Plain text: the message is sent without a parse mode, so nothing in it is markup. */
  text: string;
  buttonText: string;
  /** The `web_app` button URL, always on the configured Mini App origin. */
  url: string;
}

/**
 * The bot message that tells a creator applicant the result (US-013). The URL has no destination:
 * the Mini App lands the account by role. Returns `null` when the Mini App URL is unset or
 * malformed, so the caller can wait instead of sending a button that goes nowhere.
 */
export function buildCreatorResultMessage(input: {
  decision: 'approved' | 'rejected';
  reason?: string | null;
  miniAppUrl: string | undefined;
}): BotMessage | null {
  const reason = input.reason?.trim();
  const text =
    input.decision === 'approved'
      ? BOT_COPY.requestApproved
      : [
          BOT_COPY.requestRejectedIntro,
          ...(reason ? ['', `${BOT_COPY.requestRejectedReason} ${reason}`] : []),
          '',
          BOT_COPY.requestRejectedOutro,
        ].join('\n');
  return buildBotMessage({ text, buttonText: BOT_COPY.menuButton, miniAppUrl: input.miniAppUrl });
}
