import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import '@creatorchat/ui/fonts.css';
import '@creatorchat/ui/tokens.css';
import '@creatorchat/ui/base.css';
import { createMiniappApi } from './auth/api-client';
import { createMiniappRoutes } from './app/routes';
import { browserTelegram } from './telegram/webapp';

async function bootstrap(): Promise<void> {
  // Development only: `?tgdev=<initData>` fakes the Telegram WebApp. The import is removed from
  // production builds (checked by `pnpm build`), and the API validates the signature either way.
  if (import.meta.env.DEV) {
    const { installDevInitData } = await import('./telegram/dev-init-data');
    installDevInitData();
  }

  // The component preview is development-only; the dynamic import is removed from production builds.
  const extraRoutes = import.meta.env.DEV
    ? [
        {
          path: '__preview',
          lazy: async () => ({ Component: (await import('./preview/Preview')).Preview }),
        },
      ]
    : [];

  const api = createMiniappApi({
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
    getInitData: () => browserTelegram.getInitData(),
  });
  const router = createBrowserRouter(createMiniappRoutes({ api, extraRoutes }));

  const root = document.getElementById('root');
  if (root) {
    createRoot(root).render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
  }
}

void bootstrap();
