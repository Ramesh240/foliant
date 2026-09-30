/* ============================================================
   search.js — whole-book search with jump-to-result
   Searches every text block of every chapter (case-insensitive,
   diacritic-insensitive). Results are grouped by chapter with a
   context snippet; tapping a row navigates to the block and
   flashes the first match inside it.
   Exposes: runSearch(q) -> results, openSearch(), srs state.
   Depends on: chapters, cur, go(), esc(), openSheet/closeSheets (ui.js)
   ============================================================ */

'use strict';

/* Lowercase + strip diacritics so "resume" finds "résumé". */
const fold = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/* Search all chapters. Returns [{ci, bi, chTitle, snippet, count}] where
   snippet is HTML with <mark> around folded-case matches. Sorted in book
   order; capped so pathological queries can't hang the sheet. */
function runSearch(q) {
  const needle = fold(q.trim());
  if (needle.length < 2) return [];
  const out = [];
  const MAX = 200;
  for (let ci = 0; ci < chapters.length && out.length < MAX; ci++) {
    const ch = chapters[ci];
    for (let bi = 0; bi < ch.b.length && out.length < MAX; bi++) {
      const b = ch.b[bi];
      /* Text-bearing block kinds only; skip figures/TOC machinery. */
      if (!b || !b.t || (b.k !== 'p' && b.k !== 'li' && b.k !== 'h1' && b.k !== 'h2' && b.k !== 'h3' && b.k !== 'code' && b.k !== 'toc')) continue;
      const hay = fold(b.t);
      let idx = hay.indexOf(needle), count = 0;
      if (idx < 0) continue;
      while (idx >= 0) { count++; idx = hay.indexOf(needle, idx + needle.length); }
      out.push({ ci, bi, chTitle: ch.title, count, snippet: snippet(b.t, q) });
    }
  }
  return out;
}

/* Build a ~110-char context window around the first match, with every
   visible match inside the window wrapped in <mark>. Marking uses the
   folded text for offsets and mirrors them onto the original string,
   which keeps accents intact in the snippet. */
function snippet(t, q) {
  const hay = fold(t), needle = fold(q.trim());
  const first = hay.indexOf(needle);
  if (first < 0) return esc(t.slice(0, 110)) + '…';
  const RAD = 48;
  let s = Math.max(0, first - RAD), e = Math.min(t.length, first + needle.length + RAD);
  /* Snap to word boundaries so snippets start and end cleanly. */
  while (s > 0 && !/\s/.test(t[s])) s--;
  while (e < t.length && !/\s/.test(t[e])) e++;
  /* Collect match ranges within [s, e). */
  const ranges = [];
  for (let i = hay.indexOf(needle, s); i >= 0 && i < e; i = hay.indexOf(needle, i + needle.length)) {
    ranges.push([i, i + needle.length]);
  }
  let o = (s > 0 ? '…' : ''), p = s;
  for (const [a, b2] of ranges) {
    o += esc(t.slice(p, a)) + '<mark>' + esc(t.slice(a, b2)) + '</mark>';
    p = b2;
  }
  return o + esc(t.slice(p, e)) + (e < t.length ? '…' : '');
}

/* Jump to a hit: switch chapter if needed, scroll the block into view,
   pulse it. html{scroll-behavior:smooth} both animates the jump (racing the
   scroll reset render() performs when the chapter changes) and, in some
   engines, is applied even to behavior:'instant' scrolls — so we force it
   off with an !important class, scroll, re-assert the position once, and
   restore. Result: the tapped block is exactly where we put it. */
function jumpToHit(ci, bi) {
  /* When the chapter changes, render() would reset scroll to top and fight
     our jump — tell it to leave the viewport alone this once. */
  const switching = ci !== cur;
  if (switching) { SKIP_RENDER_SCROLL = true; go(ci); SKIP_RENDER_SCROLL = false; }
  closeSheets();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.querySelector('#book [data-bi="' + bi + '"]');
    if (!el) return;
    void el.offsetTop;   // force layout before measuring/scrolling
    /* Center small blocks; tall ones align to their start so the reader
       enters them in reading order. */
    const block = el.offsetHeight > innerHeight * 0.8 ? 'start' : 'center';
    root.classList.add('jumping');
    el.scrollIntoView({ block });
    /* Re-assert once on the next frame in case another scroll landed late. */
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const visible = r.top >= 0 && r.bottom <= innerHeight;
      if (!visible) el.scrollIntoView({ block });
      root.classList.remove('jumping');
    });
    el.classList.add('hit');
    setTimeout(() => el.classList.remove('hit'), 1600);
  }));
}

/* ---------- Sheet rendering + wiring ---------- */

let srs = [], sT = 0;

function renderSearchResults() {
  const box = $('#sResults');
  if (!srs.length) {
    const q = $('#sq').value.trim();
    box.innerHTML = q.length < 2
      ? '<div class="scount">Type at least two letters.</div>'
      : '<div class="scount">No matches.</div>';
    return;
  }
  /* Group by chapter in book order. */
  const html = [];
  let lastCi = -1;
  for (const r of srs) {
    if (r.ci !== lastCi) {
      lastCi = r.ci;
      html.push('<div class="sgrp">' + esc(nice(chapters[r.ci].title)) + '</div>');
    }
    html.push('<div class="sr" data-ci="' + r.ci + '" data-bi="' + r.bi + '">' +
      '<span class="st">' + r.snippet + '</span></div>');
  }
  box.innerHTML = html.join('');
  $('#sSearch .scount').textContent =
    srs.length + (srs.length >= 200 ? '+ ' : '') + ' result' + (srs.length === 1 ? '' : 's');
}

function openSearch() {
  openSheet('#sSearch');
  setTimeout(() => { try { $('#sq').focus(); } catch (e) {} }, 60);
}

function onSearchInput() {
  clearTimeout(sT);
  sT = setTimeout(() => { srs = runSearch($('#sq').value); renderSearchResults(); }, 180);
}

$('#sq').addEventListener('input', onSearchInput);
$('#sq').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(sT); srs = runSearch($('#sq').value); renderSearchResults(); } });
$('#sResults').addEventListener('click', e => {
  const row = e.target.closest('.sr');
  if (row) jumpToHit(+row.dataset.ci, +row.dataset.bi);
});
$('#bSearch').onclick = openSearch;
