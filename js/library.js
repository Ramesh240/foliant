/* ============================================================
   library.js — the bookshelf: books persist in IndexedDB so a PDF
   is imported once and reopened from the shelf, no re-upload.
   Storage layout (db 'foliant', version 1):
     store 'meta'  — {key, title, added, last, chapters, words, pos} per book
     store 'data'  — {key, buf: ArrayBuffer} the raw PDF bytes
   Key = file name (matches the foliant-pos/h/r localStorage keys).
   Loads after config.js; ui.js is loaded before this file, so the
   shelf exists before open()/go() run. main.js calls shelfRemember()
   once parsing finishes.
   Exposes: shelfOpen(key), shelfRender(), shelfRemember(), shelfSaveMeta()
   ============================================================ */

'use strict';

const SKEY = 'foliant-shelf-on';   // shelf hidden/dismissed when absent

let _db = null;

function shelfDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const rq = indexedDB.open('foliant', 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'key' });
    };
    rq.onsuccess = () => { _db = rq.result; res(_db); };
    rq.onerror = () => rej(rq.error);
  });
}

function shelfTx(store, mode, fn) {
  return shelfDb().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, mode);
    const rq = fn(tx.objectStore(store));
    tx.oncomplete = () => res(rq && rq.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  }));
}

const shelfGet = (store, key) => shelfTx(store, 'readonly', s => s.get(key));
const shelfPut = (store, val) => shelfTx(store, 'readwrite', s => s.put(val));
const shelfDel = (store, key) => shelfTx(store, 'readwrite', s => s.delete(key));
const shelfAllMeta = () => shelfTx('meta', 'readonly', s => s.getAll());

/* One-time migration: keep chapter positions of books read before the shelf. */
async function shelfMigrate() {
  try {
    const meta = await shelfAllMeta();
    const have = new Set(meta.map(m => m.key));
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('foliant-pos-')) continue;
      const key = k.slice('foliant-pos-'.length);
      if (have.has(key)) continue;
      /* No stored bytes for these (they were never imported) — record the
         bookmark so it surfaces if the user re-imports the same file. */
      await shelfPut('meta', { key, title: key.replace(/\.pdf$/i, ''), chapters: 0, words: 0, last: 0 });
    }
  } catch (e) {}
}

/* ---------- Shelf UI ---------- */

const fmtWhen = ts => {
  if (!ts) return '';
  const d = new Date(ts), now = Date.now(), day = 86400000;
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  if (sameDay(now, ts)) return 'Today';
  if (sameDay(now - day, ts)) return 'Yesterday';
  if (now - ts < 7 * day) return new Date(ts).toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function shelfRender() {
  const el = $('#shelf');
  if (!el) return;
  shelfAllMeta().then(rows => {
    const books = rows.filter(r => r.chapters > 0).sort((a, b) => (b.last || 0) - (a.last || 0));
    if (!books.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="shh">Continue reading</div>' + books.map(b => {
      const pct = b.words ? Math.min(99, Math.round((b.pos || 0) / b.chapters * 100)) : 0;
      const sub = b.chapters ? `${b.chapters} chapters · ${pct}% · ${fmtWhen(b.last)}` : fmtWhen(b.last);
      return `<div class="shb" data-key="${esc(b.key)}" tabindex="0" role="button" aria-label="Open ${esc(b.title)}">` +
        `<div class="shc"><div class="sht">${esc(b.title)}</div>` +
        `<div class="shs">${esc(sub)}</div>` +
        `<div class="shp"><i style="width:${pct}%"></i></div></div>` +
        `<button class="shx" data-del="${esc(b.key)}" aria-label="Remove ${esc(b.title)}">✕</button></div>`;
    }).join('');
  }).catch(() => {});
}

/* Delegated clicks: open a book, or remove it (with confirm). */
document.addEventListener('click', e => {
  const del = e.target.closest('.shx');
  if (del) {
    e.stopPropagation();
    const key = del.dataset.del;
    if (confirm('Remove "' + key.replace(/\.pdf$/i, '') + '" from your shelf? Its highlights stay in this browser until you clear site data.')) {
      shelfDel('data', key).then(() => shelfDel('meta', key)).then(shelfRender).catch(() => {});
    }
    return;
  }
  const card = e.target.closest('.shb');
  if (card) shelfOpen(card.dataset.key);
});

/* ---------- Import / reopen ---------- */

/* Import raw bytes under key; the ArrayBuffer is stored as-is. */
function shelfImport(key, buf) {
  return shelfPut('data', { key, buf }).then(() => {
    $('#msg').textContent = 'Saved to your shelf';
    setTimeout(() => { if ($('#msg').textContent === 'Saved to your shelf') $('#msg').textContent = ''; }, 1600);
  }).catch(() => {});
}

/* Reopen a stored book: zero parsing, restore the exact saved spot. */
async function shelfOpen(key) {
  try {
    const row = await shelfGet('data', key);
    if (!row) { $('#msg').textContent = 'That book is no longer stored.'; return; }
    $('#msg').textContent = 'Opening…';
    let spot = null;
    try { spot = JSON.parse(localStorage.getItem('foliant-spot-' + key) || 'null'); } catch (e) {}
    await openFromBuffer(key, row.buf, spot);
  } catch (e) {
    $('#msg').textContent = 'Could not open that book.';
  }
}

/* Save the PDF being opened to the shelf: raw bytes (for reopen without
   re-upload) + metadata (for the shelf card). */
function shelfRemember(key, buf, wordCount) {
  return Promise.all([
    buf ? shelfPut('data', { key, buf }).catch(() => {}) : Promise.resolve(),
    shelfGet('meta', key).then(prev =>
      shelfPut('meta', {
        key,
        title: key.replace(/\.pdf$/i, ''),
        added: prev ? prev.added : Date.now(),
        last: Date.now(),
        chapters: chapters.length,
        words: wordCount || 0,
        pos: prev ? prev.pos : 0
      })
    ).catch(() => {})
  ]);
}

/* Update reading position + timestamp (called from render/progress). */
function shelfSaveMeta(pos) {
  if (!chapters.length) return;
  return shelfGet('meta', name).then(m =>
    shelfPut('meta', Object.assign({}, m, {
      key: name,
      title: (m && m.title) || name.replace(/\.pdf$/i, ''),
      last: Date.now(),
      chapters: chapters.length,
      pos: typeof pos === 'number' ? pos : ((m && m.pos) || cur)
    }))
  ).catch(() => {});
}

/* ---------- Home screen composition ---------- */

function shelfInit() {
  if (typeof indexedDB === 'undefined') return;
  const show = () => { try { localStorage.setItem(SKEY, '1'); } catch (e) {} shelfRender(); };
  try { if (!localStorage.getItem(SKEY)) { shelfMigrate().then(show); return; } } catch (e) {}
  show();
}
