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

## Feedback

The settings page links to the deployed feedback portal (`@filmsnaps/feedback`),
loaded in-app via webview.
