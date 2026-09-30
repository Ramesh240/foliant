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
