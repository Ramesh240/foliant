/* ============================================================
   parse.js — PDF -> raw lines ("rows") via pdf.js
   Input : ArrayBuffer of a PDF file
   Output: L = [{ t: text, h: height, x, y, code, dc, pg }] plus
           inline image placeholders { img:1, pg, box:[x0,y0,x1,y1] }
   A "row" is one visual line of text on a page, reconstructed from
   pdf.js text items by grouping items that share a baseline.
   ============================================================ */

'use strict';

let PDFDOC = null;   // the open pdf.js document, reused by figures.js

/* 6-element affine matrix multiply (a * b) — used to track the CTM while
   walking the page's operator list so image draws get real page coordinates. */
const mm = (a, b) => [
  a[0]*b[0] + a[1]*b[2],       a[0]*b[1] + a[1]*b[3],
  a[2]*b[0] + a[3]*b[2],       a[2]*b[1] + a[3]*b[3],
  a[4]*b[0] + a[5]*b[2] + b[4], a[4]*b[1] + a[5]*b[3] + b[5]
];

/* Find bounding boxes of raster images drawn on a page.
   Walks the operator list, composing transforms through save/restore and
   form XObjects, and records each paintImageXObject* call's unit square
   mapped through the CTM. Nearby boxes are unioned (4px tolerance), then
   small/decorative images (rules, logos, page furniture near the margins)
   are filtered out. Returns boxes in PDF viewport coordinates. */
async function imgBoxes(pg) {
  const ol = await pg.getOperatorList(), O = pdfjsLib.OPS,
        [vx0, vy0, vx1, vy1] = pg.view, PW = vx1 - vx0, PH = vy1 - vy0, st = [];
  let ctm = [1, 0, 0, 1, 0, 0], out = [];
  for (let i = 0; i < ol.fnArray.length; i++) {
    const f = ol.fnArray[i], a = ol.argsArray[i];
    if (f === O.save || f === O.beginGroup) st.push(ctm);
    else if (f === O.restore || f === O.endGroup) { if (st.length) ctm = st.pop(); }
    else if (f === O.transform) ctm = mm(a, ctm);
    else if (f === O.paintFormXObjectBegin) { st.push(ctm); if (a && a[0]) ctm = mm(a[0], ctm); }
    else if (f === O.paintFormXObjectEnd) { if (st.length) ctm = st.pop(); }
    else if (f === O.paintImageXObject || f === O.paintInlineImageXObject ||
             f === O.paintJpegXObject || f === O.paintImageXObjectRepeat) {
      const P = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) =>
        [x*ctm[0] + y*ctm[2] + ctm[4], x*ctm[1] + y*ctm[3] + ctm[5]]);
      out.push([Math.min(...P.map(q => q[0])), Math.min(...P.map(q => q[1])),
                Math.max(...P.map(q => q[0])), Math.max(...P.map(q => q[1]))]);
    }
  }
  /* Union overlapping/nearby boxes (repeat until stable). */
  for (let ch = true; ch; ) {
    ch = false;
    for (let i = 0; i < out.length && !ch; i++) for (let j = i + 1; j < out.length && !ch; j++) {
      const a = out[i], b = out[j];
      if (a[0] <= b[2]+4 && b[0] <= a[2]+4 && a[1] <= b[3]+4 && b[1] <= a[3]+4) {
        out[i] = [Math.min(a[0],b[0]), Math.min(a[1],b[1]), Math.max(a[2],b[2]), Math.max(a[3],b[3])];
        out.splice(j, 1); ch = true;
      }
    }
  }
  /* Drop tiny/decorative images and anything hugging the top/bottom margins. */
  return out
    .filter(b => {
      const w = b[2]-b[0], h = b[3]-b[1], cy = (b[1]+b[3])/2;
      return w > 60 && h > 40 && w*h < PW*PH*.8 && cy > vy0 + PH*.06 && cy < vy1 - PH*.06;
    })
    .map(b => [Math.max(vx0,b[0]), Math.max(vy0,b[1]), Math.min(vx1,b[2]), Math.min(vy1,b[3])]
      .map(v => Math.round(v*10)/10));
}

/* Extract every meaningful line of the PDF, page by page.
   - Dominant font height on a page = base size `pb`; tokens rendered ~1.35x
     larger that are 1–2 chars wide are drop caps — kept aside and re-attached
     to the following body row (dc = "drop cap").
   - Rows sharing a baseline (|Δy| < 2.5) are merged, sorted by x, and gaps
     wider than 22% of the row height become spaces.
   - Rows whose glyphs are mostly monospace become `code: true`.
   - Bare page numbers are dropped; images are interleaved by y position. */
async function parse(buf) {
  const pdf = await pdfjsLib.getDocument({ data: buf, verbosity: 0 }).promise, L = [];
  PDFDOC = pdf;
  const H = it => Math.round(it.height || Math.abs(it.transform[3]));

  for (let p = 1; p <= pdf.numPages; p++) {
    $('#msg').textContent = `Reading page ${p} of ${pdf.numPages}…`;
    if (p % 4 === 0) await new Promise(r => setTimeout(r));   // yield to the UI

    const pg = await pdf.getPage(p), tc = await pg.getTextContent(), rows = [];
    const all = tc.items.filter(it => it.str), items = all.filter(it => it.str.trim());

    /* Per-page base font size = the height carrying the most characters. */
    const hs = {};
    items.forEach(it => { if (it.str.trim().length > 2) hs[H(it)] = (hs[H(it)] || 0) + it.str.length; });
    const pb = +Object.keys(hs).sort((a, b) => hs[b] - hs[a])[0] || 10;

    /* Drop-cap candidates: single glyphs rendered much larger than body text. */
    const bigTok = it => it.str.trim().length <= 2 &&
      /^["“‘(]?[A-Za-z\u00C0-\u024F]$/.test(it.str.trim()) && H(it) >= pb*1.35 && H(it) <= pb*6;
    const caps = items.filter(bigTok);

    /* Merge text items into visual rows by baseline. */
    const addRow = it => {
      const y = it.transform[5];
      let r = rows.find(r => Math.abs(r.y - y) < 2.5);
      if (!r) { r = { y, parts: [], h: 0, mono: 0, n: 0, x: 1e9 }; rows.push(r); }
      r.parts.push(it);
      if (bigTok(it)) r.bigh = Math.max(r.bigh || 0, H(it)); else r.h = Math.max(r.h, H(it));
      r.x = Math.min(r.x, it.transform[4]); r.n++;
      if (/mono|courier|consol|code/i.test((tc.styles[it.fontName] || {}).fontFamily + it.fontName)) r.mono++;
      return r;
    };
    items.filter(it => !caps.includes(it)).forEach(addRow);
    /* Whitespace-only items still carry spacing info — merge them too. */
    all.filter(it => !it.str.trim()).forEach(it => {
      const r = rows.find(r => Math.abs(r.y - it.transform[5]) < 2.5);
      if (r) r.parts.push(it);
    });

    /* Re-attach each drop cap to the body row it belongs to (its baseline sits
       lower; find the nearest row starting to the right of the cap). */
    for (const c of caps) {
      const cy = c.transform[5], cx = c.transform[4], cw = c.width || H(c)*.5;
      const cand = rows.filter(r => r.y <= cy + pb*3.4 && r.y >= cy - 3 &&
        r.x > cx + cw*.3 && r.h > 0 && r.h <= pb*1.3).sort((a, b) => b.y - a.y);
      if (cand[0]) { c._dc = 1; cand[0].parts.push(c); cand[0].dc = 1; } else addRow(c);
    }

    rows.sort((a, b) => b.y - a.y);   // top-to-bottom

    /* Emit rows as flat lines; word gaps > 22% of height become a space.
       Pure page numbers are discarded. */
    const start = L.length;
    rows.forEach(r => {
      if (!r.h) r.h = r.bigh || 0;
      r.parts.sort((a, b) => a.transform[4] - b.transform[4]);
      let t = '', pe = null, pd = false;
      for (const i of r.parts) {
        if (pe !== null && !pd && i.transform[4] - pe > r.h*.22) t += ' ';
        t += i.str; pe = i.transform[4] + i.width; pd = !!i._dc;
      }
      r.code = r.mono > r.n/2;
      r.t = r.code
        ? r.parts.map(i => i.str).join('').replace(/\s+$/, '')
        : t.replace(/\s+/g, ' ').trim();
      if (!r.t || /^\d{1,4}$/.test(r.t)) return;
      L.push({ t: r.t, h: r.h, x: r.x, y: r.y, code: r.code, dc: !!r.dc, pg: p });
    });

    /* Merge image boxes into the page's lines, re-sorted by y. */
    let bx = [];
    try { bx = await imgBoxes(pg); } catch (e) {}
    if (bx.length) {
      const seg = L.splice(start).concat(bx.map(b =>
        ({ img: 1, t: '', h: 0, x: b[0], y: b[3], code: false, dc: false, pg: p, box: b })))
        .sort((a, b) => b.y - a.y);
      L.push(...seg);
    }
  }

  /* Header/footer logos repeat identically on many pages — count rounded boxes
     and drop images appearing 4+ times in books of 12+ pages. */
  const key = l => l.box.map(v => Math.round(v/4)).join(), rc = {};
  L.forEach(l => { if (l.img) rc[key(l)] = (rc[key(l)] || 0) + 1; });
  return L.filter(l => !l.img || pdf.numPages < 12 || rc[key(l)] < 4);
}
