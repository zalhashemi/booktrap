# BookTrap

Paste TikTok or Instagram links (posts, carousels, reels, mixed freely), or a public TikTok collection, and BookTrap finds every book shown or mentioned in them. It adds each one to a want-to-read shelf, with covers and ISBNs from Google Books and Open Library when they match, you can export to Goodreads, PDF, text, CSV or JSON.

The product source of truth is `BUILD_BRIEF_BookCatcher.md` (it uses the working name "BookCatcher"). Build status lives in `PROGRESS.md`.

## Layout

| Path | What it is |
|---|---|
| `web/` | React 19 + Vite + TypeScript PWA (Tailwind v4, TanStack Query, React Router). Deploys to Cloudflare Pages. |
| `api/` | Node + TypeScript API (Fastify). Holds every third-party key. Deploys to Render. |
| `shared/` | Zod schemas and types used by both. |
| `supabase/migrations/` | Postgres schema. RLS is on for every table with no policies, so only the API's secret key can reach data. |

## Run it locally

Requires Node 22.12+ (`.nvmrc` pins 24).

```sh
npm install
cp api/.env.example api/.env    # fill in keys as phases need them
cp web/.env.example web/.env
npm run dev                     # API on :8787, web on :5180
```

If `SUPABASE_URL` is empty, the API uses **in-memory storage**, which is wiped on every restart. That's fine for UI work. For real persistence, connect Supabase:

1. Create a project at supabase.com.
2. Open **SQL Editor**, paste `supabase/migrations/0001_init.sql`, and run it.
3. In **Project Settings, API Keys**, copy the Project URL and the **secret** key (`sb_secret_...`) into `api/.env` as `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
4. Restart `npm run dev`. `GET http://localhost:8787/health` should report `"storage":"supabase"`.

## Checks

```sh
npm run check      # lint + typecheck + tests + build (what CI runs)
```

## How device identity works

There are no accounts. On first launch the browser generates a random device id (UUID v4) and a 256-bit secret, stores them in `localStorage`, and registers them with the API. The API stores only a SHA-256 hash of the secret. Every request sends both as `x-device-id` / `x-device-secret` headers, and every query is scoped to that device. A backup code (Settings, coming in a later phase) will carry these credentials to another browser.

## Environment

All API configuration is in `api/.env.example`. The web app reads only `VITE_API_URL`, which is public. **Never put a key in `web/.env`**: anything prefixed `VITE_` ships to every visitor. CI fails the build if a known key pattern shows up in `web/dist`.

## Deploy

Deployment (Cloudflare Pages + Render + Supabase) is set up in Phase 7. Steps will be added here then.
