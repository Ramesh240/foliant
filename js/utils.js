/* ============================================================
   utils.js — small pure helpers used across modules
   ============================================================ */

'use strict';

/* Normalize a string for fuzzy title matching: lowercase, strip non-letters. */
const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/* Title-case ALL-CAPS strings imported from PDFs that shout their headings.
   "THE THEORY OF RELATIVITY" -> "The Theory of Relativity" */
const nice = t => /[a-z\u00DF-\u00FF]/.test(t) || t.length < 4
  ? t
  : t.toLowerCase()
      .replace(/(^|[\s(“"—:-])([a-z])/g, (m, a, c) => a + c.toUpperCase())
      .replace(/\b(Of|The|And|A|An|In|On|To|For|At|By|Or|Vs)\b/g, (m, w, i) => i > 0 ? w.toLowerCase() : m)
      .replace(/^[ivxlc]+\./i, m => m.toUpperCase());

/* Escape &, <, > for safe HTML interpolation. */
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* Apply settings to the DOM (theme, font, size) and persist them. */
function applyS() {
  root.dataset.theme = S.t;
  root.dataset.font = S.f;
  root.style.setProperty('--fs', S.fs + 'px');
  $('#fs').value = S.fs;
  $('#bQa').textContent = 'Q&A cards: ' + (S.qa ? 'on' : 'off');
  document.querySelectorAll('#thm button').forEach(b => b.classList.toggle('sel', b.dataset.t === S.t));
  document.querySelectorAll('#fnt button').forEach(b => b.classList.toggle('sel', b.dataset.f === S.f));
  try { localStorage.setItem('foliant-s', JSON.stringify(S)); } catch (e) {}
}
applyS();

/* First usable sentence(s) of a paragraph — answer snippet for auto cards. */
function lead(t, n = 2, max = 380) {
  const m = t.match(/[^.!?]+[.!?]+["”’)]*(\s|$)/g) || [t];
  let o = '';
  for (const x of m.slice(0, n)) { if ((o + x).length > max && o) break; o += x; }
  o = o.trim();
  return o.length > max ? o.slice(0, max).replace(/\s+\S*$/, '') + '…' : o;
}

/* Deterministic djb2 hash -> base36 id, so card ratings survive reloads. */
const hq = t => { let h = 5381; for (const c of t) h = (h * 33 ^ c.charCodeAt(0)) >>> 0; return h.toString(36); };

/* ---------- Reading-time estimation ---------- */

/* Total words in the current book (used for shelf metadata). */
function totalWords() {
  return chapters.reduce((n, c) => n + c.b.reduce((m, b) => m + (b.t || '').split(/\s+/).length, 0), 0);
}

/* Reading speed learned from this browser (default 220 wpm), damped toward
   its prior so a single fast minute doesn't claim 900 wpm. */
function readWpm() {
  try {
    const r = JSON.parse(localStorage.getItem('foliant-wpm') || 'null');
    if (r && r.wpm > 80 && r.wpm < 1200) return Math.round((r.wpm + 220) / 2);
  } catch (e) {}
  return 220;
}
/* Feed one reading interval (ms spent, words scrolled past). */
function readTick(ms, words) {
  if (ms < 4000 || words < 20) return;
  try {
    const r = JSON.parse(localStorage.getItem('foliant-wpm') || 'null') || { wpm: 220 };
    const inst = words / (ms / 60000);
    if (inst > 80 && inst < 1200) r.wpm = Math.round((r.wpm * 2 + inst) / 3);   // damp outliers
    localStorage.setItem('foliant-wpm', JSON.stringify(r));
  } catch (e) {}
}

/* Words remaining in chapter ci after scrolling fraction f of it. */
function wordsLeft(ci, f) {
  const b = chapters[ci].b;
  const total = b.reduce((n, x) => n + (x.t || '').split(/\s+/).length, 0);
  const seen = Math.min(1, Math.max(0, f)) * total;
  let acc = 0, i = 0;
  for (; i < b.length && acc < seen; i++) acc += (b[i].t || '').split(/\s+/).length;
  /* Words of the block containing the viewport top + everything after it. */
  let left = 0;
  for (let j = Math.max(0, i - 1); j < b.length; j++) left += (b[j].t || '').split(/\s+/).length;
  return Math.max(0, left - (acc - seen > 0 ? 0 : 0));
}

/* Seconds of reading time left in the current chapter at fraction f. */
function chapterSecondsLeft(ci, f) {
  return Math.round(wordsLeft(ci, f) / readWpm() * 60);
}

/* "4 min" / "45 sec" / "done". */
function fmtMin(s) {
  if (s <= 5) return 'done';
  if (s < 90) return Math.round(s / 15) * 15 + ' sec';
  return Math.ceil(s / 60) + ' min';
}
