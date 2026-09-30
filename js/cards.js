/* ============================================================
   cards.js — flashcard generation from the parsed document
   Three card sources, in priority order per block position:
     1. qaAt    — explicit "Q: … A: …" lines, or a heading ending in "?"
                  whose next block is the answer.
     2. autoAt  — auto cards: a "Summary/Takeaway" section becomes "recall
                  key points"; a heading followed by a list or a long
                  paragraph becomes a recall question.
     3. structCard — at most one per chapter: "what are the main sections?".
   Card ids are content hashes (hq) prefixed with the chapter index, so
   ratings survive reloads but not re-parses of a changed file.
   ============================================================ */

'use strict';

/* Explicit Q/A. Returns {q, a, used, id} or null; `used` = extra blocks the
   card consumed (the answer block, or the run of list items). */
function qaAt(ch, i, ci) {
  const b = ch.b[i];
  if (!b || !(b.k === 'p' || b.k === 'h2' || b.k === 'h3')) return null;
  let q = null, a = null, used = 0;

  const m = b.k === 'p' &&
    b.t.match(/^Q(?:uestion)?\s*\d*\s*[:.\-]\s*(.+?)\s+A(?:nswer)?\s*[:.\-]\s*(.+)$/i);
  if (m) { q = m[1]; a = `<p>${esc(m[2])}</p>`; }
  else if ((b.k === 'h2' || b.k === 'h3') && b.t.length < 180 && /\?\s*$/.test(b.t)) {
    const n = ch.b[i+1];
    if (n && n.k === 'p') { a = `<p>${esc(n.t)}</p>`; used = 1; }
    else if (n && n.k === 'li') {
      let j = i+1, l = '';
      while (ch.b[j] && ch.b[j].k === 'li') { l += `<li>${esc(ch.b[j].t)}</li>`; j++; }
      a = `<ul>${l}</ul>`; used = j - i - 1;
    }
    if (a) q = b.t;
  }
  return a ? { q, a, used, id: ci + ':' + hq(q) } : null;
}

/* Auto-generated card at block i (headings only). */
function autoAt(ch, i, ci) {
  const b = ch.b[i];
  if (!b || !(b.k === 'h2' || b.k === 'h3')) return null;
  const t = b.t.trim();
  if (t.length < 4 || t.length > 120 || /^[—–-]/.test(t) || /\?\s*$/.test(t) ||
      /^fig/i.test(t) || (t.match(/\d/g) || []).length >= 3) return null;
  const n = ch.b[i+1];
  if (!n) return null;
  const T = nice(t.replace(/^([A-Za-z]|\d+)[.)]\s+/, ''));
  let q, a;

  /* "Summary / Takeaways / Recap" + short paragraphs -> recall-all card. */
  if (/summary|takeaway|recap/i.test(t)) {
    let j = i+1, l = '', c = 0;
    while (ch.b[j] && ch.b[j].k === 'p' && ch.b[j].t.length < 400 && c < 10) {
      l += `<li>${esc(ch.b[j].t)}</li>`; j++; c++;
    }
    if (c >= 2) return {
      q: `Recall the key points of “${nice(ch.title)}”`, a: `<ul>${l}</ul>`,
      used: 0, id: 'a' + ci + ':' + hq('sum' + ch.title), auto: 1
    };
  }
  if (n.k === 'li') {
    let j = i+1, l = '';
    while (ch.b[j] && ch.b[j].k === 'li') { l += `<li>${esc(ch.b[j].t)}</li>`; j++; }
    if (j - i - 1 < 2) return null;
    q = /summary|takeaway|recap/i.test(t)
      ? `Recall the key points of “${nice(ch.title)}”`
      : `Recall the points under “${T}”`;
    a = `<ul>${l}</ul>`;
  }
  else if (n.k === 'p' && n.t.length >= 80) {
    q = `What does the book say about “${T}”?`;
    a = `<p>${esc(lead(n.t))}</p>`;
  }
  else return null;
  return { q, a, used: 0, id: 'a' + ci + ':' + hq(q), auto: 1 };
}

/* Chapter-structure card: 3–12 clean sub-headings -> "main sections" quiz. */
function structCard(ch, ci) {
  const hs = ch.b.filter(b => b.k === 'h3' || b.k === 'h2').map(b => b.t.trim())
    .filter(t => t.length > 3 && t.length < 90 && !/^[—–-]/.test(t) &&
      !/\?\s*$/.test(t) && !/^fig/i.test(t) && !/summary|takeaway|recap/i.test(t));
  if (hs.length < 3 || hs.length > 12) return null;
  const q = `What are the main sections of “${nice(ch.title)}”?`;
  return { q, a: `<ul>${hs.map(h => `<li>${esc(nice(h))}</li>`).join('')}</ul>`,
    used: 0, id: 'a' + ci + ':' + hq(q), auto: 1 };
}

/* All cards for chapter ci; skips boilerplate chapters and everything before
   (and including) an embedded table of contents. */
function cardsOfCh(ch, ci) {
  const out = [];
  if (/^(contents|index|notes|acknowledg|selected bibliography|about the author|copyright|beginning)/i.test(ch.title.trim())) return out;
  const ti = chapters.findIndex(c => c.b.some(b => b.k === 'toc'));
  if (ti >= 0 && ci <= ti) return out;
  if (S.auto) { const s = structCard(ch, ci); if (s) out.push({ ...s, title: ch.title }); }
  for (let i = 0; i < ch.b.length; i++) {
    const r = qaAt(ch, i, ci) || (S.auto ? autoAt(ch, i, ci) : null);
    if (r) { out.push({ ...r, title: ch.title }); i += r.used; }
  }
  return out;
}

function allCards() { return chapters.flatMap((ch, ci) => cardsOfCh(ch, ci)); }
