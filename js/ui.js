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

/* Progress = (chapter index + fraction scrolled through it) / chapters. */
function progress() {
  const d = document.documentElement, m = d.scrollHeight - innerHeight;
  const f = m > 0 ? Math.min(1, scrollY / m) : 1;
  $('#prog i').style.width = ((cur + f) / chapters.length * 100) + '%';
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
function closeSheets() { ['#sToc', '#sSet', '#sHl', '#sNote', '#sSearch', '#veil'].forEach(s => $(s).classList.add('hide')); }

$('#veil').onclick = closeSheets;
$('#lb').onclick = () => $('#lb').classList.add('hide');
$('#bToc').onclick = () => openSheet('#sToc');
$('#bSet').onclick = () => openSheet('#sSet');
$('#sToc').onclick = e => { const b = e.target.closest('button'); if (b) go(+b.dataset.i); };

/* Close the book and return to the picker. */
$('#bNew').onclick = () => {
  $('#reader').classList.add('hide');
  $('#home').classList.remove('hide');
  $('#msg').textContent = '';
  window.scrollTo(0, 0);
};

/* ---------- Settings sheet ---------- */

$('#fs').oninput = e => { S.fs = +e.target.value; applyS(); };
$('#thm').onclick = e => { const b = e.target.closest('button'); if (b) { S.t = b.dataset.t; applyS(); } };
$('#fnt').onclick = e => { const b = e.target.closest('button'); if (b) { S.f = b.dataset.f; applyS(); } };
$('#bFocus').onclick = e => {
  focus = !focus;
  $('#book').classList.toggle('focus', focus);
  e.target.textContent = 'Focus mode: ' + (focus ? 'on' : 'off');
};
$('#bQa').onclick = () => { S.qa = !S.qa; applyS(); const y = scrollY; render(); scrollTo(0, y); };
