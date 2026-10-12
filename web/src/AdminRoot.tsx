import { Component, Suspense, lazy, type ReactNode } from 'react';
import { recoverFromStaleBuild } from './stale-build';
import { ToastProvider } from './components/Toaster';

const AdminPage = lazy(() => import('./routes/AdminPage').then(({ AdminPage }) => ({ default: AdminPage })));

/**
 * The hidden admin page: loaded only when opened, linked from nowhere, and outside the account
 * provider, so opening it never starts a guest session (it uses the admin key, not a reader's).
 */
export function AdminRoot() {
  return (
    <ToastProvider>
      <LoadFailure>
        <Suspense fallback={null}>
          <AdminPage />
        </Suspense>
      </LoadFailure>
    </ToastProvider>
  );
}

/** If the admin page's code can't load (an old build in this browser), recover once; otherwise say so. */
class LoadFailure extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    void recoverFromStaleBuild();
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto max-w-[40rem] px-4 pt-16">
        <p className="font-display text-[1.6rem] leading-tight">The admin page didn’t load</p>
        <p className="mt-3 text-text-muted">Reload the page. If it still doesn’t open, clear this site’s data in the browser’s settings and try again.</p>
      </main>
    );
  }
}
