/** DI token for the customer side of a private chat (`ChatService`, US-026). */
export const CHAT = Symbol('CHAT');

/** DI token for the customer's chat list and unread total (`ChatListService`, US-027). */
export const CHAT_LIST = Symbol('CHAT_LIST');

/** DI token for moving a read cursor (`ConversationReadService`, US-030). */
export const CHAT_READ = Symbol('CHAT_READ');

/** DI token for the files of a customer's conversation (`ChatMediaService`, US-037; null without storage). */
export const CHAT_MEDIA = Symbol('CHAT_MEDIA');
