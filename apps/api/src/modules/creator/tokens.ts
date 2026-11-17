/** DI tokens for the creator settings reader and the shared profile writer. */
export const CREATOR_SETTINGS = Symbol('CREATOR_SETTINGS');
export const CREATOR_PROFILE = Symbol('CREATOR_PROFILE');

/** DI token for the creator's inbox (`CreatorInboxService`, US-028). */
export const CREATOR_INBOX = Symbol('CREATOR_INBOX');

/** DI token for the creator side of a private chat (`CreatorChatService`, US-029). */
export const CREATOR_CHAT = Symbol('CREATOR_CHAT');

/** DI token for the creator's read cursor (`ConversationReadService`, US-030). */
export const CREATOR_READ = Symbol('CREATOR_READ');
