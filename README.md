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

## How accounts work

Every visitor is a Supabase Auth user. A first visit signs in anonymously, which makes a **guest** (5 posts a day). Saving the shelf adds an email, with a password or an email code, to that same user, so the shelf stays as it is (40 posts a day). The web app uses supabase-js for sign-in only and sends the access token as `Authorization: Bearer` on every request. The API checks it locally against the project's published ES256 signing keys (`api/src/auth/session-auth.ts`), and every query is scoped to that user. The browser never reads the database: RLS is on with no policies.

Logging in on a browser that has a guest shelf merges the guest's books into the account (`POST /v1/account/merge-guest`, with the guest's token in the body), then deletes the guest. Guests nobody has visited for 30 days are deleted by the API's 6-hourly purge.

## Exports

All five exports are built in the browser from the shelf the app already has (`shared/src/export.ts` holds every column). The PDF is drawn with `@react-pdf/renderer`, which loads only when someone asks for a PDF. Google Books cover images can't be read by a browser (no CORS headers), so the API passes a book's own stored cover through `GET /v1/books/:id/cover`. That route needs the owner's sign-in, fetches only from the Google Books and Open Library hosts, accepts only images, and caps them at 2 MB.

To bring the list into Goodreads, download the Goodreads CSV and upload it at goodreads.com/review/import. Fable's beta import (fable.co/goodreads-import) takes the same file.

## Environment

All API configuration is in `api/.env.example`. The web app reads only public values (`web/.env.example`): the API URL, the Supabase URL and publishable key, and the Turnstile site key. **Never put a secret key in `web/.env`**: anything prefixed `VITE_` ships to every visitor. CI fails the build if a known key pattern shows up in `web/dist`.

## Privacy and removal requests

The privacy policy and terms are at `/privacy` and `/terms` (`web/src/routes/LegalPages.tsx`, which also holds the operator name, contact address and the retention periods it promises). They're drafts for a lawyer to check before BookTrap charges money.

Readers delete their own account (or guest shelf) in Settings, Your data (`DELETE /v1/account`). Other requests arrive at the contact address:

- **A reader asking about their data**: find them by email under Authentication, Users in the Supabase dashboard. Their user id owns their rows (`books.user_id` and so on).
- **A creator asking for removal** (promised within 14 days): open `/admin` in the web app, enter the admin key (`ADMIN_TOKEN` in the API's environment), and paste each post's link under "Take down a link". Or from `api/`: `npx tsx --env-file=.env scripts/takedown.ts <post link>` (`--dry-run` first shows how far it reached). A taken-down post leaves every shelf and is never read again, whoever pastes it. Books seen only in it are deleted, unless a reader changed them (status, notes or shelves): those stay without the source. For a whole handle, find its posts first: `select distinct source_platform, source_post_id, source_url from book_sources where creator_handle = '<handle>';`.
- **Reports** from readers ("Report this post" in a book's sources) wait under Open on `/admin`, grouped by post, with how many shelves each post is on. Take down or Dismiss. The Auto-blocked tab lists posts the content check skipped (explicit or graphic, not books, or that Claude declined); Unblock marks a wrong verdict as a book post, and the next paste shelves its books without reading it again.

## Deploy

Four services: **Supabase** (database and sign-in), **Render** (the API, `render.yaml`, Starter plan), **Cloudflare** (the domain `booktrap.app`, Pages for the web app, Turnstile, email forwarding) and **Resend** (sign-in emails). After setup, a push to `main` runs CI; Render deploys only once CI is green.

1. **Domain** (Cloudflare Registrar): `booktrap.app`. The site is `https://booktrap.app` and the API is `https://api.booktrap.app`.
2. **Supabase**:
   - Run every file in `supabase/migrations/` in order (0001 to 0011).
   - Authentication, URL Configuration: Site URL `https://booktrap.app`; redirect URLs `https://booktrap.app/**` (keep `http://localhost:5180/**` for development).
   - Authentication, Emails: paste `supabase/templates/magic-link.html` into **Magic Link** (subject "Your BookTrap log-in code") and `email-change.html` into **Change Email Address** (subject "Save your BookTrap shelf"). Both need `{{ .Token }}`: the app asks for the code.
   - Authentication, Emails, SMTP: host `smtp.resend.com`, port 465, user `resend`, password a Resend API key (sending access, this domain only), sender `hello@booktrap.app`, name `BookTrap`.
   - Authentication, Attack Protection: turn on CAPTCHA, provider Turnstile, with the Turnstile **secret** key.
3. **Resend**: add the domain `booktrap.app` (region close to Singapore if offered) and add its DNS records (SPF, DKIM, and the return-path MX) in Cloudflare DNS. Add a DMARC record: `_dmarc` TXT `v=DMARC1; p=quarantine; rua=mailto:hello@booktrap.app`. Wait for "Verified".
4. **Cloudflare**:
   - Email Routing: forward `hello@booktrap.app` to the operator's inbox (the policies show this address).
   - Turnstile: a widget for `booktrap.app` and `localhost`, mode **Invisible**. The site key goes to Pages (`VITE_TURNSTILE_SITE_KEY`) and `web/.env`; the secret goes to Supabase only.
5. **Render** (API): New, Blueprint, pick this repo. Render reads `render.yaml` and asks for the secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APIFY_TOKEN`, `ANTHROPIC_API_KEY`, `GOOGLE_BOOKS_API_KEY` and `ALLOWED_ORIGIN` (`https://booktrap.app`). `IP_HASH_KEY` and `ADMIN_TOKEN` (the key for `/admin`) are generated. `region` matches the Supabase project (Singapore) and can't be changed later. Settings, Custom Domains: add `api.booktrap.app`, then in Cloudflare DNS a CNAME `api` to the `onrender.com` address, **DNS only** (grey cloud), so requests reach Render directly and the client IP chain stays Render's. When it's live, `https://api.booktrap.app/health/ready` answers `{"ok":true}`.
6. **Cloudflare Pages** (web): Workers & Pages, Create, Pages, connect this repo.
   - Build command: `npm run build -w @booktrap/web` (Pages installs dependencies itself). Build output directory: `web/dist`.
   - Environment variables (all public; they ship in the bundle): `VITE_API_URL=https://api.booktrap.app`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TURNSTILE_SITE_KEY`.
   - Custom domains: add `booktrap.app`.
   - Node comes from `.nvmrc`. Unknown paths fall back to `index.html`, so `/shelf` and `/privacy` load directly. The build writes `web/dist/_headers`: a Content-Security-Policy naming the API, Supabase and Turnstile, `nosniff`, `frame-ancestors 'none'` and long caching for hashed assets. Preview deployments have their own address, which `ALLOWED_ORIGIN` doesn't list, so they can't reach the API.
7. Check: open `https://booktrap.app`, paste a link, see it shelved, then save the shelf with an email and log in on another browser with the emailed code.
