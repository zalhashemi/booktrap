# Build Brief: BookTrap

> The app is named **BookTrap** (decided 2026-10-08; this file keeps its old name). Updated 2026-10-09 for change request 001 (`CHANGES_001.md`): Instagram support, no "unsure" state, platform-neutral data model, desktop background decoration. Where this brief and `CHANGES_001.md` ever disagree, the change request wins.

BookTrap exists for one job: pull book lists out of videos and posts. Keep everything simple and focused on that, and add nothing that slows down "paste links, get books".

A React web app (PWA) where the user pastes TikTok or Instagram links (mixed freely), or a public TikTok collection link, and the app automatically extracts the books shown or mentioned (videos, reels and photo carousels), enriches them, and adds them to a persistent want-to-read list. The list can be exported to Goodreads-format CSV, PDF, plain text, and generic CSV/JSON.

This document is the source of truth. Read all of it before writing code. If something here is ambiguous or you find a better option, ask the user before deviating.

---

## 0. Required tooling and workflow

Use all of the following throughout the build:

- **Playwright MCP**: drive the deployed/local web app in a real browser to test every user flow end to end (paste links, review list, exports, persistence after reload). Take screenshots to verify the UI at mobile (390px) and desktop (1280px) widths.
- **Impeccable**, **Taste** and **UI/UX Pro Max** skills: use for all UI/UX design decisions. If they disagree, the user's palette and the dark academia library direction win, visual polish and critique. Run them on every major screen before calling it done. If either is not installed, stop and ask the user how to install it rather than skipping it.
- **Code Review** skill: run after each phase (see section 12) and fix findings before moving on.
- Keep a short `PROGRESS.md` updated as phases complete.

---

## 1. Locked decisions (from the user)

| Topic | Decision |
|---|---|
| Platform | React + TypeScript web app (Vite), built as an installable PWA. Keep the UI responsive and the API client separate so a native wrapper (Capacitor) can be added later. |
| Post fetching | Paid scraper API via Apify: clockworks/tiktok-scraper for TikTok, apify/instagram-scraper for Instagram, behind one common fetcher interface. |
| Collections | Public TikTok collections via link only. Private collections are NOT supported; show a clear message. Instagram saved collections are always private to their owner (no public link exists), so the app says so and suggests pasting the posts' links at once. |
| Persistence | Anonymous per-device cloud list. No login. List survives closing the tab and returns next week. |
| Backend / DB | Supabase (Postgres) + a small API service on Render. React static build hosted on Cloudflare Pages. |
| Review flow | **Add everything automatically.** Newly added books are highlighted in lime as "new". There is no "unsure" flag (change request 001): low confidence or a failed catalogue match never blocks or flags a book. Everything is editable later. |
| List features | Duplicate detection, source link per book, status and tags, cover images, search/filter. |
| Exports | Goodreads-format CSV, PDF, copy as plain text, generic CSV/JSON. |

---

## 2. Architecture

```
React PWA  (Cloudflare Pages)
      |  HTTPS, device token header
      v
API service  (Render, Node + TypeScript recommended)
   |-- Apify (TikTok and Instagram post data, TikTok collections)
   |-- Claude API (vision + text extraction of book titles)
   |-- Google Books API + Open Library API (quiet enrichment: ISBN, covers, year)
   '-- Supabase Postgres (storage)
```

- The React app NEVER holds third-party API keys. All keys live on the API service as environment variables.
- Processing is asynchronous: the app submits links, the API creates a **job**, and the app polls (or uses Supabase Realtime) for progress.
- Suggested frontend stack: Vite + React + TypeScript, React Router, TanStack Query (server state and polling), Tailwind CSS with CSS-variable design tokens, `vite-plugin-pwa` (manifest and service worker), `@react-pdf/renderer` (or `pdf-lib`/`jsPDF`) for PDF, and `localStorage` for the device token. Use Zod to validate API responses. Keep the API client in its own module.

---

## 3. Anonymous device identity and sessions

1. On first launch the app generates a random `device_id` (UUID v4) and a long random `device_secret`, stores both in browser local storage, and registers them with the API.
2. The API stores only a **hash** of the secret. Every request sends `device_id` + `device_secret`; the API authorizes and scopes all queries to that device.
3. Enable Row Level Security on all Supabase tables. The app talks only to the API service, never directly to the database, unless you deliberately design RLS policies around the device token.
4. **Risk to handle:** if the user clears site data, the token is lost and so is access to the list. Implement a **Backup code** in Settings: a human-readable code that encodes the device credentials. Entering it on a new browser or device restores access to the same list. Show a gentle prompt after the first successful import: "Save your backup code so you can never lose your list."
5. Request persistent storage in the browser where supported (`navigator.storage.persist()`).

---

## 4. Input and ingestion

### Input UI
- One large input area accepting **multiple links at once** (one per line, or pasted blob; parse out all TikTok and Instagram URLs, mixed in one paste). TikTok: `vm.tiktok.com`, `vt.tiktok.com`, `tiktok.com/t/...`, `tiktok.com/@user/video/...`, `tiktok.com/@user/photo/...`, and collection URLs. Instagram: `instagram.com/p/...` (posts and carousels), `/reel/...`, `/reels/...`, `/tv/...`, optionally behind a `/username/` prefix, `instagram.com/share/...` share links and the official short domain `instagr.am`. Instagram saved-collection links are recognised only to explain that they are private.
- Show a parsed preview with the platform per link ("3 links found: 1 TikTok, 2 Instagram"). Let the user remove entries before submitting. Copy everywhere says "TikTok or Instagram links".
- Detect collection URLs (`/@user/collection/...` and creator playlists `/@user/playlist/...`) and expand them into their individual videos on the server, via Apify powerai/tiktok-collection-posts-scraper.
- **25 videos per collection are free** (user, 2026-10-09). A bigger collection is read up to 25 and the reader is told; larger collections are planned as a paid option after deploy (Stripe, tied to the account-less device). The limit is `FREE_VIDEOS_PER_COLLECTION` in `shared/src/source.ts`, read by both the web app and the API.

### Job processing (per link)
1. Resolve short and share links, validate the URL is on the platform's own domains (allowlist only: TikTok's hosts, instagram.com and instagr.am; every redirect hop is checked, and a share link may only land on the same platform). Guard against SSRF.
2. Fetch via Apify through the common fetcher: caption/description, hashtags, author, thumbnail, video URL or carousel image URLs, and any free transcript/subtitles (TikTok only; Instagram reels are read from frames and caption, and the paid transcript add-on is off).
3. **Videos and reels:** sample frames (about one every 2 seconds, capped at around 30 frames; prefer scene-change frames if cheap to do). **Carousels:** use every image (a video slide in an Instagram carousel contributes its cover frame; a single photo is a one-slide carousel).
4. Send to Claude (vision) together with the caption and any transcript. Ask for structured JSON only (see section 5).
5. Verify each extracted book (section 6).
6. Insert into the list (section 7), attach the source.
7. Record per-link status: `queued`, `fetching`, `extracting`, `verifying`, `done`, `failed` (with a human-readable reason).

### Limits and cost control
- Max links per submission (30) and videos per collection (25 free; `MAX_VIDEOS_PER_COLLECTION` 100 is the absolute ceiling for a future paid tier). Collection videos count against the daily caps; the collection link itself doesn't.
- Concurrency limit on the API; retry with backoff on scraper failures.
- Per-device daily cap on processed links, configurable by env var; Instagram and TikTok links count against the same caps and budget. Cache results by platform + post ID so the same post is never paid for twice.

### Progress UI
- A live job panel showing each link with its status, count of books found, and any failure with a "Retry" button.
- Collections show overall progress ("23 of 60 videos").

---

## 5. Extraction prompt contract (Claude)

Use a current Claude vision-capable model via the API. Request strict JSON (use structured output / tool-calling schema):

```json
{
  "books": [
    {
      "title": "string",
      "author": "string | null",
      "confidence": 0.0,
      "evidence": "cover | spine | text_overlay | caption | spoken | other",
      "notes": "string | null"
    }
  ]
}
```

Rules to put in the prompt:
- Only return actual books. Ignore Kindles, bookshelves with no readable titles, and non-book products.
- Read covers, spines, on-screen text, captions, and transcript.
- Do not invent titles or authors. If a title is partially readable, return your best reading with a LOW confidence.
- Include series name in the title only if it appears on the cover.
- Deduplicate within a single post.

Store `confidence` and `evidence` with the source, for reference only. They never flag or block a book.

---

## 6. Enrichment (quiet)

Enrichment is a background improvement, never a gate. For each extracted book:
1. Query Google Books (and Open Library as fallback) using title + author.
2. Accept a match when fuzzy title similarity and author match pass a threshold (tune it; test with real examples).
3. On match: store canonical title, canonical author, ISBN-10/13, cover URL and publication year (an internal `verified` column records that a match was found; it is not shown).
4. On no match, low similarity or low model confidence: **still add the book** with the extracted title/author as-is. No warning, no negative state; with no cover the tasteful placeholder shows.

---

## 7. List behavior

### Add everything, highlight what's new
- Every extracted book is added automatically.
- Books added in the latest import carry `is_new = true` and render with a **lime highlight** plus a "New" badge. The highlight clears when the user taps "Mark all as seen", opens/edits the book, or after the next import batch replaces it. Persist `is_new` server-side so it survives reload.
- Provide a "New" filter chip and a count in the header ("12 new").

### Duplicate detection
- Normalize title + author (lowercase, strip punctuation, strip leading articles, remove subtitle noise) and compare by ISBN first, then by fuzzy normalized title+author.
- A duplicate never creates a second row. Instead, attach the new post as an additional source on the existing book and show "Seen in N posts" (the same book from TikTok and Instagram merges too).
- Add a manual "Merge duplicates" action for edge cases the algorithm misses.

### Sources
- Every book stores one or more sources: platform, post URL, author handle, thumbnail, date processed. Source chips show a small platform icon, and tapping one opens the original post in a new tab.

### Status and tags
- Status: `want_to_read` (default), `reading`, `read`.
- Custom tags/shelves: create, rename, delete, multi-assign. Tags map to Goodreads "Bookshelves" on export.

### Covers, search, filter, sort
- Show covers (from Google Books/Open Library), with a tasteful placeholder when missing.
- Search across title, author, tags. Filters: status and new as page-tabs, tag in a picker. Sort: date added, title, author.
- Grid and list view toggle.

### Editing
- Edit title, author, ISBN, status, tags, notes. Delete single or multi-select delete with undo.

---

## 8. Exports

All exports run on the whole shelf, the current filtered view (offered when filters are on) or the books ticked in select mode (offered while selecting), in the shelf's current sort. They live in an Export sheet opened from the shelf header or the selection bar. Every format is defined once in `shared/src/export.ts`.

1. **Goodreads CSV**: the 24-column header of Goodreads' own library export (Book Id, Title, Author, Author l-f, …, Bookshelves, Bookshelves with positions, Exclusive Shelf, …, Owned Copies), which its importer reads back. `Exclusive Shelf` is `to-read`, `currently-reading` or `read` from status. `Bookshelves` holds the exclusive shelf plus the tags (lowercased, accents folded, hyphenated, comma-separated): an import with Exclusive Shelf alone has been reported to shelve everything as "read". ISBNs are plain digits; Date Added is `yyyy/MM/dd`; notes go to Private Notes. UTF-8 with a BOM, CRLF lines. Goodreads' import page needs a login, so the format was checked against its export header and a real import by the user is still to come.
2. **PDF**: a printable shelf in the app's own look (chosen by the user from three layouts, 2026-10-09): five covers across with titles and authors below, grouped by status (Reading now, Want to read, Read) under page-tab headings, a teal page edge, a Kalam margin note, lime highlighter and page-tab on New books, bookcloth plates for missing covers, and page numbers. Built client-side with `@react-pdf/renderer`, loaded only on demand and kept out of the PWA precache. A4, or Letter for US/Canadian locales. Covers come through the API (`GET /v1/books/:id/cover`, since Google Books images have no CORS headers), re-encoded to small JPEGs.
3. **Copy as plain text**: `Title by Author` per line to the clipboard with a toast ("Copied 12 books"). Toggles for numbering and status, remembered per browser.
4. **Generic CSV and JSON**: full data (ids, ISBNs, year, status, is_new, tags, notes, cover URL, timestamps) with platform-neutral sources (`source_platform`, `source_post_id`, `source_url`, creator, date). The CSV has one row per book and source; the JSON nests sources. No unsure, verified, confidence or evidence fields. Doubles as a backup. The CSV defuses spreadsheet formulas (a leading = + - @ gets an apostrophe); the Goodreads file doesn't, since an importer reads it.

The sheet carries a "Moving to Goodreads or Fable" note: download the Goodreads CSV, upload it at goodreads.com/review/import (My Books, Import and export), and for Fable upload the same file at fable.co/goodreads-import (beta, website only, signed in with the app account; Fable emails when done). Don't re-save the file in Excel. BookTrap never logs into Goodreads or Fable.

---

## 9. Data model (Postgres, adjust as needed)

- `devices`: id (uuid), secret_hash, created_at, last_seen_at
- `books`: id, device_id, title, author, isbn10, isbn13, cover_url, published_year, status, verified (bool, internal), is_new (bool), notes, normalized_key, created_at, updated_at, deleted_at. (`unsure` removed in `0004_remove_unsure.sql`.)
- `book_sources`: id, book_id, source_platform (`tiktok` | `instagram`), source_post_id, source_url, creator_handle, thumbnail_url, evidence, confidence, created_at; unique (book_id, source_platform, source_post_id). (Renamed from tiktok_* in `0005_platforms.sql`.)
- `tags`: id, device_id, name; `book_tags`: book_id, tag_id
- `jobs`: id, device_id, created_at, status
- `job_items`: id, job_id, input_url, source_platform, source_post_id, kind (video|carousel|collection|collection_child), status, error, books_found, attempts
- `post_cache`: primary key (source_platform, source_post_id), post, extracted_json, model, fetched_at (avoid re-paying for the same post)

Indexes on `(device_id, normalized_key)` and `(device_id, isbn13)` for dedup.

---

## 10. Design

- Mobile-first, then desktop. The user mostly pastes links from their phone.
- **Vibe (from the user):** dark academia library. Classic and bookish, but also fun, attractive and modern. Think old-library green lamps, burgundy leather spines, gold foil lettering and ivory pages, executed with a clean, current UI. It should feel like a beautifully designed reading app, not a museum piece and not a generic component-library look. Use bookish touches with restraint (serif display type, thin gold rules, subtle paper/leather texture, spine-like list rows, a bookmark-ribbon motif for "New") and keep layouts modern and uncluttered.
- **Palette (replaced 2026-10-09, and confirmed again for change request 001):** the user's own five colours, Dusty Lavender `#67597A`, Vintage Grape `#544E61`, Slate Grey `#6E8894`, Muted Teal `#85BAA1` and Honeydew `#CEEDDB`, with lime `#C6E04A` reserved for "New". Tokens are named by role (accent, action, success, note, tag, reading, read) in `web/src/styles/index.css`. The table below is the original palette, kept for history only.
- **Original palette (superseded):** the Dark Academia palette with Burgundy, Antique Gold, Emerald, Ivory, Charcoal, Sage Green and Dusty Rose. Define it once as CSS variables (mapped into the Tailwind theme) and use only tokens everywhere, never raw hex values in components:

| Token | Name | Hex | Suggested role |
|---|---|---|---|
| `burgundy` | Burgundy | `#7B1E28` | Primary actions, "Unsure" accents, deep headers |
| `gold` | Antique Gold | `#C4A95B` | Accents, rules, icons, focus rings, titles on dark |
| `emerald` | Emerald | `#166D3B` | Secondary actions, success, "Verified" |
| `ivory` | Ivory | `#F8F4E3` | Main text on dark, light-mode background |
| `charcoal` | Charcoal Gray | `#3D3D3D` | Surfaces and cards on dark |
| `sage` | Sage Green | `#98AE87` | Muted text, tags, subtle fills |
| `rose` | Dusty Rose | `#B77C87` | Soft highlights, tag variety, hover states |

  Notes on the palette: the source image's hex for Charcoal was partly cut off, so `#3D3D3D` is the best reading. The Dusty Rose swatch looked redder than its hex suggests; use the hex as given and check it visually. Derive a near-black app background from these (a warm, slightly green-black such as around `#14110F` to `#1A1713`, or a deeper tint of charcoal) and tune it with Impeccable/Taste. Derive any extra tints/shades from these colors rather than introducing unrelated hues.
- **Lime** is required for the "New" highlight and is not in the palette. Add a single lime accent that sits well against the dark emerald/burgundy/gold world (start near `#C6E04A`, a slightly warm, bright lime), use it ONLY for "New" so it stays meaningful, and verify contrast. Confirm the final value with the user.
- **Light mode is the default** (user, 2026-10-09). Dark (deep grape, never near-black) is in Settings and remembered per browser.
- **Background decoration (change request 001):** on desktop the side gutters become a cozy, slightly magical library, playful and modern rather than a museum: an arched window (moon and stars at night, sun and clouds by day), a teal-flamed candle on a book stack with a bookworm in reading glasses, a hanging lamp with dust drifting in its light, and a bookcase with a library ladder. Inline SVG + CSS only, palette tokens only (separate day and night tunings), `aria-hidden`, no pointer events, behind content, never over the content column. Rich from 1240px up (more pieces as the gutters widen), a low run of spines along the page foot on tablets, nothing on phones. Motion is slow and calm (candle flicker, breathing glows, drifting dust) and stops under reduced motion.
- **Phase 6 design pass (2026-10-09):** below 1240px a slim slice of the reading room (window, shelf run, candle) sits above the Add headline (user's pick of three phone mockups), and the empty paste field offers "Paste what you copied". Shelf filters are page-tabs for All, New, To read, Reading and Read in the cover-tab colours; cover tabs carry glyphs so state never rests on colour. Placeholder covers are lettered bindings. The book sheet is view-first: status and shelves save on tap, details sit behind "Edit details". Settings leads with the backup code and shows today's usage. The design system is written up in `web/DESIGN.md`.
- **Typography (chosen by the user):** Young Serif for headlines and book titles, Nunito for UI, Kalam for sparing handwritten notes, all self-hosted.
- Typography, spacing, motion and empty states should be deliberate and distinctive, not default component-library styling. Use the Taste and Impeccable skills to drive this and to critique each screen.
- Key screens: Home/Add (paste box + job progress), My List (grid/list, filters, search), Book detail/edit sheet, Export sheet, Settings (backup code, daily usage, clear data).
- Good empty, loading and error states. Accessible contrast and tap targets (min 44px).

---

## 11. Security and reliability

- All API keys server-side only. Never ship them in the frontend bundle.
- Strict CORS to the deployed web origin.
- Rate limit per device and per IP. Validate and sanitize all input; allowlist TikTok domains.
- Budget guard: kill switch env var and per-device caps for Apify and Claude spend; surface "limit reached" cleanly in the UI.
- Log job failures with reasons, but do not log device secrets.
- Handle TikTok failures gracefully (deleted video, private account, region lock, scraper timeout) with specific user-facing messages.
- Public collections only: if a collection is private or unreadable, say so plainly and suggest pasting individual links instead.

---

## 12. Build phases (run Code Review and Playwright checks at the end of each)

1. **Foundation**: repo, React (Vite + TypeScript) scaffold, PWA manifest and service worker, API service skeleton, Supabase schema, device registration and auth, health checks, CI.
2. **Single-link pipeline**: paste one link, Apify fetch, Claude extraction, verification, save to list. Test with a real video AND a real carousel.
3. **List experience**: list/grid, covers, search, filters, status, tags, edit/delete, dedup, sources, lime "New" highlight.
4. **Bulk, collections and Instagram**: multi-link paste (TikTok and Instagram mixed), TikTok collection expansion, Instagram ingestion through the common fetcher, job queue, live progress, retries, caps and caching.
5. **Exports**: Goodreads CSV, PDF, plain-text copy, CSV/JSON.
6. **Design pass**: apply the user's color scheme; run Impeccable and Taste on every screen; fix.
7. **Accounts** (Supabase Auth, replacing device identity): guests as anonymous users (5 posts a day, deleted after 30 idle days), sign-up with email and password or an email code that keeps the guest's shelf (no passkeys for now), delete account. Device registration and backup codes are removed.
8. **Limits, moderation, report and takedown**: upload and payload limits in `shared/`, content classification in extraction (block only explicit non-book content), "Report this post", an admin takedown route and page.
9. **Scale, storage and cost**: measured storage per user, a load test of 100 users at once, queue tuning, and a cost report against the budgets.
10. **Legal and deploy** (was Phase 7; 7a hardening and 7b privacy done): policies rewritten for accounts, a domain with Resend email, Render Starter, Cloudflare Pages, Supabase production settings, a proxy check, a security review, a Playwright full-flow test against production, and a final Code Review.

Full detail for Phases 7 to 10 is in `PROGRESS.md`, "Plan for Phases 7 to 10".

Playwright MCP must verify at minimum: first-launch registration, pasting multiple links, pasting an Instagram carousel, an Instagram reel and a mixed TikTok + Instagram paste, job progress, new-book highlight appears, duplicate does not create a second row, reload/new-tab persistence (and after closing the browser), each export downloads/copies correctly, backup code restores a list, mobile and desktop layouts, and the background decoration at 390, 768, 1280, 1440, 1920 and 2560px in both themes.

---

## 13. Environment variables (API service)

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
APIFY_TOKEN=
ANTHROPIC_API_KEY=
GOOGLE_BOOKS_API_KEY=
ALLOWED_ORIGIN=
DAILY_LINK_CAP_PER_DEVICE=
MAX_LINKS_PER_SUBMISSION=
MAX_VIDEOS_PER_COLLECTION=
GLOBAL_SPEND_KILL_SWITCH=false
```

Provide a `.env.example`, a README with setup and deploy steps, and ask the user for any account credentials or keys you need rather than guessing.

---

## 14. Open items to confirm with the user during the build

- ~~Final app name.~~ BookTrap.
- Final lime value for the "New" highlight, and the final near-black background.
- ~~Which Apify actor to use and the monthly budget.~~ TikTok: clockworks/tiktok-scraper. Instagram: apify/instagram-scraper ($0.0027/post, no paid transcript). One shared $20/month budget.
- ~~Whether Fable accepts the Goodreads CSV.~~ Fable has a beta CSV import at fable.co/goodreads-import (website only) for Goodreads data, so the Goodreads CSV is the file to use; untested until the user tries it.
- Custom domain, if any.
