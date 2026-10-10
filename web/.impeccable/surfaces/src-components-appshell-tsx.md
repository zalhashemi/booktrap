---
version: 1
slug: "src-components-appshell-tsx"
primary_target: "src/components/AppShell.tsx"
related_targets: ["src/routes/AddPage.tsx","src/routes/ShelfPage.tsx","src/routes/SettingsPage.tsx","src/components/LibraryBackdrop.tsx"]
---

## Scope

App shell for BookTrap (web PWA, mobile-first): navigation, Add screen (paste box and progress), Shelf, book sheet, Settings, plus first-launch, connecting, error and empty states. Visitor mode: **Operate**. Redesign of the first world (Gilt Spines), requested by the user on 2026-10-09: "not fun enough, looks generic, feels too AI", with rounder buttons, a more creative font and a background that isn't too dark. The palette was later replaced by the user's own five colours (2026-10-09).

## Audience and task

BookTok readers, mostly on a phone, pasting links from TikTok's share sheet. Core loop: paste, glance at progress, come back to a shelf that grew. Secondary: desktop clean-up and export.

## Direction contract

THESIS: BookTrap is a well-loved, annotated paperback: the reader's shelf is marked up the way BookTok readers mark up books, with coloured sticky page-tabs, highlighter strokes and pencil notes in the margin. It refuses both the generic grey list app and the museum-piece dark-academia library.

OWN-WORLD: Softer dark ground (deep Vintage Grape #2B2733, never near-black) with lifted grape cards; Honeydew text. Palette (user-supplied 2026-10-09): Dusty Lavender, Vintage Grape, Slate Grey, Muted Teal, Honeydew. Roles: teal = the action and accent colour (wordmark, focus, active tabs, page edge), teal ink = success, lavender = margin notes and gentle alerts (the "note" token), slate = shelves and reading, honeydew = read, lime = New only (highlighter stroke and New tab). There is no Unsure or Verified state (change request 001). Young Serif for headlines and book titles, Nunito (rounded) for every control, Kalam handwriting for sparing margin notes. Pill buttons and chips, 20px surfaces, covers with small rounded corners.

STORY: In one glance the reader sees their TikToks and Instagram posts becoming a marked-up reading list. New books are highlighted like a fresh find, and everything can be tidied by tapping a tab. On desktop the page sits in a reading room: an arched window (moon and stars at night, sun and clouds by day), a candle on a book stack with a bookworm in glasses, a hanging lamp with dust drifting in its light, and a bookcase with a ladder.

FIRST VIEWPORT: Phone. A slim header with the Young Serif teal wordmark. The paste card fills the top: a big rounded field, a handwritten hint in the margin, and a full-width teal pill "Catch books". Progress cards below show each link's stage. A floating rounded tab bar (Add, Shelf, Settings) sits above the safe area. Desktop: the same card with progress in a right-hand column, and the nav in the header.

FORM: Annotated Paperback (my own top-ranked grounded candidate, chosen by the user over the rolled Reading Journal); seed key ed3595ab. Signature move: page-tabs. Filters are coloured sticky tabs standing on a teal page edge, and every cover carries its state as a tab peeking from its top edge (lime New, slate Reading, honeydew Read). New titles get a lime highlighter stroke that sweeps in once. Kept from the round as discipline: status changes stamp or flag the book and nothing silently vanishes (ticket wallet); a small lift when a book takes focus (character catalog); hierarchy by scale contrast, not ornament (type specimen); covers registered at one 2:3 size on a shared baseline (botanical folio).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

Final lime value (#C6E04A in use). Light is the default theme on washed Honeydew (#f1f7f3); its final pass was done in Phase 6 (2026-10-09). Phone Add carries a reading-room strip above the headline (user's pick). Shelf filters are page-tabs for New and every status.
