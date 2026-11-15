export interface Crumb {
  label: string;
  /** Present on every crumb except the current page. */
  to?: string;
}

/** Declared on each route (`handle`); the topbar reads it for the breadcrumb and the page title. */
export interface RouteHandle {
  title: string;
  breadcrumb: readonly Crumb[];
}

export function isRouteHandle(value: unknown): value is RouteHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RouteHandle).title === 'string' &&
    Array.isArray((value as RouteHandle).breadcrumb)
  );
}

export interface AdminIdentity {
  name: string;
  role: string;
}

export function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase());
  return letters.join('') || '?';
}
