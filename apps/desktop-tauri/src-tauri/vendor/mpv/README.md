# mpv runtime

The player loads `libmpv-2.dll` at runtime. Put it here (and next to any codec
data mpv needs) before bundling:

```bash
pnpm --filter @filmsnaps/desktop-tauri fetch:libmpv
```

The app runs without it; the player then reports a clear "libmpv-2.dll was not
found" error instead of failing silently.
