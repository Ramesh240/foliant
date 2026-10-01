/* ============================================================
   iap.js — one-time Premium unlock ($1.99) entitlement layer
   Model: a single non-consumable Google Play purchase ("foliant_premium")
   unlocks Review cards, whole-book search and Markdown export forever.
   Reading, highlights, the bookshelf, themes and the bottom bar stay free.

   Enforcement: UI entry points call gateFeature(id) —
     search.js openSearch()   -> 'search'
     review.js openReview()   -> 'review'
     highlights.js #hCopy     -> 'export'
   The entitlement is cached in localStorage 'foliant-iap' so premium works
   offline; on Android the native bridge (window.FoliantBilling, injected by
   the Capacitor shell) is authoritative and re-verified on startup.

   Bridge contract (Kotlin side, see docs/PUBLISHING.md §5):
     window.FoliantBilling.purchase() -> Promise<{ok, productId}|Error>
     window.FoliantBilling.restore()  -> Promise<{ok, productId}|Error>
   On web there is no purchase path: the sheet points to the Android app.
   Dev helper (localhost only): FoliantDev.unlock() / FoliantDev.lock().
   Load order: last, after nav.js (its navOnPremium is called on unlock).
   ============================================================ */

'use strict';

/* Feature catalog — ids must match the gateFeature() call sites above. */
const PREMIUM_FEATURES = {
  search: { name: 'Whole-book search', blurb: 'Find every mention across all chapters instantly.' },
  review: { name: 'Review cards',      blurb: 'Spaced flip-card sessions built from the book.' },
  export: { name: 'Markdown export',   blurb: 'Copy all highlights and notes as Markdown.' }
};

const IAP_KEY = 'foliant-iap';
const IAP_PRICE = '$1.99';
const IAP_PRODUCT = 'foliant_premium';   // non-consumable product id in Play Console

/* Cached entitlement. On the web this localStorage copy is authoritative
   (there is no purchase path); under the Android shell the bridge re-checks
   Play ownership at startup and overwrites it. */
let IAPSTORE = { premium: false, at: 0, src: '' };
try { Object.assign(IAPSTORE, JSON.parse(localStorage.getItem(IAP_KEY) || '{}')); } catch (e) {}
IAP.premium = !!IAPSTORE.premium;

function iapSave() { try { localStorage.setItem(IAP_KEY, JSON.stringify(IAPSTORE)); } catch (e) {} }

function iapSetPremium(on, src) {
  IAPSTORE.premium = !!on;
  IAPSTORE.at = on ? Date.now() : 0;
  IAPSTORE.src = on ? (src || '') : '';
  iapSave();
  IAP.premium = !!on;
  if (on && typeof navOnPremium === 'function') navOnPremium();   // adds the Customize slot
  applyS();                                                       // re-renders bar + settings label
}

/* Localhost-only dev helper — lets the unlock flow be exercised without the
   Play Console. Never available on a deployed origin. */
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  window.FoliantDev = {
    unlock: () => iapSetPremium(true, 'dev'),
    lock: () => iapSetPremium(false, '')
  };
}

/* ---------- Unlock / pitch sheet ---------- */

function iapUnlockSheet(f) {
  const feat = f ? (PREMIUM_FEATURES[f] || { name: 'This feature', blurb: '' })
                 : { name: 'Foliant Premium', blurb: 'Review cards, whole-book search and Markdown export.' };
  const bridge = window.FoliantBilling;
  const onAndroid = !!bridge || /Android/i.test(navigator.userAgent);
  $('#sIap').innerHTML =
    '<h4>Foliant Premium</h4>' +
    '<p style="font:17px/1.5 Newsreader,serif;margin:0 0 10px"><b>' + esc(feat.name) + '</b> is part of Foliant Premium.</p>' +
    (feat.blurb ? '<p style="color:var(--mute);margin:0 0 12px">' + esc(feat.blurb) + '</p>' : '') +
    '<p style="margin:0 0 16px">' + esc(IAP_PRICE) + ' · one-time unlock · yours forever</p>' +
    (IAP.premium
      ? '<div class="row"><button class="sel" id="iapClose">You own Premium ✓</button></div>'
      : onAndroid
        ? '<div class="row"><button class="sel" id="iapBuy">Unlock with Google Play</button></div>' +
          '<div class="row"><button id="iapRestore">Restore purchase</button></div>' +
          (bridge ? '' : '<div class="nnv">Store sign-in is unavailable in this build — install the latest app release from Play to purchase.</div>')
        : '<div class="row"><button class="sel" id="iapClose">Got it</button></div>' +
          '<div class="nnv">Reading stays free on foliant.web.app — Premium (search, review cards, Markdown export) is a one-time ' + esc(IAP_PRICE) + ' unlock in the Foliant Android app.</div>') +
    '<div class="nnv" id="iapMsg"></div>';
  openSheet('#sIap');
}

$('#sIap').onclick = async e => {
  if (e.target.closest('#iapClose')) { closeSheets(); return; }
  const b = window.FoliantBilling;
  if (e.target.closest('#iapBuy') && b) {
    try {
      const r = await b.purchase();
      if (r && r.ok) { iapSetPremium(true, 'play'); closeSheets(); return; }
      $('#iapMsg').textContent = 'Purchase did not complete.';
    } catch (err) { $('#iapMsg').textContent = 'Purchase failed — try Restore.'; }
    return;
  }
  if (e.target.closest('#iapRestore') && b) {
    try {
      const r = await b.restore();
      if (r && r.ok) { iapSetPremium(true, 'play'); closeSheets(); return; }
      $('#iapMsg').textContent = 'No purchase found for this Google account.';
    } catch (err) { $('#iapMsg').textContent = 'Could not reach Google Play.'; }
  }
};

/* ---------- Gate + startup ---------- */

/* This build can only sell through Google Play (Android + the native
   billing bridge), so the gate applies there. On web there is no purchase
   path — paywalling features nobody could ever buy would make buttons feel
   broken — so Premium features stay free and the pitch is a support note.
   Revisit if a web payment provider (Stripe / Paddle) is ever added. */
const iapAndroid = () => !!window.FoliantBilling || /Android/i.test(navigator.userAgent);

/* Central gate: UI calls this before running a premium feature.
   Returns true when allowed; otherwise shows the unlock sheet. */
function gateFeature(f) {
  if (!PREMIUM_FEATURES[f]) return true;             // unknown id -> never block
  if (IAP.premium || !iapAndroid()) return true;     // web: no purchase path
  iapUnlockSheet(f);
  return false;
}

/* Startup: refresh the cache from the store (Android bridge), keep the UI in
   sync, and label the Settings row. */
function iapConfigure() {
  IAP.ready = true;
  /* Android shell: call FoliantBilling.restore() here when it exists and
     call iapSetPremium from its result; web keeps the cached value. */
  if (IAP.premium && typeof navOnPremium === 'function') navOnPremium();
}

const _iapApplyS = applyS;
applyS = function () {
  _iapApplyS();
  const b = $('#bPrem');
  if (b) b.textContent = IAP.premium ? 'Foliant Premium ✓' : 'Foliant Premium — ' + IAP_PRICE;
};

iapConfigure();
applyS();
