/* ============================================================
   render.js — draw the current chapter into <article id="book">
   Depends on: chapters/cur (config), hl() (highlights),
               cardsOfCh/qaAt/R/S (cards), loadFigs (figures),
               progress (ui), go (ui)
   ============================================================ */

'use strict';

function render() {
  const ch = chapters[cur], book = $('#book');
  const words = ch.b.reduce((n, b) => n + b.t.split(/\s+/).length, 0);
  const nc = cardsOfCh(ch, cur).length;

  /* Chapter header: title + "Chapter N of M — about X min read · N cards"
     plus a live "NN% · M min left" line updated by progress() on scroll. */
  let h = `<h1 class="ch">${esc(nice(ch.title))}</h1><div class="meta">Chapter ${cur+1} of ${chapters.length} — ` +
    `${words ? `about ${Math.max(1, Math.round(words/220))} min read` : 'opens the next section'}` +
    `${nc ? ` · ${nc} card${nc>1?'s':''} to review` : ''}</div>` +
    `<div class="live" id="live"></div>`;
  let inUl = false;

  for (let i = 0; i < ch.b.length; i++) {
    const b = ch.b[i];

    /* Close an open bullet list when a non-li block arrives. */
    if (b.k !== 'li' && inUl) { h += '</ul>'; inUl = false; }

    /* An explicit Q:/A: line is replaced by an interactive card. */
    if (S.qa) {
      const r = qaAt(ch, i, cur);        if (r) {
        h += `<div class="qa ${R[r.id] || ''}" data-id="${r.id}" data-bi="${i}">` +
          `<div class="q">${esc(r.q)}</div><div class="rv">Tap to reveal the answer</div>` +
          `<div class="a"><div>${r.a}</div></div>` +
          `<div class="rate"><button data-r="done">Got it</button><button data-r="again">Review again</button></div></div>`;
        i += r.used; continue;
      }
    }

    if (b.k === 'li') {
      if (!inUl) { h += '<ul>'; inUl = true; }
      h += `<li data-bi="${i}">${hl(b.t, cur, i)}</li>`;
    }
    else if (b.k === 'img') {
      /* Figures render lazily (figures.js); a following "Figure N: …" line
         becomes the caption. */
      const nx = ch.b[i+1]; let cp = '';
      if (nx && nx.k === 'p' && nx.t.length <= 800 && /^(figure|fig\.?)\s*\d+/i.test(nx.t)) { cp = nx.t; i++; }
      h += `<figure class="fg" data-pg="${b.pg}" data-box="${b.box.join(',')}">` +
        `<div class="fi"><div class="ph">Loading figure…</div></div>` +
        `${cp ? `<figcaption>${esc(cp)}</figcaption>` : ''}</figure>`;
    }
    else if (b.k === 'toc') {
      /* Embedded table of contents. Entries whose x is far right of the
         leftmost are "part" groupings; try to link each entry to a parsed
         chapter whose title fuzzy-matches. */
      const bx = Math.min(...b.items.map(x => x.x)), RL = [];
      b.items.forEach(it => {
        const part = it.x > bx+100 && !it.pg && !it.d, pv = RL[RL.length-1];
        if (part && pv && pv.part) pv.sub.push(it.t);
        else RL.push({ ...it, part, sub: [] });
      });
      h += '<ol class="tl" data-bi="' + i + '">' + RL.map(it => {
        const n = norm(it.t), n2 = norm(it.t.replace(/^\d+([.)]\d*)*\s*/, ''));
        const ci = it.part ? -1 : chapters.findIndex(c => {
          const m = norm(c.title);
          return m.length > 3 && [n, n2].some(v => v.length > 3 && (m === v || m.includes(v) || v.includes(m)));
        });
        const cls = (it.part ? 'part' : (it.x > bx+6 ? 'sub' : '')) + (ci >= 0 ? ' lk' : '');
        return `<li class="${cls}"${ci >= 0 ? ` data-c="${ci}"` : ''}>` +
          `<span class="tt">${esc(nice(it.t))}` +
          `${it.sub.map(x => `<small>${esc(nice(x))}</small>`).join('')}` +
          `${it.d ? `<small>${esc(it.d)}</small>` : ''}</span>` +
          `${it.pg ? `<span class="pg">${esc(it.pg)}</span>` : ''}</li>`;
      }).join('') + '</ol>';
    }
    else if (b.k === 'code') {
      h += `<pre data-bi="${i}"><button>Copy</button><code>${esc(b.t)}</code></pre>`;
    }
    else if (b.k === 'p') {
      /* "Note: …" / "Tip: …" / "Warning: …" lines become callouts. */
      const m = b.t.match(/^(note|tip|important|warning|remember|key point|example)\s*[:\-–]\s*(.*)/i);
      if (m) h += `<div class="co" data-bi="${i}"><strong>${esc(m[1][0].toUpperCase() + m[1].slice(1).toLowerCase())}</strong>${esc(m[2])}</div>`;
      else {
        h += `<p data-bi="${i}" class="${b.dc ? 'first' : ''}${b.n ? ' step' : ''}">` +
          `${b.n ? `<span class="nb">${esc(b.n)}</span>` : ''}${hl(b.t, cur, i)}</p>`;
      }
    }
    else h += `<${b.k === 'h1' ? 'h2' : b.k} data-bi="${i}">${esc(nice(b.t))}</${b.k === 'h1' ? 'h2' : b.k}>`;
  }
  if (inUl) h += '</ul>';

  h += `<div id="nav"><button id="pv" ${cur ? '' : 'disabled'}>Previous</button>` +
    `<button id="nx" class="p" ${cur < chapters.length-1 ? '' : 'disabled'}>Next chapter</button></div>`;

  book.innerHTML = h;
  /* Callers that position the viewport themselves (search jumps, exact
     resume) set SKIP_RENDER_SCROLL; everyone else starts at the top. */
  if (!SKIP_RENDER_SCROLL) window.scrollTo({ top: 0, behavior: 'instant' });
  progress();
  savePos();
  try { localStorage.setItem('foliant-pos-' + name, cur); } catch (e) {}
  $('#pv').onclick = () => go(cur-1);
  loadFigs();
  $('#nx').onclick = () => go(cur+1);
}
