---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

## Scope

App shell for BookTrap (web PWA, mobile-first): navigation, Add screen (paste box and progress), Shelf, book sheet, Settings, plus first-launch, connecting, error and empty states. Visitor mode: **Operate**. Redesign of the first world (Gilt Spines), requested by the user on 2026-10-09: "not fun enough, looks generic, feels too AI", with rounder buttons, a more creative font and a background that isn't too dark. The palette is kept.

## Audience and task

BookTok readers, mostly on a phone, pasting links from TikTok's share sheet. Core loop: paste, glance at progress, come back to a shelf that grew. Secondary: desktop clean-up and export.

## Direction contract

THESIS: BookTrap is a well-loved, annotated paperback: the reader's shelf is marked up the way BookTok readers mark up books, with coloured sticky page-tabs, highlighter strokes and pencil notes in the margin. It refuses both the generic grey list app and the museum-piece dark-academia library.

OWN-WORLD: Softer dark ground (warm charcoal, never near-black) with lifted card surfaces; ivory text. Palette roles: burgundy = the action colour, gold = rules, focus and the wordmark, emerald = verified/read, rose = unsure, sage = shelves (tags), lime = New only (as a highlighter stroke and the New tab). Young Serif for headlines and book titles, Nunito (rounded) for every control, and Kalam handwriting for sparing margin notes. Pill buttons and chips; 20px surfaces; covers with small rounded corners.

STORY: In one glance the reader sees their TikToks becoming a marked-up reading list. New books are highlighted like a fresh find, unsure ones carry a pink tab asking for a look, and everything can be tidied by tapping a tab.

FIRST VIEWPORT: Phone. A slim header with the Young Serif gold wordmark. The paste card fills the top: a big rounded field, a handwritten hint in the margin, and a full-width burgundy pill "Catch books". Progress cards below show each link's stage. A floating rounded tab bar (Add, Shelf, Settings) sits above the safe area. Desktop: the same card with progress in a right-hand column, and the nav in the header.

FORM: Annotated Paperback (my own top-ranked grounded candidate, chosen by the user over the rolled Reading Journal); seed key ed3595ab. Signature move: page-tabs. Filters are coloured sticky tabs standing on a gold page edge, and every cover carries its state as a tab peeking from its top edge (lime New, rose Unsure, emerald Reading/Read). New titles get a lime highlighter stroke that sweeps in once. Kept from the round as discipline: status changes stamp or flag the book and nothing silently vanishes (ticket wallet); a small spring when a book takes focus (character catalog); hierarchy by scale contrast, not ornament (type specimen); covers registered at one 2:3 size on a shared baseline (botanical folio).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

Final lime value (#C6E04A in use). Light mode stays available on ivory and needs a final pass in Phase 6.
