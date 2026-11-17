import { useEffect, useState } from 'react';
import { avatarTone, initialsOf } from '../inbox/inbox-model';
import styles from './creator-chat.module.css';

/** The customer's photo (https) or initials on the inbox tone: `CrChat*` 40 px, `CrCustomer` 64 px. */
export function InitialsAvatar({
  name,
  url,
  seed,
  size,
}: {
  name: string;
  url: string | null;
  /** Stable per conversation, so the colour matches the inbox row. */
  seed: string;
  size: 40 | 64;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <div
      className={`${styles.avatar} ${size === 64 ? styles.avatarLarge : ''}`}
      style={{ background: avatarTone(seed) }}
    >
      {url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} /> : initialsOf(name)}
    </div>
  );
}
