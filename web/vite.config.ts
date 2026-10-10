import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';

/** Install splash and browser chrome follow the default (light) theme. */
const INK = '#F1F7F3';

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

/**
 * Cloudflare Pages response headers (`dist/_headers`), written at build time because the
 * Content-Security-Policy names the API's origin. Scripts come from this site only (plus WebAssembly
 * for the PDF engine's layout), the page talks only to itself and the API, and covers and thumbnails
 * may come from any https image host.
 */
function cloudflareHeaders(apiUrl: string): Plugin {
  const api = new URL(apiUrl).origin;
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // data: lets the PDF engine load its WebAssembly from an inlined file (it can't reach other sites).
    `connect-src 'self' data: ${api}`,
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
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headers });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const apiUrl = loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL;
  if (command === 'build' && mode === 'production') assertApiUrl(apiUrl);

  return {
    plugins: [
      ...(command === 'build' && apiUrl ? [cloudflareHeaders(apiUrl)] : []),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png', 'theme-init.js'],
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
          // The PDF engine loads only when someone exports a PDF, and needs the network for covers anyway.
          globIgnores: ['**/renderPdf-*.js'],
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
    },
  };
});
