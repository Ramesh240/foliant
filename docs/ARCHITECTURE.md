# Foliant — Architecture

This document explains how Foliant turns a binary PDF into an interactive book.
Read it top to bottom to follow one PDF through the whole pipeline.

```
PDF file (ArrayBuffer)
   │
   ▼
parse.js ────────► flat lines L = [{t, h, x, y, code, dc, pg, box?}] + image boxes
   │
   ▼
structure.js ────► blocks B = [{k:'h1'|'h2'|'h3'|'p'|'li'|'code'|'toc'|'img', …}]
   │              chapters = [{title, b: B}]
   ▼
render.js ───────► HTML in <article id="book">
   │
   ├── cards.js ─────► flashcards per chapter (in-page + review deck)
   ├── highlights.js ━► selection → <mark> overlays + notes (orthogonal layer)
   ├── figures.js ───► canvas crops for <figure> placeholders
   └── review.js ────► flip-card sessions over all cards
```

## Design constraints

1. **No build step, no framework.** Plain script files that share globals, loaded in
   dependency order by [index.html](../index.html). Each file starts with `'use strict'`
   and a header describing what it owns.
2. **Everything is client-side.** pdf.js parses the ArrayBuffer in-browser; the worker
   is loaded via a blob bridge (`importScripts` on a CDN URL) so the app even works
   from `file://`.
3. **State is deliberately small:** `chapters`, `cur`, `name`, `S` (settings,
   including the bottom-bar slot list), `R` (ratings), `HLS` (highlights) —
   see [js/config.js](../js/config.js).

## Stage 1 — Parsing ([js/parse.js](../js/parse.js))

pdf.js gives us *text items* — styled string fragments with a transform matrix.
Foliant reconstructs visual lines ("rows") from them:

- **Grouping:** items whose baseline `y` differs by < 2.5 px join the same row;
  within a row they are sorted by `x`. A horizontal jump > 22 % of the row height
  becomes a space (that threshold reconstructs word gaps correctly).
- **Base size:** per page, the font height carrying the most characters is the body
  size `pb` — everything else is judged relative to it.
- **Drop caps:** single glyphs rendered ≥ 1.35 × `pb` are pulled out, then re-attached
  to the body row that starts to their right (`dc` flag → CSS drop cap).
- **Code:** rows whose glyphs are mostly monospace fonts are emitted verbatim with
  `code: true` (no space reconstruction, no re-flow later).
- **Images:** [imgBoxes](../js/parse.js) walks the page's operator list, composing
  transforms through save/restore and form XObjects; each `paintImageXObject*` maps
  its unit square through the CTM to get page-space boxes. Overlapping boxes merge;
  tiny/decorative ones are filtered; images repeated identically on ≥ 4 pages
  (header/footer logos, in books ≥ 12 pages) are dropped.

**Output:** one flat list `L` of lines (each with text, height, x/y, page) with image
placeholders interleaved in reading order.

## Stage 2 — Structure ([js/structure.js](../js/structure.js))

`build(L)` turns lines into a chapter tree using typography statistics instead of
PDF bookmarks (most PDFs don't have reliable ones):

1. **Body size** is recomputed across the whole document (character-weighted mode
   of line heights).
2. **Page grid:** the modal line gap (`lg`) and modal left margin (`mx`) are learned
   from body lines. A gap ≥ 1.25 × `lg` between same-size lines suggests a paragraph
   break; an x-indentation after a page break suggests a new paragraph too.
3. **Classification** per line, merging continuations into the open block:
   - `toc` — dot-leader lines (`title …… 42`) and lines following an open
     "Contents" heading; descriptions and wrapped titles are glued to entries.
   - `h1/h2/h3` — height ≥ 1.15 × body + not starting lowercase + not ending like a
     sentence; ALL-CAPS lines count as headings too. Level = size ratio (1.55× / 1.3×).
   - `li` — bullet or `N.` prefix; soft-wrapped list lines are glued.
   - `p` — default; same-height lines with gap < 1.25 × `lg` merge, de-hyphenating
     `word-` + `break` pairs. A bare `1.2` after a paragraph marks it as a *step*.
4. **Chapters:** the coarsest heading level that yields chapters ≤ ~7,000 words
   becomes the split level (`h1` > `h2` > `h3`); run-in headings ("Chapter 3" + "The
   Theory" on the same page) merge into one title with smart separators.
5. **Fallback:** with no usable headings, text is split into ~1,200-word "Parts" at
   paragraph boundaries.

**Output:** `chapters = [{ title, b: blocks }]` — the app's read model.

## Stage 3 — Rendering ([js/render.js](../js/render.js))

One chapter at a time is rendered into `#book` as HTML. Blocks map to elements:
headings → `h2/h3`, `p` → paragraph (`.first` drop-cap, `.step` numbered card),
`li` → card lists, `code` → `<pre><button>Copy</button></pre>`, `toc` → dot-leader
list whose entries fuzzy-match chapter titles and become clickable, `img` → lazy
`<figure data-pg data-box>` filled by [figures.js](../js/figures.js).
Callout regex turns `Note:`/`Tip:`/`Warning:` paragraphs into styled boxes.
Chapter position + scroll fraction drive the progress bar; the chapter index is
persisted per file (`foliant-pos-<name>`).

## Orthogonal layers

### Highlights ([js/highlights.js](../js/highlights.js))
A highlight is `{id, c: chapter, b: blockIndex, s, e, col, note}` — **character
offsets into the block's plain text**, not DOM positions. `hl()` re-renders a block
with `<mark>` spans by slicing the plain string, so highlights survive re-render and
theme changes. New selections are captured on `selectionchange` (debounced 300 ms),
mapped to offsets via DOM Ranges; overlapping highlights in a block merge.
The list sheet exports everything as Markdown.

### Flashcards ([js/cards.js](../js/cards.js), [js/review.js](../js/review.js))
Cards come from three detectors, tried per block position:

1. **Explicit** — `Q: … A: …` paragraphs; or a heading ending in `?` whose next
   block (paragraph or list run) is the answer.
2. **Auto** — a heading followed by a 2+ item list → "Recall the points under …";
   a heading followed by a long paragraph → "What does the book say about …";
   a *Summary/Takeaway* section → recall-all card; at most one *structure* card
   per chapter ("main sections?" from 3–12 sub-headings).

Card ids are `chapterIndex + djb2-hash(question)` so ratings persist across reloads.
Boilerplate chapters (Contents, Index, Copyright…) are skipped, as is everything
before an embedded TOC. The review overlay runs sessions over three decks —
rated-again, unrated, all-shuffled — with `done`/`again` ratings stored per book.

### Figures ([js/figures.js](../js/figures.js))
Each figure's page is rasterized once to a canvas (scale chosen so the box is ~1,100 px
wide, cached in `PC`), cropped to the box with a 2 px bleed, and exported as a JPEG
data URL. A generation token (`figTok`) aborts stale loads when you flip chapters.

### Search ([js/search.js](../js/search.js))
Whole-book search runs over the read model, not the DOM: every text-bearing block of
every chapter is scanned with `needle = fold(q)`, where `fold()` lowercases and strips
diacritics (NFD + combining-mark removal), so "resume" finds "résumé". Results are
[{ci, bi, count, snippet}] in book order, capped at 200. Snippets take a ~110-char
word-aligned window around the first hit; match positions are computed on the folded
string and mirrored onto the original so accented characters survive, and every hit
inside the window is wrapped in `<mark>`. Tapping a result jumps via `go()` (if the
chapter differs) then `scrollIntoView` on the block's `data-bi` anchor after a double
rAF (render must have painted), with a 1.4 s pulse animation. Every renderable block
carries `data-bi`, while `selInfo()` in highlights.js deliberately only accepts
`p[data-bi], li[data-bi]` — highlights and search anchor to the same indices but have
different eligibility rules. Input is debounced 180 ms; Enter forces an immediate run.

### Bottom navigation ([js/nav.js](../js/nav.js))
A fixed thumb-reach bar (`#navb`, hidden while the home screen shows) whose
buttons come from a slot list persisted in `S.nav` with the other settings.
Slots map one-to-one onto existing actions — `openSheet('#sToc'/'#sHl'/'#sSet')`,
`openSearch()`, `openReview()`, `showHome()`, `toggleFocus()`, `go(cur±1)` — so the
bar adds no second implementation of anything. The customize editor is an ordinary
bottom sheet (`#sNav`, also reachable from Settings) that toggles slots and an
icons-only mode; changing anything calls `applyS()`, which re-renders the bar.
Which chrome bars are visible is a setting too (`S.chrome: 'both'|'top'|'bottom'`,
Settings → On-screen bars). Touch devices start in `'bottom'` — single-bar,
thumb-reach reading — and an explicit chip tap sets `S.chromePicked`, which
pins the choice over that default on every later load: `applyS()` mirrors the
value onto `<html data-chrome>` and
nav.css owns the rules — the bottom bar can hide the top bar only on touch
screens, because the top bar carries the hover-driven menus on desktop. In
bottom-only mode the reading-progress line survives as a fixed hairline on
the nav bar's top edge (`--navh` pins the bar height so sheets, the selection
toolbar and the hairline all anchor exactly); the top bar must drop its
`backdrop-filter` there, because a filter makes it a containing block that
would anchor the fixed line to `#top` instead of the viewport.

Two gestures ride on the chrome: the hairline doubles as a chapter scrubber
([nav.js](../js/nav.js) `scrubSeek` — chapter changes render live as the drag
crosses their boundaries, the rest of the travel is in-chapter scroll, and a
preview bubble shows the target title), and horizontal swipes on `#book` flip
chapters ([ui.js](../js/ui.js)). The swipe uses pointer events with an axis
lock and `touch-action:pan-y pinch-zoom`, so vertical scrolling and pinch
zoom stay native; code blocks keep their own horizontal scroll, and a live
text selection aborts the gesture so highlighting is never interrupted.
`prev`/`next` disable at the book's edges via `navSync()`, and the reader column
pads its bottom (`body.hasnav #book`) so the bar never covers text. Custom user
labels are encoded in the slot id (`'-Home|home'` = home action, label "Home").
A Premium-only quick `custom` slot is render-filtered on `IAP.premium` (see
[iap.js](../js/iap.js)) so a lapsed subscription hides it without deleting it.

### Premium entitlement ([js/iap.js](../js/iap.js))
A single non-consumable purchase (`foliant_premium`, $1.99) unlocks review,
search and export. UI entry points call `gateFeature(id)` — `openSearch`,
`openReview` and the Markdown copy button — which returns true when
`IAP.premium` holds and otherwise slides up the unlock sheet (`#sIap`) — but
only where a purchase is actually possible (Android: Play Billing bridge or
user agent). On the web there is no store, so every Premium feature stays
free there; the pitch sheet becomes a support note pointing to the Android
app. The
entitlement is cached in `localStorage['foliant-iap']` so it survives offline
starts; under the Android shell a `window.FoliantBilling` bridge (Play Billing
Library, see docs/PUBLISHING.md §6) is authoritative and re-verified at
startup. On the web there is deliberately no purchase path — the sheet points
to the Android app — and a localhost-only `FoliantDev.unlock()/lock()` helper
exists for UI testing. Because the gates live at the entry points rather than
inside the engines, `runSearch()`/`allCards()`/`hlMd()` stay honest functions
that extensions and tests can call directly.

### Fast reopen ([js/library.js](../js/library.js) model cache)
Parsing — pdf.js text extraction plus structure detection — is the expensive
half of opening a book, and its output depends only on the bytes. So
`shelfRemember()` also stores the finished `chapters` array in a third
IndexedDB store, `model`. `shelfOpen()` tries the cache first: a hit calls
`openBookFromModel()` in main.js, which renders straight from the stored
model (a reopen drops from ~0.4 s to ~20 ms on the sample book) and only
re-parses when the cache row is missing or corrupt (self-healing: the row
is deleted and the full pipeline runs). Fresh imports always parse, which
also invalidates the cache row for re-imported files.

## Extension points

- **New block type:** classify it in `structure.js` (step 3), style it in
  `styles/content.css`, render it in `render.js`.
- **New card detector:** add a `xxxAt(ch, i, ci) → {q, a, used, id}` function in
  `cards.js` and try it inside `cardsOfCh`.
- **Sync/storage backends:** all persistence funnels through four functions —
  `loadH/saveH`, `loadR/saveR` — plus settings in `applyS` and position in `render`.
  Swap `localStorage` for IndexedDB or a remote store there.
- **Bundling:** the files are written as order-dependent globals for zero-tooling
  portability; wrapping each in an ES module is mechanical if you adopt a bundler.

## Known limits

- Scanned/image-only PDFs produce no text — OCR is out of scope by design.
- Two-column layouts are flattened by baseline grouping (rows join across columns);
  complex layouts may reorder text.
- Heading detection is heuristic: unusual typography (e.g. headings smaller than
  body text) can produce fewer chapters than expected.
- DRMed PDFs will fail pdf.js parsing and surface as "password protected or damaged".
