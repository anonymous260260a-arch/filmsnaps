# Watch Page UX/UI Redesign — Expert Reference Document

## Goal

Redesign the **watch page** (video player) for **FilmSnaps** — a movie/TV streaming app. The current implementation is functional but the UX needs improvement. Your job is to create a best-in-class video player UX while preserving the app's **"Cinematic Void"** design identity (dark, amber-gold accents, glassmorphism, film-grain aesthetic).

### Key UX Principles

- **Make it intuitive** — first-time users should understand everything in <3 seconds
- **Mobile-first** — the touch experience drives everything
- **Reduce cognitive load** — fewer options visible at once, progressive disclosure
- **Keep the vibe** — dark void theme, amber-gold primary, glassmorphism overlays
- **Responsive** — works on desktop (large player) and mobile (compact controls)

---

## Design System — "Cinematic Void"

### Color Palette

```
void (#070708)        — Deepest background, near-black
surface (#0E0E11)     — Default surface for cards, player background
elevated (#16161A)    — Modal/sheet backgrounds
subtle (#222226)      — Borders, dividers, disabled states

text-primary (#F4F4F5)    — Near-white headings
text-secondary (#A1A1AA)  — Body text
text-tertiary (#52525B)   — Muted labels, timestamps

primary (#D4A237)     — Amber Gold: CTAs, active states, accents
primary-dim (#B88B2A) — Pressed/hover states for primary

success (#4CAF82)     — Watched badge, finished
destructive (#E05252) — Errors, warnings
info (#5B9CF6)        — Continue-watching bars, info indicators
```

### Glassmorphism Formula

```css
background: rgba(14, 14, 17, 0.75);
backdrop-filter: blur(20px);
```

### Typography

- **Display/Headings:** Playfair Display (700 weight) — `var(--font-display)`
- **Body/UI:** Inter (400, 500, 600 weight) — `var(--font-body)`
- Scale: h1=28px, h2=22px, h3=18px, body=14px, caption=12px

### Spacing

xs=4, sm=8, md=16, lg=24, xl=32, 2xl=48

### Shadows

```css
box-shadow: 0 4px 24px rgba(0,0,0,0.6);    /* cards */
box-shadow: 0 8px 60px rgba(0,0,0,0.8);    /* player container */
```

### Film Grain Overlay

A subtle noise texture at 3% opacity is rendered at the root level across the entire app. Pointer-events: none.

---

## Watch Page Architecture

### Component Tree

```
page.jsx (Server Component — fetches TMDB data)
  └── WatchClient.tsx (Client Component — orchestrator)
        └── PlayerProvider.tsx (React Context — player state)
              ├── ServerPickerSheet.tsx (provider dropdown with health dots)
              ├── SecureIframe.tsx (the actual <iframe> + all protection layers)
              │     ├── CSP attribute (parent-enforced onto cross-origin iframe)
              │     ├── sandbox attribute (per-provider config)
              │     └── Redirect Breaker (detects iframe navigation away)
              ├── Covering Overlays (per-provider band-aid divs over ads)
              └── PlayerControlOverlay.tsx (fullscreen toggle, loading state)
```

### Data Flow

```
1. User clicks movie/TV show → navigates to /watch/{type}/{id}
2. page.jsx fetches TMDB metadata (movie details, seasons list)
3. For TV: also fetches first season's episodes
4. Passes everything as props to WatchClient (server → client)
5. PlayerProvider initializes with default provider, season, episode
6. WatchClientContent builds embed URL from provider's baseUrl + embed path
7. SecureIframe renders with: src, sandbox, csp, all guards active
8. User can switch providers (ServerPickerSheet), seasons/episodes (EpisodeRail)
9. When provider changes → iframe key changes → full remount
```

---

## Full Source Code

### 1. WatchClient.tsx (The Main Orchestrator)

This is the component you'll redesign. It composes everything.

```tsx
/**
 * WatchClient — composed video player.
 */
'use client';

import React, { useTransition, useRef, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, X, Film, ArrowLeft } from 'lucide-react';
import { getSeasonAction } from '@/lib/actions';
import { getEnabledProviders } from '@filmsnaps/shared';
import { getImageUrl } from '@/lib/tmdb';
import { PlayerProvider, usePlayer } from '@/components/player/PlayerProvider';
import { SecureIframe } from '@/components/player/SecureIframe';
import { ServerPickerSheet } from '@/components/player/ServerPickerSheet';
import { EpisodeRail } from '@/components/player/EpisodeRail';
import { PlayerControlOverlay } from '@/components/player/PlayerControlOverlay';
import { buildIframeCSP } from '@/lib/movieProviders/cspBuilder';
import type { ProviderDefinition } from '@filmsnaps/shared';

// ── Types ──

interface WatchClientContentProps {
  contentid: string;
  plat: 'movie' | 'tv';
  initialMeta: any;
  initialSeasonData: any;
  defaultProvider?: string;
  minimal?: boolean;
}

// ── Embed URL builder — direct provider URLs ──
//
// Proxy/cf-proxy routes and FlareSolverr code are kept on disk but
// bypassed for now. Providers load directly in the iframe with
// per-provider sandbox attributes for security.

function buildEmbedUrl(
  provider: ProviderDefinition,
  contentid: string,
  plat: 'movie' | 'tv',
  selectedSeason: number,
  activeEpisode: number,
): string {
  const embedPath = plat === 'tv'
    ? provider.embed.tv(contentid, selectedSeason, activeEpisode)
    : provider.embed.movie(contentid);
  return `${provider.baseUrl}${embedPath}`;
}

function absUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${window.location.origin}${path}`;
}

// ── Content (inner) — lives inside PlayerProvider ──

function WatchClientContent({
  contentid,
  plat,
  initialMeta,
  initialSeasonData,
  minimal = false,
}: WatchClientContentProps) {
  const [isPending, startTransition] = useTransition();
  const [seasonData, setSeasonData] = useState(initialSeasonData);
  const [showNotice, setShowNotice] = useState(true);
  const [electronVideoOpen, setElectronVideoOpen] = useState(false);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  const {
    selectedProviderId,
    setSelectedProvider,
    selectedSeason,
    activeEpisode,
    setActiveEpisode,
    setSelectedSeason,
    refreshKey,
    cpuWarning,
    mediaType,
    contentId,
  } = usePlayer();

  // Only show providers marked for web
  const providers = useMemo(
    () => getEnabledProviders().filter((p) => p.platforms?.includes('web')),
    [],
  );

  // Resolve current provider object
  const currentProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? providers[0],
    [providers, selectedProviderId],
  );

  // ── Desktop Electron integration ──
  const isDesktop = typeof window !== 'undefined' && (window as any).electronAPI?.isDesktop === true;
  const activeProviderRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    if (!currentProvider || !currentProvider.baseUrl) return;
    if (activeProviderRef.current === currentProvider.id) return;
    activeProviderRef.current = currentProvider.id;

    const embedUrl = absUrl(buildEmbedUrl(currentProvider, contentid, plat, selectedSeason, activeEpisode));
    (window as any).electronAPI?.openVideo({
      type: plat,
      id: contentid,
      season: plat === 'tv' ? selectedSeason : undefined,
      episode: plat === 'tv' ? activeEpisode : undefined,
      provider: currentProvider.id,
      embedUrl,
    }).then((result: any) => {
      if (result?.success) setElectronVideoOpen(true);
    });
  }, [isDesktop, currentProvider]);

  useEffect(() => {
    if (!isDesktop || !(window as any).electronAPI) return;
    const handleClosed = () => setElectronVideoOpen(false);
    (window as any).electronAPI.onVideoClosed?.(handleClosed);
    return () => (window as any).electronAPI?.removeVideoClosedListener?.();
  }, [isDesktop]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && (window as any).electronAPI) {
        (window as any).electronAPI.closeVideo?.();
        (window as any).electronAPI.removeVideoClosedListener?.();
      }
    };
  }, []);

  // ── Season change handler ──
  const handleSeasonChange = useCallback(
    (seasonNum: number) => {
      setSelectedSeason(seasonNum);
      setActiveEpisode(1);
      startTransition(async () => {
        const data = await getSeasonAction(contentid, seasonNum);
        setSeasonData(data);
      });
    },
    [contentid, setSelectedSeason, setActiveEpisode],
  );

  // ── Provider selection handler ──
  const handleProviderSelect = useCallback(
    (provider: ProviderDefinition) => {
      setSelectedProvider(provider.id);
    },
    [setSelectedProvider],
  );

  // ── Embed URL (for the iframe) ──
  const embedUrl = currentProvider
    ? buildEmbedUrl(currentProvider, contentid, plat, selectedSeason, activeEpisode)
    : '';

  // ── Re-open Electron player ──
  const reopenElectronPlayer = useCallback(() => {
    if (!currentProvider) return;
    setElectronVideoOpen(false);
    setTimeout(() => {
      const embedUrl = absUrl(buildEmbedUrl(currentProvider, contentid, plat, selectedSeason, activeEpisode));
      (window as any).electronAPI?.openVideo({ ... }).then((r: any) => {
        if (r?.success) setElectronVideoOpen(true);
      });
    }, 100);
  }, [currentProvider, contentid, plat, selectedSeason, activeEpisode]);

  const openElectronPlayer = useCallback(() => { /* same pattern */ }, [...]);

  const displayTitle = initialMeta?.name || initialMeta?.title || '';
  const year = (initialMeta?.release_date || initialMeta?.first_air_date || '').slice(0, 4);

  return (
    <div className="min-h-screen bg-[#070708] text-[#A1A1AA]">
      <main className={`max-w-6xl mx-auto px-3 sm:px-4 ${
        minimal ? 'min-h-screen flex flex-col justify-center py-0 sm:py-2'
        : 'py-4 sm:py-6 lg:py-12'
      }`}>
        {/* ── Header Area ── */}
        {!minimal && (
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 sm:gap-4 mb-6 sm:mb-8 px-1 sm:px-2">
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-[#F4F4F5] tracking-tight leading-none mb-2"
                  style={{ fontFamily: 'var(--font-display)' }}>
                {displayTitle}
              </h1>
              <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-[#52525B]">
                <span className="text-[#F4F4F5]/80">{plat}</span>
                <span className="w-1 h-1 rounded-full bg-[#222226]" />
                <span>{year}</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Server Picker ── */}
        {!minimal && (
          <ServerPickerSheet
            onSelect={handleProviderSelect}
            selectedId={selectedProviderId}
          />
        )}

        {/* ── Dismissible Notice ── */}
        {!minimal && showNotice && (
          <div className="flex items-center gap-3 text-sm bg-white/[0.03] px-4 sm:px-5 py-3 rounded-xl border border-white/[0.05] mb-4 sm:mb-6 backdrop-blur-sm">
            <AlertCircle size={16} className="text-[#A1A1AA] flex-shrink-0" />
            <p className="flex-1 text-xs sm:text-sm text-[#A1A1AA]">
              If the video is stuck, try switching to a different server above.
            </p>
            <button onClick={() => setShowNotice(false)}
              className="text-[#52525B] hover:text-[#F4F4F5] transition-colors p-1 flex-shrink-0"
              aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}

        {/* ── Video Player ── */}
        {isDesktop && electronVideoOpen ? (
          <DesktopVideoPlayer provider={currentProvider} meta={initialMeta}
            plat={plat} onReopen={reopenElectronPlayer} />
        ) : isDesktop && !electronVideoOpen ? (
          <DesktopVideoIdle provider={currentProvider} meta={initialMeta}
            plat={plat} onOpen={openElectronPlayer} />
        ) : (
          <div ref={playerContainerRef}
            className="relative aspect-video w-full rounded-xl sm:rounded-2xl overflow-hidden
              bg-[#0E0E11] shadow-[0_8px_60px_rgba(0,0,0,0.8)] ring-1 ring-white/[0.08] group/player">

            {/* Ambient glow */}
            <div className="absolute -inset-4 bg-gradient-radial from-[#D4A237]/5
              via-transparent to-transparent opacity-60 pointer-events-none z-0" />

            {/* CPU Warning overlay */}
            {cpuWarning && currentProvider && (
              <div className="absolute inset-0 z-50 flex items-center justify-center
                bg-[#070708]/80 backdrop-blur-sm">
                <div className="flex items-center gap-3 text-sm text-[#E05252]
                  bg-red-500/10 px-5 py-4 rounded-xl border border-red-500/20 max-w-md mx-4">
                  <AlertCircle size={16} className="text-[#E05252] flex-shrink-0" />
                  <div className="flex-1 text-xs sm:text-sm">
                    This server is using too much CPU — stopped.
                    <span className="block mt-1 text-[#A1A1AA]">
                      Switch to a different server above.
                    </span>
                  </div>
                  <button className="text-[#52525B] hover:text-[#F4F4F5] p-1">
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* The iframe */}
            {!cpuWarning && embedUrl && (
              <SecureIframe
                src={embedUrl}
                sandbox={currentProvider?.sandbox}
                csp={currentProvider ? buildIframeCSP(currentProvider) : undefined}
                key={`provider-${selectedProviderId}-${refreshKey}`}
              />
            )}

            {/* Covering overlays — per-provider ad band-aids */}
            {currentProvider?.coverOverlays?.map((o, i) => (
              <div key={`cover-${i}`} className="absolute z-20" style={{
                top: o.top, left: o.left, width: o.width, height: o.height,
                borderRadius: '20px', background: 'rgba(14, 14, 17, 0.9)',
              }} />
            ))}

            {/* Loading / controls overlay */}
            <PlayerControlOverlay isPending={isPending} />
          </div>
        )}

        {/* ── Episode Rail (TV only) ── */}
        <EpisodeRail
          seasonData={seasonData}
          seasons={initialMeta?.seasons}
          onSeasonChange={handleSeasonChange}
        />
      </main>
    </div>
  );
}

// ── Main WatchClient wrapper ──
export default function WatchClient({
  contentid, plat, initialMeta, initialSeasonData,
  defaultProvider, minimal = false, initialSeason = 1, initialEpisode = 1,
}: WatchClientProps) {
  return (
    <PlayerProvider
      mediaType={plat} contentId={contentid}
      initialProviderId={defaultProvider} initialSeason={initialSeason}
      initialEpisode={initialEpisode} minimal={minimal}
      maxEpisodeCount={initialSeasonData?.episodes?.length ?? 99}>
      <WatchClientContent {...} />
    </PlayerProvider>
  );
}
```

---

### 2. ServerPickerSheet.tsx (Provider/Server Selector)

Current state: A `<select>` dropdown at the top with health status emoji dots (🟢🟡🔴⚪) showing provider availability. Shows after a health check runs on mount.

```tsx
export function ServerPickerSheet({ onSelect, selectedId }: ServerPickerSheetProps) {
  const { minimal } = usePlayer();
  const [healthCache, setHealthCache] = useState<HealthCache>(new Map());
  const providers = useMemo(
    () => getEnabledProviders().filter((p) => p.platforms?.includes('web')),
    [],
  );

  // Health check on mount
  useEffect(() => {
    let alive = true;
    checkAllProviders(providers, { timeoutMs: 5000 }).then((cache) => {
      if (alive) setHealthCache(cache);
    });
    return () => { alive = false; };
  }, [providers]);

  if (minimal) return null;

  return (
    <div className="relative group mb-4 sm:mb-6">
      {/* "SERVER" floating label */}
      <div className="absolute -top-2.5 left-4 px-2 bg-[#070708]
        text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 z-10
        group-focus-within:text-[#D4A237] transition-colors">Server</div>

      <div className="relative flex items-center">
        <select value={selectedId ?? ''}
          onChange={(e) => { const p = providers.find(pr => pr.id === e.target.value); if (p) onSelect(p); }}
          aria-label="Select Server"
          className="w-full bg-[#0E0E11]/80 backdrop-blur hover:bg-[#16161A]
            focus:bg-[#16161A] border border-[#222226] focus:border-[#D4A237]/30
            text-[#F4F4F5] text-sm font-bold py-4 px-5 rounded-2xl
            appearance-none cursor-pointer
            shadow-[0_8px_30px_rgba(0,0,0,0.4)] ...">
          {providers.map((p) => {
            const health = healthCache.get(p.id);
            const statusDot = health?.alive
              ? health.latencyMs < 2000 ? '🟢' : '🟡'
              : health !== undefined ? '🔴' : '⚪';
            return (
              <option key={p.id} value={p.id} className="bg-[#0E0E11] text-[#F4F4F5] py-4">
                {statusDot} {p.displayName || p.name}
              </option>
            );
          })}
        </select>
        <ChevronDown className="absolute right-5 text-zinc-500 pointer-events-none" size={18} />
      </div>
    </div>
  );
}
```

**Provider data shape** (from registry):
```typescript
{
  id: 'nxsha',
  displayName: 'Server 1 [Multi lang, Fast]',
  baseUrl: 'https://web.nxsha.app',
  platforms: ['web'],
  sandbox: 'allow-scripts allow-same-origin ',
  coverOverlays?: [{ top: '80px', left: '40%', width: '200px', height: '100px' }],
}
```

---

### 3. EpisodeRail.tsx (Season + Episode Selectors for TV)

```tsx
export function EpisodeRail({ seasonData, seasons = [], onSeasonChange }: EpisodeRailProps) {
  const { selectedSeason, activeEpisode, mediaType, setActiveEpisode,
    goToNextEpisode, goToPrevEpisode, minimal } = usePlayer();

  if (mediaType !== 'tv' || minimal) return null;

  return (
    <>
      {/* Season & Episode Selector grid */}
      <div className="mt-6 sm:mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        {/* Season Selector */}
        {seasons.length > 0 && (
          <div className="relative group">
            <div className="absolute -top-2.5 left-4 px-2 bg-[#070708]
              text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 z-10
              group-focus-within:text-[#D4A237]">Season</div>
            <select value={selectedSeason}
              onChange={(e) => onSeasonChange(Number(e.target.value))}
              className="w-full bg-[#0E0E11]/80 backdrop-blur hover:bg-[#16161A]
                border border-[#222226] focus:border-[#D4A237]/30
                text-[#F4F4F5] text-sm font-bold py-4 px-5 rounded-2xl
                appearance-none cursor-pointer ...">
              {seasons.filter(s => s.season_number > 0).map((s) => (
                <option key={s.id} value={s.season_number} className="bg-[#0E0E11] ...">
                  Season {s.season_number < 10 ? `0${s.season_number}` : s.season_number}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-5 text-zinc-500 pointer-events-none" size={18} />
          </div>
        )}

        {/* Episode Selector */}
        <div className="relative group">
          <div className="absolute -top-2.5 left-4 px-2 bg-[#070708]
            text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 z-10
            group-focus-within:text-[#D4A237]">Episode</div>
          <select value={activeEpisode}
            onChange={(e) => setActiveEpisode(Number(e.target.value))}
            className="w-full bg-[#0E0E11]/80 backdrop-blur hover:bg-[#16161A]
              border border-[#222226] focus:border-[#D4A237]/30
              text-[#F4F4F5] text-sm font-bold py-5 px-6 rounded-2xl
              appearance-none cursor-pointer ...">
            {seasonData?.episodes?.map((ep) => (
              <option key={ep.id} value={ep.episode_number} className="bg-[#0E0E11] ...">
                {ep.episode_number < 10 ? `0${ep.episode_number}` : ep.episode_number}
                {' — '}{ep.name.slice(0, 40)}
              </option>
            ))}
          </select>
          <div className="absolute right-5 flex items-center gap-2 border-l border-[#222226] pl-4">
            <ChevronDown className="text-zinc-500 pointer-events-none" size={18} />
          </div>
        </div>
      </div>

      {/* Now Playing & Navigation */}
      <div className="mt-8 sm:mt-12 flex flex-col sm:flex-row items-start sm:items-center
        justify-between border-t border-white/5 pt-6 sm:pt-10 gap-5 sm:gap-6">
        <div className="flex items-center gap-4 sm:gap-8">
          {/* Green pulsing dot + "Now Watching" label */}
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative rounded-full h-2 w-2 bg-green-500" />
          </span>
          <p className="text-[9px] font-black uppercase text-zinc-600 tracking-widest">Now Watching</p>
          <h2 className="text-sm font-bold text-[#F4F4F5]">
            S{selectedSeason < 10 ? `0${selectedSeason}` : selectedSeason} :
            E{activeEpisode < 10 ? `0${activeEpisode}` : activeEpisode}
          </h2>
        </div>

        {/* Prev / Next buttons */}
        <div className="flex items-center gap-3">
          <button disabled={activeEpisode <= 1} onClick={goToPrevEpisode}
            className="h-12 w-12 flex items-center justify-center rounded-2xl
              bg-[#0E0E11] border border-white/5 text-zinc-500
              hover:text-[#F4F4F5] hover:border-white/20 disabled:opacity-20 ...">
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button disabled={activeEpisode >= maxEpisode} onClick={goToNextEpisode}
            className="h-12 w-12 flex items-center justify-center rounded-2xl
              bg-[#D4A237] text-[#070708] hover:bg-[#B88B2A] disabled:opacity-20 ...">
            <SkipForward size={18} fill="currentColor" />
          </button>
        </div>
      </div>
    </>
  );
}
```

---

### 4. PlayerControlOverlay.tsx (Controls on the Video)

```tsx
export function PlayerControlOverlay({ isPending = false }: PlayerControlOverlayProps) {
  const { isFullscreen, toggleFullscreen, cpuWarning, setCpuWarning, minimal } = usePlayer();
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-hide after 4s of inactivity
  useEffect(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 4000);

    const show = () => {
      setVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), 4000);
    };
    document.addEventListener('mousemove', show);
    document.addEventListener('touchstart', show);
    return () => {
      document.removeEventListener('mousemove', show);
      document.removeEventListener('touchstart', show);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <>
      {/* Fullscreen toggle — bottom-right */}
      <button onClick={toggleFullscreen}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        className={`absolute bottom-3 right-3 z-20 flex items-center gap-2 px-3 py-2
          rounded-lg bg-[#070708]/60 backdrop-blur-sm border border-white/10
          text-white/80 hover:text-white hover:bg-[#070708]/80
          transition-all duration-200 text-xs font-semibold tracking-wide
          ${visible ? 'opacity-100' : 'opacity-0 group-hover/player:opacity-100'}`}>
        {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
      </button>

      {/* CPU Warning overlay */}
      {cpuWarning && (
        <div className="absolute inset-0 z-30 flex items-center justify-center
          bg-[#070708]/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 text-sm text-[#E05252]
            bg-red-500/10 px-5 py-4 rounded-xl border border-red-500/20 max-w-md mx-4">
            <AlertCircle size={16} className="text-[#E05252]" />
            <div className="flex-1 text-xs sm:text-sm">
              This server is using too much CPU — stopped.
              <span className="block mt-1 text-[#A1A1AA]">
                Switch to a different server above.
              </span>
            </div>
            <button onClick={() => setCpuWarning(false)}
              className="text-zinc-600 hover:text-zinc-300 p-1" aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Loading spinner */}
      {isPending && (
        <div className="absolute inset-0 bg-[#070708]/90 backdrop-blur-md
          flex items-center justify-center z-50">
          <div className="animate-spin w-8 h-8 border-2 border-[#D4A237]
            border-t-transparent rounded-full" />
        </div>
      )}
    </>
  );
}
```

---

### 5. PlayerProvider.tsx (React Context — State Management)

```tsx
export interface PlayerProviderState {
  selectedProviderId: string | null;
  selectedSeason: number;
  activeEpisode: number;
  isFullscreen: boolean;
  cpuWarning: boolean;
  refreshKey: number;          // incremented to force iframe remount
  mediaType: 'movie' | 'tv';
  contentId: string;
  minimal: boolean;
}

export interface PlayerProviderActions {
  setSelectedProvider: (id: string) => void;
  setSelectedSeason: (season: number) => void;
  setActiveEpisode: (episode: number) => void;
  setIsFullscreen: (fs: boolean) => void;
  setCpuWarning: (warn: boolean) => void;
  refreshIframe: () => void;
  toggleFullscreen: () => void;
  goToNextEpisode: () => void;
  goToPrevEpisode: () => void;
}
```

Key design note: Rapidly-changing state (currentTime, duration) lives in `useRef` NOT in this Context to avoid re-rendering the SecureIframe on every progress tick.

---

### 6. SecureIframe.tsx (The Security Layer)

This wraps the actual `<iframe>` and adds all protection layers. **DO NOT redesign this component's interface** — focus on UX only. The security layers are:

| Layer | What it does |
|---|---|
| `sandbox` attribute | Browser-enforced restrictions (popups, navigation, forms) — per-provider config |
| `csp` attribute | Parent-enforced CSP onto cross-origin iframe — blocks workers (miners), tracking beacons, ad frames |
| Navigation Guard | Polls `window.location.href` every 500ms — blocks `window.location` hijack from iframe |
| `window.open` seal | Overrides `window.open` to return null — blocks popup ads |
| Popup Guard | Focus reclaim timer — if a popup steals focus, yanks it back |
| CPU Watchdog | Checks `performance.now()` lag every 3s — if JS exceeds 300ms lag 3 consecutive times, shows warning and blanks the iframe |
| Session timeout | Auto-refreshes iframe after 60 minutes |
| Redirect Breaker | Polls `iframe.contentWindow` every 1.5s — if cross-origin error (navigation to ad domain), resets `iframe.src` to original |

All protection layers are optional via props and default to enabled.

---

## Server Component (page.jsx)

This is the entry point that fetches TMDB data server-side:

```jsx
const Page = async ({ params, searchParams }) => {
  const { id } = await params;
  const [plat, contentid] = id;

  const meta = await tmdb(`/${plat}/${contentid}`);
  const sp = await searchParams;

  let initialSeasonData = null;
  let initialSeason = 1;
  let initialEpisode = 1;

  if (plat === 'tv') {
    const requestedSeason = sp.season
      ? parseInt(sp.season)
      : (meta.seasons?.find(s => s.season_number > 0)?.season_number ?? 1);
    initialSeason = requestedSeason;
    initialEpisode = sp.episode ? parseInt(sp.episode) : 1;
    initialSeasonData = await tmdb(`/tv/${contentid}/season/${requestedSeason}`);
  }

  return (
    <WatchClient
      contentid={contentid} plat={plat} initialMeta={meta}
      initialSeasonData={initialSeasonData}
      defaultProvider={sp.provider} minimal={sp.minimal === '1'}
      initialSeason={initialSeason} initialEpisode={initialEpisode}
    />
  );
};
```

---

## User Flow & States to Handle

### Main States

| State | What the user sees | Current handling |
|---|---|---|
| **Loading** | Player area shows nothing until iframe loads | Weak — just a spinning amber ring via PlayerControlOverlay when `isPending` |
| **Playing** | Video playing in iframe | Iframe does its thing — no real integration |
| **Provider Switch** | User clicks different server → iframe remounts | `key={provider.id}` forces remount, but no loading indicator during the transition |
| **Episode Switch** | User picks different episode → URL changes → iframe reloads | Similar — `key` changes, no transition UX |
| **Empty/No Providers** | No providers available on web | Currently crashes — `providers[0]` would be undefined |
| **Iframe Ad Redirect** | Iframe navigates to ad page | Redirect Breaker detects and resets src |
| **CPU Abuse** | Provider scripts peg CPU >300ms for 3 checks | Warning overlay shown, iframe blanked, user told to switch |

### Missing UX Features (Design Opportunities)

- **No loading skeleton** — the player area is empty black until iframe loads
- **No error state** — if the provider URL is unreachable, nothing happens
- **No retry mechanism** — user has to manually switch servers
- **No progress tracking** — no "continue watching" or resume point inside the player
- **No playback controls** — can't play/pause/seek from the parent page (iframe sandbox prevents it)
- **No keyboard shortcuts** — space for play/pause, f for fullscreen, arrows for seek
- **No picture-in-picture** — could be offered as a mode
- **No volume control** — relies entirely on the provider's player
- **Mobile touch** — the server picker and episode rail are functional but not touch-optimized
- **Fullscreen transitions** — the fullscreen button works but there's no animation or overlay
- **No "mini player"** — when user scrolls down to read info, video continues playing in a corner
- **No episode auto-advance** — after an episode ends, there's no "next episode" prompt
- **No episode thumbnails** — the episode selector just shows numbers and names

---

## Design Constraints

### What You CAN Change
- Layout of the player page (header, server picker, episode rail positioning)
- Visual design of all controls (ServerPickerSheet, PlayerControlOverlay, EpisodeRail)
- Loading states, error states, empty states
- Animation and transitions
- Mobile responsiveness
- Touch interactions and gestures
- Keyboard shortcuts
- Mini player / picture-in-picture
- Progress bar, timeline preview (if you add server-side progress tracking)
- Episode thumbnails in the rail
- "Next episode" auto-play prompt

### What You CANNOT Change (Security)
- **SecureIframe interface** — props are fixed (src, sandbox, csp, guards)
- **Cross-origin iframe DOM** — cannot inject CSS/JS into the provider's page
- **iframe CSP attribute** — currently uses `buildIframeCSP()` which blocks workers and restricts connect-src
- **sandbox attribute** — per-provider from registry
- **Protection layers** — nav guard, popup guard, CPU watchdog, redirect breaker are all required

### Mobile Web (PWA) Considerations
- Touch targets must be ≥48px
- Orient to landscape in fullscreen
- Bottom sheet for server picker (not dropdown)
- Swipe gestures for episode navigation
- The player should auto-enter fullscreen on mobile when tapping play
- Safe area insets for notched phones

### Desktop Considerations
- The player should be max ~1200px centered
- Controls reveal on hover and auto-hide
- Picture-in-picture option
- Keyboard shortcuts accessible
- Electron desktop has a separate video window — the web player is the fallback

---

## Provider Configuration Reference

Each provider in the registry defines:

```typescript
interface ProviderDefinition {
  id: string;                       // lowercase unique id
  name: string;                     // code name
  displayName?: string;             // shown in UI e.g. "Server 1 [Multi lang]"
  baseUrl: string;                  // e.g. "https://web.nxsha.app"
  enabled?: boolean;                // false = hidden
  platforms?: ('web' | 'mobile')[]; // platform restriction
  sandbox?: string;                 // iframe sandbox attr
  coverOverlays?: Array<{           // band-aid div positions
    top: string; left: string;
    width: string; height: string;
  }>;
  embed: {
    movie: (id: string) => string;
    tv: (id: string, season: number, episode: number) => string;
  };
}
```

Web providers (currently 6): nxsha, screenscape, nhdapi, zxcstream, cinemaos, chillflix

---

## Design Tokens (Importable)

```typescript
const colors = {
  void: '#070708', surface: '#0E0E11', elevated: '#16161A', subtle: '#222226',
  'text-primary': '#F4F4F5', 'text-secondary': '#A1A1AA', 'text-tertiary': '#52525B',
  primary: '#D4A237', 'primary-dim': '#B88B2A',
  secondary: '#8B5CF6', success: '#4CAF82', destructive: '#E05252', info: '#5B9CF6',
};

const typography = {
  h1: { size: 28, lineHeight: 32, fontFamily: 'display', fontWeight: 700 },
  h2: { size: 22, lineHeight: 28, fontFamily: 'display', fontWeight: 700 },
  h3: { size: 18, lineHeight: 24, fontFamily: 'body', fontWeight: 600 },
  body: { size: 14, lineHeight: 20, fontFamily: 'body', fontWeight: 400 },
  caption: { size: 12, lineHeight: 16, fontFamily: 'body', fontWeight: 500 },
};

const glass = {
  background: 'rgba(14, 14, 17, 0.75)',
  backdropFilter: 'blur(20px)',
};

const shadows = {
  card: '0 4px 24px rgba(0,0,0,0.6)',
  player: '0 8px 60px rgba(0,0,0,0.8)',
};
```

---

## Summary for the Expert

### What we need from you

1. **Redesign the watch page layout** — header area, server picker, player container, episode rail. Current layout is a simple vertical stack. Think about: tabs, collapsible sections, side panel on desktop, bottom sheet on mobile.

2. **Beautiful loading/error states** — currently the player area is just empty black until the iframe loads. Design a branded loading state (maybe "Scanning projection room..." with the amber spinner), an error state with retry, and an empty state when no providers are available.

3. **Touch-optimized controls** — the server picker dropdown should be a bottom sheet on mobile. Episodes should be swipeable. Fullscreen should auto-trigger on mobile tap.

4. **Episode rail redesign** — the dual dropdown layout (season + episode) is functional but not great. Consider: horizontal episode thumbnails, a Netflix-style episode picker, collapsible season accordion, etc.

5. **Now Playing / Metadata area** — what shows below the player should feel premium: episode title, description, next episode countdown, auto-play toggle.

6. **Keyboard shortcuts** — space=play/pause, f=fullscreen, left/right=seek, up/down=volume, n=next episode, p=previous episode.

7. **Mini player** — when the user scrolls down past the player, the player shrinks to a floating corner so they can continue watching while browsing details.

8. **Full-screen experience** — the player in fullscreen should feel cinematic. Minimal chrome, overlays that fade, gesture-based controls on mobile.

### Style Reference

- Think: **dark cinema** (not Netflix bright, not Disney+ colorful)
- Amber gold (#D4A237) is the hero accent — use it sparingly
- Glassmorphism for overlays and controls
- Playfair Display for headings (cinematic/classy feel)
- Everything should feel like a premium movie theater website
- The app is called "FilmSnaps" — the name evokes film photography, cinema, snapshots

---

*This document contains all source code and context needed for a full watch page redesign. Deliverables: Figma designs or React component implementations.*
