import { useEffect, useState } from 'react';
import styles from './Avatar.module.css';

export interface AvatarProps {
  /** Photo URL (https). Missing or failing to load shows the illustration. */
  src?: string | null;
  /** Pixel size; the boards use 72 (profile card) and 96 (edit profile). */
  size?: number;
  /** Text alternative for a meaningful photo; leave empty when the name is shown next to it. */
  alt?: string;
  /** Rectangular variant (the creator preview card is 72x96 with 14px corners). */
  height?: number;
  radius?: number;
}

/** Round photo with the design's illustrated placeholder (`Profile.html`). */
export function Avatar({ src, size = 72, alt = '', height, radius }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <div
      className={styles.avatar}
      style={{
        width: size,
        height: height ?? size,
        ...(radius !== undefined ? { borderRadius: radius } : {}),
      }}
    >
      {src && !failed ? (
        <img
          className={styles.photo}
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid slice"
          width="100%"
          height="100%"
          className={styles.illustration}
          aria-hidden="true"
          data-testid="avatar-placeholder"
        >
          <rect width="100" height="100" fill="#EBD3DC" />
          <path d="M30 50 C26 26 40 15 50 15 C60 15 74 26 70 50 L71 68 L29 68 Z" fill="#3A2A2E" />
          <path d="M8 100 C12 76 30 68 50 68 C70 68 88 76 92 100 Z" fill="#A83F67" />
          <rect x="44.5" y="58" width="11" height="14" rx="4" fill="#D8A88F" />
          <ellipse cx="50" cy="46" rx="14.5" ry="17" fill="#D8A88F" />
          <path
            d="M34 48 C32 31 41 21 50 21 C59 21 68 31 66 48 C64 39 58 33 50 33 C42 33 36 39 34 48 Z"
            fill="#3A2A2E"
          />
        </svg>
      )}
    </div>
  );
}
