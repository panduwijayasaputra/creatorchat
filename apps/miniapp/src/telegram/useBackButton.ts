import { useEffect } from 'react';

/** Shows Telegram's back arrow while the component is mounted and routes its tap to `onBack`. */
export function useBackButton(onBack: () => void): void {
  useEffect(() => {
    const button = window.Telegram?.WebApp?.BackButton;
    if (!button) return;
    button.onClick(onBack);
    button.show();
    return () => {
      button.offClick(onBack);
      button.hide();
    };
  }, [onBack]);
}
