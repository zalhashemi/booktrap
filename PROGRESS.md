# BookTrap build progress

Phases from `BUILD_BRIEF_BookCatcher.md` §12.

| # | Phase | Status |
|---|---|---|
| 1 | Foundation | Done |
| 2 | Single-link pipeline | Done |
| 3 | List experience | Done |
| 4 | Bulk, collections and Instagram | Done |
| 5 | Exports | Done (Goodreads test import pending) |
| 6 | Design pass | Done |
| 7 | Accounts (Supabase Auth) | In progress: token verifier, migration 0009 (applied 2026-10-11), shelf backup and screen picks done; API and web wiring next |
| 8 | Limits, moderation, report and takedown | Not started |
| 9 | Scale, storage and cost | Not started |
| 10 | Legal and deploy (the old Phase 7) | Partly done: 7a hardening and 7b privacy built on device identity (parts to redo after Phase 7); 7c deploy is live on Render and Cloudflare Pages but is to be taken offline until Phases 7 to 9 are done |

The old "Phase 7: Hardening and deploy" became Phase 10 on 2026-10-10. Its finished work keeps the names 7a, 7b and 7c in the sections below. Section §12 of the brief follows the new order.

## Plan for Phases 7 to 10 (user decisions, 2026-10-09)

Decisions:
- **Guests** can try BookTrap without an account and sign up to keep their shelf. Guests get 5 posts a day. An unclaimed guest shelf is deleted after 30 days without a visit.
- **Sign-in**: email and password, and an email code or magic link, through **Supabase Auth**. No Google or Apple for now. **No passkeys for now** (user, 2026-10-10): Supabase's passkeys are beta, and an anonymous (guest) user can't register one, so they couldn't be how a guest saves a shelf. They can come back once the API leaves beta.
- **A guest's shelf is kept on sign-up**: the user id never changes. The old device identity is removed with no migration, so existing device data is dropped (export it as JSON first if it's worth keeping).
- **Moderation**: every post the AI reads is checked, and only explicit non-book content is blocked (adult book covers and talk about adult books are fine). There is a report-and-takedown flow.
- **Upload and payload limits** are audited and enforced. **Caching**: videos are never stored; the result cache stays, with an expiry.
- **Email**: no domain yet. Claude suggests one and the user buys it.
- **Scale target**: 100 people at once, with hosting up to about $10 a month.
- **Order**: Accounts, then Limits and moderation, then Scale and cost, then Legal and deploy.

Migrations 0007 and 0008 are already used by 7a and 7b, so the accounts migration is **0009** and the reports table is **0010**.

### Phase 7: Accounts
- Every visitor gets a Supabase session; a guest is an anonymous user. Signing up adds an email and password, or an email code, to that same user.
- The device identity is deleted: `web/src/device/*`, `POST /v1/devices`, `DELETE /v1/devices/me`, the device headers, `api/src/auth/device-auth.ts` and the related Settings sections.
- API:
  - `api/src/auth/session-auth.ts` verifies the Supabase access token (asymmetric JWT, checked with jose against Supabase's published signing keys) and sets `request.user = { id, isAnonymous }`. `request.device` becomes `request.user` throughout.
  - Caps: guests get 5 posts a day (`DAILY_LINK_CAP_GUEST`), signed-in users 40 (`DAILY_LINK_CAP_PER_DEVICE`), and the per-IP caps stay.
  - A timer deletes anonymous users inactive for 30 days, next to the 6-hourly purge.
  - `DELETE /v1/account` deletes everything. The JSON export is "download my data".
- Database: `0009_accounts.sql` makes ownership go by `user_id`, which references `auth.users(id)` on delete cascade.
  - It drops `devices`, the device tombstones and the device-owned rows, and keeps cached posts and spend history.
  - It reworks `create_job_capped`, `add_child_items_capped` and `delete_device` (from 0007/0008) for users.
  - It is tested in PGlite first. The user runs it in Supabase.
- Web:
  - supabase-js is used for auth only. The app never reads the database directly, and RLS stays on with no policies.
  - `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are public. The CI secret scan allows the publishable key and still blocks secret keys.
  - `web/src/api/client.ts` sends `Authorization: Bearer` and refreshes the token.
  - `AccountProvider` replaces `DeviceProvider`: it holds the session, an `onAuthStateChange` listener and the guest-to-account upgrade.
- Screens (mockups shown before building):
  - A Sign up / Log in sheet: email and password, "Email me a code", "Forgot password", and the Terms and Privacy line.
  - A "Save your shelf" prompt after a guest's first books, and an "unsaved" margin note on the guest's shelf header.
  - Settings, Account: email, change password, sign out and delete account.
  - Landing routes for email confirmation and password reset.
  - `/terms` and `/privacy` rewritten for accounts (no device ids or backup codes).
- Email uses Supabase's built-in sender in development.
- Tests:
  - API: token verification (valid, expired, wrong issuer), guest versus user caps, delete account.
  - Web: the account provider's states.
  - Playwright: sign up; password login; email code; a guest's shelf surviving sign-up; delete account. All at 390 and 1280 in both themes.
  - No device-identity code remains (grep).
- Needs from the user:
  - Enable "Anonymous sign-ins" and "Email".
  - Turn on **JWT Signing Keys** (Project Settings, JWT Keys: migrate to the asymmetric ES256 key), so the API verifies tokens locally against the project's JWKS (`/auth/v1/.well-known/jwks.json`). User's choice, 2026-10-10, over asking Supabase on every request.
  - Allow `http://localhost:5180` as a redirect URL.
  - Run 0009.

### Phase 8: Limits, moderation, report and takedown
- **Limits**, each in `shared/` with a test, so the web app shows a limit before the server refuses:
  - body size (256 KB)
  - links per paste (30), pasted text length, notes (5,000 characters)
  - shelf names and shelves per user, and books per account (about 5,000)
  - books per PDF, cover proxy (2 MB), video and slide bytes (`media.ts`)
  - job history kept per user
- **Moderation**:
  - The structured output in `api/src/pipeline/extract.ts` gains `content: "books" | "not_books" | "explicit_non_book" | "graphic_violence"`, judged from the same frames at no extra cost. Adult book covers and discussion count as books.
  - A blocked post adds nothing, is cached so it's never paid for again, and shows a plain message on its job item.
  - Tests come from fixtures and a prompt check with `api/scripts/compare-models.ts`.
- **Report and takedown**:
  - "Report this post" on each source in the book sheet writes to a `reports` table (`0010`).
  - The takedown email is on the privacy page.
  - An admin-only route (`ADMIN_TOKEN`) and `api/scripts/takedown.ts` remove the post from the cache and from every shelf, and delete books seen only there. This also closes the 7b gap: a removed post shouldn't come back when pasted again.
  - A small hidden admin page lists open reports.

### Phase 9: Scale, storage and cost
- **Storage**: real per-user size measured in Supabase, projected to 1k, 10k and 100k users against Free (500 MB), Pro (8 GB) and beyond.
- **Load test**:
  - k6 or autocannon scripts in `api/scripts/load/`, with Apify and Claude stubbed so nothing is paid for.
  - 100 simultaneous users submit links and poll; the shelf and export endpoints are tested too.
  - Run in Docker at Render-like limits (512 MB first, then the paid plan's size), measuring memory (ffmpeg), CPU, queue wait and errors.
- **Tuning**:
  - Queue concurrency (currently 2) set to what memory allows.
  - A fair per-user share of the queue.
  - A "you're in the queue" estimate in the job panel.
  - An explicit check that no video or temp directory is kept after frames are taken.
- **Cost report** here: hosting, Supabase, Apify, Claude and email at 100, 1k and 10k users, set against the $20 reading budget and the ~$10 hosting budget, with a recommendation.

### Phase 10: Legal and deploy
- **Legal**: the 7b privacy policy and terms are rewritten for accounts, guests, moderation, reports and Resend. They are marked for review by the user or a lawyer.
  - The user's checklist: notify Bahrain's Personal Data Protection Authority, and get a lawyer's review before any paid tier.
  - The post cache already expires (7a, 90 days); it is slimmed further to what extraction and dedupe need.
- **Domain and email**: Claude suggests a domain (about $10-15 a year) and the user buys it.
  - Resend (free for 3,000 emails a month) becomes Supabase's mail sender, with SPF, DKIM and DMARC.
  - Auth emails are branded in the app's style.
- **Deploy**:
  - Render's always-on Starter plan (about $7 a month) replaces free in `render.yaml`.
  - Cloudflare Pages serves the web app on the domain.
  - Supabase gets production settings and redirect URLs.
- **Proxies**: share-link lookups and media downloads are tested from Render. They go through Apify's proxy only if they're blocked.
- **Hardening**: a security review, rate limits, error states and environment docs, then a Playwright full-flow test against production and a final Code Review.

Every phase: Impeccable, Taste and UI/UX Pro Max for UI, with options shown first. Code Review (high), with all findings fixed. Playwright at 390 and 1280 in both themes. Update this file and the brief, then stop with a short status. Ask for keys, accounts and decisions.

## Decisions log

- 2026-10-11: **Account screens picked (user):** Sign up / Log in is option B: email first, then "Email me a code" or "Use a password". The Save your shelf prompt is option A, a card above the paste box. The unsaved note is option B, a lavender "Unsaved" tab on the shelf header. Settings, Account is as mocked (guest, signed in, two-step delete). **Code-only accounts are allowed** and a password is optional (Claude's recommendation, user agreed to "whatever is safest and costs less"): no password to reuse or leak for those who don't want one, and an email is sent only when someone logs in on a new browser, since sessions renew themselves. **Logging in on a browser with a guest shelf merges the guest's books into the account** (duplicates folded together, as on a re-paste), then deletes the guest user. The browser proves it owns the guest shelf by sending the guest's token. This follows "never lose a book".
- 2026-10-11: **0009 is applied** (user ran it). Checked read-only: device tables and `delete_device` gone; books, tags and jobs empty and owned by `user_id`; 10 cached posts, 26 spend records and 6 network counts kept; `user_activity` and `inactive_guests` work. The app doesn't work against Supabase until Phase 7's wiring is done.
- 2026-10-11: The project already signed with ES256 (the JWKS lists two ES256 keys: current and standby), so no rotation was needed.

- 2026-10-11: **Accounts plumbing (Phase 7):** guests' visits are recorded in `user_activity` (the API writes at most hourly), because Supabase doesn't record a visit when a session refreshes. `inactive_guests()` reads `auth.users` as its owner (`security definer`, only `service_role` may call it), and the API deletes those users through Supabase's admin API. Deleting an account runs `delete_user_data()` first (carrying today's network counts, as 7b did), then the admin delete; the cascade from `auth.users` covers anything left. A capped submission now answers `{"capped": "user"}` instead of `"device"`.

- 2026-10-10: **Phase 7 adjustments (user):** no passkeys for now (guests can't register one in Supabase, and the API is beta); tokens are verified locally with Supabase's asymmetric JWT signing keys (the project migrates to them).

- 2026-10-10: **Phase order replaced** with the plan above (Accounts, Limits and moderation, Scale and cost, then Legal and deploy). **The live deploy (Render API, Cloudflare Pages) is to be taken offline** until the plan is done, since real users would otherwise create device-owned shelves that Phase 7 drops.

- 2026-10-10: **Operator and contact (7b):** the policies name **VistaHunt Co.** (Kingdom of Bahrain) as controller, contact **vistahuntco@gmail.com**. Both pages are drafts for a lawyer before BookTrap charges money.
- 2026-10-10: **Moved to a Mac** (from Windows). Node 24 via nvm, a fresh `npm ci` (the copied `node_modules` held Windows binaries), Playwright MCP added for this project. Phases 5 and 6 had never been committed; they are now (`89fd4c9`).
- 2026-10-10: **Retention (7a):** cached posts are deleted after `POST_CACHE_DAYS` (default 90; re-reading one costs again), captions are no longer cached at all, and hashed networks are cleared from jobs after 2 days. To be stated in the privacy policy (7b).
- 2026-10-10: **`IP_HASH_KEY`** is its own secret, required in production, so rotating the Supabase key doesn't reset every network's daily count.

- 2026-10-09: **Legal and proxy research before Phase 7** (user's request; not legal advice). BookTrap reads single public posts on a user's request via Apify (logged out) and keeps book titles, the post link and the creator handle. Risks, in order: TikTok's and Meta's terms forbid automated collection (TikTok's US terms of May 2026 also name commercial use); a 2024 US ruling (Meta v. Bright Data) held logged-out scraping isn't bound by Meta's terms, but that is one district court and not TikTok. Personal data (handles, frames with people) needs a privacy policy and a lawful basis. Copyright risk is low (titles are facts; media is never republished). Charging money raises the stakes. Apify puts legal responsibility on the customer. No official API covers analysing other people's videos. **User is in Bahrain**: the Personal Data Protection Law (Law No. 30 of 2018) applies, with prior notification of processing to the Personal Data Protection Authority and rules on transfers abroad (our processors are outside Bahrain); GDPR also applies to EU users. **Before charging money, the user gets a short review from a lawyer.**
- 2026-10-09: **Phase 7 legal scope (user):** draft a privacy policy and terms page (for the user or a lawyer to check), a takedown/contact address, and an expiry on the post cache so full scraped records aren't kept indefinitely.
- 2026-10-09: **Proxies (user):** Apify's actors already use Apify's proxies (included in their price), and our volume is far below platform rate limits. Our server contacts the platforms directly for share-link lookups (`api/src/pipeline/resolve.ts`) and carousel images, subtitles and Instagram media (`media.ts`). Phase 7 tests these from Render first; only if blocked, they go through Apify's proxy on the existing account.

- 2026-10-09: **Phone Add screen** gets a slice of the reading room above the headline (user's pick, B, from three rendered phone mockups: page-tab card, reading-room strip, annotated page), plus a "Paste what you copied" button in the empty field.
- 2026-10-09: **Book sheet is view-first** (user): status and shelves save on tap; title, author, notes and ISBNs sit behind "Edit details" with a Save and an unsaved-changes guard.
- 2026-10-09: **Phase 6 took on all critique findings** (user: "All 5 + minor").

- 2026-10-09: **PDF layout is the Shelf** (user's pick from three rendered layouts: List, Shelf, Checklist): five covers across, grouped by status.
- 2026-10-09: **Covers in the PDF come through the API** (user's choice): Google Books images have no CORS headers, so `GET /v1/books/:id/cover` passes the stored cover through (owner only, cover hosts only, images only, 2 MB cap, its own 600/min rate limit).
- 2026-10-09: **Exports cover the whole shelf, the filtered view or the selected books** (user added "Selected").
- 2026-10-09: **Goodreads CSV** uses Goodreads' own 24-column export header (the import page needs a login, so it couldn't be read). The status is repeated in Bookshelves, because an import with Exclusive Shelf alone has been reported to shelve everything as "read". **Fable** has a beta CSV import at fable.co/goodreads-import (website only) for Goodreads data, so the same file is the one to use. Neither has been tested with a real import yet.

- 2026-10-09: **Change request 001** (`CHANGES_001.md`) applied. It overrides the brief where they conflict. The user confirmed the lavender/teal palette and the light default stay, even though the change request named the old dark-academia colours.
- 2026-10-09: **No "unsure" state.** Every book is added as read; enrichment (cover, ISBN, year) is quiet. The Unsure and Verified chips, badges and banner are gone.
- 2026-10-09: **Instagram** via Apify **apify/instagram-scraper** ($0.0027/post, no start fee; chosen over apify/instagram-post-scraper, which cost the same on the test posts, for its much larger run record). No paid transcript ($0.048/reel): reels are read from frames and caption. TikTok and Instagram share the $20/month budget and the caps.
- 2026-10-09: **Instagram saved collections are not readable**: they are private to the owner with no public link, and collaborative collections need a login. The app recognises the link and says so, suggesting a multi-link paste instead (user's choice).
- 2026-10-09: **TikTok collections and playlists** are read with Apify **powerai/tiktok-collection-posts-scraper** (the only actor found that can; clockworks' can't). It's small (56 users) but 55/55 recent runs succeeded. Cost: $0.09 per run (pinned to 1 GB; the default 2 GB billed the start twice) + $0.005 per video listed, then each video is read like a normal link (about $0.06, free if cached).
- 2026-10-09: **25 videos per collection, free** (user). Larger collections are planned as a **paid option** later. That needs Stripe and a way to tie a purchase to an account-less device, so it's deferred until after deploy. The limit is `FREE_VIDEOS_PER_COLLECTION` in `shared/src/source.ts`, so the web app and the API always agree; `MAX_VIDEOS_PER_COLLECTION` (100) is the ceiling a paid tier could raise it to.
- 2026-10-08: App name is **BookTrap**.
- 2026-10-08: Audience is a **public product**, so first-run copy must explain itself and per-IP limits matter, not just per-device ones.
- 2026-10-08: Render **free plan**: job state lives in Postgres and unfinished jobs resume on wake. Expect cold starts of 30-60s.
- 2026-10-08: First visual direction was **Gilt Spines** (seed 6ce76978), with Libre Caslon + Schibsted Grotesk. Replaced on 2026-10-09 at the user's request (below).
- 2026-10-09: Visual direction **Annotated Paperback** (seed ed3595ab, user's choice): page-tabs, a highlighter for New, margin notes. Contract in `web/.impeccable/surfaces/src-components-appshell-tsx.md` (repointed from the deleted `src/App.tsx` on 2026-10-09).
- 2026-10-09: Type is **Young Serif** (user's choice from a 4-font specimen) for headlines and titles, **Nunito** for UI and **Kalam** for annotations, all self-hosted. Icons are Phosphor.
- 2026-10-09: **Palette replaced** at the user's request: Dusty Lavender #67597A, Vintage Grape #544E61, Slate Grey #6E8894, Muted Teal #85BAA1, Honeydew #CEEDDB (lime kept for New). Tokens renamed by role (accent, action, success, unsure, tag, reading, read) instead of colour names. Dark ground #2B2733 (deep grape), text honeydew 11.8:1, teal accent and action with dark ink, lavender for Unsure. Contrast-checked in both themes, and the icons regenerated.
- 2026-10-09: **Light is the default theme** (user request; the brief said dark). Dark (deep grape #2B2733) remains in Settings and is remembered per browser. Controls are rounded (pills).
- 2026-10-08: Device secrets are hashed with SHA-256 rather than a slow KDF. They're 256-bit random values, so a slow hash adds nothing but latency on every request.
- 2026-10-08: Scraper is the Apify actor **clockworks/tiktok-scraper**. Free-plan prices: $0.0037/post + $0.0013/video download + $0.001/run. Paid speech-to-text is off; TikTok's free subtitles are used when present.
- 2026-10-08: Extraction model is **Claude Sonnet 5.5** at effort medium (user's choice). It matched Opus 5.5 on every featured book in the fixtures at about half the cost: $0.05-0.08/post vs $0.12-0.18.
- 2026-10-08: **Featured books only** (user's choice). Claude tags each book featured or background; background-only shelf books are cached but not added (`INCLUDE_BACKGROUND_BOOKS=false`).

## Test fixtures

From the user (TikTok):

- Photo carousel: https://www.tiktok.com/@readbetweeenlines/photo/7674670540518395169
- Video: https://www.tiktok.com/@wmccusker/video/7672440936101727519

Public Instagram posts (Penguin UK, chosen for testing):
- Carousel: https://www.instagram.com/p/DeJvdqUjLd1/
- Reel: https://www.instagram.com/reel/DeMTMjJjmqF/

## Limits (user approved 2026-10-08)

30 links per paste, 100 videos per collection (ask above that), 40 posts/device/day, 120 posts/IP/day, $20/month global budget (processing pauses when reached), cached posts free. Extraction model: compare Opus 5.5 and Sonnet 5.5 on the test fixtures in Phase 2, then the user picks.

## Phase 7: Accounts (in progress, 2026-10-11)

Done so far (no routes or screens rewired yet):
- **`api/src/auth/session-auth.ts`**: `createSessionVerifier` checks Supabase access tokens locally with jose against the project's JWKS (`/auth/v1/.well-known/jwks.json`, cached and refetched on an unknown key id). It accepts ES256 only, issuer `<SUPABASE_URL>/auth/v1`, audience `authenticated`, role `authenticated`, a uuid `sub` and 5 seconds of clock drift, and returns `{ id, isAnonymous }`. `requireUser` is the preHandler: it reads `Authorization: Bearer` and gives every failure the same 401. It isn't mounted yet. The 16 tests use ES256 keys generated locally: signed-in and guest tokens, expired, drift, wrong issuer and audience, roles `anon` and `service_role`, a key the project doesn't publish, an HS256 token, a tampered payload, a non-uuid `sub`, the JWKS fetched from a local server, and one 401 body for every bad header. Dependency: `jose` 6.2.12.
- **`supabase/migrations/0009_accounts.sql`** (one transaction):
  - Drops every device-owned row and moves ownership to `user_id` → `auth.users(id)` (cascade; `set null` for spend).
  - Drops devices, the device tombstones, `delete_device` and the trigger.
  - Rebuilds the cap functions for users. The caller passes the cap, so guests get 5.
  - Adds `delete_user_data`, `user_activity` and `inactive_guests`.
  - Keeps cached posts, spend history and network counts.
  - Tested in PGlite on top of 0001-0008 with seeded device data, as `service_role` against a stand-in for Supabase's auth schema and grants. 14 checks:
    - the device rows and objects are gone; cache, spend (with no owner) and network counts are kept
    - the foreign keys point at `auth.users`
    - a guest's cap of 5 holds and pasted order is kept
    - the network cap counts every user and deleted accounts
    - collection children stop at the room left and aren't added twice
    - `delete_user_data` keeps the network count and can run twice
    - deleting the auth user cascades and keeps spend
    - `inactive_guests` finds only guests not seen for 30 days
    - `service_role` can't read `auth.users` directly
    - `anon` and `authenticated` can't execute anything
    - a second run fails and changes nothing
  - Applied in Supabase on 2026-10-11 (see the decisions log).
- **Backup of the device shelves** before 0009: `api/scripts/backup-device-shelves.ts` (select-only; leaves out device secrets and hashed networks) wrote `backups/device-shelves-2026-10-11.json` (gitignored): 23 devices, 183 books, 182 sources, 1 tag, 23 jobs, 32 items. The largest shelf, the dev shelf, has 43 live books and 1 in the Undo bin. Every count matched a direct count.
- **Mockups** of the four new screens (Sign up / Log in sheet, Save your shelf prompt, the unsaved note on the shelf header, Settings → Account), shown as options at 390 and 1280 in both themes: https://claude.ai/artifact/H1p3MeQFU9rD4FQrfB559B. Picks and decisions recorded in the decisions log (2026-10-11).

Supabase setup: the project was already on ES256 keys; 0009 is applied. The user is finishing the rest of the dashboard setup (anonymous sign-ins and Email on, `{{ .Token }}` in the Magic Link template, Site URL and redirect `http://localhost:5180/**`).

Known limit to note: a guest can start a new anonymous session to get another 5 posts. The per-network cap (120) and Supabase's limit on anonymous sign-ins per IP still hold. A CAPTCHA on sign-ins is listed for Phase 10.

## 7c: Deploy (live on 2026-10-10, then taken offline)

Deployed: API on Render (`booktrap-api.onrender.com`, Singapore, next to Supabase `ap-southeast-1`), web on Cloudflare Pages (`booktrap.pages.dev`). The user suspended both the same day under the new plan (Phase 10 redeploys).

Production checks run before it went offline (Playwright against the live site, cached fixtures, $0):
- First visit registered a device in 1.5s. CORS allowed only `https://booktrap.pages.dev` with the device headers. The live `_headers` carried the CSP naming the Render origin.
- A mixed paste of 2 TikTok and 2 Instagram posts (carousel 5, video 7, Instagram carousel 35, reel 1): 48 books, all New, no console errors. A re-paste added no rows. A reload and a second tab kept the shelf.
- Every export from the 48-book shelf: Goodreads CSV (24 columns, 48 rows, BOM, CRLF), CSV (48 rows, both platforms), JSON (48), PDF (3 pages, 35 covers), Copy as text (48 lines, "Copied 48 books").
- Backup code in a fresh browser: a typo was caught; the code typed in lowercase with spaces restored the same shelf.
- Add and Shelf at 390, 768, 1280, 1440, 1920 and 2560 in both themes: no horizontal overflow, no tap target under 44px.
- Delete my shelf: the old credentials got 401. The test shelves were deleted.
- The only console error was an Open Library 404 for a missing cover (`default=false`), shown as a lettered plate as designed.

Not checked before it went offline, carried into Phase 10:
- **Client IP behind Render's proxies.** `TRUST_PROXY_HOPS=1` is unverified. Render's community reports differing chains (Cloudflare then Render's load balancer), and Cloudflare adds `CF-Connecting-IP`. If the hop count is wrong, every reader behind one Cloudflare edge shares the per-IP caps. Measure the real chain on the deployment first, then set the hops, or read `CF-Connecting-IP` if it can be trusted. A temporary `/health/whoami` probe was deployed for this, got no answer (the service was already suspended), and was removed.
- **Direct platform fetches from Render** (share links, carousel slides, Instagram media) need 2 posts that aren't cached (about $0.10-0.20).
- From the final code review of the deploy work (open):
  - `autoDeployTrigger: checksPass` in `render.yaml`, so a red CI never deploys.
  - Retention while the free plan sleeps: the 6-hourly timer doesn't run, so expiry waits for the next wake. Move it into Supabase with `pg_cron` (with Starter it stays awake, but the database is the right home).
  - The Pages build command needs no `npm ci` (Pages installs dependencies itself): `npm run build -w @booktrap/web`.
  - `render.yaml` repeats the API's defaults. Keep only secrets and differences.
  - `allowScripts` keys are exact versions. Re-approve after updating ffmpeg-static or esbuild.
  - Redundant config: `theme-init.js` in `includeAssets` and the plugin's `apply: 'build'`.
  - The theme script could go back inline with a CSP hash, saving a request on first load.
  - Pages preview deployments would need their origins in `ALLOWED_ORIGIN`.

Prepared for the deploy:
- `render.yaml` (Blueprint for the API: free plan, `npm ci --include=dev` so tsup is there, `/health` as the health check, secrets entered in the dashboard, `IP_HASH_KEY` generated). README "Deploy" has the Render and Cloudflare Pages steps.
- **Security headers for the web app**: the build writes `web/dist/_headers` with a Content-Security-Policy naming the API origin (scripts from the site only, plus WebAssembly for the PDF engine; `connect-src` the site, `data:` and the API; any https image for covers), `nosniff`, `X-Frame-Options: DENY`, a Permissions-Policy and immutable caching for hashed assets. The theme script moved out of `index.html` into `public/theme-init.js` so no inline script is needed.
- Checked under that exact policy on a production build (Playwright, real Supabase): paste, shelf with 7/7 covers, PDF export, no violations and no console errors. The first run caught two: the PDF engine fetching its WebAssembly from a `data:` URL (now allowed; it had fallen back and still worked) and Zod probing `new Function` (now `jitless`, set in `web/src/zod-config.ts`, imported first).
- `allowScripts` in package.json approves the install scripts of ffmpeg-static, esbuild and fsevents, so a stricter npm on Render can't silently skip downloading ffmpeg.
- The production API build was started locally: it serves `/health/ready` against Supabase, finds ffmpeg, and refuses to start without `IP_HASH_KEY`.
- PWA manifest and meta description now say "TikTok or Instagram links".
- Test-harness note: a fresh Playwright context with `route()` interception sometimes stalls at "Opening your shelf" until a reload (3/3 fresh contexts without interception load in about 1.4s). Watch for it in the production checks.

## Phase 7b: Privacy, terms and "Delete my shelf" (2026-10-10)

Done:
- **`/privacy` and `/terms`** (`web/src/routes/LegalPages.tsx`), each opening with "The short version". The privacy policy covers: who the controller is (PDPL Law No. 30 of 2018, GDPR for EU/UK visitors), what's collected and why, how public posts are read (media and captions not kept), the processors (Supabase, Render, Cloudflare, Apify, Anthropic, Google Books, Open Library) and transfers abroad, legal bases, retention (shelf until deleted, Undo bin 30 days, cache 90 days, network hashes 2 days), rights (self-service export, edit and delete, emailed requests with the device id, never the backup code, answered within 30 days, complaints to Bahrain's PDP Authority or an EU/UK authority), a creators' removal route (within 14 days), children under 13, and changes. The terms cover fair use, others' posts and non-affiliation, accuracy, the backup code, no warranty, and Bahraini law. Both open without a shelf, even when the server is asleep or unreachable (`handle: { open: true }`, `ConnectionGate open`). A footer on every page links Privacy, Terms and Contact. Contact constants live in `web/src/legal.ts`.
- **Delete my shelf** (Settings, Your data; also the brief's "clear data"): `DELETE /v1/devices/me` calls `delete_device` (`supabase/migrations/0008_delete_device.sql`). It removes the device and everything it owns, keeps a tombstone of the random id so no browser holding the key or a backup code can register it again, and carries the posts its networks read in the last 2 days into `network_usage` so deleting doesn't reset a network's daily cap (cleared after 2 days). The device's waiting queue items are dropped, and spend from a post already being read is still recorded without the device. In the app, a two-step inline confirmation focuses "Keep my shelf", then the browser moves to a new, empty shelf. A second browser opening a deleted shelf sees "This shelf may have been deleted…" with Start a fresh shelf.
- **No client IPs in API logs** (request lines log method and path only).
- README: how to handle removal requests (SQL for a post or a handle).
- Tests: 55 shared, 146 API, 30 web. Migration 0008 run in PGlite as `service_role`: a deleted device's network count survives, all its rows go, re-registering the id fails with 23505, and spend against it fails with 23503, which the store catches and records without the device.

Playwright (local, real Supabase): the 7a limit message on Add at 390 (with the cap set to 1, refused before anything was read); `/privacy` at 390 with the API blocked (renders, no gate, no overflow, title "Privacy · BookTrap"); `/terms` and the footer at 1280 in dark (links 44px tall); Settings, Your data at 390: focus lands on "Keep my shelf", Delete everything works, the old credentials get 401 and the browser is on a new shelf. Impeccable detector: 0 findings.

Code review (high) found 10 issues; 9 fixed:
- Deleting a shelf reset its network's daily cap, since the count came from its own job rows. Fix: `network_usage` carry-over.
- A shelf deleted mid-read lost that read's spend (foreign key). Fix: queued items dropped, spend recorded without the device.
- Another browser with the same key re-registered the deleted device, so the backup code worked again. Fix: tombstones.
- "Nothing was removed" was shown after a timeout that may have deleted it, and a retry then got stuck on 401. Fix: honest copy, and 401 on delete counts as done.
- Deleting with no open session reported success. Fix: it throws.
- The memory store didn't erase anything, so tests couldn't check it. Fix: it erases like Postgres, and the tests check books, jobs and the cap.
- Delete and restore switched shelves in different orders. Fix: one `switchShelf`.
- Components imported contact details from a route module. Fix: `web/src/legal.ts`.
- Two render paths for the outlet. Fix: `ConnectionGate open`.
- Not fixed: opening `/privacy` still registers a device. The id is random and the policy says a key is made on the first visit.

Known gap for the lawyer: a removed creator post can come back if someone pastes it again (no blocklist yet).

Migration 0008 is applied (2026-10-10). Live check with two browsers on one shelf: deleting in one moved it to a new shelf; the other, reopened, was refused (old credentials 401) and offered Start a fresh shelf. A delete during a read made that read's book insert fail on the foreign key, logged, with nothing written.

## Phase 7a: Hardening (2026-10-10)

Done:
- **Daily caps are atomic.** Submitting counted today's posts and inserted the job in separate requests, so parallel submissions could each pass the check: 30 parallel pastes of 30 links could queue about 900 paid posts against a cap of 40. The Phase 4 collection race was the same bug. `supabase/migrations/0007_hardening.sql` adds `create_job_capped` and `add_child_items_capped`, which take a per-device and a per-network advisory lock (always device first, so no deadlock), count and insert in one transaction. Collection videos are capped again as they're saved, and saving them is idempotent (a retry after a lost response no longer adds them twice). Pasted order is kept (a microsecond apart).
- **Less data kept:** captions are no longer cached (they were never read back; the migration strips existing ones), cached posts expire after 90 days, and `jobs.ip_hash` is cleared after 2 days, all in the 6-hourly purge.
- **API headers:** `cache-control: no-store` unless a route sets its own (covers keep `private, max-age=86400`), `x-content-type-options: nosniff`, `referrer-policy: no-referrer`. `/health/ready` reaches the database, so it's rate limited (60/min); Render's health check should use `/health`.
- **`IP_HASH_KEY`** (see the decisions log).
- Tests: 55 shared, 143 API (8 new), 30 web. The race tests use a real listening server and a store whose answers arrive late; both fail on the old code and pass on the new. The migration was run in PGlite on top of 0001-0006, as `service_role` with Supabase's grants and RLS bypass: caps refuse per device and per network, order is kept, children stop at the room left and aren't added twice, captions are stripped, and `anon` can't execute the functions.

Security review (the skill, over everything since the last push, including Phases 5 and 6): no findings above its bar. Checked: covers can't be redirected to another host (`coverUrl` is never reader-set, every hop is allowlisted, images only), every new route and function is device-scoped, no dynamic SQL, functions granted to `service_role` only.

Code review (high) found 10 issues; 5 fixed:
- `lock_daily_caps` had no grant for `service_role`, so in Supabase every paste would have failed with "permission denied" (the first PGlite run was as superuser and missed it; now granted, and the test runs as `service_role`).
- A collection cut short by the caps while saving got no note when its listing was complete. Fix: the note follows what was actually saved.
- The production check for `IP_HASH_KEY` could never fire (it fell back to the Supabase key). Fix: required in production.
- The race tests' servers weren't closed when an assertion failed. Fix: `onTestFinished`.
- The collection limit message was written twice. Fix: one helper.
- Not fixed, judged acceptable: a listing paid for in the split second before a parallel paste takes the last room is paid again on retry ($0.09); a collection retried more than 2 days later skips the network cap (the device cap still holds, at most 25 over); the race tests' store delay placement; one extra read after creating a job.

Migration 0007 is applied (2026-10-10). Live check: a cached TikTok fixture pasted from a test device shelved 7 books for $0 through `create_job_capped`.

## Phase 6: Design pass (2026-10-09)

Process: an Impeccable critique of the whole app with two isolated reviews (design director, and detector plus browser evidence) scored **27/40** (2 P1, 3 P2). You chose to fix everything. Three phone Add mockups were rendered with the real CSS and fonts for you to pick from. Then an Impeccable finish review (disposition "fix", 8 material fixes, applied), Code Review (high, 10 findings, all fixed), a final Playwright pass and a confirming finish review. UI/UX Pro Max (feedback, loading and focus rules) and Taste (no em-dashes, one radius system, no hairline per row, full state cycle) were applied throughout.

Changes:
- **Feedback shows over sheets.** Toasts render inside an open sheet (a modal sheet makes the rest of the page inert), at its bottom, and take no taps unless they carry an action. Export rows confirm on the button itself ("Saved ✓", "Copied ✓"); Copy keeps its toast as the brief asks.
- **Accessibility.** Cover page-tabs are bigger, carry a glyph (sparkle New, open book Reading, check Read) and, in light mode, an ink edge, so state is never colour alone and each tab reaches 3:1. The grid shows a text status line. Focus ring uses teal ink in light mode (2.1:1 to 4.7:1). Dark New tab is a lime outline (no more olive), counts at full strength, placeholders 5.3:1. Every tap target is 44px or more (nav pills, view toggle, job and import links).
- **Shelf filters are all page-tabs:** All, New, To read, Reading, Read, coloured like the cover tabs (the Status dropdown is gone; Sort and Shelf remain in the pickers).
- **Phone shelf header:** "Mark all as seen" is a link in the count note; Filter and Select are icon buttons on the tab row; Export stays in the title row. The first cover moved from y=510 to y=332 on a 390x844 phone.
- **Phone Add:** the reading-room strip (window, shelf run, candle; day and night, flicker off under reduced motion) below 1240px, a "Paste what you copied" button inside the empty field (Clipboard API, with a fallback message), a one-line intro on phones, the margin note on phones, a quiet note when pasted TikTok or Instagram links aren't readable posts (profiles, search pages), and the collection cap shown as a limit with an info glyph rather than under "No books found".
- **Lettered placeholder plates:** title sized to the plate (container units), author in Kalam, one of three bindings (gilt rules, head-and-tail bands, label panel). The PDF plates carry the author too.
- **The New highlighter** is an authored marker stroke (tilted top edge, ragged ends), not a flat block.
- **Book sheet** (view-first, see the decisions log): a newly set Reading or Read tab drops onto the cover once (the one authored status moment). The discard guard makes "Keep editing" the filled choice. One shared `Sheet` component.
- **Export:** Goodreads CSV is the one primary action, with the import steps in a disclosure right under it.
- **Settings** leads with the backup code; "About this device" shows today's usage from a new `GET /v1/usage` (posts today of the daily limit, resets at midnight UTC).
- **Smaller:** the 404 page offers "Go to your shelf"; Delete in the selection bar is quiet (note colour), like the sheet; one clear button in search fields; section labels are one weight; the desktop window waits for a wing of about 1340px instead of squeezing in at 1280 (candle and lamp still from 1240).
- Dev: `useDevice` moved to `device/device-context.ts`, so hot reloads no longer throw "useDevice must be used inside <DeviceProvider>" (and the last lint warning is gone).

Finish review (Impeccable) found 8 material fixes, 7 applied. The eighth, collection copy saying "reads the first 3", is stored text from the Phase 4 test run, where the limit was set to 3; the live limit is still 25. The confirming re-review passed the seven and caught two regressions from them, both fixed: the new status tab said "To read" while the sheet and PDF say "Want to read" (now "Want to read" everywhere), and the phone tab row cut a count in half with no sign it scrolls (a fade on the right edge until the last tab is in view, and tighter tabs on phones). It also asked for evidence of the status tab on the sheet's cover (captured) and, optionally, toasts in a sheet clear of the row buttons and "Keep editing" on the right (both done).

Code review (high) found 10 issues, all fixed:
- A second Esc could close the book sheet past the unsaved-changes guard and leave it stuck. Fix: the sheet reopens if its owner keeps it open.
- After a save that re-verified the book, the edit form kept the old ISBNs. Fix: the draft resets from the server's book.
- Quick status or shelf taps could be overwritten by an older response arriving late. Fix: edits per book are sequenced, and each tap has its own error.
- A huge shelf's PDF could hit the cover rate limit and print blank plates. Fix: covers wait and retry after a 429.
- Toasts outside a modal sheet were inert to screen readers. Fix: they render inside the sheet.
- Optimistic shelves could drop a shelf the list hadn't loaded. Fix: the book's own shelves fill the gap.
- The Goodreads CSV had no formula guard. Fix: `=`, `+`, `@` are always defused, and a leading `-` when it looks like a formula, so titles like "-273.15" still import as they are.
- The unreadable-link note counted variants of one page twice and bare home pages. Fix: links are normalised, and home pages ignored.
- The header Export ignored the selection. Fix: it opens on Selected while selecting.
- Duplicate hash and fetch plumbing. Fix: one `hashString` and one `send` helper.

**DESIGN.md** (`web/DESIGN.md` plus `web/.impeccable/design.json`) was written by Impeccable's documenter from the shipped code: tokens for both themes, the full type ramp and radius scale, the signature components and the named rules (One Action Colour, Reserved Lime, Ink-On-Tab, Titles-Are-Serif, Pencil, Hairline-Not-Border, Micro Floor). Writing it surfaced three bits of drift, fixed: a warm-black backdrop and pure-black shadows left from the first world (now a grape scrim and the lift shadow), an instruction carried only in Kalam (now plain text), and two off-scale radii (now 20px cards).

Tests: 55 shared, 135 API, 30 web. Lint clean (0 warnings). Impeccable detector: 0 findings against DESIGN.md.

Playwright MCP (real Supabase shelf of 43 books): Add, Shelf, Settings and 404 at 390 and 1280 in light and dark; Add at 768, 1440, 1920 and 2560 in both themes. No horizontal overflow, no tap target under 44px, no console errors. Behaviours checked: status tabs filter (statuses mocked in the browser, nothing saved), the Copy toast inside the Export sheet without blocking the toggles, "Saved" on the Goodreads row, one-tap status change and revert, the unsaved-changes guard surviving two Escapes, Discard closing the sheet.

Still open: the Goodreads test import (Phase 5). Ceiling ideas from the finish review, not done: the backup reminder as a lavender sticky note, pencil marks on the active nav item, a richer Settings layout at 1280.

## Phase 5: Exports (2026-10-09)

Done:
- **Export sheet** (`web/src/components/ExportSheet.tsx`), opened from the shelf header or the selection bar. Scope: Whole shelf, This view (when filters are on) or Selected (while selecting); one plain line when only the whole shelf applies. Exports keep the shelf's sort. Formats are grouped: For Goodreads and Fable (Goodreads CSV), To read or share (PDF, Copy as text with Numbered and With status toggles, remembered per browser), Your data (CSV, JSON). A "Moving to Goodreads or Fable" note with links. Toasts confirm each download or copy.
- **Formats** in one place, `shared/src/export.ts`: Goodreads CSV (24 columns; Exclusive Shelf from status; Bookshelves = status + tag slugs; Author l-f handles particles and suffixes), generic CSV (one row per book and source, platform-neutral source columns, formula-safe), JSON (sources nested), plain text. No unsure, verified, confidence or evidence anywhere. UTF-8 BOM and CRLF for the CSVs.
- **PDF** (`web/src/library/pdf/`): `@react-pdf/renderer` in a lazy chunk (1.2 MB, kept out of the PWA precache, so the precache went from 2.2 MB to 1.0 MB). Young Serif, Nunito and Kalam with latin-ext, Cyrillic and Vietnamese fallbacks (no CJK face: it would add megabytes). A4, or Letter for US/Canadian locales. Covers are fetched 6 at a time, versioned by cover URL so a re-matched book never shows a stale cover, re-encoded to small JPEGs on a paper-coloured canvas. Progress shows on the button ("Covers 12/40", "Binding…"), and closing the sheet cancels it. A real 43-book shelf: 3 Letter pages, 680 KB, about 8s.
- **API**: `GET /v1/books/:id/cover` (see the decisions log). `COVER_HOSTS` covers Google Books (and its googleusercontent hand-off), Open Library and the Internet Archive.
- Shared `Sheet` component now behind both the book sheet and the export sheet. `downloadFile` is shared with the backup-code download. Status labels moved to `shared`.
- The selection bar goes to two rows on phones (count, then Export, Merge, Delete) so every label fits.
- Tests: 53 shared, 134 API, 29 web. Impeccable detector: 0 findings.

Design process: ui-ux-pro-max searches (UX guidance on feedback, loading and focus; its font pairings were off-direction and the fonts are locked). Taste's anti-slop rules (no em-dashes, no hairline on every row, one radius system, full state cycle). Impeccable shape, with three PDF layouts rendered from the real component, with real covers, for the user to choose.

Code review (high) found 10 issues, all fixed:
- A big shelf's PDF could spend the app's whole 300/minute rate limit on covers and 429 everything else. Fix: covers have their own limit.
- "Selected" was taken from the filtered list while the bar counted every ticked book. Fix: both use all ticked books.
- Only latin fonts were registered, so Polish or Cyrillic text lost glyphs. Fix: fallback subsets (checked with "Stanisław Lem" and "Мастер и Маргарита").
- Google's googleusercontent redirect host wasn't allowed. Fix: added, with a test.
- The header row (Mark all as seen, Select, Export) could overflow at 360px. Fix: it wraps (checked, no sideways scroll).
- Transparent cover pixels turned black in JPEG. Fix: paper-coloured canvas.
- With no session the PDF button did nothing, and closing the sheet didn't stop a PDF. Fix: disabled without a session; an AbortController cancels the covers and the download.
- A cached cover could outlive a re-match. Fix: the cover URL carries a version.
- "Ursula K. Le Guin" became "Guin, Ursula K. Le". Fix: particles and suffixes (Spanish double surnames still come out as "Zafón, Carlos Ruiz"; Goodreads matches on ISBN and title anyway).
- The dialog scaffolding was copied from the book sheet. Fix: a shared `Sheet`.

Also fixed from Playwright and the PDF previews: the lime highlighter spanned the full width on two-line titles (now per line), a group heading could vanish at a page break (each heading is kept with its first row), react-pdf logged "Buffer is not defined" per cover (`buffer` polyfill in the PDF chunk), and the selection bar's icons were squashed at 390px.

Playwright MCP (real Supabase shelf, 43 books), 390px and 1280px, light and dark: Goodreads CSV, CSV, JSON and PDF all download with the right file names and contents (43 rows, correct headers, no flag columns, `%PDF`). This view (New, 7 books) and Selected (2, then 3 with a search hiding some) export exactly those books. Copy as text with Numbered puts 43 numbered lines on the clipboard and toasts "Copied 43 books". Closing mid-PDF downloads nothing. No overflow at 360, 390 or 1280; tap targets at least 44px.

**Waiting on the user:** import the Goodreads CSV into Goodreads once (and Fable if wanted) and report what came through. The Phase 4 open item (a real public BookTok collection) is still open: no link was provided this phase.

Dev note: the PDF previews are rendered from the real component by `web/.impeccable/review/pdf/preview.tsx` (gitignored) with `npx tsx`.

## Phase 4: Bulk, collections and Instagram (2026-10-09)

Bulk paste (mixed TikTok and Instagram, a preview with set-aside, caps, caching, retries) and Instagram came with change request 001 below. This part adds TikTok collections:
- Links: `tiktok.com/@user/collection/Name-ID` and creator playlists `.../playlist/Name-ID` (short links that resolve to either work too).
- Expansion (`api/src/pipeline/process.ts` → `expandCollection`): the collection item lists the videos once, then queues each as a child item (`parent_item_id`) in the same job, read exactly like a pasted link and cached. It reads up to 25, and asks the actor for 26 so a bigger collection is noticed and the reader told. It also never reads more than today's device and IP caps allow; the collection link itself doesn't count against the caps, its videos do. At submit time a collection link needs room for at least one post. A restart mid-collection resumes its videos without paying to list again, and saving the listed videos is retried rather than paying to list again. An empty, private or deleted collection says so, and the listing cost is still recorded.
- Schema: `supabase/migrations/0006_collections.sql` (user ran it): `job_items.note` and a parent index.
- UI: the preview notes "reads up to 25 videos per collection". A collection gets one card with "Read 12 of 25 videos", a progress bar, books shelved so far and the note. Failed videos fold under "N videos couldn't be read", each with Retry.
- Tests: 42 shared, 127 API, 28 web. Impeccable detector: 0 findings.

Code review (high) found 10 issues; 9 are fixed:
- A collection one row over the limit was reported as complete if a row was dropped (private or duplicate). Fix: judged on the raw rows.
- A non-list Apify answer became an unretried TypeError and its cost was lost. Fix: `runActor` checks the body and retries.
- A listing could be paid for when the book reader (Anthropic) wasn't configured, and every video then failed. Fix: both keys are checked first.
- A database error just after a paid listing meant paying again on retry. Fix: saving the videos is retried in place.
- The web app's "up to 25" could disagree with a server env override. Fix: one shared constant, and the env var is gone.
- The submit-time cap counted a collection link as a post. Fix: it needs room for one post, and its videos count as they're read.
- A share link that resolved to a collection kept the "Share link" label. "Books shelved so far" counted books found, not added; it now says "found". The failed-spend rule was written out twice, and `PostFetcher.platform` was unused. All fixed.
- Not fixed (known, small): two devices on one network expanding collections at the same moment can each read up to 25 against the same per-IP count, overshooting the IP cap by at most 25. It needs a database-side counter; revisit in Phase 7 hardening.

Real run (Apify sample collection 7442134949027351314, not book content, with the limit set to 3 for the test): listed, the 3 videos were read (0 books, as expected), and the "more than 3 videos … paid option" note showed. It took about 96s. This run caught the double start charge, fixed by pinning memory to 1 GB and re-checked at $0.09 per start. No public BookTok collection could be found to test with, because search engines don't index collection pages. **Next time:** run one real book collection through it.

## Change request 001 (2026-10-09)

Done:
- **Unsure removed**: `supabase/migrations/0004_remove_unsure.sql` (user ran it) drops the column. It's gone from the shared types, API, pipeline (`UNSURE_BELOW_CONFIDENCE` removed), filters, covers, sheet and tests. `verified` stays as an internal column only. The lavender token is renamed `note` (margin notes and gentle alerts).
- **Platform-neutral data model**: `0005_platforms.sql` (user ran it) adds `source_platform` (`tiktok` | `instagram`) and renames the `tiktok_*` columns to `source_post_id`/`source_url` on `book_sources`, `post_cache` (primary key now platform + post id) and `job_items`. Tested first on a copy of the schema with existing rows in PGlite.
- **Instagram ingestion**: a shared parser (`shared/src/instagram.ts`, `links.ts`) for /p, /reel, /reels, /tv, `/username/` prefixes, /share links, instagr.am and saved collections. Fetchers sit behind one `PostFetcher` interface (`api/src/pipeline/fetchers/`), with a shared Apify runner (retry, billing on failure). Share links resolve over instagram.com only, with a canonical-tag fallback when Instagram answers 200 instead of redirecting. Instagram CDNs (`*.cdninstagram.com`, `*.fbcdn.net`) were added to the media allowlist. Readable errors cover private, deleted, login-required and rate-limited posts.
- **UI**: copy says "TikTok or Instagram links". The paste preview shows a chip per link with its platform icon and kind, can set links aside before sending, and shows the private-collection note. Job cards show the platform. Sources show a platform icon and say "Seen in N posts".
- **Reading room** (desktop decoration, `web/src/components/LibraryBackdrop.tsx`): an arched window (moon and stars at night, sun and clouds by day), a teal-flamed candle on a book stack with a bookworm in glasses, a hanging lamp with drifting dust, and a bookcase with a ladder. Inline SVG and CSS, `--deco-*` tokens tuned per theme. The wings are size containers, so each piece appears only when it fits: candle and lamp from 1240px, the window from about 1260px (on screens at least 620px tall), the bookcase from about 1500px. Tablets get a low run of spines at the page foot; phones get nothing. Three slow loops (flicker, glow, dust), all off under reduced motion.
- Docs: the brief, PRODUCT.md, the surface brief, README and `.env.example` are updated.
- Tests: 41 shared, 113 API, 28 web.

Real runs (Supabase, Apify, Claude):
- Penguin UK carousel `instagram.com/p/DeJvdqUjLd1`: 35 books shelved.
- Reel `instagram.com/reel/DeMTMjJjmqF` (pasted with a `/username/` prefix and `?igsh`): 1 book.
- Mixed paste (TikTok video + Instagram reel + saved collection + YouTube link): the preview read "2 links found: 1 TikTok, 1 Instagram", the saved collection showed the note, and YouTube was ignored. The TikTok post came from the pre-migration cache: 7 books, $0.

Bug found by the Playwright run and fixed: posts cached before the migration have no `platform` in their JSON, so their sources failed the new not-null column, after the book row had already been inserted. Fix: the cache key's platform always wins (pipeline and Supabase store), and a book whose source fails to save is rolled back. A regression test covers it.

Code review (high) found 10 issues, all fixed:
- Instagram error matching used substrings ("page" contains "age"), and a "blocked" post was retried as a rate limit, paying for runs that couldn't succeed. Fix: whole-word patterns, and blocked is not retried.
- Canonical-tag parsing depended on attribute order. Fix: tags are parsed attribute by attribute.
- A successful send cleared set-aside links even when the reader had typed more. Fix: they're cleared only with the text.
- A carousel with failed slide downloads was described to the model as one photo. Fix: the slide count is passed separately.
- The source-failure rollback only soft-deleted the book (restorable, and the cleanup error was swallowed). Fix: a permanent `removeBook`, with the error logged.
- Duplicate sources of truth (platform labels, link key, page hosts, private-collection sentence, cache fix in two layers, a second kind-label table in the job panel). Fix: each now lives in one place, mostly `shared/src/source.ts`.

Playwright MCP: 390, 768, 1280, 1440, 1920 and 2560px, light and dark, Add and Shelf pages. Pieces were measured against the content column at every size: no overlap and no horizontal scroll. Reduced motion stops all three loops. Impeccable detector: 0 findings.

## Redesign (brought forward from Phase 6, 2026-10-09)

The user asked for a new look before Phase 4. Their feedback on the first design: "not fun enough, looks generic, feels too AI", with rounder buttons, a more creative font and a background that isn't too dark. The palette is kept.

- Process: ui-ux-pro-max searches (design system, typography, style). The generic book-app result (Swiss + Cormorant + amber) was rejected and noted. Then an Impeccable direction round (seed ed3595ab), where the user chose **Annotated Paperback** over the rolled Reading Journal, and a font specimen of 4 faces opened in the user's browser (they chose **Young Serif**). Taste rules applied throughout.
- World: the shelf is marked up like an annotated paperback. Filters are sticky page-tabs on a gold page edge (tinted at rest, full colour when active). Covers carry state as tabs peeking from the top edge (lime New, rose Unsure, emerald Reading, sage Read). New titles get a lime highlighter stroke. Kalam handwriting is used sparingly for margin notes (counts, hints, empty states).
- Tokens: a softer dark ground (#2A2723 warm charcoal, lifted cards), contrast-checked text tints, Young Serif + Nunito + Kalam (self-hosted). One shape system: pills for anything pressable, 20px cards, 14px fields, 5px covers. Placeholder bookcloth colours are fixed so they stay dark in light mode.
- Shell: a floating rounded tab bar on phones, a pill nav on desktop, pill toasts with a gold Undo, a floating selection bar.
- Impeccable detector: an overshooting "spring" easing was flagged and replaced with a no-overshoot curve; now 0 findings.
- Playwright (390px and 1280px, dark and light, real data): paste → 5 shelved, edit → saved, delete → Undo, empty state, no overflow.

## Phase 3: List experience

Done:
- Shelf view (the Gilt Spines signature): 2:3 cover plates standing on gold planks, titles below like shelf labels, and rows that reflow by whole cells. Also a list view. The chosen view and sort are remembered per browser.
- Search across title, author and shelf names (accent- and case-insensitive). Chips: All / New / Unsure / Verified with counts. Status and shelf filters. Sort by date added, title (ignoring articles) or author (by surname). On phones the pickers fold behind "Filter & sort".
- Book sheet (native dialog: bottom sheet on phones, side panel on desktop). Edit title, author, status, shelves, notes and ISBNs. Changing the title or author re-verifies; when no match is found, old identifiers are cleared and the book is marked Unsure. The Unsure banner has "Looks right". Opening a book clears its New flag. Sources link to the original TikToks.
- Multi-select: delete with Undo (soft delete, purged after 30 days on a 6-hourly timer) and manual merge (pick the copy to keep; sources, shelves and notes move over). "Mark all as seen".
- Shelves (tags): create from the sheet or Settings, rename, delete. A restored book that duplicates a re-imported copy merges into it.
- Backup code (brief §3): Crockford base32 of the device credentials with a checksum, shown on request, copy or download. Restore from code in Settings, forgiving of case, spaces and I/L/O. A "Save your backup code" prompt appears after the first import that finds books.
- Schema: `supabase/migrations/0003_list.sql` (user ran it).
- Tests: 17 shared, 83 API, 24 web.

Code review (high) found 10 issues, all fixed:
- Restoring a backup code didn't switch the open app until a reload. Fix: device-scoped query keys and a session reset.
- A rename that failed verification kept the old book's ISBN and cover. Fix: they're cleared.
- Non-UUID ids caused Postgres 500s. Fix: they now return 404 or count 0.
- Purge ran on every list request. Fix: a 6-hour timer.
- Bulk ids could overflow URL limits. Fix: chunks of 100.
- Overlapping deletes lost their Undo toast. Fix: mutateAsync.
- Whole-list rollbacks undid other changes. Fix: targeted rollbacks.
- Tag replacement could strip all tags on failure. Fix: add first, then remove.
- A restore could create a duplicate. Fix: it merges into the live copy.
- The toast timer reset on every re-render. Fix: a stable dismiss.

Also fixed from Playwright runs:
- Shelf covers rendered at 0x0 (buttons don't stretch). Fix: `w-full`.
- The phone toolbar pushed books below the fold. Fix: pickers fold away.
- The selection bar's Merge was icon-only. Fix: it has a label.
- Entrance animations started invisible. Fix: they're transform-only and skipped under reduced motion.

Playwright MCP (390px and 1280px, dark and light, real Supabase):
- Edit, re-verify and Unsure → confirm.
- Shelves and notes persist after reload.
- Search, filters and sorting.
- List view, and the view is remembered.
- Delete → Undo, including two overlapping deletes.
- Merge.
- Mark all as seen.
- Backup code → restore in a fresh browser with no reload; a typo is caught.
- No overflow, and every tap target is at least 40px.

Impeccable detector: 0 findings.

Test-harness note: the Playwright MCP window runs in the background, which freezes CSS animations and transitions. Visual checks use CDP focus emulation (`Emulation.setFocusEmulationEnabled`).

Open: the backup code is long (102 characters) because it encodes the full credentials, as the brief specifies. A shorter server-issued code is possible if wanted.

## Phase 2: Single-link pipeline

Done:
- Pipeline per link: parse and allowlist, resolve short links (every redirect hop checked), cache lookup by post id, Apify fetch, media (carousel slides re-encoded to at most 1568px; video sampled to up to 30 frames, about every 2s plus scene cuts, with exact timestamps via ffmpeg showinfo; subtitles from VTT), Claude structured extraction with server-side refusal fallback, Google Books then Open Library verification (English editions preferred), then shelve.
- Shelving: duplicates are found by ISBN or fuzzy title+author (bigram and edit-distance similarity) and become an extra source instead of a new row. The first book a new import adds clears the previous "new" highlight. Unverified or under-0.6-confidence books are flagged "unsure" but still added.
- Jobs: `POST /v1/jobs`, `GET /v1/jobs`, `GET /v1/jobs/:id`, retry, `GET /v1/books`. The in-process queue runs 2 at a time, one per device, and resumes after restart. Readable per-link failures.
- Cost controls: per-device and per-IP daily caps, a $20/month budget from a spend ledger (`spend_events`, including failed-but-billed calls), the kill switch, a 3-attempt cap per link, and the post cache so a post is never paid for twice.
- Schema: `supabase/migrations/0002_pipeline.sql` (user ran it).
- Web: live paste preview ("2 links found: 1 video, 1 photo post"), progress panel with stages and Retry, basic shelf list (cover plate, New ribbon, Unsure/Verified, source).
- Model comparison script: `api/scripts/compare-models.ts`.
- Tests: 17 shared, 68 API, 14 web.

Real-world results (Sonnet 5.5): carousel 5/5 books and video 7/7, all verified. About 15-60s per post. Re-pasting a post is free and creates no duplicates.

Code review (high) found 10 issues, all fixed with regression tests:
- A short link to a collection was paid for, then failed. Fix: rechecked after resolving.
- A featured book could be dropped as "background" in dedupe. Fix: featured always wins.
- Failed-but-billed Apify and Claude calls were missing from the budget ledger. Fix: errors carry their cost.
- The video download had no byte cap without content-length. Fix: a streaming cap.
- Pressing Retry the instant an item failed could leave it stuck "queued". Fix: the queue re-runs it.
- Retries skipped the daily caps. Fix: caps are enforced, plus a 3-attempt limit.
- Shutdown killed in-flight paid work, and resumes were unbounded. Fix: a 25s drain and the attempt cap.
- Slides over 5MB would fail the whole post. Fix: slides are re-encoded to at most 1568px.
- The shelf refetched every 2s during jobs. Fix: it only refetches when an item finishes.
- Subtitles dropped spoken numeric titles ("1984"). Fix: real cue-id parsing.

Also fixed from Playwright runs:
- Text typed while a paste was sending got cleared.
- Slow covers showed a blank plate. The placeholder now sits underneath.
- The desktop shelf count floated far from the list.

Playwright MCP (390px and 1280px, real APIs): carousel → 5 shelved; video → 7 shelved and the old "new" cleared; re-paste → no duplicates; cached posts spend $0; fresh uncached run after fixes → 5/5; 0 console errors. Impeccable detector: 0 findings.

## Phase 1: Foundation

Done:
- npm-workspaces monorepo (`web`, `api`, `shared`), git, TypeScript 6, ESLint 10, Vitest 5.
- API (Fastify 5): `/health`, `/health/ready`, `POST /v1/devices` (idempotent registration), `GET /v1/me` (device auth). Strict CORS, global and registration rate limits, a uniform error shape, and secrets redacted from logs.
- Storage: Supabase repository, plus an in-memory fallback for development only (refused in production).
- Schema: `supabase/migrations/0001_init.sql`, covering every §9 table, the dedup indexes, RLS on with no policies, check constraints and updated_at triggers. It also adds `job_items.parent_item_id`/`attempts` and a `collection` kind for Phase 4 resumable jobs. Verified by running it in PGlite.
- Web: Vite 8 PWA (manifest, service worker, generated icons), device bootstrap (generate, register, verify, `navigator.storage.persist()`), connection states (opening, slow cold start, offline, rejected key, rate limited), app shell with Add / Shelf / Settings, dark and light themes.
- CI: GitHub Actions running lint, typecheck, tests and build, plus a check that no secrets are in the web bundle.
- Tests: 21 API, 14 web.

Code review (high) found 10 issues, all fixed:
- X-Forwarded-For spoofing bypassed IP rate limits. Fix: trust exactly `TRUST_PROXY_HOPS` (1 on Render), with a regression test.
- Registration limit was too tight for shared mobile IPs. Fix: now 60/hour, configurable.
- `AbortSignal.any` broke older iOS Safari, and caller aborts were reported as network errors. Fix: manual timeout plus a signal combiner, with tests.
- A production build could silently target localhost. Fix: the build now fails without a real `VITE_API_URL`.
- Two tabs on first launch could mint two devices. Fix: Web Locks around bootstrap, and other tabs follow credential changes.
- The secret scan missed JWT-format keys. Fix: the CI grep now catches JWTs and Google keys.
- Supabase default grants would expose future tables, and the trigger function had a mutable search_path. Fix: both revoked/fixed.
- The auth path leaked which device ids exist via timing. Fix: constant-cost compare, and the docs are now accurate about the 409.
- The status-bar colour was wrong when reopening in light mode. Fix: set in the startup script.
- Error codes were hardcoded strings. Fix: they use the shared `ERROR_CODES`.

Playwright MCP checks (390px and 1280px, dark and light), all passing:
- First launch registers a device: UUID v4 id plus a 43-char secret saved, `registered: true`, and 0 console warnings.
- Reload and new tab keep the same device. A new tab calls only `GET /v1/me`.
- Two tabs opened at once on a fresh browser make one registration and share one device id.
- API unreachable: the "Can't reach BookTrap" state appears with Try again.
- A held request shows the "server naps" cold-start message after 4s and recovers when the API answers.
- Theme toggle persists across reload, and the status-bar colour follows it.
- No horizontal overflow, and every tap target is at least 44px.

Fixed from the screenshots:
- The wordmark tap target was 42px; now 44px.
- The nav shifted between pages with and without a scrollbar; `scrollbar-gutter: stable` fixes it.
- The desktop Add page left half the screen empty; "In progress" now sits beside the form at ≥1024px.
- The loading sweep sat off-screen most of each cycle; the easing is fixed.

Impeccable detector: 0 findings. Screenshots are in `web/.impeccable/review/` (gitignored).
The Impeccable finish review and the DESIGN.md write-up are scheduled for Phase 6, once every screen exists.

Live Supabase check (2026-10-08): migration applied, `/health/ready` ok, a browser registration created a device row that holds only a SHA-256 hash, and it survived a reload.

Open: GitHub repo (optional) to switch on CI.
