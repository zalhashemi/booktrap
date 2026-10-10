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
| 7 | Hardening and deploy | Not started |

## Decisions log

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
