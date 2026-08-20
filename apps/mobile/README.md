# `@filmsnaps/mobile` — Mobile App

Expo / React Native app for Android and iOS. Content discovery, watchlist &
history, SQLite-backed downloads, and a native hardened player powered by the
`player-webview` Expo module.

## Stack

- **Expo SDK 55**, React Native 0.83, TypeScript.
- **Native module:** `modules/player-webview` (Android Kotlin + iOS Swift) —
  the hardened provider player.
- **Downloads:** SQLite-backed download engine in `lib/download/` + a native
  downloader injected into the Android/iOS projects at prebuild by the
  `plugins/with-filmsnaps-downloader` config plugin.
- **State:** shared watchlist/history from `@filmsnaps/shared`.
- **Builds:** EAS build profiles (`development` / `preview` / `production`).

## Layout

```
app/                      Expo Router routes (tabs, movie, tv, watch, download, history, …)
components/               UI components
  VideoWebView.tsx        Player host — injects the shared guard bundle, drives PlayerWebView
  player/                 Player controls, server picker, episode rail, subtitles
modules/player-webview/   Native hardened player (Android + iOS)
lib/
  api.ts                  TMDB client
  download/               Download engine (manager, store, SQLite, native adapter)
  watchHistory.ts         Watch progress/history
  settings.tsx            App settings
  introDetect.ts          Skip-intro detection
```

## Run

```bash
# From repo root
pnpm dev:mobile

# Or from this dir
pnpm start        # Expo dev server
pnpm android      # expo run:android
pnpm ios          # expo run:ios
```

## Build

```bash
# EAS builds
eas build --platform android --profile preview
eas build --platform android --profile production

# Local native builds (requires Android/iOS toolchain)
pnpm android
pnpm ios
```

CI builds via `.github/workflows/mobile.yml`.

## Player & security

`components/VideoWebView.tsx` builds the consolidated protection bundle with
`buildAllScriptsWithScriptlets()` from `@filmsnaps/shared` (15-layer guard +
uBO scriptlets + provider cosmetic CSS) and injects it into the native
`PlayerWebView`. The native module adds network-level filtering
(`AdblockEngine.kt`, `shouldInterceptRequest`), navigation gating, a DOM
sweeper, disable-devtool neutralization, and the home-escape guard. See
[docs/security.md](../../docs/security.md).

## Downloads

`lib/download/` implements the download engine:

- `manager.ts` — download orchestration (queue, progress, resume).
- `database.ts` / `store.ts` — SQLite-backed metadata store.
- `nativeAdapter.ts` / `nativeBridge.ts` — bridge to the native downloader.
- `useDownload*.ts` — React hooks over the engine.

The native downloader (`FilmsnapsDownloadModule` Kotlin / Swift) is injected
into the generated Android/iOS projects by `plugins/with-filmsnaps-downloader`
during `expo prebuild`. Downloads persist across app restarts and surface in
the Downloads screen.

### File extension handling

A downloaded file keeps the **real container extension** of the bytes actually
written to disk (`.mkv`, `.mp4`, `.webm`, …), not a hard-coded default. The
extension is resolved with a clear precedence:

1. **JS-provided `extension`** — the download screen derives the extension from
   the provider's file listing (e.g. `file.name.split(".").pop()` for falix)
   and passes it through `enqueue({ extension })` → `buildFileName`. This wins
   so the _temp_ file is created with the correct extension from the start.
2. **Native response** — `FilmsnapsDownloadService.renameWithRealExtension`
   derives the extension from the final HTTP response URL (after redirects)
   plus the `Content-Type` header (`mimeToExt` maps `video/*` to extensions).
   This is the backstop that handles providers whose listing hides the
   real extension.
3. **Fallback `.mp4`** — only used when neither of the above yields one.

The resolved extension is emitted back to JS via the `onDownloadComplete`
bridge event (`extension` + `fileName`), persisted in the download record, and
used for the MediaStore `MIME_TYPE` at publish time — so the file appears with
the correct icon and opens in the right player.

> Note: providers like falix serve downloads from opaque tokenized URLs that
> redirect, so the native response URL / `Content-Type` is not a reliable
> extension source. For those providers the JS-provided `extension` (step 1)
> is the authoritative fix.

### Where downloaded files live

To make offline videos **easy to find and play outside the app** (like a Chrome
download) the app writes to the device's shared storage with **no permission
prompt**:

- **Android 10 (API 29) and later:** completed downloads are published into the
  system **MediaStore `Downloads`** collection under a `Filmsnaps/` subfolder.
  They appear in the system Downloads app, can be opened in any video player
  (e.g. VLC via "Open with"), and **survive app uninstall**.
- **Older Android (API 24–28):** files stay in the app-private
  `getExternalFilesDir` download directory — still no permission, but only
  visible inside FilmSnaps.
- **In-app playback** of the MediaStore file uses a small `OfflineFileProvider`
  bridge (`content://com.filmsnaps.offline/...`) so the native `expo-video`
  player can read the shared file without copying it.

Deleting an item from the in-app Downloads screen removes the shared MediaStore
entry as well, so used-space accounting stays accurate.

## Feedback

The settings page links to the deployed feedback portal (`@filmsnaps/feedback`),
loaded in-app via webview.
