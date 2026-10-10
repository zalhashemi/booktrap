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

There are no accounts. On first launch the browser generates a random device id (UUID v4) and a 256-bit secret, stores them in `localStorage`, and registers them with the API. The API stores only a SHA-256 hash of the secret. Every request sends both as `x-device-id` / `x-device-secret` headers, and every query is scoped to that device. A backup code (Settings) carries these credentials to another browser.

## Exports

All five exports are built in the browser from the shelf the app already has (`shared/src/export.ts` holds every column). The PDF is drawn with `@react-pdf/renderer`, which loads only when someone asks for a PDF. Google Books cover images can't be read by a browser (no CORS headers), so the API passes a book's own stored cover through `GET /v1/books/:id/cover`. That route is device-authenticated, fetches only from the Google Books and Open Library hosts, accepts only images, and caps them at 2 MB.

To bring the list into Goodreads, download the Goodreads CSV and upload it at goodreads.com/review/import. Fable's beta import (fable.co/goodreads-import) takes the same file.

## Environment

All API configuration is in `api/.env.example`. The web app reads only `VITE_API_URL`, which is public. **Never put a key in `web/.env`**: anything prefixed `VITE_` ships to every visitor. CI fails the build if a known key pattern shows up in `web/dist`.

## Privacy and removal requests

The privacy policy and terms are at `/privacy` and `/terms` (`web/src/routes/LegalPages.tsx`, which also holds the operator name, contact address and the retention periods it promises). They're drafts for a lawyer to check before BookTrap charges money.

Readers delete their own shelf in Settings, Your data (`DELETE /v1/devices/me`). Other requests arrive at the contact address:

- **A reader asking about their data**: they send the device id from Settings (never the backup code). Find it with `select id, created_at from devices where id::text like '<first 8 chars>%';`.
- **A creator asking for removal** (promised within 14 days): in the Supabase SQL Editor, for each post id (`<platform>` is `tiktok` or `instagram`):

  ```sql
  delete from post_cache  where source_platform = '<platform>' and source_post_id = '<post id>';
  delete from book_sources where source_platform = '<platform>' and source_post_id = '<post id>';
  ```

  For a whole handle, find its posts first: `select distinct source_platform, source_post_id from book_sources where creator_handle = '<handle>';` (and the same on `post_cache` with `post->>'creatorHandle'`). Books stay on readers' shelves without that source. A post can come back if someone pastes it again; if a creator asks for that not to happen, the platform's own privacy settings are the reliable answer.

## Deploy

Three services: **Supabase** (database, already set up), **Render** (the API, `render.yaml`) and **Cloudflare Pages** (the web app). Pushing to `main` on GitHub runs CI and redeploys both.

1. **Supabase**: every file in `supabase/migrations/` must have been run in order (0001 to 0008).
2. **Render** (API): New, Blueprint, pick this GitHub repo. Render reads `render.yaml` and asks for the secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APIFY_TOKEN`, `ANTHROPIC_API_KEY`, `GOOGLE_BOOKS_API_KEY`, and `ALLOWED_ORIGIN` (the Pages address from step 3; put a placeholder first and fix it after). `IP_HASH_KEY` is generated. Change `region` in `render.yaml` first if the Supabase project isn't in Europe; it can't be moved later. When it's live, `https://<service>.onrender.com/health/ready` answers `{"ok":true}`.
3. **Cloudflare Pages** (web): Workers & Pages, Create, Pages, connect this GitHub repo.
   - Build command: `npm ci && npm run build -w @booktrap/web`
   - Build output directory: `web/dist`
   - Environment variable: `VITE_API_URL` = the Render address (e.g. `https://booktrap-api.onrender.com`). It's public; it ships in the bundle.
   - Node comes from `.nvmrc`. Unknown paths fall back to `index.html` (no `404.html`), so `/shelf` and `/privacy` load directly.
   - The build writes `web/dist/_headers`: a Content-Security-Policy naming the API origin, `nosniff`, `frame-ancestors 'none'` and long caching for hashed assets.
4. Set Render's `ALLOWED_ORIGIN` to the Pages address (`https://<project>.pages.dev`) and let it redeploy.
5. Check: open the Pages address, paste a link, and see it shelved.

The free Render plan sleeps after about 15 minutes idle; the first request then takes 30 to 60 seconds, and the app says so. Unfinished jobs resume when it wakes.
