# BookTrap build progress

Phases from `BUILD_BRIEF_BookCatcher.md` §12.

| # | Phase | Status |
|---|---|---|
| 1 | Foundation | Done |
| 2 | Single-link pipeline | Done |
| 3 | List experience | Done |
| 4 | Bulk and collections | Not started |
| 5 | Exports | Not started |
| 6 | Design pass | Not started |
| 7 | Hardening and deploy | Not started |

## Decisions log

- 2026-10-08: App name is **BookTrap**.
- 2026-10-08: Audience is a **public product**, so first-run copy must explain itself and per-IP limits matter, not just per-device ones.
- 2026-10-08: Render **free plan**: job state lives in Postgres and unfinished jobs resume on wake. Expect cold starts of 30-60s.
- 2026-10-08: First visual direction was **Gilt Spines** (seed 6ce76978), with Libre Caslon + Schibsted Grotesk. Replaced on 2026-10-09 at the user's request (below).
- 2026-10-09: Visual direction **Annotated Paperback** (seed ed3595ab, user's choice): page-tabs, a highlighter for New, margin notes. Contract in `web/.impeccable/surfaces/src-app-tsx.md`.
- 2026-10-09: Type is **Young Serif** (user's choice from a 4-font specimen) for headlines and titles, **Nunito** for UI and **Kalam** for annotations, all self-hosted. Icons are Phosphor.
- 2026-10-09: **Palette replaced** at the user's request: Dusty Lavender #67597A, Vintage Grape #544E61, Slate Grey #6E8894, Muted Teal #85BAA1, Honeydew #CEEDDB (lime kept for New). Tokens renamed by role (accent, action, success, unsure, tag, reading, read) instead of colour names. Dark ground #2B2733 (deep grape), text honeydew 11.8:1, teal accent and action with dark ink, lavender for Unsure. Contrast-checked in both themes, and the icons regenerated.
- 2026-10-09: **Light is the default theme** (user request; the brief said dark). Dark (deep grape #2B2733) remains in Settings and is remembered per browser. Controls are rounded (pills).
- 2026-10-08: Device secrets are hashed with SHA-256 rather than a slow KDF. They're 256-bit random values, so a slow hash adds nothing but latency on every request.
- 2026-10-08: Scraper is the Apify actor **clockworks/tiktok-scraper**. Free-plan prices: $0.0037/post + $0.0013/video download + $0.001/run. Paid speech-to-text is off; TikTok's free subtitles are used when present.
- 2026-10-08: Extraction model is **Claude Sonnet 5.5** at effort medium (user's choice). It matched Opus 5.5 on every featured book in the fixtures at about half the cost: $0.05-0.08/post vs $0.12-0.18.
- 2026-10-08: **Featured books only** (user's choice). Claude tags each book featured or background; background-only shelf books are cached but not added (`INCLUDE_BACKGROUND_BOOKS=false`).

## Test fixtures (from the user)

- Photo carousel: https://www.tiktok.com/@readbetweeenlines/photo/7674670540518395169
- Video: https://www.tiktok.com/@wmccusker/video/7672440936101727519

## Limits (user approved 2026-10-08)

30 links per paste, 100 videos per collection (ask above that), 40 posts/device/day, 120 posts/IP/day, $20/month global budget (processing pauses when reached), cached posts free. Extraction model: compare Opus 5.5 and Sonnet 5.5 on the test fixtures in Phase 2, then the user picks.

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
