import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The API port, from the environment or the repo-root `.env`. Only this one value is read, and by
 * hand: Vite's `loadEnv` would also pick up `NODE_ENV=development` from that file and quietly turn
 * production builds into development ones (the preview pages would leak into `dist`).
 */
function apiPort(): string {
  if (process.env.API_PORT) return process.env.API_PORT;
  const file = fileURLToPath(new URL('../../.env', import.meta.url));
  if (existsSync(file)) {
    const match = /^API_PORT=(\d+)\s*$/m.exec(readFileSync(file, 'utf8'));
    if (match?.[1]) return match[1];
  }
  return '3000';
}

export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin in development: the browser talks to :5174 and Vite forwards `/v1` to the API.
    // Cookies stay host-only and no CORS is involved. The Origin header is passed through as is.
    proxy: { '/v1': { target: `http://127.0.0.1:${apiPort()}`, changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
