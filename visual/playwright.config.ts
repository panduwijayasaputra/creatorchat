import { defineConfig } from '@playwright/test';
import { ADMIN_URL, MINIAPP_URL } from './lib';

// Starts its own Vite dev servers on separate ports so it never depends on (or disturbs) `pnpm dev`.

export default defineConfig({
  testDir: './specs',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  outputDir: './output/playwright',
  use: { browserName: 'chromium', reducedMotion: 'reduce' },
  webServer: [
    {
      command: 'pnpm --filter @creatorchat/miniapp exec vite --port 5273 --strictPort',
      url: MINIAPP_URL,
      // The outside-Telegram sheet needs a (sample) bot username for its link.
      // The harness fakes each Telegram session itself, so the dev auto-login stays off.
      env: { VITE_TELEGRAM_BOT_USERNAME: 'CreatorChatBot', MINIAPP_DEV_TELEGRAM_LOGIN: 'off' },
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @creatorchat/admin exec vite --port 5274 --strictPort',
      url: ADMIN_URL,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
