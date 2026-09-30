/* ============================================================
   iap.js — subscription / in-app-purchase entitlement layer
   Today: hard-coded FREE tier (IAP.premium stays false) so the paywall
   plumbing is testable before a store is connected. The Premium tier is
   defined in PREMIUM_FEATURES below and enforced in ui gates:
     js/ui.js  gateFeature() — search / export / review currently free.
   On web the unlock UI is a placeholder sheet; on Android the intended
   production path is the Play Billing Library (or RevenueCat) inside the
   Capacitor shell — replace configure()/purchase()/restore() with the
   native bridge once the Play developer account exists.
   Load order: last, after all UI modules (their gate calls find this).
   ============================================================ */

'use strict';

/* Features that can be gated; id -> {name, blurb}. Ids are referenced by
   gateFeature() calls in the UI modules — keep the two in sync. */
const PREMIUM_FEATURES = {
  search:   { name: 'Whole-book search', blurb: 'Find every mention across all chapters instantly.' },
  review:   { name: 'Review cards',      blurb: 'Spaced flip-card sessions built from the book.' },
  export:   { name: 'Markdown export',   blurb: 'Copy all highlights and notes as Markdown.' }
};

function iapUnlockSheet(f) {
  const feat = PREMIUM_FEATURES[f] || { name: 'This feature', blurb: '' };
  $('#sIap').innerHTML =
    '<h4>Foliant Premium</h4>' +
    '<p style="font:17px/1.5 Newsreader,serif;margin:0 0 10px"><b>' + esc(feat.name) + '</b> is part of Foliant Premium.</p>' +
    (feat.blurb ? '<p style="color:var(--mute);margin:0 0 14px">' + esc(feat.blurb) + '</p>' : '') +
    '<p style="color:var(--mute);font-size:13px;margin:0 0 14px">Purchases open once the store build ships. Your books, highlights and progress stay free forever.</p>' +
    '<div class="row"><button class="sel" id="iapClose">Maybe later</button></div>';
  openSheet('#sIap');
}

/* Central gate: UI calls this before running a premium feature.
   Returns true when allowed; otherwise shows the unlock sheet. */
function gateFeature(f) {
  if (!PREMIUM_FEATURES[f]) return true;             // unknown id -> never block
  if (IAP.premium) return true;
  iapUnlockSheet(f);
  return false;
}

/* Deferred so a slow store never blocks startup. */
function iapConfigure() {
  IAP.ready = true;
  /* Future (Android): initialize the billing plugin here, query purchases,
     and set IAP.premium / IAP.owned accordingly; on the web, restore from
     the account backend once subscriptions exist. */
  if (IAP.premium && typeof navOnPremium === 'function') navOnPremium();
}

iapConfigure();
