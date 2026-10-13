import './zod-config';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppShell } from './components/AppShell';
import { ReportIssueProvider } from './components/ReportIssue';
import { ToastProvider } from './components/Toaster';
import { AccountProvider } from './account/AccountProvider';
import { AdminRoot } from './AdminRoot';
import { AddPage } from './routes/AddPage';
import { CrashPage } from './routes/CrashPage';
import { PrivacyPage, TermsPage } from './routes/LegalPages';
import { NotFoundPage } from './routes/NotFoundPage';
import { SettingsPage } from './routes/SettingsPage';
import { ShelfPage } from './routes/ShelfPage';
import { watchForStaleBuild } from './stale-build';
import './styles/index.css';

watchForStaleBuild();

const queryClient = new QueryClient();

const router = createBrowserRouter([
  {
    element: <AppShell />,
    // A page that crashes shows a way back and a Report button, not the router's bare error.
    errorElement: <CrashPage />,
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

// The hidden admin page has its own root (see AdminRoot): no router, no reader session.
const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {isAdmin ? (
        <AdminRoot />
      ) : (
        <AccountProvider>
          <ToastProvider>
            <ReportIssueProvider>
              <RouterProvider router={router} />
            </ReportIssueProvider>
          </ToastProvider>
        </AccountProvider>
      )}
    </QueryClientProvider>
  </StrictMode>,
);
