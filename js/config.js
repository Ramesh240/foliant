/* ============================================================
   config.js — pdf.js worker wiring and shared mutable state
   Loaded first; every other file augments the globals declared here.
   Globals: chapters, cur, name, focus, S (settings), R (ratings)
   ============================================================ */

'use strict';

const $ = s => document.querySelector(s);
const root = document.documentElement;

/* Resolve the worker relative to the page so it works on http(s), file:// and
   inside the Capacitor Android shell (https://localhost). The blob bridge keeps
   file:// working, where a direct workerSrc from the same folder can be blocked. */
const WURL = new URL('vendor/pdfjs/pdf.worker.min.js', document.baseURI).href;
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    URL.createObjectURL(new Blob([`importScripts("${WURL}");`], { type: 'text/javascript' }));
} catch (e) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = WURL;
}

/* ---------- App state (module-scoped globals, deliberately plain) ---------- */

let chapters = [];      // [{title, b:[{k,t,...}]}] — the parsed book
let cur = 0;            // index of the chapter being read
let name = '';          // PDF file name; keys all per-book localStorage
let focus = false;      // focus mode toggle

/* Reading settings, persisted to localStorage under 'foliant-s'.
   chrome: which on-screen bars are visible in the reader —
   'bottom' | 'top' | 'both' (default 'bottom': the single-bar,
   thumb-reach reading layout on every device — the top bar's controls
   all live in the bottom nav, whose Library slot closes the book).
   Tapping a bar chip in Settings sets chromePicked, which pins the
   choice on every later load.
   sv: settings-shape version. v2 shipped night + bottom-only as the
   defaults; users whose saved settings still match the v1 defaults
   (never customized) are lifted to the new look exactly once. */
let S = { fs: 20, t: 'night', f: 'serif', qa: true, auto: true, chrome: 'bottom', sv: 2 };
try {
  const saved = JSON.parse(localStorage.getItem('foliant-s') || '{}');
  Object.assign(S, saved);
  /* applyS() has persisted the settings since first launch, so anyone who
     never opened Settings still carries the v1 defaults (paper + both
     bars) in storage — migrate them; explicit choices are kept. */
  if (!saved.sv) {
    if (saved.t === 'paper') S.t = 'night';
    if (!saved.chromePicked && saved.chrome === 'both') S.chrome = 'bottom';
  }
} catch (e) {}

/* Flashcard ratings { cardId: 'done' | 'again' }, per book: 'foliant-r-<name>'. */
let R = {};

/* Set to true around a render() whose scroll position the caller controls
   (e.g. search jumps) so render() skips its scroll-to-top reset. */
let SKIP_RENDER_SCROLL = false;

/* Subscription/IAP entitlement state (populated by js/iap.js; declared here
   so UI modules can consult it before the store answers). */
let IAP = { ready: false, premium: false, owned: {}, products: {} };
