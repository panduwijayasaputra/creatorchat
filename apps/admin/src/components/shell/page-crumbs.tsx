import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Crumb } from './route-handle';

interface PageCrumbsValue {
  crumbs: readonly Crumb[] | null;
  setCrumbs: (crumbs: readonly Crumb[] | null) => void;
}

const PageCrumbsContext = createContext<PageCrumbsValue | null>(null);

/** Lets a page replace the breadcrumb of its route (e.g. with the person's name). */
export function PageCrumbsProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<readonly Crumb[] | null>(null);
  const value = useMemo(() => ({ crumbs, setCrumbs }), [crumbs]);
  return <PageCrumbsContext.Provider value={value}>{children}</PageCrumbsContext.Provider>;
}

export function usePageCrumbsOverride(): readonly Crumb[] | null {
  return useContext(PageCrumbsContext)?.crumbs ?? null;
}

/** Sets the breadcrumb while the page is mounted; `null` keeps the route's own. No-op outside the shell. */
export function usePageCrumbs(crumbs: readonly Crumb[] | null): void {
  const ctx = useContext(PageCrumbsContext);
  const setCrumbs = ctx?.setCrumbs;
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    if (!setCrumbs) return;
    setCrumbs(crumbs);
    return () => setCrumbs(null);
    // `key` stands for the content of `crumbs`.
  }, [setCrumbs, key]);
}
