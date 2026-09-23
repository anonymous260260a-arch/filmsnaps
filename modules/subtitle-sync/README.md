# subtitle-sync

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

Rule: any change to the signal engine (VAD, scorer) must bump BOTH cache
version tokens in `apps/mobile/lib/subtitleSync/cache.ts` (`CACHE_NAMESPACE`
and the `vN/win/` literal) — cached evidence from a different engine is
stale by definition.
