import { useEffect, useState } from 'react';

export type LayoutMode = 'desktop' | 'tablet' | 'mobile';

/** Same breakpoints as the shell: tablet below 1280 px, mobile below 768 px. */
const TABLET = '(max-width: 1279px)';
const MOBILE = '(max-width: 767px)';

function read(): LayoutMode {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop';
  if (window.matchMedia(MOBILE).matches) return 'mobile';
  return window.matchMedia(TABLET).matches ? 'tablet' : 'desktop';
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(read);
  useEffect(() => {
    if (!window.matchMedia) return;
    const lists = [window.matchMedia(TABLET), window.matchMedia(MOBILE)];
    const update = () => setMode(read());
    lists.forEach((list) => list.addEventListener('change', update));
    update();
    return () => lists.forEach((list) => list.removeEventListener('change', update));
  }, []);
  return mode;
}
