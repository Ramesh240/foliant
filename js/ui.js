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
function closeSheets() { ['#sToc', '#sSet', '#sHl', '#sNote', '#sSearch', '#sNav', '#sIap', '#veil'].forEach(s => $(s).classList.add('hide')); }

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
$('#bQa').onclick = () => { S.qa = !S.qa; applyS(); const y = scrollY; render(); scrollTo(0, y); };
$('#bNav').onclick = () => openNavSheet();
$('#bPrem').onclick = () => iapUnlockSheet();   // no arg -> full Premium pitch
