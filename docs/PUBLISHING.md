# Publishing Foliant

Two targets, one codebase:

1. **Web (GitHub Pages)** — automatic on every push to `main`. Live at
   `https://ramesh240.github.io/foliant/` once Pages is enabled (steps below).
2. **Android (Play Store)** — a signed AAB is built automatically by GitHub
   Actions; you download it and upload it to the Play Console.

---

## 1. Web: GitHub Pages

The repo already contains [.github/workflows/pages.yml](../.github/workflows/pages.yml),
which assembles the offline bundle (`tools/copy-www.js`) and deploys it.

One-time enable (after the repo exists):

1. GitHub → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main` (or run the *Deploy web app to GitHub Pages* workflow manually).
3. The app is live at `https://<username>.github.io/foliant/` — installable as a
   PWA (browser menu → *Install app*), fully offline after first load.

## 2. Android: build & sign

### 2.1 One-time: create an upload keystore

A keystore is your app's private signing key — **keep it and its passwords forever**;
Play Store updates must be signed with the same key.

Local (requires JDK; `keytool` ships with it):

```bash
keytool -genkeypair -v \
  -keystore foliant-release.keystore -alias foliant \
  -keyalg RSA -keysize 2048 -validity 10000
```

It will ask for two passwords (store + key). Remember them.

### 2.2 Store signing secrets in GitHub

```bash
# base64-encode the keystore (Windows Git Bash)
base64 -w0 foliant-release.keystore > keystore.b64
```

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_B64` | contents of `keystore.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password from 2.1 |
| `ANDROID_KEY_ALIAS` | `foliant` |
| `ANDROID_KEY_PASSWORD` | key password from 2.1 |

Do **not** commit the keystore itself. It's already in `.gitignore`.

### 2.3 Build

- **Automatic:** every push to `main` runs *Android release build*; download the
  `foliant-release-aab` and `foliant-release-apk` artifacts from the run page.
- **Manual:** Actions → *Android release build* → **Run workflow**.
- **Local:** `npm run cap:sync` then `cd android && ./gradlew bundleRelease`
  (without secrets present it signs with the debug key — fine for device testing,
  not for the store).

## 3. Play Store listing

1. Register at [play.google.com/console](https://play.google.com/console) —
   $25 one-time, identity verification required.
2. **All apps → Create app**: name *Foliant*, default language, *App*, *Free*.
3. Complete the required declarations (privacy policy URL — use
   `https://ramesh240.github.io/foliant/privacy.html`, which ships with the app
   and is linked from the Settings sheet; content rating questionnaire; data
   safety: *no data collected, everything stays on device* — true for Foliant).
4. **Production → Create release**: upload `app-release.aab`, add
   [store listing copy](#4-store-listing-copy), 2+ phone screenshots (open the
   PWA in a narrow browser window and screenshot the reader), feature graphic
   1024×500 (a render of `icons/icon-512.png` on the paper background works).
5. Roll out. First review typically takes a few days.

### 4. Store listing copy

- **Short description** (80 chars max):
  > Turn any PDF into a book — chapters, highlights, focus mode, flashcards.
- **Full description**:
  > Foliant restructures any text PDF into a readable book: it detects chapters,
  > rebuilds paragraphs, extracts figures and renders everything in clean book
  > typography. Highlight in four colors, attach notes, export as Markdown, and
  > review what you read with automatically generated flashcards. Everything
  > happens on your device — no account, no uploads, works offline.

### 5. Versioning an update

Bump in two places, then push:

- `package.json` → `"version"`
- `android/app/build.gradle` → `versionCode` (+1 each release) and `versionName`
  (currently **3** / **1.2**)

## 6. Premium unlock ($1.99 one-time, Google Play Billing)

Foliant has a **one-time non-consumable purchase** — `foliant_premium` at $1.99 —
that unlocks three value-add features: **Review cards**, **whole-book search** and
**Markdown export**. Reading, highlights, the bookshelf, themes and the bottom
bar stay free. The entitlement is cached in `localStorage['foliant-iap']` so
Premium works offline; the Android bridge is authoritative on startup.

> **Web = free.** `gateFeature()` only gates where a purchase is actually
> possible — Android (Play Billing bridge or UA). On the web there is no way
> to buy, so search / review / export stay free there and the Settings pitch
> simply points readers to the Android app. Don't "fix" this by re-gating the
> web UI: paywalling features nobody on that origin can buy makes the buttons
> feel broken.

### 6.1 Create the product in Play Console

1. Play Console → Foliant → **Monetize → Products → In-app products** → *Create product*.
2. Product ID: **`foliant_premium`** (must match `IAP_PRODUCT` in
   [js/iap.js](../js/iap.js) exactly). Type: **Non-consumable** (managed).
3. Name: "Foliant Premium"; price: **$1.99** (your choice per market).
4. **Activate** the product. Play Billing is unavailable to testers until it is active.

### 6.2 Bridge (Capacitor shell) — implemented

The bridge ships as `android/app/src/main/java/com/ramesh/foliant/FoliantBillingPlugin.java`
(registered in `MainActivity`), backed by the
[Play Billing Library](https://developer.android.com/google/play/billing)
(`com.android.billingclient:billing-ktx` 7.x, wired in `android/app/build.gradle`).
js/iap.js adapts the Capacitor plugin object to the seam the app expects:

```js
window.FoliantBilling = {
  purchase() -> Promise<{ok:true, productId} | {ok:false} | Error>,
  restore()  -> Promise<{ok:true, productId} | {ok:false} | Error>
};
```

Behavior: `purchase()` launches the Play flow for `foliant_premium` and
acknowledges the purchase (unacknowledged one-time buys are auto-refunded by
Play after 3 days); `restore()` reports an existing entitlement and is also
probed automatically at app startup so refunds and account switches take
effect. `iapSetPremium(true, 'play')` (js/iap.js) grants the entitlement in
the web layer whenever either path confirms ownership.

On plain web there is still no purchase path: web users get the features free
(no purchase path on that origin), Android users see the Play purchase sheet,
and the dev helper `FoliantDev.unlock()` / `FoliantDev.lock()` (localhost only)
simulates the purchase for UI testing.

### 6.3 Internal testing checklist — step by step

Current state: versionCode **3**, versionName **1.2**; the Billing bridge
(`FoliantBillingPlugin`) ships in the APK; hardware + predictive back return
to the library while a book is open; the web app is deployed with the
same build.

**Before you can upload anything** — Play developer account:

1. Register at play.google.com/console (one-time **$25**; identity
   verification can take a couple of days).
2. Play Console → **All apps → Create app**: name *Foliant*, default
   language, *App*, *Free*. Accept the declarations.

**Create the release (once CI is green):**

3. Download the signed AAB artifact `foliant-release-aab` from the green
   Android workflow run on GitHub (Actions → Android release build → run →
   Artifacts).
4. Play Console → **Testing → Internal testing** → *Create new release*.
5. Under *App signing*: accept Play App Signing (Google holds the release
   key from the first upload; your CI keystore is the upload key).
6. Upload the `.aab`, name the release, add release notes, then
   **Review release → Start rollout to Internal testing**.

   Ready-to-paste v1.2 release notes:

   > Back gesture now returns to your library while reading instead of
   > closing the book view. Optional passphrase encryption for exported
   > reading sessions. Imports show a completion summary with per-book
   > size and chapter counts, and warn when a file is larger than the
   > remaining storage space. Progress indicator now follows the fastest
   > parse lane and never counts backwards. Settings can no longer be
   > removed from the bottom bar. The app now updates itself to new
   > versions without a manual reload.

   (For v1.1 the release name was *1.1 – billing bridge*.)
7. **Testers tab** → create an email list (your Gmail), copy the
   *opt-in link*, open it on your phone and accept. Install the app from
   the Play Store page that appears.
8. **Back-gesture check**: open a book, then swipe the system back
   gesture (or press back) — Foliant must return to the library, not exit;
   back on the library screen exits as usual. Open a book again and repeat
   once more (the second cycle exercises the stacked history entries).

**Purchase testing (needs the product from §6.1 to be ACTIVE):**

9. In Play Console → **Monetize → Testing → License testing**, add the same
   Gmail so purchases use test cards instead of real money.
10. On the phone: open Foliant → Settings → *Foliant Premium* → *Unlock with
    Google Play* → complete the test purchase.
11. Kill + reopen the app → Premium still on (cached, re-verified against
    Play at startup via the bridge's `restore()`).
12. Test the refund path: Play Console → **Order management** → refund the
    test order → reopen the app → Premium should drop (startup `restore()`
    no longer confirms ownership).

**Web remains free** (no purchase path): search/review/export are free on
the site; only the Android shell can sell, and an Android purchase is cached
per device (`foliant-iap`). A cross-device sync backend could honor it on
web later.

## 7. Distributing Premium for free (promo codes & license testers)

No code changes are needed — the bridge's `restore()` uses
`queryPurchasesAsync(TYPE_INAPP)`, and a redeemed promo code creates a real
$0 purchase of `foliant_premium`, so the existing startup probe and the
*Restore purchase* button grant Premium automatically.

**Promo codes (share with anyone):**

1. Play Console → **Monetize → Promotions → Create promotion** → pick the
   in-app product `foliant_premium`.
2. Generate **single-use codes** (each code redeems once; subject to
   Google's quarterly promotion quota).
3. Send each person a code plus these instructions:
   *Play Store → profile icon → Payments & subscriptions → Redeem code*,
   or the direct link `https://play.google.com/redeem?code=XXXX`.
   After redeeming, open Foliant — Premium is on (or tap *Restore
   purchase* in Settings).

**License testers (close collaborators / QA):** add their Gmail under
**Monetize → Testing → License testing** — they buy Premium with Google's
test card at $0, which also exercises the real purchase flow end to end.

**Do not** add a built-in bypass (client-side license keys, dev unlock on
production): Foliant has no server, so any client check is trivially
crackable, and `FoliantDev.unlock()` is deliberately localhost-only.
Promo codes are the legitimate, revocable path — refunded codes stop
granting Premium on the next app start, because startup re-verifies with
Play. Note the web app has no purchase path, so search / review / export
are already free on github.io by design.
