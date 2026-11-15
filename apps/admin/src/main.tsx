import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import '@creatorchat/ui/fonts.css';
import '@creatorchat/ui/tokens.css';
import '@creatorchat/ui/base.css';
import { createAdminRoutes } from './app/routes';

// The component preview is development-only; the dynamic import is removed from production builds.
const extraRoutes = import.meta.env.DEV
  ? [
      {
        path: '__preview',
        lazy: async () => ({ Component: (await import('./preview/Preview')).Preview }),
      },
    ]
  : [];

const router = createBrowserRouter(createAdminRoutes({ extraRoutes }));

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
