import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import styles from './Button.module.css';

/** `danger` is the outlined red-text button; `destructive` is the solid red confirm button of block/revoke dialogs. */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'destructive' | 'link';
/** `table` 36 px, `md` 40 px (admin), `mobile` 48 px and `lg` 52 px (Mini App primary). */
export type ButtonSize = 'table' | 'md' | 'mobile' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** In-flight: ignores clicks and exposes `aria-busy`, keeps the label and width. */
  loading?: boolean;
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/** Buttons never wrap: the label stays on one line (`white-space: nowrap`). */
export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  fullWidth = false,
  disabled,
  type = 'button',
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const blocked = disabled || loading;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (blocked) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    fullWidth ? styles.full : '',
    loading ? styles.loading : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled}
      aria-disabled={blocked || undefined}
      aria-busy={loading || undefined}
      onClick={handleClick}
    >
      {icon}
      {children}
    </button>
  );
}
