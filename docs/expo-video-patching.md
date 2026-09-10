# Patching `expo-video` (pnpm patch)

How `patches/expo-video@55.0.18.patch` is maintained — the vendored MKV
secondary-SeekHead extractor, the `buildFromSource` requirement, and the full
edit → commit → verify workflow (including the Windows-specific pitfalls hit
on this repo). The design of the vendored extractor itself is documented in
[mkV-secondary-seekhead-extractor.md](mkV-secondary-seekhead-extractor.md).

## The pieces that must stay in sync

| File                                                                            | Role                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `patches/expo-video@55.0.18.patch`                                              | The diff applied to `node_modules/expo-video` on every `pnpm install`.                                                                                                                               |
| `pnpm-workspace.yaml` → `patchedDependencies`                                   | Registers the patch. Removing it silently reverts everything.                                                                                                                                        |
| `pnpm-lock.yaml` → `patchedDependencies."expo-video@55.0.18".hash`              | **sha256 hex** of the patch file. Must match after every patch edit.                                                                                                                                 |
| `apps/mobile/package.json` → `expo.autolinking.buildFromSource: ["expo-video"]` | Forces expo-modules-autolinking to compile the module from source. Without it Expo consumes the **prebuilt AAR** shipped in the npm package and the patch is never compiled into the app — silently. |

After a successful build, confirm the "Using expo modules" Gradle output shows
`expo-video` **without** the boxed `[📦]` prebuilt marker.

## Edit workflow

```bash
# from repo root — creates/prints the edit dir
pnpm patch expo-video@55.0.18
# edit dir: node_modules/.pnpm_patches/expo-video@55.0.18/
```

Edit files under the edit dir (e.g.
`node_modules/.pnpm_patches/expo-video@55.0.18/android/src/main/java/expo/modules/video/...`).

Tip: the edit dir persists across commits. For a quick iteration it is fine to
edit `node_modules/expo-video/...` directly (so a dev-client reload picks it up)
and then copy the changed files into the edit dir before committing.

Before committing, stop Gradle daemons — from `apps/mobile/android`:

```powershell
.\gradlew.bat --stop
```

Daemons hold locks on `node_modules/expo-video/android/build`; if they are
alive, the install phase of `patch-commit` can hang for 20+ minutes with no
output.

Then commit:

```bash
pnpm patch-commit node_modules/.pnpm_patches/expo-video@55.0.18
```

`patch-commit` writes `patches/expo-video@55.0.18.patch` **first**, then runs
an install that re-links `node_modules/expo-video` from the patch and updates
the lockfile hash. Note the re-link deletes that module's Gradle build dir —
the next build recompiles it.

## Reconciling the lockfile hash

If `patch-commit`'s install phase is interrupted (see pitfalls below), the
patch file is still written but `pnpm-lock.yaml` may be stale. Reconcile with a
plain `pnpm install`, then verify the hash matches the patch content:

```bash
sha256sum patches/expo-video@55.0.18.patch
grep -A3 "expo-video@55.0.18" pnpm-lock.yaml | grep hash
```

Both must be the same sha256 **hex** string. A mismatch means the installed
`node_modules/expo-video` may not contain your latest change.

## Windows pitfalls hit on this repo

- **`ERR_PNPM_ENOENT scandir 'node_modules\<pkg>_tmp_XXXX\node_modules'`**
  during the install phase (reported for the package being patched _or_
  unrelated ones like `slice-ansi` / `archiver-utils`). The patch file itself
  was still written. Root cause seen here: stale **nested** `node_modules`
  dirs left from an old hoisting layout. Fix: delete the offending nested dir
  (e.g. `rm -rf node_modules/slice-ansi/node_modules`) and run `pnpm install`
  again.
- **`patch-commit` hangs with no output**: Gradle daemons holding locks —
  `.\gradlew.bat --stop`, then re-run `pnpm install` standalone to finish the
  lockfile reconciliation.

## Compile & runtime verification

```powershell
cd M:\filmsnaps-main\apps\mobile
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"

# targeted Kotlin compile, no device needed:
cd android
.\gradlew.bat :expo-video:compileDebugKotlin

# full app build:
cd ..
npx expo run:android
```

Runtime logcat tags emitted by the patched sources: `SecondarySeekHeadMKV`
(extractor pre-pass), `PlayerHttp` (OkHttp traffic interceptor — download
rates per ranged request, used to diagnose playback stalls), and
`SidecarSubs` (external-subtitle merge/re-prepare diagnostics).

## JS-tunable native knobs (player-tuning patch markers)

The patch exposes module-level `Property`s on `ExpoVideo` so post-release
fixes stay in JS (OTA or remote config via `lib/playerConfig.ts`), not in
another native release. Policy lives in `lib/playerConfig.ts`; native only
implements the mechanism:

| Property                                     | Values                             | Effect                                                                                                                             |
| -------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `mkvExtractorMode`                           | `"vendored"` (default) / `"stock"` | Kill switch for the vendored secondary-SeekHead MKV extractor; read per `createExtractors()` so a flip applies at the next prepare |
| `defaultHttpHeaders`                         | `Record<string,string>`            | Merged _under_ per-source headers in `DataSourceUtils` — per-source always wins                                                    |
| `httpConnectTimeoutMs` / `httpReadTimeoutMs` | ms (clamped 1s–120s / 1s–600s)     | Timeouts of the shared player/probe OkHttp client; client rebuilt on change                                                        |

JS-side tuning values (probe timeout, switch/rebuffer windows, subtitle error
window, provider fallback delay) are centralized in `lib/playerConfig.ts` and
overridable by a remote JSON (`GET {API}/api/player-config`, cached in
AsyncStorage) — see that file's header comment for the post-ship fix path.

Kotlin gotchas hit before: okio's `Source.buffer()` is an extension and needs
an explicit `import okio.buffer`; `ForwardingSource` is `okio.ForwardingSource`.

JS-side changes never need any of this — only native sources live in the patch.
