/* ============================================================
   figures.js — draw real figure crops from the PDF onto canvases
   Each <figure data-pg data-box> from render.js is filled by rasterizing
   its page once (cached per page+scale in PC), cropping the box to an
   offscreen canvas, and inserting it as a JPEG data URL. Results are
   memoized in FC. figTok guards against stale renders when the user
   flips chapters while figures are still loading.
   ============================================================ */

'use strict';

const FC = {};       // "pg:box" -> dataURL cache
let PC = null;       // last rendered page canvas {pg, sc, cv, vp}
let figTok = 0;      // generation token; bumped on every loadFigs()

async function figURL(pg, box) {
  const k = pg + ':' + box;
  if (FC[k]) return FC[k];
  const page = await PDFDOC.getPage(pg),
        sc = Math.min(3, Math.max(1.5, 1100 / (box[2] - box[0])));
  if (!PC || PC.pg !== pg || PC.sc < sc - .01) {
    const vp = page.getViewport({ scale: sc }), cv = document.createElement('canvas');
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: cx, viewport: vp }).promise;
    PC = { pg, sc, cv, vp };
  }
  /* Crop the box (PDF space -> viewport space) with a 2px bleed. */
  const r = PC.vp.convertToViewportRectangle(box),
        x = Math.max(0, Math.floor(Math.min(r[0], r[2]) - 2)),
        y = Math.max(0, Math.floor(Math.min(r[1], r[3]) - 2)),
        w = Math.min(PC.cv.width - x, Math.ceil(Math.abs(r[2] - r[0]) + 4)),
        h = Math.min(PC.cv.height - y, Math.ceil(Math.abs(r[3] - r[1]) + 4));
  const o = document.createElement('canvas');
  o.width = w; o.height = h;
  o.getContext('2d').drawImage(PC.cv, x, y, w, h, 0, 0, w, h);
  return FC[k] = o.toDataURL('image/jpeg', .88);
}

async function loadFigs() {
  const t = ++figTok;
  for (const f of document.querySelectorAll('#book figure[data-pg]')) {
    if (t !== figTok) return;   // a newer render started; abort
    try {
      const u = await figURL(+f.dataset.pg, f.dataset.box.split(',').map(Number));
      if (t !== figTok) return;
      const im = new Image();
      im.alt = 'Figure from the PDF'; im.src = u;
      const fi = f.querySelector('.fi');
      fi.innerHTML = ''; fi.appendChild(im);
    } catch (e) {
      const ph = f.querySelector('.ph');
      if (ph) ph.textContent = 'This figure could not be drawn';
    }
  }
}
