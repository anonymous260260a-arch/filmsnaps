# FilmSnaps v1.0.4 — What's New

> **Released:** July 2026  
> **Platform:** Android (iOS coming soon)  
> **Build:** EAS Preview • Runtime 55.0.0 • Channel `preview`

---

## 🎥 Watching Just Got Better

### Next Episode — Now Works Across Seasons
Ever finish a season finale and hit "Next Episode" only to get a 404? Fixed.  
Going from **Season 1 Episode 10 → now correctly opens Season 2 Episode 1** instead of trying to play a non-existent Episode 11.

### Fullscreen "Next Episode" Button Stays Visible
The button used to disappear when you entered fullscreen. Now it **stays right where you expect it** — bottom-right, ready for the next episode.

### Screen Stays Awake During Playback
No more screen dimming mid-episode. We switched to the native `expo-keep-awake` module — reliable, battery-friendly, and it just works.

### Orientation Lock That Makes Sense
- **Fullscreen** → locks to **landscape** 📺
- **Exit fullscreen** → returns to **portrait** 📱
- No more awkward sideways browsing

---

## 🔄 Updates Without the App Store (OTA)

This build is configured for **Over-The-Air updates** via Expo EAS:
- **Channel:** `preview`  
- **Runtime:** `55.0.0`

Future bug fixes and small features will land on your device **instantly** — no Play Store update needed.  
*(Previous builds on different channels/runtime won't receive these updates — that's by design.)*

---

## 🎞️ More Ways to Watch

| Provider | Status |
|----------|--------|
| **ScreenScape** | ✅ Added (Server 3) |
| **Nxsha** | ✅ Added (Server 19) |
| **StreamGuide** | 🔄 Refactored — now standard iframe, more stable |

Backend moved to **Cloudflare Workers** with edge caching for faster API responses worldwide.

---

## 🛠️ Under the Hood (For the Curious)

- **Expo SDK 55** — React Native 0.82, React 18.3.1
- **Android build toolchain pinned** — Gradle 8.3, AGP 8.4
- **New app icon** — fresh look from our updated logo
- **Edge-to-edge display** on Android (immersive, modern)
- **GitHub Actions CI** — automated mobile builds
- **Fixed React Hooks ordering bug** that caused crashes on Movie/TV detail screens
- **Watch history resume** now respects season boundaries correctly

---

## 📥 For Developers / Testers

### Cloud Build (EAS)
```bash
eas build --platform android --profile preview
```

### Local Preview (Expo Go)
```bash
cd apps/mobile
npx expo start
# Scan QR with Expo Go app
```

---

## 🐛 Known Issues
- SVG filter warnings in console (harmless, native platform limitation)
- iOS build not yet verified — coming in next release

---

## 🙏 Thanks
Built with ❤️ for movie & TV lovers who just want to watch.

**Questions? Issues?** Open a GitHub issue or reach out on Discord.

---

*FilmSnaps v1.0.4 — Watch what you want, where you left off.*