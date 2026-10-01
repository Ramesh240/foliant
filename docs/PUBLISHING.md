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
3. Complete the required declarations (privacy policy URL — use the GitHub Pages
   URL of this repo; content rating questionnaire; data safety: *no data collected,
   everything stays on device* — true for Foliant).
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

### 6.2 Bridge (Capacitor shell)

The web app calls a tiny bridge object the Android shell must inject:

```js
window.FoliantBilling = {
  purchase() -> Promise<{ok:true} | {ok:false}>,   // launches Play billing flow
  restore()  -> Promise<{ok:true} | {ok:false}>    // queries owned purchases
};
```

Implement it in `android/app/src/main/java/.../MainActivity.java` with the
[Play Billing Library](https://developer.android.com/google/play/billing)
(v7+, `com.android.billingclient:billing-ktx`), calling
`iapSetPremium(true, 'play')` (exposed globally by [js/iap.js](../js/iap.js))
whenever ownership is confirmed — at startup via `queryPurchasesAsync` and after
`purchase()` resolves. Until the bridge exists, the app degrades gracefully:
web users get the features free (no purchase path on that origin), Android
users see the Play purchase sheet, and the dev helper
`FoliantDev.unlock()` / `FoliantDev.lock()` (localhost only) simulates the
purchase for UI testing.

### 6.3 Testing checklist

1. Play Console → **Testing → Internal testing** → add your Gmail as tester.
2. Upload an AAB to the internal track; install via the opt-in link.
3. Buy the product with a **test card** (never your real card while the
   license-testing account is set).
4. Kill + reopen the app → Premium still on (cached) and re-verified.
5. Web app: search/review/export are free (no purchase path on web); on
   Android without Premium they show the unlock sheet. After an Android
   purchase, Premium is cached by the bridge and honored on the web if a
   cross-device sync backend is ever added.
