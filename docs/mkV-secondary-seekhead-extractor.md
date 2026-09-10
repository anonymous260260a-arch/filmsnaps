# MKV Secondary SeekHead Support in the Android Player

**Status:** Shipped and verified on device (2026-09-08). All previously unseekable test MKVs now seek.
**Scope:** Android app only (`expo-video` → Media3/ExoPlayer). Desktop and web are unaffected.
**Performance note:** The fix adds a small one-time load cost per playback (~0.3–1 s on an 11 Mbps Wi-Fi connection for the ranged fetch described below). Optimizations are **pending** — see [Performance & pending optimizations](#8-performance--pending-optimizations).

---

## 1. TL;DR

Some MKV files (notably mkvmerge-remuxed HEVC rips) reference their **Cues** (seek index) through a **secondary SeekHead** instead of the primary one. Stock Media3 1.8.0 — the extractor engine inside `expo-video` — only follows _direct_ `SeekHead → Cues` references, so these files play but report as **unseekable** (every seek snaps back to the start).

The fix vendors a patched copy of Media3's `MatroskaExtractor` into `expo-video` via `pnpm patch`. The copy adds a small **pre-pass** ("SSH pre-pass") that resolves the Cues position through the secondary SeekHead chain before the stock parser runs, then hands control back to stock logic unchanged. Making that work end-to-end required three things beyond the algorithm itself:

1. A **`buildFromSource` override** in `apps/mobile/package.json`, because the `expo-video` npm package otherwise ships a **prebuilt AAR** and never compiles the patched sources.
2. A **`checker-qual` compile dependency** in the patched module, because Media3 sources use Checker Framework nullness annotations that are not on `expo-video`'s compile classpath.
3. Correct **raw big-endian decoding of `SeekPosition`** values (they are _not_ varint-encoded inside their content).

---

## 2. Background: how seeking works in MKV and Media3

Matroska (MKV) is an EBML container. The relevant top-level structure:

```
EBML header
Segment
 ├─ SeekHead        (0x114D9B74)  ← "table of contents": where to find the other elements
 │   └─ Seek*       (0x4DBB)      ← { SeekID (EBML ID of target), SeekPosition (offset) }
 ├─ Info / Tracks / Tags / Attachments / Chapters
 ├─ Cluster*        (0x1F43B675)  ← the actual media, in playback order
 └─ Cues            (0x1C53BB6B)  ← the seek index: CueTime → CueClusterPosition pairs
```

`SeekPosition` is an offset **relative to the start of the Segment's content** (i.e. after the Segment element's own header). The sample files examined all follow this rule exactly.

Media3's `MatroskaExtractor` parses the file **sequentially**. Seeking requires the Cues, but Cues typically live _after_ the first Cluster, so the extractor does this:

1. While parsing the Segment's children it reads each `Seek` entry from the SeekHead. If an entry's `SeekID == Cues`, it stores the absolute offset in `cuesContentPosition`.
2. When it reaches the **first Cluster**, if `cuesContentPosition` is set it returns `RESULT_SEEK` to jump to the Cues (one small ranged HTTP request), parses the Cues into a `ChunkIndex`-based `SeekMap`, then seeks back and starts playback.
3. If `cuesContentPosition` was never set, it publishes `SeekMap.Unseekable` — playback works, but no seek will ever succeed.

## 3. The problem: files with a secondary SeekHead

There are two common ways muxers lay out the metadata:

**Layout A — direct Cues reference (works in stock Media3):**

```
Primary SeekHead: { Info → …, Tracks → …, Cues → X, Tags → … }
```

**Layout B — secondary SeekHead (broken in stock Media3):**

```
Primary SeekHead: { SeekHead → Y, Info → …, Tracks → …, Tags → … }   ← no Cues entry
Secondary SeekHead (at Y, near end of file): { Cues → X, … }
```

Layout B is spec-legal (players like VLC and mpv follow SeekHead chains). In stock Media3 1.8.0, `endMasterElement(ID_SEEK)` validates a `Seek` entry whose `SeekID == SeekHead` and then **discards it** — only `SeekID == Cues` assigns `cuesContentPosition`. Layout-B files therefore publish `SeekMap.Unseekable` and the app logs the familiar failure:

```
[ExpoVideoAdapter] seek to 2789.2s …
WARN [ExpoVideoAdapter] Seek to 2789.2s failed on unseekable stream (remained at 1.36s)
[HevcPlayer] Playback error: "Stream does not support seeking — switching to backup source"
```

### Evidence from the real files

Verified byte-level by downloading the head and tail of the failing files with HTTP `Range` requests and parsing the EBML manually (`ejCj8VhS`, 2,494,129,792 bytes):

| Element                    | Absolute offset   | Notes                                                                                                                 |
| -------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| EBML header                | 0 – 39            | DocType `matroska`                                                                                                    |
| Segment (ID + 8-byte size) | 40 – 51           | content starts at **52**                                                                                              |
| Primary SeekHead           | 52 – 74           | one entry: `SeekID=SeekHead`, `SeekPosition=0x94A965ED` = 2,494,129,645                                               |
| Void / Tracks              | 74 / 118          |                                                                                                                       |
| Tags                       | 2,494,129,608     |                                                                                                                       |
| **Secondary SeekHead**     | **2,494,129,697** | = 52 + 2,494,129,645 ✓ exactly where the Seek entry points                                                            |
| **Cues**                   | **2,494,093,721** | = 52 + 2,494,093,669 from the secondary SeekHead's entry; byte-verified; ~36 KB of CuePoints ending right before Tags |

`YN2QmC7Q` and the 3.6 GB variant have the identical layout with different offsets. The working file `mHT6Sh2p` is Layout A.

---

## 4. Constraints that shaped the design

- **No player swap.** Do not replace expo-video/Media3 with MPV or anything else. Fix must stay inside the Media3 extractor.
- **No Media3 upgrade.** The fork is pinned to the `androidxMedia3Version = "1.8.0"` that expo-video declares.
- **HTTP Range only.** Files stream from CDNs; the fix may issue only small ranged requests (no full-file downloads).
- **No JavaScript API change.** The fix is entirely native; the JS video-player surface is untouched.
- **Patch persistence.** Everything lives in `patches/expo-video@55.0.18.patch` (applied by `pnpm install`), so clean checkouts and EAS builds get it automatically.
- **`ExtractorInput` is forward-only.** There is no `seekTo()`. Backward jumps happen only by returning `Extractor.RESULT_SEEK` with a `PositionHolder`, which `ProgressiveMediaPeriod` honors by re-opening the data source at that offset (this works over HTTP Range).
- **The stock EBML reader keeps fragile state.** `DefaultEbmlReader` tracks open master elements by absolute file offsets. Any pre-pass that _consumes_ bytes would corrupt that stack. Hence the pre-pass is strictly **peek-only** (`peekFully` / `advancePeekPosition`) while scanning, and repositions exclusively via `RESULT_SEEK`.
- **Why a fork and not a subclass:** the classes the extractor needs (`DefaultEbmlReader`, `EbmlReader`, `EbmlProcessor`, `VarintReader`, `Sniffer`) are package-private inside `androidx.media3.extractor.mkv`, so they cannot be reused or overridden from another package. They are vendored alongside the fork in the same package.

---

## 5. The implementation

All patched files live in `node_modules/expo-video/android/src/main/java/expo/modules/video/utils/` and are persisted in `patches/expo-video@55.0.18.patch`:

| File                                      | Kind                    | Purpose                                                                                                                                              |
| ----------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SecondarySeekHeadMatroskaExtractor.java` | new (~3,120 lines)      | Fork of Media3 1.8.0 `MatroskaExtractor` + SSH pre-pass appended (clearly marked `BEGIN/END secondary-SeekHead pre-pass`)                            |
| `Sniffer.java`                            | new (~112 lines)        | Stock Media3 1.8.0 `Sniffer` (MKV sniffing), vendored — the fork's `sniff()` delegates to it                                                         |
| `DefaultEbmlReader.java`                  | vendored, made `public` | Stock EBML parser (was package-private)                                                                                                              |
| `EbmlReader.java`                         | vendored, made `public` | EBML reader interface                                                                                                                                |
| `EbmlProcessor.java`                      | vendored, made `public` | EBML event interface                                                                                                                                 |
| `VarintReader.java`                       | vendored, made `public` | EBML varint reader                                                                                                                                   |
| `CustomExtractorsFactory.java`            | new                     | Returns the SSH extractor **first**, then `DefaultExtractorsFactory` for everything else (non-MKV formats fail its sniff and fall through untouched) |
| `DataSourceUtils.kt`                      | modified (1 line)       | `buildMediaSourceFactory` now passes `CustomExtractorsFactory()` into `DefaultMediaSourceFactory`                                                    |

Call chain: `VideoPlayer.setMediaSource` → `VideoSource.toMediaSource` → `buildExpoVideoMediaSource` → `buildMediaSourceFactory(context, …)` → `DefaultMediaSourceFactory(context, CustomExtractorsFactory())`. There is exactly one media-source entry point in expo-video, so nothing bypasses the factory.

### The SSH pre-pass state machine

The fork's `read()` intercepts before stock logic:

```java
if (sshPhase != SSH_PHASE_DONE) {
    return sshResolveCues(input, seekPosition);   // pre-pass, peek-only + RESULT_SEEK
}
// ... stock read loop, byte-identical to Media3 1.8.0 ...
```

Phases:

```
SSH_PHASE_SCAN_PRIMARY
  ├─ ensure input is at 0 (RESULT_SEEK 0 if not; bounded retries)
  ├─ peek-scan the file head (≤64 elements, ≤1 MB):
  │     Segment content position, then the first SeekHead's Seek entries
  │     (stops immediately once a Cues or secondary-SeekHead reference is found)
  ├─ direct Cues found  → cuesContentPosition = X        → SSH_PHASE_DONE (no extra I/O)
  ├─ secondary ref found (and in range)                   → RESULT_SEEK to Y → SSH_PHASE_PARSE_SECONDARY
  └─ nothing usable    → SSH_PHASE_DONE (stock behavior; file may be unseekable)

SSH_PHASE_PARSE_SECONDARY
  ├─ confirm input landed at Y (bounded retries; on failure fall back gracefully)
  ├─ peek-parse the SeekHead at Y (verifies its ID really is SeekHead)
  ├─ Cues entry found → cuesContentPosition = absolute offset (segment base + relative)
  │                      → RESULT_SEEK 0 → SSH_PHASE_DONE
  ├─ chained SeekHead (≤3 hops) → RESULT_SEEK to next → stay in this phase
  └─ nothing found → RESULT_SEEK 0 → SSH_PHASE_DONE (stock behavior)

SSH_PHASE_DONE
  └─ stock MatroskaExtractor runs normally; when it reaches the first Cluster it
     seeks to cuesContentPosition (set by the pre-pass) exactly as it would for a
     Layout-A file, parses the Cues, builds the real SeekMap, and seeks back.
```

Design properties worth knowing:

- **Convergence with stock.** `cuesContentPosition` is the same field stock logic uses (`endMasterElement(ID_SEEK)`). The pre-pass only sets it earlier; both paths produce identical values, and stock never overwrites it (in Layout B the primary SeekHead has no Cues entry).
- **Bounded work.** `SSH_MAX_SCAN_ELEMENTS=64`, `SSH_MAX_SCAN_BYTES=1 MB`, `SSH_MAX_SEEK_ATTEMPTS=3`, `SSH_MAX_CHAIN_HOPS=3`. Everything degrades to stock behavior on malformed input instead of throwing.
- **Peek-only discipline.** The pre-pass never consumes input, so `DefaultEbmlReader`'s master-element stack is intact when stock parsing begins at 0.
- **Range safety.** Every resolved offset is checked against `ExtractorInput.getLength()` (known for HTTP progressive streams with `Content-Length`); out-of-range references are ignored.
- **Sniffing is unchanged.** The fork uses the stock `Sniffer`; non-MKV streams fail sniff and fall through to `DefaultExtractorsFactory`, so MP4/HLS/etc. are unaffected.

### The `SeekPosition` encoding gotcha (important)

`SeekPosition` is an EBML **unsigned integer element**. Its _content_ is a plain fixed-width big-endian integer of `size` bytes — **there is no varint length marker inside the content** (the marker exists only in the element's size prefix). This matches stock `DefaultEbmlReader.readInteger()`. Decoding the content as a varint silently produces garbage for values whose first byte is ≥ 0x80 — e.g. `0x94A965ED` (2,494,129,645) varint-decodes to `0x14` = **20**, which sends the ranged fetch to the wrong place entirely (the log then shows `element at target position is not a SeekHead (id 0x65ed)` — the tail of the value bytes). The SSH code reads it raw big-endian; keep it that way.

---

## 6. Build integration

### 6.1 The prebuilt-AAR trap (most important)

The `expo-video@55.0.18` npm package ships a **prebuilt Android AAR** inside itself:

```
node_modules/expo-video/local-maven-repo/host/exp/exponent/expo.modules.video/55.0.18/expo.modules.video-55.0.18.aar
```

By default, Expo autolinking resolves the module as the Maven artifact `host.exp.exponent:expo.modules.video:55.0.18` from that local repo — **the Java/Kotlin sources in `node_modules/expo-video/android/` are never compiled**, and any patch to them is silently ignored no matter how often caches are cleared. Gradle signals this with the boxed marker in the "Using expo modules" list:

```
- [📦] expo-video (55.0.18)     ← prebuilt AAR: patch NOT in the build
- expo-video (55.0.18)          ← built from source: patch in effect
```

**Fix (in place):** `apps/mobile/package.json` declares

```json
"expo": {
  "autolinking": {
    "buildFromSource": ["expo-video"]
  }
}
```

`buildFromSource` is Expo's official opt-out of prebuilt modules (matched as a regex against the module name by `expo-modules-autolinking`'s settings plugin). **Do not remove it.** When touching the build, always confirm the "Using expo modules" list shows `expo-video` _without_ the boxed marker.

### 6.2 `checker-qual` compile dependency

The vendored Media3 sources use Checker Framework annotations (`org.checkerframework.checker.nullness.qual.MonotonicNonNull`, `@RequiresNonNull`, …). Media3 does not expose them transitively on `expo-video`'s compile classpath, so the patched `node_modules/expo-video/android/build.gradle` adds:

```gradle
compileOnly 'org.checkerframework:checker-qual:3.43.0'
```

### 6.3 Patch mechanics

The commands are below; the full workflow (edit-dir iteration, Gradle-daemon
lock hang, `ERR_PNPM_ENOENT` recovery, lockfile hash reconciliation, compile
checks) lives in [expo-video-patching.md](expo-video-patching.md).

```bash
# start an edit copy of the (currently patched) package
pnpm patch expo-video@55.0.18
# … edit files under node_modules/.pnpm_patches/expo-video@55.0.18/ …
pnpm patch-commit "node_modules/.pnpm_patches/expo-video@55.0.18"
```

`patch-commit` regenerates `patches/expo-video@55.0.18.patch`, updates the `patch_hash` in `pnpm-lock.yaml`, and re-applies. Note it re-links `node_modules/expo-video`, which deletes that module's Gradle build dir — the next build recompiles it.

### 6.4 Building

```powershell
cd M:\filmsnaps-main\apps\mobile
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot\"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
npx expo run:android
```

A targeted check without a device:

```powershell
cd M:\filmsnaps-main\apps\mobile\android
.\gradlew.bat :expo-video:compileDebugJavaWithJavac
```

---

## 7. Verification

**Byte-level:** head/tail of the failing files were fetched via HTTP Range and parsed manually; the secondary SeekHead and Cues offsets predicted by the fixed decoder match the actual bytes exactly (e.g. Cues ID `1C53BB6B` found at absolute 2,494,093,721 in `ejCj8VhS`).

**Runtime (on device, `adb logcat -s SecondarySeekHeadMKV`):** every test URL now logs a successful pre-pass and seeks land correctly (`[ExpoVideoAdapter] readyToPlay: time≈target`), and the `"Stream does not support seeking"` fallback no longer triggers:

```
scan: Segment content starts at 52 (size …)
scan: SeekHead at 57 (size 17)
scan: Seek entry -> secondary SeekHead at 2494129697 (relative 2494129645)
scan: primary SeekHead references secondary SeekHead at 2494129697 …; requesting ranged fetch
secondary: reading SeekHead at position 2494129697
scan: Seek entry -> Cues at 2494093721 (relative 2494093669)
secondary: resolved Cues via secondary SeekHead; cuesContentPosition=2494093721 …; pre-pass succeeded
pre-pass complete; seeking back to 0 for the main parse
```

Layout-A files log `primary SeekHead references Cues directly; cuesContentPosition=… (no extra fetch needed)`.

**Compile:** `:expo-video:compileDebugJavaWithJavac` → `BUILD SUCCESSFUL`.

Test assets (pixeldrain IDs): `ejCj8VhS`, `YN2QmC7Q`, `mHT6Sh2p` (Layout A), plus the 3.6 GB and R2 (`hub/*`) variants served by the app's link lists.

---

## 8. Performance & pending optimizations

**Current cost (per playback start, Layout-B files only):**

1. One `RESULT_SEEK` to the secondary SeekHead → one small ranged HTTP request (~0.3–1 s observed on ~11 Mbps Wi-Fi, depending on CDN RTT).
2. Stock seek-for-cues then fetches the Cues element (~36 KB in the samples) — the same cost a Layout-A file pays.

**Pending optimizations** (deliberately deferred; do not lose this list):

- **Single tail range request.** In these files the secondary SeekHead and Cues are adjacent near the end of the file. One ranged read covering the tail region could resolve both in a single round trip. The current `Extractor` API is synchronous pull-based, so this likely means extending the pre-pass to detect "secondary SH near EOF" and fetch a combined window.
- **Parallelize / prefetch.** The head scan and the secondary-SeekHead fetch are currently sequential phases. A warm-up range request for the tail issued at the DataSource layer (keyed by URL) would hide most of the latency.
- **Cache resolved offsets per URL** (app-level, e.g. in the existing download/cache layer) so replays of the same source skip the pre-pass entirely.
- **Tune the peek budget.** With the early-exit in place the scan stops right after the first SeekHead, so the 1 MB cap can likely be reduced for metered networks.
- Keep the `[SecondarySeekHeadMKV]` logs (Log.i) until the optimization round lands — they are the primary field diagnostic.

---

## 9. Maintenance

**Upgrading `expo-video` / Media3:**

1. Re-vendor `MatroskaExtractor` (and `Sniffer`, `DefaultEbmlReader`, `EbmlReader`, `EbmlProcessor`, `VarintReader`) from the Media3 version the new expo-video pins (`androidxMedia3Version` in its `build.gradle`). The SSH pre-pass is a self-contained block (`BEGIN/END secondary-SeekHead pre-pass`) — port it onto the new stock source.
2. Check whether upstream gained secondary-SeekHead support (`endMasterElement(ID_SEEK)` handling `SeekID == SeekHead`). If it ever does, the whole patch can be retired — keep the pre-pass log line as the detector.
3. Re-diff the vendored fork against stock to confirm the only deltas are the package/public changes and the SSH block.
4. Re-verify with the test files in §7.

**Never remove** `buildFromSource: ["expo-video"]` from `apps/mobile/package.json`, the `checker-qual` line from the patched `build.gradle`, or the `patchedDependencies` entry in `pnpm-workspace.yaml` — any of the three silently reverts the fix.

**Debugging checklist when seeks fail again:**

1. `adb logcat -s SecondarySeekHeadMKV` — is the pre-pass running at all? If there are no lines, the build is using the prebuilt AAR (§6.1) or `CustomExtractorsFactory` isn't wired.
2. `element at target position is not a SeekHead (id 0x…)` → the ranged fetch landed on garbage; dump the file's SeekHead bytes and compare against the logged `relative` value.
3. `no Cues reference found; pre-pass failed (stock behavior applies)` → the secondary SeekHead parsed but had no Cues entry; check for a third-level SeekHead chain (hops are capped at 3).
4. Pre-pass succeeds but seeking still fails → the problem is downstream (stock seek-map build); capture `[ExpoVideoAdapter]` lines and the full `SecondarySeekHeadMKV` block.
