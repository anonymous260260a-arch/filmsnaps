# FilmSnaps

> Discover, search, and watch movies and TV shows — across **Web**, **Mobile (Android)**, and **Desktop (Windows/macOS/Linux)**.

FilmSnaps is a cross-platform streaming discovery app powered by the TMDB API. Browse trending content, search with fuzzy matching, build your watchlist, and stream via secure provider players. Each platform is built native-first with platform-specific security layers for the video player.

---

## ✨ Features

### 🔍 Smart Search
- Fuzzy title matching with Fuse.js (handles typos, spacing, partial names)
- Hybrid ranking: fuzzy relevance + popularity + vote score
- Variant generation: "zombie land" → `Zombieland`, "spider-man" → `Spider Man`

### 📱 Cross-Platform
| Platform | Stack | Status |
|---|---|---|
| **Web** | Next.js 15 (App Router), Tailwind CSS, TypeScript | ✅ Live |
| **Mobile** | Flutter (Android 8.0+) | ✅ APK available |
| **Desktop** | Electron + Next.js | ✅ v1.0.0 |

### 🎬 Streaming Player
- **Web**: Proxy iframe with JS protection (popup/navigation blocking)
- **Mobile**: Flutter WebView with 16-layer JS injection protection
- **Desktop**: Separate BrowserWindow with **6 native security layers**:
  1. Isolated session partition (cookies/storage destroyed on close)
  2. Network-level request filtering (`session.webRequest` — pre-JS)
  3. Response header injection (CSP, security headers — cannot be stripped)
  4. Native navigation/popup/redirect blocking (`setWindowOpenHandler`, `will-navigate`)
  5. JS injection protection script (defense-in-depth)
  6. Resource watchdog (CPU/memory monitoring, auto-reload on abuse)

### 📋 Watchlist
- Save movies and TV shows
- Cross-session persistence
- Badge count in navigation

---

## 🏗 Project Structure

```
filmsnaps/
├── apps/
│   ├── web/                  # Next.js web app (primary UI)
│   │   ├── app/              # Pages & API routes (App Router)
│   │   │   ├── download/     # Multi-platform download page
│   │   │   ├── versions/     # Release history (mobile + desktop)
│   │   │   ├── watch/        # Video player page
│   │   │   └── ...
│   │   ├── components/       # Reusable UI components
│   │   ├── hooks/            # Custom React hooks
│   │   └── lib/              # API logic (TMDB, utils)
│   │
│   ├── desktop/              # Electron desktop app
│   │   ├── src/
│   │   │   ├── main.ts       # Main process (window, menus, IPC)
│   │   │   ├── preload.ts    # Context bridge API
│   │   │   ├── updater.ts    # Auto-updater (electron-updater)
│   │   │   ├── video/        # Secure video window manager
│   │   │   └── security/     # 6 security layers
│   │   └── electron-builder.yml
│   │
│   ├── mobile/               # Flutter Android app
│   │   └── ...
│   │
│   └── shared/               # Shared configs (provider registry)
│       └── src/
│           └── providers.ts  # Streaming provider definitions
│
├── packages/                  # Internal workspace packages
├── pnpm-workspace.yaml
└── package.json
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** v18+
- **pnpm** (recommended) or npm
- **TMDB API key** ([get one free](https://www.themoviedb.org/settings/api))

### Web App

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp apps/web/.env.example apps/web/.env
# Edit .env with your TMDB_API_KEY and other values

# Start development server
pnpm dev
```

The web app runs at [http://localhost:3000](http://localhost:3000).

### Desktop App (Development)

```bash
# Build the web app first (desktop bundles it)
cd apps/web && pnpm build

# Run desktop in dev mode
cd apps/desktop && pnpm dev
```

### Desktop App (Production Build)

```bash
# 1. Build the web app (standalone output)
cd apps/web && pnpm build

# 2. Build and package the desktop app
cd apps/desktop && pnpm dist

# Or build + publish to GitHub Releases:
# export GH_TOKEN=ghp_xxxxxxxxxxxx
# pnpm dist:publish
```

The output goes to `apps/desktop/release/`:
- **Windows**: `FilmSnaps-Setup-1.0.0.exe` (NSIS installer)
- **macOS**: `FilmSnaps-1.0.0-x64.dmg` / `FilmSnaps-1.0.0-arm64.dmg`
- **Linux**: `FilmSnaps-1.0.0.AppImage`

---

## 🔄 Desktop Auto-Updates

The desktop app uses `electron-updater` to check for new versions on GitHub Releases:

1. **On launch** → silently checks GitHub for a newer version
2. **Update found** → downloads in background (progress shown in-app)
3. **Ready** → shows "Restart & Update" button
4. **User clicks** → app restarts, new version installs

**To publish a new version:**

```bash
# 1. Bump version in apps/desktop/package.json
# 2. Build web app
cd apps/web && pnpm build
# 3. Tag and push
git tag v1.0.1
git push origin v1.0.1
# 4. Build and publish
cd apps/desktop && pnpm dist:publish
# 5. Update apps/web/public/desktop-versions.json with the new release
```

---

## 📱 Download

Get the latest version for your platform:

| Platform | Download |
|---|---|
| **Android** | [Download APK](https://filmsnaps.com/download) |
| **Windows** | [Download Installer](https://filmsnaps.com/download) |
| **macOS** | [Download DMG](https://filmsnaps.com/download) |
| **Linux** | [Download AppImage](https://filmsnaps.com/download) |

All releases are published on [GitHub Releases](https://github.com/anonymous260260a-arch/filmsnaps/releases).

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 15 (App Router) |
| **Language** | TypeScript, JavaScript |
| **Styling** | Tailwind CSS |
| **Database / Auth** | Supabase + Firebase |
| **API** | TMDB (The Movie Database) |
| **Desktop** | Electron, electron-builder, electron-updater |
| **Search** | Fuse.js (fuzzy matching) |
| **Package Manager** | pnpm (workspace monorepo) |
| **Deployment** | Netlify (web), GitHub Releases (desktop) |

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Made with ❤️ for movie lovers everywhere.
</p>
