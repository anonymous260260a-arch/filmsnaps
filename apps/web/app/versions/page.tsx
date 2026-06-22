'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Download,
  ArrowLeft,
  Clock,
  Github,
  Smartphone,
  Monitor,
  Tag,
  ChevronRight,
} from 'lucide-react';

import mobileVersions from '../../public/versions.json';
import desktopVersions from '../../public/desktop-versions.json';

// ── Types ──

type ViewMode = 'mobile' | 'desktop';

interface PlatformEntry {
  label: string;
  icon: React.ReactNode;
  downloadUrl: string | null;
  size: string | null;
}

// ── Data ──

const VIEWS: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  { id: 'mobile', label: 'Android', icon: <Smartphone className="w-4 h-4" /> },
  { id: 'desktop', label: 'Desktop', icon: <Monitor className="w-4 h-4" /> },
];

// ── Component ──

export default function VersionsPage() {
  const [view, setView] = useState<ViewMode>('mobile');

  const entries = view === 'mobile' ? mobileVersions.versions : desktopVersions.versions;

  // Build platform download options for desktop entries
  function getPlatformsForDesktop(version: (typeof desktopVersions.versions)[0]): PlatformEntry[] {
    if (!version.platforms) return [];
    return [
      {
        label: 'Windows',
        icon: <Monitor className="w-4 h-4" />,
        downloadUrl: version.platforms.win?.downloadUrl ?? null,
        size: version.platforms.win?.size ?? null,
      },
      {
        label: 'macOS Intel',
        icon: <Monitor className="w-4 h-4" />,
        downloadUrl: version.platforms.mac?.downloadUrl ?? null,
        size: version.platforms.mac?.size ?? null,
      },
      {
        label: 'macOS Apple Silicon',
        icon: <Monitor className="w-4 h-4" />,
        downloadUrl: version.platforms['mac-arm']?.downloadUrl ?? null,
        size: version.platforms['mac-arm']?.size ?? null,
      },
      {
        label: 'Linux',
        icon: <Monitor className="w-4 h-4" />,
        downloadUrl: version.platforms.linux?.downloadUrl ?? null,
        size: version.platforms.linux?.size ?? null,
      },
    ];
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Nav */}
      <header className="border-b border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="text-white font-bold text-lg">
            FilmSnaps
          </Link>
          <Link
            href="/download"
            className="text-zinc-400 hover:text-white text-sm transition-colors flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Download
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-12 pb-24">
        {/* Title */}
        <div className="text-center mb-10">
          <Clock className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h1 className="text-3xl font-bold text-white mb-2">
            Release History
          </h1>
          <p className="text-zinc-400 text-sm">
            Every version of FilmSnaps, with what changed in each release
          </p>
        </div>

        {/* Platform filter tabs */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                view === v.id
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30 shadow-[0_0_20px_rgba(251,191,36,0.08)]'
                  : 'text-zinc-500 hover:text-zinc-300 border border-transparent hover:border-zinc-800'
              }`}
            >
              {v.icon}
              {v.label}
            </button>
          ))}
        </div>

        {/* Version list */}
        {entries.length === 0 && (
          <div className="text-center py-16 text-zinc-500">
            <Tag className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No releases yet</p>
          </div>
        )}

        <div className="space-y-5">
          {entries.map((entry: any, index: number) => (
            <div
              key={entry.version}
              className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6 hover:border-zinc-700 transition-all"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-white text-lg font-bold">
                      v{entry.version}
                    </h2>
                    {index === 0 && (
                      <span className="bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-0.5 rounded-full font-medium">
                        Latest
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-500 text-xs">{entry.date}</p>
                </div>
                {view === 'mobile' && entry.size && (
                  <span className="text-zinc-600 text-xs">{entry.size}</span>
                )}
              </div>

              {/* Release notes */}
              <p className="text-zinc-300 text-sm leading-relaxed mb-4">
                {entry.releaseNotes}
              </p>

              {/* Downloads */}
              {view === 'mobile' && (
                <div className="flex items-center gap-2">
                  <a
                    href={entry.downloadUrl ?? '#'}
                    className={`inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg transition-all active:scale-[0.97] ${
                      entry.downloadUrl
                        ? 'bg-amber-500 hover:bg-amber-400 text-black'
                        : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    }`}
                  >
                    <Download className="w-4 h-4" />
                    {entry.downloadUrl ? 'Download APK' : 'Unavailable'}
                  </a>
                </div>
              )}

              {view === 'desktop' && entry.platforms && (
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['win', 'Windows'],
                      ['mac', 'macOS Intel'],
                      ['mac-arm', 'macOS Apple Silicon'],
                      ['linux', 'Linux'],
                    ] as const
                  ).map(([key, label]) => {
                    const plat = entry.platforms[key];
                    if (!plat?.downloadUrl) return null;
                    return (
                      <a
                        key={key}
                        href={plat.downloadUrl}
                        className="inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all active:scale-[0.97]"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {label}
                        {plat.size && (
                          <span className="text-zinc-500 font-normal ml-0.5">
                            {plat.size}
                          </span>
                        )}
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Info */}
        <div className="mt-8 bg-zinc-900/50 rounded-xl border border-zinc-800/50 p-4">
          <div className="flex items-start gap-3">
            <Github className="w-5 h-5 text-zinc-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-white text-sm font-semibold mb-1">
                Open Source
              </h3>
              <p className="text-zinc-500 text-xs leading-relaxed">
                All releases are published on GitHub. Each version is tagged and
                signed. Desktop app auto-updates via GitHub Releases — no manual
                downloads needed after the first install.
              </p>
              <a
                href="https://github.com/anonymous260260a-arch/filmsnaps/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-amber-500 hover:text-amber-400 text-xs font-semibold mt-3 transition-colors"
              >
                View all on GitHub
                <ChevronRight className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
