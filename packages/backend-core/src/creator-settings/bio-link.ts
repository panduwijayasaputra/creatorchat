// Telegram bot usernames: 5-32 letters, digits or underscores.
const BOT_USERNAME = /^[A-Za-z0-9_]{5,32}$/;

/** The link a creator puts in their Instagram bio; null while the bot username is unset or malformed. */
export function buildBioLink(botUsername: string | undefined, publicCode: string): string | null {
  if (!botUsername || !BOT_USERNAME.test(botUsername)) return null;
  return `https://t.me/${botUsername}?start=c_${publicCode}`;
}
