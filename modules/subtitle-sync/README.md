# subtitle-sync

## Watch-sync (live playback PCM tap)

While a video plays, an always-attached pass-through processor in the audio
sink taps pre-sonic PCM at content rate. The `WatchCollector` (native third
slot, outside the fetch-scan busy gates) bins speech into a rolling 90s
window and emits correlation-ready signals; `lib/subtitleSync/watchSync.ts`
owns the JS session (checkpoint first-apply, up to two refinements under
stricter guards, 30-min cap). HevcPlayer starts/stops/anchors the session;
SubtitleSheet registers the apply handler (sidecar re-add + prefs).

**Kill-switches** (JS rebundle only — no native rebuild):

- `WATCH_SYNC_ENABLED` in `apps/mobile/lib/subtitleSync/watchSync.ts` —
  disables the entire path (no native activate, no signal handling).
- `useSilero: false` on `activateWatchSync` — energy-only VAD for the
  watch window (fetch scans use `SUBTITLE_SYNC_SILERO` in `autoSync.ts`).

**Isolation probe** (no session required): `tapProbe()` / `tapProbeReset()`
from `expo-subtitle-sync` read the static `PlayerAudioTap` byte counters —
use these to verify the tap is receiving PCM (~192 KB/s stereo 48 kHz) before
debugging correlation.

**Engine thresholds**: `MARK_ON` / `MARK_OFF` live in
`apps/mobile/lib/subtitleSync/engineConstants.ts` (single JS source of truth)
and are passed on every `scanAsync` / `activateWatchSync`. The derived
`ENGINE_TOKEN` is embedded in the window-cache key so a threshold change
automatically orphans stale entries.

## Silero VAD asset hash record

Version control for model assets is SHA-256 (no git binary tracking).

| path                                      | sha256                                                             | bytes     | notes                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `android/src/main/assets/silero_vad.onnx` | `1A153A22F4509E292A94E67D6F9B85E8DEB25B4988682B7E174C65279D8788E3` | 2,327,524 | **BROKEN** — frozen output proven: desktop harness (onnxruntime-node 1.30.0) zeros=0.000592 ≈ sine=0.000589; device spike probs ~0.001 across 90 chunks, speech swap 0/101. Retired 2026-09-22. |
| `ios/silero_vad.onnx`                     | `1A153A22F4509E292A94E67D6F9B85E8DEB25B4988682B7E174C65279D8788E3` | 2,327,524 | **BROKEN** — same graph, same evidence as Android. Retired 2026-09-22.                                                                                                                          |
| `android/src/main/assets/silero_vad.onnx` | `2623A2953F6FF3D2C1E61740C6CDB7168133479B267DFEF114A4A3CC5BDD788F` | 2,327,524 | **CURRENT** — alive: desktop harness zeros=0.044263, sine200=0.306489, noise=0.124952, noise30 range=0.089828. Installed 2026-09-22.                                                            |
| `ios/silero_vad.onnx`                     | `2623A2953F6FF3D2C1E61740C6CDB7168133479B267DFEF114A4A3CC5BDD788F` | 2,327,524 | **CURRENT** — identical bytes to Android asset. Installed 2026-09-22.                                                                                                                           |

Source: `https://github.com/snakers4/silero-vad` tag **v5.1.2**, path
`src/silero_vad/data/silero_vad.onnx` (no release assets — source-tree only).

Rule: any change to the signal engine (VAD, scorer, mark thresholds) must
bump `CACHE_NAMESPACE` in `apps/mobile/lib/subtitleSync/cache.ts` — and, for
mark-threshold changes, update `engineConstants.ts` (the window-cache key
token `ENGINE_TOKEN` is derived from `MARK_ON`/`MARK_OFF` automatically).
Cached evidence from a different engine is stale by definition.

## Limitations

- **CAM/TELESYNC audio**: expect ~1–1.5s lateness (video is often shifted vs
  the audio the scanner hears); the onset `delta=` log line quantifies it for
  a given file. Engine output on clean WEBRip/BluRay is within ~0.2s.
