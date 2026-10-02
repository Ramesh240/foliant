/* ============================================================
   library.js — the bookshelf: books persist in IndexedDB so a PDF
   is imported once and reopened from the shelf, no re-upload.
   Storage layout (db 'foliant', version 3):
     store 'meta'  — {key, title, added, last, chapters, words, pos} per book
     store 'data'  — {key, buf: ArrayBuffer} the raw PDF bytes
     store 'model' — {key, ch: chapters} the PARSED book (fast reopen:
                     skips pdf.js text extraction + structure detection)
     store 'user'  — {key: '<book>:h' | '<book>:r', val} highlights+notes
                     and card ratings (moved out of localStorage so a future
                     export/import can move a whole reading session)
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
    const rq = indexedDB.open('foliant', 3);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('model')) db.createObjectStore('model', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('user')) db.createObjectStore('user', { keyPath: 'key' });
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

/* ---------- Reader data: highlights, notes, card ratings ----------
   These used to live in localStorage ('foliant-h-*' / 'foliant-r-*'); they
   now live in the 'user' store keyed '<book>:h' / '<book>:r' so they sit
   beside the books and can be exported/imported as one session later.
   Reads fall back to the legacy localStorage copy until the one-time
   migration has copied it (userDataMigrate, below). */
const userGet = key => shelfTx('user', 'readonly', s => s.get(key)).then(r => (r ? r.val : null)).catch(() => null);
const userPut = (key, val) => shelfTx('user', 'readwrite', s => s.put({ key, val })).catch(() => {});

/* One-time move of every legacy foliant-h- and foliant-r- key into the store.
   Never overwrites an existing entry; keeps the localStorage copies as a
   safety net (clearing site data removes both). */
async function userDataMigrate() {
  try {
    if (localStorage.getItem('foliant-userdata-idb')) return;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      let book = null, suffix = null;
      if (k.startsWith('foliant-h-')) { book = k.slice('foliant-h-'.length); suffix = ':h'; }
      else if (k.startsWith('foliant-r-')) { book = k.slice('foliant-r-'.length); suffix = ':r'; }
      else continue;
      if (await userGet(book + suffix) == null) {
        try { await userPut(book + suffix, JSON.parse(localStorage.getItem(k) || 'null')); } catch (e) {}
      }
    }
    localStorage.setItem('foliant-userdata-idb', '1');
  } catch (e) {}
}

/* ---------- Parsed-book model cache (fast reopen) ----------

   Parsing a PDF (pdf.js text extraction + structure detection) is the
   slow part of opening a book, and its output only depends on the bytes.
   Cache the built chapter list per key; openFromBuffer (main.js) uses it
   when present and re-parses only when absent (first open / old shelf
   rows / cache drop). Plain objects only — IndexedDB-safe as-is. */
function modelSave(key, ch) {
  try { return shelfPut('model', { key, ch }); } catch (e) { return Promise.resolve(); }
}
function modelLoad(key) {
  return shelfGet('model', key).then(r => (r && Array.isArray(r.ch) && r.ch.length) ? r.ch : null).catch(() => null);
}
function modelDel(key) { return shelfDel('model', key).catch(() => {}); }

const shelfGet = (store, key) => shelfTx(store, 'readonly', s => s.get(key));
function shelfPut(store, val) {
  if (typeof val !== 'object' || val === null) return Promise.reject(new Error('shelfPut: not an object'));
  return shelfTx(store, 'readwrite', s => s.put(val));
}
const shelfDel = (store, key) => shelfTx(store, 'readwrite', s => s.delete(key));
const shelfAllMeta = () => shelfTx('meta', 'readonly', s => s.getAll());

/* ---------- Whole-session export / import ----------
   One JSON file with everything a reader produced: the shelf (metadata +
   raw PDF bytes), parsed-book caches, and the 'user' store (highlights,
   notes, ratings) — plus exact reading positions. Books become base64 so
   the file is plain JSON; import restores all four stores and re-renders
   the shelf. Byte keys stay per-book so nothing else needs to change. */

const b64 = {
  enc(buf) {
    const u = new Uint8Array(buf), s = [], CH = 0x8000;
    for (let i = 0; i < u.length; i += CH) s.push(String.fromCharCode.apply(null, u.subarray(i, i + CH)));
    return btoa(s.join(''));
  },
  dec(str) {
    const bin = atob(str), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
};

/* utf8-safe decode of an embedded payload (the PDF bytes use raw b64.dec). */
const b64Str = str => new TextDecoder().decode(b64.dec(str));

/* localStorage keys that belong to the session: per-book positions and
   global reading prefs. Flags (shelf-on, migration markers) and the
   store-bound entitlement (foliant-iap) stay device-local on purpose. */

/* ---------- Optional AES-GCM encryption for session files ----------
   Export can seal the snapshot with a passphrase: PBKDF2-SHA256 (310k
   iterations, 16-byte random salt) stretches it into an AES-GCM-256 key.
   An encrypted file holds {app:'foliant-session', enc:true, v:2, kdf,
   salt, iv, ct} with ct = the encrypted JSON snapshot. The passphrase is
   never stored or transmitted — it exists only while encrypting or
   decrypting. The v1 plaintext shape (snapshot at top level) stays
   importable unchanged. */
const SESSION_KDF = { name: 'PBKDF2', hash: 'SHA-256', iterations: 310000 };

async function sessionKey(pass, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  /* The per-file random salt belongs in the derive params (Pbkdf2Params needs
     it), not in the shared template. */
  return crypto.subtle.deriveKey(Object.assign({ salt }, SESSION_KDF), key,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/* seal: snapshot object -> encrypted envelope (fresh salt + IV every time). */
async function sessionSeal(snap, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await sessionKey(pass, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(JSON.stringify(snap)));
  return { app: 'foliant-session', enc: true, v: 2, kdf: SESSION_KDF,
           salt: b64.enc(salt), iv: b64.enc(iv), ct: b64.enc(ct) };
}

/* open: envelope (v2, encrypted) or plain snapshot (v1) -> snapshot object.
   A wrong passphrase fails AES-GCM authentication here, surfacing as a
   friendly 'Wrong passphrase' error. */
async function sessionOpen(env, pass) {
  if (!env || env.app !== 'foliant-session') throw new Error('Not a Foliant session file');
  if (!env.enc) return env;   // v1 plaintext file
  if (!env.ct || !env.salt || !env.iv || !env.kdf) throw new Error('Not a Foliant session file');
  let pt;
  try {
    const key = await sessionKey(pass, b64.dec(env.salt));
    pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(env.iv) }, key, b64.dec(env.ct));
  } catch (e) {
    throw new Error('Wrong passphrase');
  }
  const snap = JSON.parse(new TextDecoder().decode(pt));
  if (!snap || snap.app !== 'foliant-session') throw new Error('Not a Foliant session file');
  return snap;
}
const SESSION_LS = [/^foliant-pos-/, /^foliant-spot-/, /^foliant-s$/, /^foliant-wpm$/];

/* Gather everything, resolve when the snapshot is complete. */
async function sessionExport() {
  const [metas, datas, models, users] = await Promise.all([
    shelfTx('meta', 'readonly', s => s.getAll()),
    shelfTx('data', 'readonly', s => s.getAll()),
    shelfTx('model', 'readonly', s => s.getAll()),
    shelfTx('user', 'readonly', s => s.getAll())
  ]);
  const ls = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && SESSION_LS.some(re => re.test(k))) ls.push({ k, v: localStorage.getItem(k) });
    }
  } catch (e) {}
  return {
    app: 'foliant-session',
    v: 1,
    at: Date.now(),
    meta: metas || [],
    data: (datas || []).map(r => ({ key: r.key, b64: b64.enc(r.buf) })),
    model: models || [],
    user: users || [],
    ls
  };
}

/* Restore a snapshot: replaces matching rows, keeps anything not mentioned
   in the file (so a partial export never deletes existing books).
   Returns { restored: [{key, title, mb, chapters}] } for the import summary. */
async function sessionImport(snap) {
  if (!snap || snap.app !== 'foliant-session' || !Array.isArray(snap.meta)) {
    throw new Error('Not a Foliant session file');
  }
  const db = await shelfDb();
  const restored = [];
  await new Promise((res, rej) => {
    const tx = db.transaction(['meta', 'data', 'model', 'user'], 'readwrite');
    const m = tx.objectStore('meta'), d = tx.objectStore('data'),
          mo = tx.objectStore('model'), u = tx.objectStore('user');
    snap.meta.forEach(r => r && r.key && m.put(r));
    (snap.model || []).forEach(r => r && r.key && mo.put(r));
    (snap.user || []).forEach(r => r && r.key && u.put(r));
    (snap.data || []).forEach(r => {
      if (!r || !r.key || typeof r.b64 !== 'string') return;
      try {
        d.put({ key: r.key, buf: b64.dec(r.b64) });
        /* Per-book summary row: base64 length -> exact byte count. */
        const meta = (snap.meta || []).find(x => x && x.key === r.key);
        const bytes = Math.floor(r.b64.length * 3 / 4);
        const mb = bytes >= 1048576
          ? (bytes / 1048576).toFixed(1).replace(/\.0$/, '') + ' MB'
          : Math.max(1, Math.round(bytes / 1024)) + ' KB';
        restored.push({ key: r.key,
          title: (meta && meta.title) || String(r.key).replace(/\.pdf$/i, ''),
          mb, chapters: (meta && meta.chapters) || 0 });
      } catch (e) {}
    });
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
  /* Restore per-book positions + prefs (the file's copy wins; keys the file
     does not mention keep their local values). */
  try { (snap.ls || []).forEach(r => { if (r && r.k) localStorage.setItem(r.k, r.v); }); } catch (e) {}
  shelfRender();
  return { restored };
}

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
      shelfDel('data', key).then(() => shelfDel('meta', key)).then(() => modelDel(key)).then(shelfRender).catch(() => {});
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

/* Reopen a stored book from the cached parsed model (no PDF parsing).
   Mirrors the position logic of openFromBuffer; misses fall through to
   the full pipeline, which re-populates the cache. */
async function shelfOpen(key) {
  try {
    const row = await shelfGet('data', key);
    if (!row) { $('#msg').textContent = 'That book is no longer stored.'; return; }
    let spot = null;
    try { spot = JSON.parse(localStorage.getItem('foliant-spot-' + key) || 'null'); } catch (e) {}
    const ch = await modelLoad(key);
    if (ch && openBookFromModel) { await openBookFromModel(key, ch, spot); return; }
    $('#msg').textContent = 'Opening…';
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
    modelSave(key, chapters),
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
  userDataMigrate();
  const show = () => { try { localStorage.setItem(SKEY, '1'); } catch (e) {} shelfRender(); };
  try { if (!localStorage.getItem(SKEY)) { shelfMigrate().then(show); return; } } catch (e) {}
  show();
}
