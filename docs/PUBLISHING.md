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
