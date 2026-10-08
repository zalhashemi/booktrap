---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

## Scope

App shell for BookTrap (web PWA, mobile-first): navigation, Add screen (paste box + job area), My List (shelf), Settings, plus first-launch / connecting / offline / error states. Visitor mode: **Operate**. Built up across phases 1-6. Phase 1 ships the shell, tokens, and connection states.

## Audience and task

BookTok readers, mostly on a phone, pasting links from TikTok's share sheet. Core loop: paste, glance at progress, come back to a list that grew. Secondary: desktop list clean-up and export.

## Direction contract

THESIS: Your want-to-read list is a lit library shelf. Every book is a clothbound spine with its title foil-stamped in gold, and new arrivals carry a lime ribbon. It refuses the category default of a grey list of thumbnail rows with a floating add button.

OWN-WORLD: Green-black reading-room ground; bookcloth in burgundy, emerald and charcoal; antique-gold foil for the wordmark, hairline rules, focus rings and spine titles; ivory for reading text; sage for quiet text; rose only for Unsure; lime only as the New ribbon. Caslon-cut serif set like foil stamping (caps, tracked, on spines and headings) over a sturdy grotesk for every control. Corners are almost square (book boards, 3px). The only depth is a soft shelf shadow under spines.

STORY: The visitor understands in one glance that pasting TikTok links fills a shelf, trusts the progress because it's legible, and returns to find new spines ribboned in lime.

FIRST VIEWPORT: Phone. A foil-stamped BOOKTRAP wordmark top-left on a slim header. A paste field fills the upper half with a one-line instruction and a burgundy "Catch books" button full width under it. Below: the job area, empty until a paste, then link lines. A fixed bottom tab bar (Add, Shelf, Settings) at 64px with gold active state. Desktop: a left-aligned 720px column with the tab bar moving into the header.

FORM: Gilt Spines (my own top-ranked grounded candidate, chosen by the user over the rolled Circulation Desk); seed key 6ce76978. Kept from the round as product discipline: one fixed state-ink language (emerald = verified/done, rose = unsure, burgundy = act, lime = new); printed capacity (links used today vs cap); covers registered at one 2:3 plate size; grids reflow by whole cells. Signature move: the Shelf. On the list, books stand as spines on a gold-ruled shelf; tapping a spine slides it out into its cover and detail sheet. The empty shelf shows ghost spine outlines between bookends.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

Final lime value (start #C6E04A), final ground value; light mode quality on Ivory to be confirmed in the Phase 6 design pass.
