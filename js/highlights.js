/* ============================================================
   highlights.js — text selection -> colored highlights + notes
   A highlight = { id, c: chapter, b: block index, s: start, e: end,
                   col: 'y'|'g'|'p'|'b', note } stored per book under
   localStorage key 'foliant-h-<name>'.
   hl() re-renders block text with <mark> spans; offsets are plain-string
   indices into the block's `t`, so they survive re-render.
   Exposes: hl(), hideBar(), showBar() (used by ui.js), HLS
   ============================================================ */

'use strict';

let HLS = [];          // all highlights for the current book
let hAct = null;       // id of the highlight being edited (toolbar "edit" mode)
let hPend = null;      // pending selection {b, s, e} awaiting a color choice
let hT = 0;            // debounce timer for selectionchange
let nH = null;         // highlight currently open in the note editor

/* Highlights + notes live in IndexedDB ('user' store, key '<book>:h'); the
   legacy localStorage copy is read only while the store has no entry yet
   (userDataMigrate in js/library.js copies it over on first load). */
async function loadH() {
  HLS = [];
  const v = await userGet(name + ':h');
  if (Array.isArray(v)) { HLS = v; return; }
  try { HLS = JSON.parse(localStorage.getItem('foliant-h-' + name) || '[]'); } catch (e) { HLS = []; }
}
function saveH() { userPut(name + ':h', HLS); }

/* Render block text with <mark> spans for this block's highlights. */
function hl(t, ci, bi) {
  const rs = HLS.filter(x => x.c === ci && x.b === bi && x.s < x.e && x.e <= t.length).sort((a, b) => a.s - b.s);
  if (!rs.length) return esc(t);
  let o = '', p = 0;
  for (const r of rs) {
    if (r.s < p) continue;   // skip overlaps
    o += esc(t.slice(p, r.s)) +
      `<mark class="hm ${r.col}${r.note ? ' nt' : ''}" data-h="${r.id}">${esc(t.slice(r.s, r.e))}</mark>`;
    p = r.e;
  }
  return o + esc(t.slice(p));
}

/* Re-render one block after a highlight change. */
function refreshBlock(bi) {
  const el = $('#book [data-bi="' + bi + '"]');
  if (!el) return;
  const b = chapters[cur].b[bi];
  el.innerHTML = (b.n ? `<span class="nb">${esc(b.n)}</span>` : '') + hl(b.t, cur, bi);
}

/* Map the current DOM selection to {b, s, e} offsets within one block.
   Returns null when the selection is empty, spans blocks, or is < 2 chars. */
function selInfo() {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  /* Only paragraphs and list items are highlightable: they are the blocks
     render.js draws through hl(), and refreshBlock() re-renders them safely. */
  const blk = n => n && (n.nodeType === 3 ? n.parentElement : n).closest('#book p[data-bi], #book li[data-bi]');
  const a = blk(r.startContainer), z = blk(r.endContainer);
  if (!a) return null;
  const nb = (a.querySelector('.nb') || { textContent: '' }).textContent.length,
        t = chapters[cur].b[+a.dataset.bi].t;
  const off = (node, o) => {
    const q = document.createRange(); q.selectNodeContents(a); q.setEnd(node, o);
    return q.toString().length - nb;
  };
  let s = Math.max(0, off(r.startContainer, r.startOffset)),
      e = z === a ? off(r.endContainer, r.endOffset) : t.length;
  e = Math.min(e, t.length);
  while (s < e && /\s/.test(t[s])) s++;
  while (e > s && /\s/.test(t[e-1])) e--;
  return e - s >= 2 ? { b: +a.dataset.bi, s, e } : null;
}

function showBar(mode) {
  const b = $('#hbar');
  b.classList.remove('hide'); b.dataset.mode = mode;
  $('#hbar [data-a=del]').classList.toggle('hide', mode !== 'edit');
  $('#hbar .lb').textContent = mode === 'edit' ? 'Change' : 'Highlight';
}
function hideBar() { $('#hbar').classList.add('hide'); hAct = null; }

function onSel() {
  const i = selInfo();
  if (i) { hPend = i; hAct = null; showBar('new'); }
  else if (!hAct) $('#hbar').classList.add('hide');
}
document.addEventListener('selectionchange', () => { clearTimeout(hT); hT = setTimeout(onSel, 300); });

/* Create a highlight from the pending selection; merges with any overlapping
   highlights in the same block (their notes are concatenated). */
function addH(col) {
  const p = hPend;
  if (!p) return null;
  let s = p.s, e = p.e, note = '';
  HLS = HLS.filter(x => {
    if (x.c === cur && x.b === p.b && x.s <= e && x.e >= s) {
      s = Math.min(s, x.s); e = Math.max(e, x.e);
      if (x.note) note += (note ? ' ' : '') + x.note;
      return false;
    }
    return true;
  });
  const h = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), c: cur, b: p.b, s, e, col, note };
  HLS.push(h); saveH();
  getSelection().removeAllRanges(); hPend = null;
  refreshBlock(p.b);
  return h;
}

/* ---------- Highlight list sheet + Markdown export ---------- */

const hlText = h => { const b = chapters[h.c] && chapters[h.c].b[h.b]; return b ? b.t.slice(h.s, h.e) : ''; };
const hlSorted = () => HLS.filter(h => hlText(h)).sort((a, b) => a.c - b.c || a.b - b.b || a.s - b.s);

function hlMd() {
  let o = '# Highlights — ' + $('#title').textContent + '\n', c = -1;
  hlSorted().forEach(h => {
    if (h.c !== c) { c = h.c; o += '\n## ' + nice(chapters[c].title) + '\n'; }
    o += '\n> ' + hlText(h) + '\n' + (h.note ? '\nNote: ' + h.note + '\n' : '');
  });
  return o;
}

function hlList() {
  const L = hlSorted();
  $('#sHl').innerHTML = '<h4>Highlights &amp; notes</h4>' + (L.length
    ? '<div class="row"><button id="hCopy">Copy all as Markdown</button></div>' + L.map(h =>
      `<div class="hi" data-id="${h.id}"><i class="dot ${h.col}"></i><div>` +
      `<div class="hc">${esc(nice(chapters[h.c].title))}</div>` +
      `<div class="ht">${esc(hlText(h))}</div>` +
      `${h.note ? `<div class="hn">${esc(h.note)}</div>` : ''}</div></div>`).join('')
    : '<p style="color:var(--mute);font:17px/1.5 Newsreader,serif">Nothing yet. Select text while reading to highlight it. Tap a highlight to add a note.</p>');
}

function openNote(h) {
  nH = h;
  $('#hq').textContent = hlText(h);
  $('#nt').value = h.note || '';
  openSheet('#sNote');
  setTimeout(() => { try { $('#nt').focus(); } catch (e) {} }, 60);
}

/* ---------- Toolbar + note editor wiring ---------- */

$('#hbar').onmousedown = e => e.preventDefault();   // keep the selection alive
$('#hbar').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.col) {
    if (hAct) { const h = HLS.find(x => x.id === hAct); if (h) { h.col = b.dataset.col; saveH(); refreshBlock(h.b); } }
    else addH(b.dataset.col);
    hideBar(); return;
  }
  if (b.dataset.a === 'note') {
    const h = hAct ? HLS.find(x => x.id === hAct) : addH('y');
    hideBar(); if (h) openNote(h); return;
  }
  if (b.dataset.a === 'del') {
    const h = HLS.find(x => x.id === hAct);
    if (h) { HLS = HLS.filter(x => x !== h); saveH(); refreshBlock(h.b); }
    hideBar();
  }
};

$('#nSave').onclick = () => { if (nH) { nH.note = $('#nt').value.trim(); saveH(); refreshBlock(nH.b); } closeSheets(); };
$('#nCancel').onclick = () => closeSheets();
$('#bHl').onclick = () => openSheet('#sHl');

/* Highlight list: click "copy" exports Markdown; click a row jumps to the mark. */
$('#sHl').onclick = e => {
  if (e.target.closest('#hCopy')) {
    if (!gateFeature('export')) return;   // Premium gate (js/iap.js)
    const md = hlMd(), bt = $('#hCopy');
    (navigator.clipboard ? navigator.clipboard.writeText(md) : Promise.reject())
      .then(() => { bt.textContent = 'Copied'; })
      .catch(() => {
        const ta = document.createElement('textarea');
        ta.value = md; ta.rows = 8; ta.style.cssText = 'width:100%;margin-top:8px';
        bt.parentNode.after(ta); ta.select();
        bt.textContent = 'Select and copy the text below';
      });
    return;
  }
  const it = e.target.closest('.hi');
  if (!it) return;
  const h = HLS.find(x => x.id === it.dataset.id);
  if (!h) return;
  if (h.c !== cur) go(h.c); else closeSheets();
  const m = $('#book mark[data-h="' + h.id + '"]');
  if (m) { m.scrollIntoView({ block: 'center' }); m.classList.add('flash'); setTimeout(() => m.classList.remove('flash'), 1800); }
};
