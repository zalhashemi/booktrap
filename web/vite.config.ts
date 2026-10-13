import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';

/** Install splash and browser chrome follow the default (light) theme. */
const INK = '#F1F7F3';

/** Sign-in needs the Supabase project too; a build without it couldn't open any shelf. */
function assertSupabase(url: string | undefined, key: string | undefined) {
  if (!/^https:\/\/[^/]+/.test(url ?? '') || !key) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set for production builds.');
  }
  // Only the publishable key may ship in the bundle: a secret key would give every visitor the whole database.
  if (/^sb_secret_/.test(key) || /service_role/.test(atobSafe(key.split('.')[1] ?? ''))) {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is a secret key. Use the publishable key.');
  }
}

function atobSafe(value: string) {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

/** A production bundle without a real API URL would quietly call each visitor's own localhost. */
function assertApiUrl(url: string | undefined) {
  const isHttpOrigin = /^https?:\/\/[^/]+/.test(url ?? '');
  const isLocal = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url ?? '');
  if (!isHttpOrigin || (isLocal && !process.env.ALLOW_LOCAL_API)) {
    throw new Error(
      'VITE_API_URL must be set to the deployed API origin for production builds ' +
        '(set ALLOW_LOCAL_API=1 to build against a local API on purpose).',
    );
  }
}

/** Cloudflare Turnstile (the CAPTCHA) loads its script and widget frame from here. */
const TURNSTILE = 'https://challenges.cloudflare.com';

/**
 * Google AdSense and its consent message (src/ads/ads.ts): the ad script, the ad frames, and the hosts
 * they report to. Google's ad hosts change, so these are its documented families rather than single hosts.
 */
const ADSENSE = [
  'https://pagead2.googlesyndication.com',
  'https://*.googlesyndication.com',
  'https://*.doubleclick.net',
  'https://*.googleadservices.com',
  'https://*.google.com',
  'https://*.gstatic.com',
  'https://*.adtrafficquality.google',
].join(' ');

/**
 * Cloudflare Pages response headers (`dist/_headers`), written at build time because the
 * Content-Security-Policy names the API's origin and the Supabase project (sign-in). Scripts come from
 * this site (plus WebAssembly for the PDF engine's layout), Cloudflare Turnstile (the CAPTCHA) and
 * Google AdSense; frames only from those two; the page talks to itself, the API, Supabase Auth and
 * AdSense; and covers, thumbnails and ads may show images from any https host.
 */
function cloudflareHeaders(apiUrl: string, supabaseUrl: string | undefined): Plugin {
  const api = new URL(apiUrl).origin;
  const auth = supabaseUrl ? ` ${new URL(supabaseUrl).origin}` : '';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${TURNSTILE} ${ADSENSE}`,
    `frame-src ${TURNSTILE} ${ADSENSE}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    // Google's consent message uses its own web fonts.
    "font-src 'self' data: https://fonts.gstatic.com",
    // data: lets the PDF engine load its WebAssembly from an inlined file (it can't reach other sites).
    `connect-src 'self' data: ${api}${auth} ${ADSENSE}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  const headers = [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
    '  X-Frame-Options: DENY',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n');
  return {
    name: 'booktrap-cloudflare-headers',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headers });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiUrl = env.VITE_API_URL;
  if (command === 'build' && mode === 'production') {
    assertApiUrl(apiUrl);
    assertSupabase(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
  }

  return {
    plugins: [
      ...(command === 'build' && apiUrl ? [cloudflareHeaders(apiUrl, env.VITE_SUPABASE_URL)] : []),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
        manifest: {
          name: 'BookTrap',
          short_name: 'BookTrap',
          description: 'Paste TikTok or Instagram links and get every book in them on your want-to-read shelf.',
          theme_color: INK,
          background_color: INK,
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // The PDF engine loads only when someone exports a PDF (and needs the network for covers anyway);
          // the hidden admin page is for the operator alone.
          globIgnores: ['**/renderPdf-*.js', '**/AdminPage-*.js'],
          navigateFallback: 'index.html',
          // The API lives on another origin and is never cached by the service worker.
          runtimeCaching: [],
        },
        devOptions: { enabled: false },
      }),
    ],
    server: { port: 5180, strictPort: true },
    preview: { port: 4173, strictPort: true },
    test: {
      environment: 'jsdom',
      // Tests never load Turnstile, whatever web/.env holds (captcha.test.ts sets its own key).
      env: { VITE_TURNSTILE_SITE_KEY: '' },
    },
  };
});
