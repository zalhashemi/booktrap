/**
 * A browser still running an older build (kept by the service worker) asks for code files that the
 * newest deploy no longer has: the site answers with index.html, and a page that loads code on demand
 * (the admin page, the PDF engine) breaks or goes blank. Then: drop the offline copy and reload once,
 * which fetches the current build. At most once every 10 minutes, so a real outage can't loop.
 */
const RECOVERED_AT = 'booktrap.stale-build-reload';
const AGAIN_AFTER_MS = 10 * 60 * 1000;

export async function recoverFromStaleBuild(): Promise<boolean> {
  try {
    const last = Number(sessionStorage.getItem(RECOVERED_AT) ?? 0);
    if (Date.now() - last < AGAIN_AFTER_MS) return false;
    sessionStorage.setItem(RECOVERED_AT, String(Date.now()));
  } catch {
    // Storage blocked: no way to know whether we already tried, so don't.
    return false;
  }
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ('caches' in window) await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
  } catch {
    // Reloading still helps.
  }
  window.location.reload();
  return true;
}

/** Vite reports a code file that failed to load; recover instead of failing (or going blank). */
export function watchForStaleBuild() {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    void recoverFromStaleBuild();
  });
}
