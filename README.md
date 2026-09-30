# Foliant — turn any PDF into a book 📖

Foliant is a **100% client-side PDF reader** that restructures any text PDF into a
readable book: it detects chapters, rebuilds paragraphs and lists, extracts figures,
and layers on reading features — highlights with notes, focus mode, and automatically
generated flashcards for review.

No build step, no framework, no server. **Your PDF never leaves your device.**

---

## Features

| Feature | What it does |
|---|---|
| **Chapter detection** | Groups headings into chapters by font size; falls back to ~1,200-word parts for heading-less PDFs |
| **Smart re-flow** | Rebuilds paragraphs from raw PDF lines, fixes hyphenated line breaks, de-noises page numbers and headers |
| **Drop caps & callouts** | Detects decorated first letters and "Note: / Tip: / Warning:" lines |
| **Figures** | Finds image regions per page, renders them as crops, supports captions and a lightbox |
| **Code blocks** | Rows set in monospace fonts become copyable code blocks |
| **Embedded TOC** | Detects a book's own table of contents and makes its entries clickable |
| **Whole-book search** | Case- and diacritic-insensitive search across every chapter; tap a result to jump to the block with a pulse |
| **Highlights & notes** | Select text → 4 colors → attach notes; export everything as Markdown |
| **Focus mode** | Dims everything except the paragraph you tap |
| **Bottom nav bar** | Customizable thumb-reach bar on mobile: pick up to 5 slots (chapters, search, highlights, review, settings, library, focus, prev/next), icons-only mode, saved per device |
| **Q&A review cards** | Auto-generates flashcards from headings/lists/summaries, or reads explicit `Q: … A: …` lines; flip-card review sessions with got-it / again ratings |
| **Reading comfort** | 3 themes (paper / sepia / night), serif / sans fonts, font-size slider, progress bar |
| **Bookshelf** | Every imported PDF is stored on-device (IndexedDB); reopen any past book from the home screen — no re-uploading |
| **Exact resume** | Reopens at the exact viewport spot, not just the chapter |
| **Live progress** | Per-chapter "% read · minutes left" that adapts to your measured reading speed |

## Project structure

```
foliant/
├── index.html            Shell page: markup only, loads styles + scripts in order
├── manifest.webmanifest  PWA manifest (installable, offline)
├── sw.js                 Service worker: offline-first app-shell cache (v4)
├── styles/               CSS split by UI concern
│   ├── base.css          Theme tokens (paper/sepia/night), resets
│   ├── home.css          Landing screen + drop zone
│   ├── reader.css        Top bar, progress, book column, focus mode, nav
│   ├── content.css       Rendered blocks: TOC, lists, callouts, code, figures
│   ├── cards.css         In-page Q&A cards + review overlay
│   ├── library.css       Home-screen bookshelf cards
│   ├── highlights.css    Selection toolbar, marks, notes
│   ├── search.css        Search sheet + jump pulse
│   ├── nav.css           Bottom navigation bar + its customize editor
│   └── sheets.css        Bottom sheets + veil
├── js/                   ES modules-in-spirit: plain scripts sharing globals
│   ├── config.js         pdf.js worker setup, shared state (loaded first)
│   ├── utils.js          String helpers, settings, hashing
│   ├── parse.js          PDF → raw text lines + image boxes (pdf.js)
│   ├── structure.js      Lines → blocks → chapters (the "brain")
│   ├── render.js         Chapter → HTML
│   ├── cards.js          Flashcard detection & generation
│   ├── library.js        IndexedDB bookshelf: store, list, reopen, remove books
│   ├── search.js         Whole-book search + jump-to-result
│   ├── highlights.js     Selection, marks, notes, Markdown export
│   ├── review.js         Flip-card review sessions
│   ├── figures.js        Canvas figure rendering
│   ├── ui.js             Sheets, settings, book click handling
│   ├── nav.js            Customizable bottom nav bar (loaded after ui.js)
│   └── main.js           File open flow (loaded last)
├── vendor/pdfjs/         pdf.js 3.11 vendored locally — no network needed
├── icons/                PWA + Android launcher icons (generated)
├── android/              Capacitor 6 native Android project
├── tools/                Dev utilities (not shipped)
│   ├── make_sample_pdf.js  Generates sample.pdf — a 4-chapter test book
│   ├── make_icons.js     Draws the PWA/Android icon set (zero dependencies)
│   ├── copy-www.js       Assembles the deployable bundle into www/
│   └── serve.js          Zero-dependency static server (port 8137)
├── .github/workflows/    CI: pages.yml (web) + android.yml (signed AAB)
└── docs/
    ├── ARCHITECTURE.md   How the parsing pipeline works, in depth
    └── PUBLISHING.md     GitHub Pages + Play Store guide
```

## Running it

```bash
npm install                # only needed for the Android/PWA tooling
npm run serve              # http://localhost:8137 (zero-dependency server)
```

Or open `index.html` directly from disk — pdf.js is vendored locally, so
`file://` works with no server at all. Then drop any text-based PDF onto the
page. (Scanned PDFs need OCR first — Foliant reads text, not pictures of text.)

## Deploying

| Target | How |
|---|---|
| **Web (GitHub Pages)** | Automatic via `.github/workflows/pages.yml`; enable Pages → Source: GitHub Actions. Installable PWA, works offline after first load. |
| **Android (Play Store)** | `.github/workflows/android.yml` builds a signed AAB on every push; for keystore setup and the Play Console checklist. Local device testing: `npm run cap:sync` then open `android/` in Android Studio. |

## Data & privacy

- The PDF is parsed **in your browser** via pdf.js; nothing is uploaded.
- Per-book data lives in `localStorage`:

| Key | Contents |
|---|---|
| `foliant-s` | Global settings (theme, font, size, card toggles, bottom-bar layout) |
| `foliant-pos-<file>` | Last chapter read (legacy bookmark) |
| `foliant-spot-<file>` | Exact spot: `{chapter, y-offset, fraction}` |
| `foliant-wpm` | Your measured reading speed (drives "minutes left") |
| `foliant-h-<file>` | Highlights + notes |
| `foliant-r-<file>` | Flashcard ratings |

PDF bytes + shelf metadata live in **IndexedDB** (database `foliant`, stores
`meta` and `data`) — that's what makes the shelf work offline and instantly.

Clearing site data resets everything.

## Browser support

Uses modern CSS (`color-mix`, `env()`, `:has`-free selectors) and JS (optional
chaining, Unicode property escapes). Works in current Chrome, Edge, Firefox and
Safari, on desktop and mobile.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full technical story —
the parsing heuristics, the block model, and how flashcards are generated.
