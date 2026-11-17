import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { devTelegramLogin } from './dev-telegram-login';

export default defineConfig({
  plugins: [react(), devTelegramLogin()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
