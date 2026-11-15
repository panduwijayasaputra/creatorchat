import type { HTMLAttributes } from 'react';
import styles from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** 20 px radius used by admin page cards; default is the 16 px card radius. */
  large?: boolean;
}

export function Card({ large = false, className, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={[styles.card, large ? styles.large : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    />
  );
}

export function CardTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 {...rest} className={[styles.title, className ?? ''].filter(Boolean).join(' ')} />;
}
