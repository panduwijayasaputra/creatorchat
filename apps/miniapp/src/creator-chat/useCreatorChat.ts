import type { CreatorChatHistoryResponse, CreatorChatMessage } from '@creatorchat/contracts';
import type { MiniappApi } from '../auth/api-client';
import { useThread, type ThreadAdapter } from '../chat/useChat';
import { useMarkRead } from '../chat/useMarkRead';

export type CreatorConversation = CreatorChatHistoryResponse['conversation'];

type CreatorChatApi = Pick<
  MiniappApi,
  'getCreatorChatHistory' | 'sendCreatorChatMessage' | 'markCreatorRead'
>;

/** The creator side of a private chat (US-029): the same thread logic as the customer chat. */
export function useCreatorChat(api: CreatorChatApi, conversationId: string) {
  const adapter: ThreadAdapter<CreatorChatMessage, CreatorConversation> = {
    getHistory: (id, q) => api.getCreatorChatHistory(id, q),
    send: (id, input) => api.sendCreatorChatMessage(id, input),
    accessLost: (conversation, code) =>
      code === 'CHAT_ACCESS_EXPIRED'
        ? { ...conversation, access: { state: 'EXPIRED', ends_at: null, ended_at: null } }
        : null,
  };
  const thread = useThread(adapter, conversationId);
  // US-030: the creator's own cursor moves as customer messages are seen.
  useMarkRead(
    thread.state,
    (m) => m.sender === 'CUSTOMER',
    conversationId,
    (id, seq) => api.markCreatorRead(id, seq),
  );
  return thread;
}
