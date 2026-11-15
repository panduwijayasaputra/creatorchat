import { ChatIcon } from '@creatorchat/ui';
import styles from './auth-screens.module.css';

/** The three illustrated avatars of AuthLogin / AuthOutside (inline SVG copied from the boards). */
const AVATARS = [
  {
    bg: '#E6C3B5',
    body: (
      <>
        <path d="M30 46 C28 24 40 14 50 14 C60 14 72 24 70 46 L73 86 L27 86 Z" fill="#3B2A26" />
        <path d="M8 100 C12 76 30 68 50 68 C70 68 88 76 92 100 Z" fill="#F6EFE9" />
        <rect x="44.5" y="58" width="11" height="14" rx="4" fill="#C48A72" />
        <ellipse cx="50" cy="46" rx="14.5" ry="17" fill="#C48A72" />
        <path
          d="M34 48 C32 31 41 21 50 21 C59 21 68 31 66 48 C64 39 58 33 50 33 C42 33 36 39 34 48 Z"
          fill="#3B2A26"
        />
      </>
    ),
  },
  {
    bg: '#D9C3D6',
    body: (
      <>
        <path d="M62 32 C80 28 86 52 76 72 C72 60 68 50 62 44 Z" fill="#2B2226" />
        <path d="M8 100 C12 76 30 68 50 68 C70 68 88 76 92 100 Z" fill="#5B4B63" />
        <rect x="44.5" y="58" width="11" height="14" rx="4" fill="#D6A58B" />
        <ellipse cx="50" cy="46" rx="14.5" ry="17" fill="#D6A58B" />
        <path
          d="M34 48 C32 31 41 21 50 21 C59 21 68 31 66 48 C64 39 58 33 50 33 C42 33 36 39 34 48 Z"
          fill="#2B2226"
        />
      </>
    ),
  },
  {
    bg: '#F0D3B8',
    body: (
      <>
        <path d="M30 50 C26 26 40 15 50 15 C60 15 74 26 70 50 L71 68 L29 68 Z" fill="#5A3B2E" />
        <path d="M8 100 C12 76 30 68 50 68 C70 68 88 76 92 100 Z" fill="#3E4F4A" />
        <rect x="44.5" y="58" width="11" height="14" rx="4" fill="#B97F63" />
        <ellipse cx="50" cy="46" rx="14.5" ry="17" fill="#B97F63" />
        <path
          d="M34 48 C32 31 41 21 50 21 C59 21 68 31 66 48 C64 39 58 33 50 33 C42 33 36 39 34 48 Z"
          fill="#5A3B2E"
        />
      </>
    ),
  },
] as const;

/** Pink header block with the logo and the avatar row (shared by the login and outside screens). */
export function AuthHero() {
  return (
    <div className={styles.hero}>
      <div className={styles.brand}>
        <span className={styles.logo}>
          <ChatIcon size={24} strokeWidth={2} />
        </span>
        <span className={styles.brandName}>Creator Chat</span>
      </div>
      <div className={styles.avatars} aria-hidden="true">
        {AVATARS.map((avatar, index) => (
          <span key={avatar.bg} className={styles.avatarRing} data-index={index}>
            <span className={styles.avatar} style={{ background: avatar.bg }}>
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="xMidYMid slice"
                width="100%"
                height="100%"
              >
                <rect width="100" height="100" fill={avatar.bg} />
                {avatar.body}
              </svg>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
