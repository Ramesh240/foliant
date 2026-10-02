/* ============================================================
   ui.js — chrome wiring: chapter navigation, sheets, settings,
   focus mode, and the delegated click handler for book content.
   ============================================================ */

'use strict';

/* ---------- Chapter navigation + progress ---------- */

function go(i) {
  if (i < 0 || i >= chapters.length) return;
  cur = i; hideBar(); render(); closeSheets();
}

/* Progress = (chapter index + fraction scrolled through it) / chapters.
   Also updates the meta line's "X% · Y min left" and throttles position saves. */
function progress() {
  const d = document.documentElement, m = d.scrollHeight - innerHeight;
  const f = m > 0 ? Math.min(1, scrollY / m) : 1;
  $('#prog i').style.width = ((cur + f) / chapters.length * 100) + '%';
  const el = $('#live');
  if (el && chapters.length) {
    const left = chapterSecondsLeft(cur, f);
    const pct = Math.round(((cur + f) / chapters.length) * 100);
    el.textContent = (pct >= 100 ? 'Chapter finished' : pct + '% · ' + fmtMin(left) + ' left in chapter');
  }
}
addEventListener('scroll', progress, { passive: true });

/* ---------- Clicks inside the rendered book ---------- */

$('#book').addEventListener('click', e => {
  /* Copy button on code blocks. */
  const pre = e.target.closest('pre button');
  if (pre) {
    try {
      navigator.clipboard.writeText(pre.nextSibling.textContent);
      pre.textContent = 'Copied';
      setTimeout(() => pre.textContent = 'Copy', 1200);
    } catch (_) {}
    return;
  }
  /* Figure -> lightbox. */
  const fim = e.target.closest('.fi img');
  if (fim) { $('#lb img').src = fim.src; $('#lb').classList.remove('hide'); return; }

  /* Embedded TOC entries that matched a chapter -> jump. */
  if (e.target.closest('.tl')) {
    const tl = e.target.closest('.tl li[data-c]');
    if (tl) go(+tl.dataset.c);
    return;
  }
  /* Tap a highlight -> toolbar in edit mode. */
  const mk = e.target.closest('mark.hm');
  if (mk) {
    const h = HLS.find(x => x.id === mk.dataset.h);
    if (h) { hAct = h.id; hPend = null; getSelection().removeAllRanges(); showBar('edit'); }
    return;
  }
  if (hAct) hideBar();

  /* Q&A cards: rate, or flip open. */
  const rb = e.target.closest('.rate button');
  if (rb) {
    const c = rb.closest('.qa');
    c.classList.remove('done', 'again'); c.classList.add(rb.dataset.r);
    c.classList.remove('open');
    R[c.dataset.id] = rb.dataset.r; saveR(); return;
  }
  const qa = e.target.closest('.qa');
  if (qa) { qa.classList.toggle('open'); return; }

  /* Otherwise: focus mode — highlight the tapped paragraph/list item. */
  if (String(getSelection()).length) return;
  const el = e.target.closest('p,li');
  if (!el) return;
  const was = el.classList.contains('on');
  document.querySelectorAll('#book .on').forEach(x => x.classList.remove('on'));
  if (!was) el.classList.add('on');
});

/* ---------- Bottom sheets ---------- */

function toc() {
  $('#sToc').innerHTML = '<h4>Chapters</h4>' + chapters.map((c, i) =>
    `<button data-i="${i}" class="${i === cur ? 'cur' : ''}">${esc(nice(c.title))}</button>`).join('');
}
function openSheet(s) {
  closeSheets(); hideBar();
  if (s === '#sToc') toc();
  if (s === '#sHl') hlList();
  $(s).classList.remove('hide');
  $('#veil').classList.remove('hide');
}
function closeSheets() { ['#sToc', '#sSet', '#sHl', '#sNote', '#sSearch', '#sNav', '#sIap', '#veil'].forEach(s => $(s).classList.add('hide')); const sm = $('#impSum'); if (sm) sm.remove(); }

$('#veil').onclick = closeSheets;
$('#lb').onclick = () => $('#lb').classList.add('hide');
$('#bToc').onclick = () => openSheet('#sToc');
$('#bSet').onclick = () => openSheet('#sSet');
$('#sToc').onclick = e => { const b = e.target.closest('button'); if (b) go(+b.dataset.i); };

/* ---------- Reading position: exact resume ---------- */

/* Viewport position as a 0..1 fraction of the chapter's scrollable range. */
function posFraction() {
  const m = document.documentElement.scrollHeight - innerHeight;
  return m > 0 ? Math.min(1, Math.max(0, scrollY / m)) : 0;
}

/* Persist the exact spot: DOM y-offset (fast, survives font-size changes),
   the fraction (fallback), plus chapter- and book-level progress. */
function savePos() {
  if (!chapters.length) return;
  const f = posFraction();
  try {
    localStorage.setItem('foliant-pos-' + name, cur);   // legacy key, kept in sync
    localStorage.setItem('foliant-spot-' + name, JSON.stringify({ ci: cur, y: Math.round(scrollY), f }));
  } catch (e) {}
  if (typeof shelfSaveMeta === 'function') shelfSaveMeta(cur);
}

/* Rebuild a saved viewport position after (re)render: DOM anchor first,
   fraction of the scrollable range as fallback. Double rAF + a figure-load
   re-apply because images change page height as they arrive. */
function restoreScroll(spot) {
  if (!spot) return;
  const apply = () => {
    const m = document.documentElement.scrollHeight - innerHeight;
    let y;
    if (typeof spot.y === 'number' && spot.y > 0) {
      y = Math.min(spot.y, Math.max(0, m));
      if (typeof spot.f === 'number' && Math.abs(spot.y - y) > 4) y = spot.f * m;   // layout shrank
    } else if (typeof spot.f === 'number') {
      y = spot.f * Math.max(0, m);
    } else return;
    root.classList.add('jumping');
    window.scrollTo(0, y);
    root.classList.remove('jumping');
  };
  requestAnimationFrame(() => requestAnimationFrame(apply));
  if (typeof loadFigs === 'function') {
    const t = ++figTok;   // piggyback on the figure token: re-apply after its last write
    const re = () => { if (t === figTok) apply(); };
    setTimeout(re, 400); setTimeout(re, 900);
  }
}

/* Save on scroll (debounced) and when the tab hides or the app backgrounds.
   NOTE: never save outside the reader — a save while #reader is hidden would
   record scrollY=0 and wipe the bookmark. */
let posT = 0;
addEventListener('scroll', () => {
  if (!chapters.length || document.querySelector('#reader').classList.contains('hide')) return;
  clearTimeout(posT);
  posT = setTimeout(savePos, 400);
}, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && chapters.length && !document.querySelector('#reader').classList.contains('hide')) savePos();
});
addEventListener('pagehide', () => {
  if (chapters.length && !document.querySelector('#reader').classList.contains('hide')) savePos();
});

/* Close the book and return to the picker (shelf refreshes via showHome).
   Position is already saved by the scroll handler; nothing here may write a
   new spot — the home screen's scrollY=0 must not clobber the bookmark. */
function showHome() {
  if (!chapters.length) return;   // nothing open
  $('#reader').classList.add('hide');
  $('#home').classList.remove('hide');
  $('#msg').textContent = '';
  window.scrollTo(0, 0);
  if (typeof shelfRender === 'function') shelfRender();
}
$('#bNew').onclick = showHome;

/* ---------- Settings sheet ---------- */

$('#fs').oninput = e => { S.fs = +e.target.value; applyS(); };
$('#thm').onclick = e => { const b = e.target.closest('button'); if (b) { S.t = b.dataset.t; applyS(); } };
$('#fnt').onclick = e => { const b = e.target.closest('button'); if (b) { S.f = b.dataset.f; applyS(); } };
/* Show/hide focus mode. Kept as a standalone function (not an inline
   onclick) so the nav bar's Focus slot can reuse it; js/nav.js wraps it
   to re-sync its own highlight. */
function toggleFocus(btn) {
  focus = !focus;
  $('#book').classList.toggle('focus', focus);
  const b = btn || $('#bFocus');
  if (b) b.textContent = 'Focus mode: ' + (focus ? 'on' : 'off');
}
$('#bFocus').onclick = e => toggleFocus(e.target);
$('#bch').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  S.chrome = b.dataset.c;
  S.chromePicked = true;   // explicit choice: beats the touch-device default
  applyS();
};
$('#bQa').onclick = () => { S.qa = !S.qa; applyS(); const y = scrollY; render(); scrollTo(0, y); };
$('#bNav').onclick = () => openNavSheet();
$('#bPrem').onclick = () => iapUnlockSheet();   // no arg -> full Premium pitch

/* ---------- Whole-session export / import (library.js) ----------
   One JSON file: shelf books (bytes included), parsed-model caches,
   highlights/notes/ratings and exact positions. Export optionally seals
   the file with a passphrase (AES-GCM — sessionSeal in library.js). */
$('#bExp').onclick = async () => {
  const btn = $('#bExp');
  try {
    btn.textContent = 'Packing…';
    const snap = await sessionExport();
    let env = snap;
    const pass = window.prompt('Optional: encrypt this file with a passphrase.\n\nLeave empty to export it unencrypted:');
    if (pass) {
      btn.textContent = 'Encrypting…';
      env = await sessionSeal(snap, pass);
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(env)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'foliant-session-' + stamp + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    btn.textContent = env.enc ? 'Exported ✓ (encrypted)' : 'Exported ✓';
  } catch (e) {
    btn.textContent = 'Export failed';
  }
  setTimeout(() => { btn.textContent = 'Export reading session'; }, 2200);
};
$('#bImp').onclick = () => $('#impFile').click();
/* Would this session file fit in the storage that's left? Estimates via
   navigator.storage (Chrome/Android); silently allows when unavailable. */
async function warnSessionStorage(need) {
  let free = null;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      if (typeof est.quota === 'number') free = Math.max(0, est.quota - (est.usage || 0));
    }
  } catch (e) {}
  if (free == null || need <= free) return true;
  const have = free >= 1048576 ? (free / 1048576).toFixed(0) + ' MB' : Math.max(1, Math.round(free / 1024)) + ' KB';
  return confirm('This session file needs about ' + (need / 1048576).toFixed(1) +
    ' MB but only about ' + have + ' of storage is left.\n\nImport anyway?');
}

/* 'Import complete' summary, prepended into the settings sheet (never
   replaces its controls); closeSheets removes it again. */
function showImportSummary(n, rows) {
  let d = $('#impSum');
  if (d) d.remove();
  d = document.createElement('div');
  d.id = 'impSum';
  d.innerHTML = '<h4>Import complete: ' + n + ' book' + (n === 1 ? '' : 's') + ' restored</h4>' +
    (rows || []).map(r => '<div class="improw"><b>' + esc(r.title) + '</b><span>' + esc(r.mb) +
      (r.chapters ? ' · ' + r.chapters + ' ch' : '') + '</span></div>').join('') +
    '<div class="row"><button id="impOk">Done</button></div>';
  /* openSheet first: it runs closeSheets, which would remove a summary
     inserted before it. */
  openSheet('#sSet');
  $('#sSet').insertBefore(d, $('#sSet').firstChild);
  $('#impOk').onclick = closeSheets;
}

$('#impFile').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';                       // allow re-picking the same file
  if (!f) return;
  const btn = $('#bImp');
  try {
    btn.textContent = 'Importing…';
    const env = JSON.parse(await f.text());
    if (!env || env.app !== 'foliant-session') throw new Error('Not a Foliant session file');
    let pass = null;
    if (env.enc) {
      pass = window.prompt('This session file is encrypted. Enter its passphrase:');
      if (pass === null) throw new Error('cancelled');        // user backed out
      if (!pass) throw new Error('Passphrase required');
    }
    /* Encrypted files: ciphertext b64 is exact (3/4 of its length); plain
       files: the picked file itself. Refusing saves a doomed write. */
    if (!await warnSessionStorage(env.enc ? env.ct.length * 3 / 4 : f.size)) throw new Error('cancelled');
    const snap = await sessionOpen(env, pass);
    const out = await sessionImport(snap);
    btn.textContent = 'Imported ✓';
    showImportSummary(out.restored.length, out.restored);
  } catch (err) {
    const m = (err && err.message) || '';
    btn.textContent =
      m === 'cancelled' ? 'Import cancelled' :
      /Not a Foliant/.test(m) ? 'Not a session file' :
      /Wrong passphrase/.test(m) ? 'Wrong passphrase' :
      /Passphrase required/.test(m) ? 'Passphrase required' : 'Import failed';
  }
  setTimeout(() => { btn.textContent = 'Import reading session'; }, 2600);
};

/* ---------- Touch gesture: swipe left / right to flip chapters ----------
   Horizontal intent locks the axis (vertical scrolling, pinch zoom and text
   selection are untouched — a live selection aborts the gesture). Code
   blocks keep their native horizontal scroll. A committed swipe (56px+)
   renders the neighbouring chapter with a short slide-in. */
(function () {
  if (!('PointerEvent' in window)) return;
  const book = $('#book');
  let x0 = 0, y0 = 0, axis = '', live = false;
  const abort = () => { live = false; book.style.transform = ''; };
  book.addEventListener('pointerdown', e => {
    live = false; axis = '';
    if (e.pointerType === 'mouse' || !e.isPrimary || e.button) return;
    if (chapters.length < 2 || String(getSelection()).length) return;
    if (e.target.closest('pre')) return;   // code blocks scroll horizontally
    x0 = e.clientX; y0 = e.clientY; live = true;
  });
  book.addEventListener('pointermove', e => {
    if (!live) return;
    if (String(getSelection()).length) { abort(); return; }   // selection started
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (!axis) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y';
    }
    if (axis === 'x') {
      e.preventDefault();
      book.style.transform = 'translateX(' + Math.max(-32, Math.min(32, dx * 0.18)) + 'px)';
    }
  });
  book.addEventListener('pointerup', e => {
    if (!live) return;
    live = false;
    const dx = e.clientX - x0;
    book.style.transform = '';
    if (axis !== 'x' || Math.abs(dx) < 56) return;
    const dir = dx < 0 ? 1 : -1;   // left = next chapter, right = previous
    if (dir > 0 ? cur < chapters.length - 1 : cur > 0) {
      book.classList.remove('flip-l', 'flip-r');
      void book.offsetWidth;       // restart the slide-in animation
      book.classList.add(dir > 0 ? 'flip-l' : 'flip-r');
      go(cur + dir);
    }
  });
  book.addEventListener('pointercancel', abort);
  book.addEventListener('animationend', () => book.classList.remove('flip-l', 'flip-r'));
})();
