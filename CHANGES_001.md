# BookTrap: Change Request #001

Apply these changes BEFORE continuing Phase 4. They override anything in `BUILD_BRIEF_BookCatcher.md` that conflicts (the app is now named **BookTrap**). After finishing them, update `BUILD_BRIEF_BookCatcher.md` and `PROGRESS.md` so they match, then continue with Phase 4.

Same workflow rules as before: run the Code Review skill after the changes, test with Playwright MCP, and use the Taste, Impeccable and UI/UX Pro Max skills for all design work. If the design skills disagree, the user's palette and the dark academia library direction always win.

---

## 1. Purpose reminder

BookTrap exists for one job: pull book lists out of videos and posts. Keep everything simple and focused on that. Do not add features that slow down "paste links, get books".

---

## 2. Remove the "Unsure" feature completely

Books are added to the list whether or not the app is certain about them. There is no "unsure" concept anymore.

- Remove the "Unsure" badge, the "Unsure" filter chip, the "confirm" action, and any unsure counts or copy.
- Remove the `unsure` column from the database with a proper migration, and remove it from the API types, the extraction/verification pipeline, exports (CSV/JSON), and tests.
- Low model confidence or a failed Google Books/Open Library match must NOT block or flag a book. Add it with the extracted title/author as-is.
- Keep enrichment (cover, ISBN, year) as a quiet background improvement. Do not show any "unverified" warning or negative state in the UI. If there is no cover, show the tasteful placeholder only.
- Keep `is_new` and the lime "New" highlight exactly as they are. Lime is still reserved only for "New".
- Editing and deleting books still works, so the user can fix mistakes themselves.
- Update the Playwright test list: remove the unsure-flag check, keep everything else.

---

## 3. Background graphics and decoration (desktop first)

Problem: on desktop the content sits in the middle and the sides and background are empty. Fix it with fun, on-theme decoration.

Direction:
- Dark academia library, but playful and modern. The decoration should make the page feel like a cozy, slightly magical library, not a museum and not clutter.
- Ideas to explore (pick and combine what looks best, do not do all of them): leaning book stacks and shelf silhouettes along the side edges, thin gold line-art ornaments and corner flourishes, a quill and inkpot, a candle or hanging lamp with a soft warm glow, a library ladder, a crescent moon and stars through an arched window, floating dust motes in lamplight, a bookworm peeking out of a book, subtle leather or paper grain on the background, a faint pattern of tiny book spines.
- Use the palette tokens only (burgundy, gold, emerald, ivory, charcoal, sage, rose). Derive tints from them. Lime stays only for "New".
- Make it feel alive but calm: slow, subtle motion (drifting dust, a flickering candle glow, gentle parallax). Respect `prefers-reduced-motion` by turning motion off.

Rules:
- The decoration must never reduce readability or contrast of the content, and must never be clickable. Mark it `aria-hidden`, `pointer-events: none`, behind content.
- Main content stays in a centered column with a sensible max width. The decoration fills the space on the left and right, and the background behind everything.
- Responsive: rich at 1280px and wider, lighter on tablets, minimal or hidden on phones so mobile stays fast and uncluttered.
- Performance: prefer inline SVG and CSS. No large images, no heavy animation libraries unless clearly worth it. No layout shift, no jank. Keep the page fast.
- Light mode, if supported, needs its own tuned version of the decoration.
- Verify with Playwright screenshots at 390px, 768px, 1280px, 1440px, 1920px and an ultrawide 2560px, in dark mode (and light if it exists). Check that nothing overlaps content or looks stretched.
- Run Taste, Impeccable and UI/UX Pro Max on the result and iterate until it genuinely looks good, then show the user screenshots.

---

## 4. Add Instagram support (same as TikTok)

Instagram links must work the same way TikTok links do: paste one or many, the app extracts books and adds them to the list.

Supported input:
- Instagram **posts** and **carousels** (`instagram.com/p/...`)
- **Reels** (`instagram.com/reel/...`, `instagram.com/reels/...`)
- Video posts (`instagram.com/tv/...`)
- Short links and share links, resolved safely
- **Collections**: be honest about feasibility. Instagram "Saved" collections are private to the owner and may have no public shareable link. Research this (and which Apify Instagram actors can do what) BEFORE building. Report back to the user with what is actually possible. If public collections are not possible, make the UI say so clearly, and offer the closest useful option (for example pasting many links at once) instead of a broken feature.
- TikTok and Instagram links can be mixed in the same paste.

Implementation notes:
- Generalize the data model so it is not TikTok-specific: use `source_platform` (`tiktok` | `instagram`) plus `source_post_id` and `source_url`, instead of TikTok-named columns. Write a migration that converts existing data and updates `post_cache`, `book_sources`, `job_items` and indexes. Cache key is platform plus post ID.
- Extend the URL parser and regex to detect Instagram URLs, and extend the domain allowlist (instagram.com and the official short domain only). Keep the SSRF protections.
- Add an Instagram fetcher through Apify (compare actors on cost and reliability with a few real links, same as for TikTok). Carousel images, reel video frames, caption and any available transcript feed the same Claude extraction step. Do not duplicate the pipeline: put TikTok and Instagram behind one common "fetcher" interface.
- Handle Instagram-specific failures with clear messages: private account, deleted post, login-required, rate limited.
- UI copy: "TikTok or Instagram links" everywhere the input is described. The parsed preview shows the platform per link. Source chips on a book show a small platform icon and open the original link. "Seen in N posts" instead of "N TikToks".
- Exports keep working. Rename source columns in generic CSV/JSON to be platform-neutral.
- Respect the existing limits and per-device caps for Instagram links too.
- Add Playwright checks: paste an Instagram carousel, a reel, and a mixed TikTok + Instagram paste.

---

## 5. Order of work

1. Remove the unsure feature (section 2), including the migration.
2. Platform-neutral data model migration (part of section 4).
3. Instagram ingestion (section 4), folded into Phase 4 alongside bulk paste and collections.
4. Background graphics and desktop design pass (section 3).
5. Update `BUILD_BRIEF_BookCatcher.md` and `PROGRESS.md`, run Code Review, run the Playwright checks, then continue the rest of Phase 4 and onward.

Ask the user for anything needed (keys, budget for the Instagram actor, decisions) instead of guessing.
