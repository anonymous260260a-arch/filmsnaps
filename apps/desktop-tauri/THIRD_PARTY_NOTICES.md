# Third-party notices

The desktop app redistributes the components below. Their licenses apply to those
files only; the application code stays under the project's own license.

## On-screen controls

`src-tauri/vendor/mpv/scripts/filmsnaps-osc.lua` is first-party code written for this project
against the documented mpv Lua API, so it needs no licence entry here.

## Geist font

- Project: [Geist](https://github.com/vercel/geist-font)
- Files: `src-tauri/vendor/mpv/fonts/Geist_*.ttf`, `src-tauri/vendor/mpv/fonts/GeistMono_*.ttf`
- License: SIL Open Font License, version 1.1
- Full text: `src-tauri/vendor/mpv/licenses/LICENSE-GEIST-OFL-1.1.txt`

The font files are bundled so the mpv OSC can render its labels in Geist and its figures in Geist Mono.

## libmpv

- Project: [mpv](https://mpv.io), version 0.42.0
- Build: the official LGPL release,
  [`libmpv-v0.42.0-x86_64-w64-mingw32-lgpl.zip`](https://github.com/mpv-player/mpv/releases/tag/v0.42.0)
- File: `src-tauri/vendor/mpv/libmpv-2.dll`
- License: GNU Lesser General Public License, version 2.1 or later, combined with
  FFmpeg under LGPL version 3
- License texts: `src-tauri/vendor/mpv/licenses/LICENSE.LGPL-2.1.txt`,
  `LICENSE.LGPL-3.0.txt`, `LICENSE.GPL-3.0.txt`
- Corresponding source: [mpv 0.42.0](https://github.com/mpv-player/mpv/tree/v0.42.0) and
  [FFmpeg](https://ffmpeg.org/download.html), built with `-Dgpl=false` against the
  LGPL FFmpeg variant, unmodified

The GPL build of libmpv would place this application under the GPL, so the LGPL
build is the one that ships. The DLL is loaded at runtime with `libloading` and
sits beside the executable, so anyone can replace it with their own build:
the app falls back to `MPV_LIBMPV_DLL` or a `libmpv-2.dll` next to the
executable. `scripts/fetch-libmpv.mjs` downloads the pinned archive and verifies
its SHA-256.

## mpv ad-blocking rules

`filters.txt` is loaded from the project root and is not redistributed with this
directory.
