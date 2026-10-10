import './zod-config';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppShell } from './components/AppShell';
import { ToastProvider } from './components/Toaster';
import { DeviceProvider } from './device/DeviceProvider';
import { AddPage } from './routes/AddPage';
import { PrivacyPage, TermsPage } from './routes/LegalPages';
import { NotFoundPage } from './routes/NotFoundPage';
import { SettingsPage } from './routes/SettingsPage';
import { ShelfPage } from './routes/ShelfPage';
import './styles/index.css';

const queryClient = new QueryClient();

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <AddPage /> },
      { path: 'shelf', element: <ShelfPage /> },
      { path: 'settings', element: <SettingsPage /> },
      // Readable before (and without) a shelf: even when the server is asleep or unreachable.
      { path: 'privacy', element: <PrivacyPage />, handle: { open: true } },
      { path: 'terms', element: <TermsPage />, handle: { open: true } },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DeviceProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </DeviceProvider>
    </QueryClientProvider>
  </StrictMode>,
);
