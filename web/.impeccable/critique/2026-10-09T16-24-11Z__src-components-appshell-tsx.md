---
target: whole BookTrap web app
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\zhalh\\dev\\book-finder\\web\\src\\components\\AppShell.tsx"
target_fingerprint: "sha256:226e86a89a7ff01bc891a30b56336b709f33040c042c404123aabb0d3823c69c"
target_path: "C:\\Users\\zhalh\\dev\\book-finder\\web\\src\\components\\AppShell.tsx"
timestamp: 2026-10-09T16-24-11Z
slug: src-components-appshell-tsx
---
# BookTrap critique (Phase 6), whole app
Method: dual-agent (A: design review, B: detector + browser evidence)

## Design Health Score: 27/40 (Acceptable)
1 Visibility 3: toasts hidden under open modal sheets (Export feedback invisible).
2 Real world 3: "Shelf" overloaded (list vs tag); Settings system jargon.
3 Control 3: unsaved book edits silently lost on close.
4 Consistency 2: duplicate search clear buttons; Delete styling differs (text link vs teal primary); status segmented vs select.
5 Error prevention 3: Delete in primary "act" colour; unsaved-edit loss.
6 Recognition 3: grid Reading/Read colour-only.
7 Flexibility 2: no paste-from-clipboard, no bulk status, no shortcuts.
8 Minimalist 2: phone shelf chrome ~510/844px before first cover; Export five equal buttons; New triple-signalled.
9 Recovery 3: collection cap note reads as failure.
10 Help 3: import steps at bottom of Export sheet.

## Specificity: split. Marks are owned (page-tabs, highlighter, cloth plates, margin notes, reading room); structures are generic, especially on phone (Add, Settings, Export). 1280 wings cramped.
Detector: CLI 0 findings. Overlay: dark New chip 3.8:1, count 3.0:1, dark placeholders 3.8:1. Tap targets <44: nav pills 40, view toggle 40, recent links 20-25, Export inline links 23. False positives: highlight-new 1.2:1, loader marquee, sheet overflow-hidden, disabled buttons.

## Priority issues
1. [P1] Toasts invisible under showModal sheets. Fix: top-layer toast (popover=manual) + inline Saved/Copied state on Export rows. /impeccable harden
2. [P1] A11y: grid status colour-only; light focus ring ~2.1:1 (use accent-ink); dark New chip/count/placeholders below AA; sub-44px targets. /impeccable audit
3. [P2] Phone shelf chrome buries books; move Mark all as seen to New tab, Select/Export to search row, Filter & sort beside tabs; covers by ~330px. /impeccable layout
4. [P2] Coverless monotone wall (10px titles, 4 cloths); book sheet edit-first, evidence buried; unsaved-edit guard. /impeccable delight, /impeccable distill
5. [P2] Phone Add generic; no paste-from-clipboard; margin note hidden on phones. /impeccable onboard, /impeccable bolder

## Personas
Mia (BookTok, phone): no paste button; re-paste no hint; cap reads as failure; backup card clipped behind tab bar; books below chrome.
Casey (distracted): status change lost on backdrop tap; double downloads; two floating bars cover ~25%.
Sam (keyboard/low vision): faint focus ring; colour-only status; duplicate clear button; window.confirm.

## Minor
Dark New tab olive; header tone mismatch at 1280; 404 lacks shelf link; Settings should lead with backup, daily usage missing; double scrollbars in mobile sheets; Numbered toggle on-state reads disabled; unrecognised URL-like lines dropped silently; list "from @creator" faint.
