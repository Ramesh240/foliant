/* ============================================================
   structure.js — raw lines -> blocks -> chapters
   Consumes the flat line list from parse.js and produces the
   document model the rest of the app reads:
     blocks B: [{k:'h1'|'h2'|'h3'|'p'|'li'|'code'|'toc'|'img', t, ...}]
     chapters: [{title, b: blocks}]
   ============================================================ */

'use strict';

function build(L) {
  /* ---- 1. Body-text size: the font height carrying the most characters. ---- */
  const cnt = {};
  L.forEach(l => { if (!l.code) cnt[l.h] = (cnt[l.h] || 0) + l.t.length; });
  const body = +Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || 10;

  /* Drop caps that parse.js could not attach (e.g. paragraph opened a chapter):
     glue a lone big glyph line to the next line. */
  L = L.slice();
  for (let i = 0; i < L.length-1; i++) {
    const l = L[i], n = L[i+1];
    if (l.t.length <= 2 && /^["“‘(]?[A-Za-z]$/.test(l.t) && l.h >= body*1.35 &&
        n.pg === l.pg && /^[a-z\u00DF-\u00FF]/.test(n.t)) {
      L[i+1] = { ...n, t: l.t + n.t, dc: true }; L.splice(i, 1); i--;
    }
  }

  /* Highest page number in the book, used to sanity-check bare page
     references in TOC entries (a trailing number larger than the page
     count is not a page). Without this, any TOC entry that ends in a
     number but has no dot leaders threw a ReferenceError and the whole
     open failed with "Could not read this PDF". */
  const maxPg = L.reduce((m, l) => Math.max(m, l.pg || 0), 0);

  /* ---- 2. Learn the page grid: line gap and left margin. ---- */
  const gp = {}, xs = {}, top1 = o => +Object.keys(o).sort((a, b) => o[b] - o[a])[0];
  L.forEach((l, i) => {
    const q = L[i-1];
    if (l.code || l.h !== body) return;
    xs[Math.round(l.x)] = (xs[Math.round(l.x)] || 0) + 1;
    if (q && q.pg === l.pg && q.h === body && !q.code) {
      const g = Math.round(q.y - l.y);
      if (g > 0 && g < 60) gp[g] = (gp[g] || 0) + 1;
    }
  });
  const lg = top1(gp) || body*1.3;      // modal line gap
  const mx = top1(xs) || 0;             // modal left x of body lines
  const pgap = lg*1.25;                 // gap that starts a new paragraph
  const B = [], gapBase = body*1.9;
  let prev = null, inToc = false, tocH = 0, tnote = false;

  const bullet   = /^([•●▪◦■\-–*]|\d{1,2}[.)])\s+/;
  const leader   = /^(.*?\S)\s*(?:\.{3,}|(?:[.·…]\s*){3,})\s*(\d{1,4}|[ivx]{1,4})$/i;
  const loose    = /^(.*?[^\s\d.])\s+(\d{1,4}|[ivx]{1,4})$/i;
  const nopg     = /(chapter|part|unit|section|lesson|module|day|week|step|level|phase|topic|book|volume|appendix|question|q)$/i;

  /* ---- 3. Classify each line, merging continuations into open blocks. ---- */
  for (let l of L) {
    let last = B[B.length-1];

    if (l.img) { B.push({ k:'img', t:'', pg:l.pg, box:l.box }); prev = null; continue; }
    if (l.code) {
      if (last && last.k === 'code') last.t += '\n' + l.t;
      else B.push({ k:'code', t:l.t });
      prev = l; continue;
    }
    /* A bare "1.2" after a paragraph = its step number (becomes p.step). */
    if (/^\d{1,2}\.\d{1,2}$/.test(l.t) && last && last.k === 'p' && !last.n) { last.n = l.t; prev = l; continue; }

    const gap = prev && prev.pg === l.pg ? prev.y - l.y : 0;
    const ind = l.x > mx+6 && l.x < mx+50 && prev && (prev.pg !== l.pg || prev.x < l.x-6);
    const isC = /^(table of )?contents?$/i.test(l.t.trim());
    const up  = !l.dc && l.t.length >= 8 && l.t.length <= 100 && /\s/.test(l.t) &&
                !/[a-z\u00DF-\u00FF]/.test(l.t) && /[A-Z]{2}/.test(l.t);
    const isH = isC || up || (l.h >= body*1.15 && l.t.length < 110 &&
                !/^[a-z\u00DF-\u00FF]/.test(l.t) &&
                !(l.t.length > 50 && /[.,;]$/.test(l.t)));
    const ld = !isH && l.t.match(leader);

    /* TOC page: dot-leader lines and lines that look like entries while we are
       inside an already-open "Contents" section. */
    if (ld || (inToc && !isC && (!isH || l.h < tocH*.97) && !l.dc &&
        !(isH && prev && prev.pg !== l.pg && l.h >= body*1.3 && !/^[IVXLC]+\.?$/.test(l.t)) &&
        (l.h < body*.9 || (l.t.length < 140 && !(l.t.length > 60 && /[.!?]$/.test(l.t)))))) {
      const m = ld || l.t.match(leader) ||
        (q => q && !nopg.test(q[1].trim()) && (isNaN(+q[2]) || +q[2] <= maxPg) ? q : null)(l.t.match(loose));
      const it = { t: (m ? m[1] : l.t).replace(/[.\s·…]+$/, ''), pg: m ? m[2] : '', x: l.x, d: '' };
      if (!(last && last.k === 'toc')) { last = { k:'toc', items:[], t:'' }; B.push(last); tnote = false; }
      const lp = last.items[last.items.length-1],
            num = /^(\d+|[IVXA-Z])[.)]\s/.test(l.t);
      /* Long lines after an entry are its description; indented lowercase lines
         continue the previous entry's title. */
      const note = lp && !m && !num &&
        ((l.t.includes('—') && l.t.length > 25) || l.t.length >= 85 ||
         (tnote && /[a-z]/.test(l.t) && l.h <= body));
      if (note) { lp.d += (lp.d ? ' ' : '') + l.t; tnote = true; }
      else if (lp && !lp.pg && !lp.d && /^[a-z\u00DF-\u00FF]/.test(l.t) && gap && gap < gapBase) {
        lp.t += ' ' + it.t; lp.pg = it.pg; tnote = false;
      }
      else if (lp && !lp.d && (/^[IVXLC]+\.$/.test(lp.t) || /:$/.test(lp.t))) {
        lp.t += ' ' + it.t; tnote = false;
      }
      else { last.items.push(it); tnote = false; }
      last.t += ' ' + it.t; prev = l; continue;
    }
    if (inToc && !isC) inToc = false;

    if (isH) {
      /* Size relative to body text decides the level; "Contents" opens TOC mode. */
      const k = l.h >= body*1.55 ? 'h1' : (l.h >= body*1.3 || isC) ? 'h2' : 'h3';
      if (isC) tocH = l.h < body*1.15 ? body*1.5 : l.h;
      if (!isC && last && last.k === k && last.h === l.h && last.pg === l.pg && gap < gapBase) {
        last.t += ' ' + l.t; last.y = l.y;
      } else B.push({ k, t: l.t, h: l.h, pg: l.pg, y: l.y });
      inToc = isC;
    }
    else if (bullet.test(l.t)) B.push({ k:'li', t:l.t.replace(bullet, '') });
    else if (last && last.k === 'li' && gap < gapBase && !/[.!?]$/.test(last.t)) last.t += ' ' + l.t;
    else if (last && last.k === 'p' && !l.dc && !ind && prev && Math.abs(l.h - prev.h) < 2 &&
             (gap < pgap || (prev.pg !== l.pg && !/[.!?:]$/.test(last.t)))) {
      /* Same paragraph continues: de-hyphenate across line breaks. */
      last.t = /[a-z]-$/.test(last.t) ? last.t.slice(0, -1) + l.t : last.t + ' ' + l.t;
    }
    else B.push({ k:'p', t:l.t, dc:l.dc });
    prev = l;
  }

  /* ---- 4. Pick the "chapter heading" level and group blocks under it. ---- */
  const nw  = b => (b.t || '').split(/\s+/).length,
        tw  = B.reduce((n, b) => n + nw(b), 0),
        ck  = k => B.filter(b => b.k === k).length;
  const lv  = ['h1', 'h2', 'h3'].filter(k => ck(k) >= 4);
  /* Prefer the coarsest heading level that gives reasonably sized chapters. */
  let top = tw < 1200 ? null
    : lv.find(k => tw/ck(k) <= 7000) || lv[lv.length-1] || (ck('h1') ? 'h1' : ck('h2') ? 'h2' : null);

  const C = []; let c = { title:'Beginning', b:[], run:0 };
  const sep = t => /^(the|a|an)$/i.test(t) ? ' ' : /^[IVXLC]+$/.test(t) ? '. '
    : /[.:]$/.test(t) ? ' ' : ': ';

  for (const b of B) {
    const hd = b.k === 'h1' || b.k === 'h2' || b.k === 'h3';
    if (top && hd && +b.k[1] <= +top[1]) {
      /* A heading following an empty chapter on the same page extends its title
         ("Chapter 3" + "The Theory" -> "Chapter 3: The Theory"). */
      if (c.run && !c.b.length && c.pg === b.pg) {
        c.title += (c.h === b.h && c.y - b.y < gapBase*1.6 ? ' ' : sep(c.title)) + b.t;
        c.h = b.h; c.y = b.y;
      } else {
        if (c.b.length || C.length || c.run) C.push(c);
        c = { title: b.t, b: [], run: 1, pg: b.pg, h: b.h, y: b.y };
      }
    }
    else if (hd && c.run && !c.b.length && c.run < 3) { c.title += sep(c.title) + b.t; c.run++; }
    else c.b.push(b);
  }
  C.push(c);

  /* ---- 5. Cleanup: drop the empty prologue; split huge chapterless books. ---- */
  const out = [];
  C.forEach(ch => {
    const w = ch.b.reduce((n, b) => n + b.t.split(/\s+/).length, 0);
    if (w < 1 && ch.title === 'Beginning') return;
    if (!top && w > 1600) {
      /* No headings anywhere: cut into ~1200-word parts so pages stay sane. */
      let cb = [], n = 0, i = 1;
      ch.b.forEach(b => {
        cb.push(b); n += b.t.split(/\s+/).length;
        if (n > 1200 && b.k === 'p') { out.push({ title:'Part ' + i++, b: cb }); cb = []; n = 0; }
      });
      if (cb.length) out.push({ title:'Part ' + i, b: cb });
    }
    else out.push(ch);
  });
  return out;
}
