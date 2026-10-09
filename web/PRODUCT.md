# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Readers who find books through BookTok and Bookstagram. The usual moment: they're on their phone and have just saved or watched TikToks, reels or carousels where creators show stacks, covers and spines or talk about books, and they want those books on a list without pausing every video and typing titles by hand. Secondary moment: on desktop, cleaning up the list and exporting it to Goodreads or another reading app.

This is a public product (confirmed 2026-10-08), so first-time visitors arrive cold, often from a shared link, and must understand what to do within seconds.

## Product Purpose
One job: pull book lists out of videos and posts. You paste TikTok or Instagram links (one or many, mixed freely) or a public TikTok collection, and BookTrap pulls out every book that's shown or mentioned in videos, reels and photo carousels, then adds them to a persistent want-to-read list. A catalogue lookup (Google Books / Open Library) quietly adds covers, ISBNs and years when it finds a match. Success: pasting a dozen links produces a correct, deduplicated list with covers. Nothing should slow down "paste links, get books" (change request 001).

## Positioning
It reads what's actually on screen: covers, spines, text overlays, captions and speech across a whole collection. You never type a title. Nothing that requires the user to enter titles can truthfully claim this.

## Operating Context
- Mostly mobile and paste-driven: copy a link from the TikTok share sheet, switch to BookTrap, paste. Bulk pastes of many links at once are expected.
- Processing runs in the background and takes from seconds to minutes. Users watch a live job panel or leave and come back.
- No accounts. Each browser holds an anonymous identity, and a backup code restores the list on another device.
- Exports go to Goodreads (CSV import at goodreads.com/review/import), PDF, plain text and CSV/JSON. BookTrap never logs into other services.

## Capabilities and Constraints
- Inputs: TikTok video and photo-carousel URLs, TikTok short links (vm./vt.tiktok.com), **public** TikTok collection links, and Instagram posts, carousels, reels and IGTV (instagram.com/p, /reel, /reels, /tv, share links and instagr.am). Instagram saved collections are private to their owner and cannot be read; the app says so and suggests pasting the posts' links instead.
- Every extracted book is added automatically, as read, whether or not a catalogue match was found. There is no "unsure" state and no "unverified" warning (change request 001). Books from the latest import are marked **New**. Everything can be edited or deleted.
- Duplicates never create a second entry. A repeat sighting adds a source ("Seen in N posts"), and each source shows its platform.
- Status: want to read / reading / read. Users can create custom tags, which export as Goodreads shelves.
- Costs are real (paid scraper and AI per link): per-device and per-IP daily caps, a global kill switch, and a clear "limit reached" state.
- The API runs on a free host that sleeps when idle: the first request after idle can take 30-60s, and jobs resume after wake.
- Scrapers: Apify clockworks/tiktok-scraper, apify/instagram-scraper and powerai/tiktok-collection-posts-scraper (collection listing), sharing one $20/month budget and the same caps.
- Collections: up to 25 videos per TikTok collection or playlist are free; larger collections are planned as a paid option.
- Undecided: custom domain; final lime value for "New".

## Brand Commitments
- Name: **BookTrap**.
- Palette (user-supplied 2026-10-09, replacing the brief's dark-academia palette): Dusty Lavender `#67597A`, Vintage Grape `#544E61`, Slate Grey `#6E8894`, Muted Teal `#85BAA1`, Honeydew `#CEEDDB`. Lime `#C6E04A` is kept and reserved exclusively for "New".
- **Light mode is the default** (user, 2026-10-09). A softer dark mode (deep grape, never near-black) is available in Settings.
- Desktop decoration (change request 001): the side gutters are a cozy, slightly magical library (dark academia, playful and modern) drawn from the palette, with a day and a night version.
- Type (user-chosen 2026-10-09): **Young Serif** for headlines and book titles, a rounded sans (Nunito) for UI, and a handwriting face (Kalam) used sparingly for annotations.
- Controls are **rounded**: pill buttons and chips, soft-cornered surfaces (user, 2026-10-09).
- It must feel fun and distinctive, not generic or "AI-made" (user feedback on the first design, 2026-10-09).

## Evidence on Hand
None yet: no real users, testimonials, usage numbers or press. Never fabricate any of them. Example book data shown in empty states or demos must be clearly illustrative.

## Product Principles
1. **Never lose a book.** If in doubt, add it as read rather than drop it; the reader can fix it.
2. **Paste and walk away.** The core loop must work in a few seconds on a phone, with processing visible but never blocking.
3. **Be honest about limits.** Failed, private and over-the-cap states are explained plainly with a next step.
4. **The list belongs to the reader.** Everything can be edited, everything can be exported, and nothing is locked in.

## Accessibility & Inclusion
WCAG AA contrast in both themes, 44px minimum tap targets, full keyboard operation on desktop, and respect for reduced motion. Status (New, Reading, Read) must never be signalled by colour alone.
