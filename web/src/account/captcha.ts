import { AccountError } from './account-context';

/**
 * Cloudflare Turnstile, which Supabase checks before it starts a guest, signs someone in or emails a
 * code (Phase 10: a new anonymous session per visit was a way around the guest limit). The widget is
 * Invisible in the Turnstile dashboard, so nobody sees a puzzle. Without a site key (tests, a copy of
 * BookTrap with CAPTCHA off in Supabase) no token is sent.
 */
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Turnstile usually answers in about a second; a blocked script never answers at all. */
const GIVE_UP_MS = 20_000;

interface Turnstile {
  render(container: HTMLElement, options: Record<string, unknown>): string | undefined;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

/** The Turnstile script never loaded: almost always a content blocker. */
const BLOCKED = new AccountError(
  'captcha',
  'BookTrap couldn’t check this browser. If a content blocker is on, allow challenges.cloudflare.com, then try again.',
);
/** The script loaded but the check itself failed or ran out of time. */
const CHECK_FAILED = new AccountError('captcha', 'BookTrap couldn’t check this browser. Reload the page and try again.');

let loading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    // A failed tag is removed, so trying again doesn't pile up blocked scripts.
    const fail = () => {
      script.remove();
      reject(BLOCKED);
    };
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : fail());
    script.onerror = fail;
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** A fresh single-use token for one Supabase sign-in call, or undefined when CAPTCHA isn't configured. */
export async function captchaToken(): Promise<string | undefined> {
  if (!SITE_KEY) return undefined;
  const turnstile = await loadTurnstile();
  // A widget per token: each is used once. Should Turnstile ever need a click, it shows at the bottom.
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:60';
  document.body.append(container);
  let widgetId: string | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(CHECK_FAILED), GIVE_UP_MS);
      const fail = () => {
        window.clearTimeout(timer);
        reject(CHECK_FAILED);
      };
      try {
        widgetId = turnstile.render(container, {
          sitekey: SITE_KEY,
          appearance: 'interaction-only',
          callback: (token: string) => {
            window.clearTimeout(timer);
            resolve(token);
          },
          'error-callback': fail,
          'expired-callback': fail,
          'timeout-callback': fail,
        });
      } catch {
        // A bad site key or a broken page: Turnstile throws instead of calling back.
        fail();
      }
    });
  } finally {
    if (widgetId) turnstile.remove(widgetId);
    container.remove();
  }
}
