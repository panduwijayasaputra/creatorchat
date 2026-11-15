import type { ReactNode, SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> {
  /** Pixel size (width and height). */
  size?: number;
  /** Accessible name. Without it the icon is decorative (`aria-hidden`). */
  title?: string;
  strokeWidth?: number;
}

/** Board icons: 24 px grid, outline, round caps, `currentColor`. */
export function createIcon(name: string, paths: ReactNode, defaults: { filled?: boolean } = {}) {
  function Icon({ size = 20, title, strokeWidth = 1.75, ...rest }: IconProps) {
    const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const };
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={defaults.filled ? 'currentColor' : 'none'}
        stroke={defaults.filled ? 'none' : 'currentColor'}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flex: 'none' }}
        {...a11y}
        {...rest}
      >
        {paths}
      </svg>
    );
  }
  Icon.displayName = `${name}Icon`;
  return Icon;
}
