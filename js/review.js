/* ============================================================
   review.js — spaced flip-card review sessions
   Ratings live in R ({cardId: 'done'|'again'}, persisted per book).
   A session is a filtered deck (again / unrated / all-shuffled);
   answers update R and the tally, cards flip on tap.
   ============================================================ */

'use strict';

let deck = [], di = 0, shown = false, tally = { done: 0, again: 0 };

function loadR() { try { R = JSON.parse(localStorage.getItem('foliant-r-' + name) || '{}'); } catch (e) { R = {}; } }
function saveR() { try { localStorage.setItem('foliant-r-' + name, JSON.stringify(R)); } catch (e) {} }

const rvBox = () => $('#rvw .rc');

function openReview() { closeSheets(); $('#rvw').classList.remove('hide'); rvMenu(); }

/* Menu: counts per bucket + toggles. */
function rvMenu() {
  const all = allCards(),
    ag = all.filter(c => R[c.id] === 'again').length,
    nw = all.filter(c => !R[c.id]).length,
    dn = all.length - ag - nw;
  rvBox().innerHTML = all.length
    ? `<h4>Review cards</h4><p>${all.length} cards in this book · ${dn} got it · ${ag} to review again · ${nw} not yet rated</p>` +
      `<button class="btn pri" data-d="again" ${ag ? '' : 'disabled'}>Review again (${ag})</button>` +
      `<button class="btn" data-d="new" ${nw ? '' : 'disabled'}>Not yet rated (${nw})</button>` +
      `<button class="btn" data-d="all">All cards, shuffled (${all.length})</button>` +
      `<button class="btn" data-d="auto">Auto-generated cards: ${S.auto ? 'on' : 'off'}</button>` +
      `<button class="btn" data-d="reset">Reset ratings</button>` +
      `<button class="btn" data-d="close">Close</button>`
    : `<h4>No cards yet</h4><p>Turn on auto-generated cards to build them from section headings and lists, or use a book with Q: … A: … text.</p>` +
      `<button class="btn" data-d="auto">Auto-generated cards: ${S.auto ? 'on' : 'off'}</button>` +
      `<button class="btn pri" data-d="close">Close</button>`;
}

function rvCard() {
  const c = deck[di];
  if (!c) {
    rvBox().innerHTML = `<h4>Session complete</h4><p>${tally.done} got it · ${tally.again} to review again</p>` +
      `<button class="btn pri" data-d="menu">Back to review</button><button class="btn" data-d="close">Close</button>`;
    return;
  }
  rvBox().innerHTML =
    `<div class="pr"><i style="width:${di / deck.length * 100}%"></i></div>` +
    `<div class="cd"><div class="ct">Card ${di+1} of ${deck.length} · ${esc(nice(c.title))}${c.auto ? ' · auto' : ''}</div>` +
    `<div class="q">${esc(c.q)}</div>` +
    (shown ? `<div class="a">${c.a}</div>`
           : '<div class="ct" style="margin-top:16px;color:var(--acc)">Tap to reveal the answer</div>') +
    `</div>` +
    (shown ? '<div class="two"><button class="btn" data-r="again">Review again</button><button class="btn pri" data-r="done">Got it</button></div>' : '') +
    '<button class="btn" data-d="menu">Stop</button>';
}

$('#rvw').onclick = e => {
  const b = e.target.closest('button');

  /* Menu / navigation actions (data-d). */
  if (b && b.dataset.d) {
    const d = b.dataset.d;
    if (d === 'close') { $('#rvw').classList.add('hide'); const y = scrollY; render(); scrollTo(0, y); return; }
    if (d === 'reset') { R = {}; saveR(); rvMenu(); return; }
    if (d === 'menu') { rvMenu(); return; }
    if (d === 'auto') { S.auto = !S.auto; applyS(); rvMenu(); return; }
    const all = allCards();
    deck = d === 'all'
      ? all.sort(() => Math.random() - .5)
      : all.filter(c => d === 'again' ? R[c.id] === 'again' : !R[c.id]);
    di = 0; tally = { done: 0, again: 0 }; shown = false; rvCard(); return;
  }

  /* Rating buttons (data-r). */
  if (b && b.dataset.r) {
    const c = deck[di];
    R[c.id] = b.dataset.r; saveR();
    tally[b.dataset.r]++; di++; shown = false; rvCard(); return;
  }

  /* Tap the card to flip it. */
  if (e.target.closest('.cd') && !shown) { shown = true; rvCard(); }
};

$('#bRev').onclick = openReview;
$('#bRvw').onclick = openReview;
