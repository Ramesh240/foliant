/* ============================================================
   nav.js — customizable bottom navigation bar (thumb reach)
   Buttons render from the S.nav slot list persisted with the other
   reading settings under localStorage 'foliant-s' (utils.js applyS).

   Slots:
     id        action
     toc       chapters sheet          (#sToc, openSheet in ui.js)
     search    whole-book search       (#sSearch, openSearch in search.js)
     hl        highlights + notes      (#sHl,    openSheet in ui.js)
     rvw       flashcard review deck   (#rvw,    openReview in review.js)
     set       reading settings        (#sSet,   openSheet in ui.js)
     home      close book -> shelf     (showHome in ui.js)
     focus     toggle focus mode       (toggleFocus in ui.js)
     prev/next previous/next chapter   (go in ui.js)
     custom    opens the customize editor

   Slot ids starting with '-' are custom user labels: e.g. '-Home|home'
   renders the home action but shows the label "Home".

   Depends on: S + applyS (config/utils), esc (utils), closeSheets and
   toggleFocus (ui.js), openSearch (search.js), openReview (review.js),
   showHome (ui.js). Loaded after ui.js, before search.js. Also owns the
   back gesture (seq-tagged pushState on book open, popstate -> showHome;
   Android hardware back arrives as a foliantBack event from MainActivity).
   ============================================================ */

'use strict';

/* Set true to preview the Premium layout (adds the Customize quick button)
   while reading — a pushState book entry makes the browser back button work.
   Always ship false. (var, not const: the inline hook in index.html reads it
   off window.) */
var IAP_PREMIUM_PREVIEW = false;

const NAV_DEFS = {
  toc:    { i: '☰',  l: 'Chapters' },
  search: { i: '🔍', l: 'Search' },
  hl:     { i: '🖍',  l: 'Highlights' },
  rvw:    { i: '🗂',  l: 'Review' },
  set:    { i: 'Aa', l: 'Settings' },
  home:   { i: '📚',  l: 'Library' },
  focus:  { i: '👁',  l: 'Focus' },
  prev:   { i: '‹',  l: 'Previous' },
  next:   { i: '›',  l: 'Next' },
  custom: { i: '⚙️',  l: 'Customize' }
};
NAV_DEFS.order = ['toc', 'search', 'hl', 'rvw', 'set', 'home', 'focus', 'prev', 'next'];
// NAV_DEFS.custom is editorial-only: it never appears in the "Add" grid.

const NAV_DEFAULT = ['toc', 'search', 'hl', 'set'];

/* id of a nav slot without any custom-label prefix */
const navBase = id => id[0] === '-' ? id.slice(1).split('|')[0] : id;
/* display label of a nav slot */
const navLabel = id => id[0] === '-'
  ? id.slice(1).split('|')[1] || (NAV_DEFS[navBase(id)] || {}).l || '?'
  : (NAV_DEFS[id] || {}).l || '?';

function navEnsure() { if (!Array.isArray(S.nav) || !S.nav.length) S.nav = NAV_DEFAULT.slice(); }
navEnsure();

/* Current chapter has a previous / next chapter? */
function navHas(d) {
  if (!chapters.length) return false;
  return d === 'prev' ? cur > 0 : cur < chapters.length - 1;
}

function navRender() {
  const bar = $('#navb');
  bar.classList.toggle('prem', IAP.premium);
  /* The Customize quick button is Premium-only: render-filter (not delete)
     so a lapsed subscription drops it but the saved slot survives. */
  bar.innerHTML = S.nav.filter(id => IAP.premium || navBase(id) !== 'custom').map(id => {
    const a = navBase(id);
    if (a === 'prev' || a === 'next') {
      const ok = navHas(a);
      return `<button data-a="${a}" ${ok ? '' : 'disabled'}>` +
        `<span class="ni">${NAV_DEFS[a].i}</span><span class="nl">${esc(navLabel(id))}</span></button>`;
    }
    const on = a === 'focus' && focus ? ' on' : (a === 'custom' ? ' pri' : '');
    return `<button data-a="${esc(a)}"${on}>` +
      `<span class="ni">${NAV_DEFS[a] ? NAV_DEFS[a].i : '?'}</span><span class="nl">${esc(navLabel(id))}</span></button>`;
  }).join('');
  document.body.classList.add('hasnav');
}

function navRun(a) {
  if (a === 'toc') openSheet('#sToc');
  else if (a === 'set') openSheet('#sSet');
  else if (a === 'hl') openSheet('#sHl');
  else if (a === 'search') openSearch();
  else if (a === 'rvw') openReview();
  else if (a === 'home') showHome();
  else if (a === 'focus') toggleFocus();
  else if (a === 'custom') openNavSheet();
  else if (a === 'prev' || a === 'next') go(cur + (a === 'prev' ? -1 : 1));
}

$('#navb').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b && !b.disabled) navRun(b.dataset.a);
});

/* Keep prev/next enabled-state and the focus highlight current. */
function navSync() {
  const bar = $('#navb');
  if (!bar || bar.classList.contains('hide')) return;
  const prev = bar.querySelector('[data-a="prev"]'), next = bar.querySelector('[data-a="next"]'),
        fo = bar.querySelector('[data-a="focus"]');
  if (prev) prev.disabled = !navHas('prev');
  if (next) next.disabled = !navHas('next');
  if (fo) fo.classList.toggle('on', focus);
}

/* ---------- Customize sheet ---------- */

function navSlotRow(id) {
  const a = navBase(String(id).replace(/^__/, ''));   // strip the add-only prefix for display
  const def = NAV_DEFS[a] || {};
  const name = def.l || a;
  return `<label><input type="checkbox" data-nav="${esc(id)}" ${S.nav.includes(String(id).replace(/^__/, '')) ? 'checked' : ''}>` +
    `<span class="ni">${def.i || '?'}</span> ${esc(name)}</label>`;
}

function openNavSheet() {
  const fixed = S.nav.filter(id => navBase(id) === 'custom');
  const chosen = S.nav.filter(id => navBase(id) !== 'custom');
  const avail = NAV_DEFS.order.filter(a => !chosen.some(id => navBase(id) === a));

  $('#sNav').innerHTML =
    '<div class="nnclose"><button type="button" id="navDone">Done</button></div>' +
    '<h4>Bottom bar</h4>' +
    '<div class="nnh">Bar style</div>' +
    '<div class="npv">' +
    '<button type="button" data-navmode="labels" aria-pressed="' + (S.navMode !== 'icons') + '">Icons + labels</button>' +
    '<button type="button" data-navmode="icons" aria-pressed="' + (S.navMode === 'icons') + '">Icons only</button>' +
    '</div>' +
    '<div class="nnh">In your bar</div>' +
    '<div class="npz">' + S.nav.filter(id => navBase(id) !== 'custom').map(navSlotRow).join('') + '</div>' +
    (avail.length ? '<div class="nnh">Add</div><div class="npz">' +
      avail.map(a => navSlotRow('__' + a)).join('') + '</div>' : '') +
    (fixed.length ? '<div class="nnh">Always shown</div><div class="npz">' +
      fixed.map(navSlotRow).join('') + '</div>' : '') +
    '<div class="row"><button id="navReset">Reset to default</button></div>' +
    '<div class="nnv">Your bar is saved on this device.</div>';

  openSheet('#sNav');
}

/* toggle id in S.nav; '__' prefix = add-only from the "Add" grid */
function navToggle(id, want) {
  const add = id.startsWith('__');
  const base = add ? id.slice(2) : id;
  const real = add ? base : id;   // '__search' adds 'search'; custom ids keep their label
  const has = S.nav.includes(real);
  if (want && !has) {
    if (navBase(real) === 'custom') S.nav.push(real);
    else {
      const at = S.nav.findIndex(x => navBase(x) === navBase(real));
      if (at >= 0) S.nav[at] = real; else S.nav.push(real);
    }
  } else if (!want && has) {
    if (navBase(real) === 'custom') S.nav = S.nav.filter(x => x !== real);
    else S.nav = S.nav.filter(x => navBase(x) !== navBase(real));
  }
}

/* Last line of defence against locking yourself out of Settings: if the bar
   no longer contains a Settings entry (user unchecked 'set' and saved with a
   pre-fix build), restore it as the final slot. Settings is the only way to
   reach the Customize editor, so the bar must always offer it. */
function navEnsureSettings() {
  if (!S.nav.some(id => navBase(id) === 'set')) S.nav.push('set');
}

$('#sNav').addEventListener('click', e => {
  const mode = e.target.closest('[data-navmode]');
  if (mode) { S.navMode = mode.dataset.navmode; applyS(); openNavSheet(); return; }
  if (e.target.closest('#navReset')) {
    S.nav = NAV_DEFAULT.slice(); S.navMode = 'labels';
    applyS(); openNavSheet();
  }
  if (e.target.closest('#navDone')) closeSheets();
});
$('#sNav').addEventListener('change', e => {
  const box = e.target.closest('[data-nav]');
  if (!box) return;
  /* Settings is the only way back to this editor — and to font, theme,
     export and import — whenever the top bar is hidden, so it cannot be
     removed. (Legacy bars missing it are repaired by navEnsureSettings.) */
  if (!box.checked && navBase(box.dataset.nav) === 'set') {
    box.checked = true;
    window.alert('Settings stays in the bar: it is the only way back to this editor and to your reading settings.');
    return;
  }
  navToggle(box.dataset.nav, box.checked);
  if (!S.nav.length) { S.nav = NAV_DEFAULT.slice(); window.alert('Keep at least one button in the bar.'); }
  navEnsureSettings();
  applyS(); openNavSheet();
});

/* ---------- App-state hooks ---------- */

const _navApplyS = applyS;
applyS = function () {
  navEnsure();
  navEnsureSettings();   // repaired legacy bars keep a Settings entry
  if (S.navMode !== 'icons') S.navMode = 'labels';
  _navApplyS();
  const bar = $('#navb');
  bar.classList.toggle('compact', S.navMode === 'icons');
  navRender();
};
applyS();   // persist S.nav/navMode now and render the (hidden) bar

const _navGo = go;
go = function (i) { _navGo(i); navSync(); };

const _navToggleFocus = toggleFocus;
toggleFocus = function (btn) { _navToggleFocus(btn); navSync(); };

const _navCloseSheets = closeSheets;
closeSheets = function () { _navCloseSheets(); };

/* ---------- Android / browser back gesture: book -> library ---------- */

/* Show/hide the bar with the reader. */
const _navShowHome = showHome;
showHome = function () { _navShowHome(); $('#navb').classList.add('hide'); document.body.classList.remove('hasnav'); };

/* Opening a book adds ONE history entry tagged { foliant: 'book', seq }.
   The browser/app back control then lands on the library and popstate
   returns to the shelf; Forward re-enters the still-loaded book.

   Entries accumulate across open/back cycles and cannot be removed, so each
   push is numbered: a popstate landing on the CURRENT book's entry re-enters
   it, while a STALE entry (an earlier book from this session) or a home
   entry means "leave the reader" -> navBack. Otherwise back from the second
   book would resurrect the first one.

   Android (Capacitor): the WebView history can be closed by the system
   back-gesture dialog, so MainActivity ALSO dispatches foliantBack for
   hardware + predictive back; navBack is idempotent so both paths can run.
   On the shelf the event does nothing — the activity default (minimize or
   exit) is preserved. */
let navBookSeq = 0;   // increments on every push
let navCurSeq = 0;    // seq of the book currently loaded in memory

function navPushBook() {
  navBookSeq++;
  navCurSeq = navBookSeq;
  try { history.pushState({ foliant: 'book', seq: navCurSeq }, '', location.href); } catch (e) {}
}

function navBack() {
  if (!chapters.length || $('#reader').classList.contains('hide')) return false;
  if (!$('#rvw').classList.contains('hide')) { $('#rvw').classList.add('hide'); return true; }
  if (!$('#hbar').classList.contains('hide')) hideBar();
  closeSheets();
  showHome();
  return true;
}

addEventListener('popstate', () => {
  const st = history.state || {};
  if (st.foliant === 'book' && st.seq === navCurSeq && chapters.length) {
    /* Forward (or a refresh) onto the current book's own entry: re-enter it. */
    if ($('#reader').classList.contains('hide')) {
      $('#home').classList.add('hide');
      $('#reader').classList.remove('hide');
      $('#navb').classList.remove('hide');
      document.body.classList.add('hasnav');
    }
    return;
  }
  navBack();   // stale book entry or home entry -> the library
});
addEventListener('foliantBack', () => { navBack(); });

/* Called by main.js after a book opens successfully (main.js loads after
   nav.js, so it must invoke this explicitly rather than being wrapped). */
function navOnOpen() {
  $('#navb').classList.remove('hide');
  navRender();
  navSync();
  navPushBook();   // give the back gesture a library entry to land on
}

/* Called by js/iap.js when a Premium subscription becomes active: add the
   quick Customize editor button (free readers customize via Settings). */
function navOnPremium() {
  navEnsure();
  if (!S.nav.some(id => navBase(id) === 'custom')) S.nav.push('-custom');
  applyS();
}

/* ---------- Chapter scrubber (progress hairline as a seek bar) ----------
   The progress line is draggable: move left/right to move through the book
   live — chapter changes render as the finger crosses their boundaries, the
   rest of the travel is in-chapter scroll. Touch gets an enlarged hit zone
   and touch-action:none in bottom-only mode (nav.css); mouse works anywhere
   the line is visible. */
const scrubTip = document.createElement('div');
scrubTip.id = 'scrubTip';
scrubTip.className = 'hide';
document.body.appendChild(scrubTip);

function scrubSeek(clientX) {
  if (!chapters.length) return;
  const prog = $('#prog'), r = prog.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
  const idx = Math.min(chapters.length - 1, Math.floor(f * chapters.length));
  const cf = Math.min(1, Math.max(0, f * chapters.length - idx));
  if (idx !== cur) { SKIP_RENDER_SCROLL = true; go(idx); SKIP_RENDER_SCROLL = false; }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const m = document.documentElement.scrollHeight - innerHeight;
    root.classList.add('jumping');
    window.scrollTo(0, cf * Math.max(0, m));
    root.classList.remove('jumping');
  }));
  /* Preview bubble above the drag point: chapter title + position. */
  scrubTip.classList.remove('hide');
  scrubTip.innerHTML = '<b>' + esc(nice(chapters[idx].title)) + '</b><span>' +
    (idx + 1) + ' / ' + chapters.length + '</span>';
  const above = r.top > innerHeight / 2;
  scrubTip.style.top = above ? 'auto' : (r.bottom + 14) + 'px';
  scrubTip.style.bottom = above ? (innerHeight - r.top + 14) + 'px' : 'auto';
  scrubTip.style.left = Math.min(innerWidth - 130, Math.max(130, clientX)) + 'px';
}

let scrubbing = false;
$('#prog').addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button) return;
  if (chapters.length < 2 || document.querySelector('#reader').classList.contains('hide')) return;
  scrubbing = true;
  $('#prog').classList.add('scrubbing');
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  scrubSeek(e.clientX);
  e.preventDefault();
});
$('#prog').addEventListener('pointermove', e => { if (scrubbing) scrubSeek(e.clientX); });
const scrubEnd = () => {
  if (!scrubbing) return;
  scrubbing = false;
  $('#prog').classList.remove('scrubbing');
  scrubTip.classList.add('hide');
};
$('#prog').addEventListener('pointerup', scrubEnd);
$('#prog').addEventListener('pointercancel', scrubEnd);
