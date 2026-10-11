import { Suspense, lazy } from 'react';
import { ToastProvider } from './components/Toaster';

const AdminPage = lazy(() => import('./routes/AdminPage').then(({ AdminPage }) => ({ default: AdminPage })));

/**
 * The hidden admin page: loaded only when opened, linked from nowhere, and outside the account
 * provider, so opening it never starts a guest session (it uses the admin key, not a reader's).
 */
export function AdminRoot() {
  return (
    <ToastProvider>
      <Suspense fallback={null}>
        <AdminPage />
      </Suspense>
    </ToastProvider>
  );
}
