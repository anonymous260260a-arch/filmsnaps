import Link from 'next/link';
import {
  Download,
  Smartphone,
  Monitor,
  Apple,
  LinuxIcon,
  Shield,
  ExternalLink,
  Clock,
  ChevronRight,
  Github,
} from 'lucide-react';

import mobileVersions from '../../public/versions.json';
import desktopVersions from '../../public/desktop-versions.json';

// ── Platform definitions ──

type PlatformId = 'android' | 'windows' | 'mac' | 'linux';

interface PlatformInfo {
  id: PlatformId;
  label: string;
  icon: React.ReactNode;
  description: string;
  requirements: string;
  downloadLabel: string;
  artifactPattern: string;
}

const PLATFORMS: PlatformInfo[] = [
  {
    id: 'android',
    label: 'Android',
    icon: <Smartphone className="w-5 h-5" />,
    description: 'The full FilmSnaps experience on your phone or tablet.',
    requirements: 'Requires Android 8.0+ (API 26+)',
    downloadLabel: 'Download APK',
    artifactPattern: 'filmsnaps-v{version}.apk',
  },
  {
    id: 'windows',
    label: 'Windows',
    icon: <Monitor className="w-5 h-5" />,
    description: 'Native Windows app with secure video player.',
    requirements: 'Windows 10 64-bit or later',
    downloadLabel: 'Download Installer',
    artifactPattern: 'FilmSnaps-Setup-{version}.exe',
  },
  {
    id: 'mac',
    label: 'macOS',
    icon: <Apple className="w-5 h-5" />,
    description: 'Native macOS app — Intel & Apple Silicon.',
    requirements: 'macOS 11 Big Sur or later',
    downloadLabel: 'Download DMG',
    artifactPattern: 'FilmSnaps-{version}-{arch}.dmg',
  },
  {
    id: 'linux',
    label: 'Linux',
    icon: <LinuxIcon className="w-5 h-5" />,
    description: 'AppImage for all major Linux distributions.',
    requirements: 'AppImage runtime required',
    downloadLabel: 'Download AppImage',
    artifactPattern: 'FilmSnaps-{version}.AppImage',
  },
];

// ── Helpers ──

const mobileLatest = mobileVersions.versions[0];
const desktopLatest = desktopVersions.versions[0];

function getDownloadUrl(platform: PlatformId): string | null {
  if (platform === 'android') {
    return mobileLatest?.downloadUrl ?? null;
  }
  // Desktop platforms
  const map: Record<string, string | undefined> = {
    windows: desktopLatest?.platforms?.win?.downloadUrl,
    mac: desktopLatest?.platforms?.mac?.downloadUrl,
    linux: desktopLatest?.platforms?.linux?.downloadUrl,
  };
  return map[platform] ?? null;
}

function getFileSize(platform: PlatformId): string | null {
  if (platform === 'android') return mobileLatest?.size ?? null;
  const map: Record<string, string | undefined> = {
    windows: desktopLatest?.platforms?.win?.size,
    mac: desktopLatest?.platforms?.mac?.size,
    linux: desktopLatest?.platforms?.linux?.size,
  };
  return map[platform] ?? null;
}

function getVersion(platform: PlatformId): string {
  return platform === 'android' ? mobileLatest?.version : desktopLatest?.version;
}

// ── Platform details (shown below download card) ──

const PLATFORM_NOTES: Record<PlatformId, { icon: React.ReactNode; title: string; body: React.ReactNode }[]> = {
  android: [
    {
      icon: <Smartphone className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />,
      title: 'Android Only',
      body: <>Requires Android 8.0+ (API 26+). iOS version coming soon.</>,
    },
    {
      icon: <Shield className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />,
      title: 'Sideload Only',
      body: (
        <>
          Not available on Google Play. You may need to enable{' '}
          <span className="text-zinc-300">Install from unknown sources</span> in
          your device settings.
        </>
      ),
    },
  ],
  windows: [
    {
      icon: <Shield className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />,
      title: '6-Layer Security',
      body: (
        <>
          Ad blocking, popup protection, navigation guards, and session isolation
          built in at the OS level — provider scripts cannot bypass.
        </>
      ),
    },
    {
      icon: <ExternalLink className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />,
      title: 'Auto-Updates',
      body: (
        <>
          The app checks for updates on launch and downloads new versions in the
          background — no manual re-downloads needed.
        </>
      ),
    },
  ],
  mac: [
    {
      icon: <Shield className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />,
      title: '6-Layer Security',
      body: (
        <>
          Ad blocking, popup protection, navigation guards, and session isolation
          built in at the OS level — provider scripts cannot bypass.
        </>
      ),
    },
    {
      icon: <ExternalLink className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />,
      title: 'Auto-Updates',
      body: (
        <>
          The app checks for updates on launch and downloads new versions in the
          background — no manual re-downloads needed.
        </>
      ),
    },
  ],
  linux: [
    {
      icon: <Shield className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />,
      title: '6-Layer Security',
      body: (
        <>
          Ad blocking, popup protection, navigation guards, and session isolation
          built in at the OS level — provider scripts cannot bypass.
        </>
      ),
    },
    {
      icon: <ExternalLink className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />,
      title: 'Auto-Updates',
      body: (
        <>
          The app checks for updates on launch and downloads new versions in the
          background — no manual re-downloads needed.
        </>
      ),
    },
  ],
};

// ── Component ──

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Nav */}
      <header className="border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="text-white font-bold text-lg">
            FilmSnaps
          </Link>
          <Link
            href="/"
            className="text-zinc-400 hover:text-white text-sm transition-colors"
          >
            ← Back to Home
          </Link>
        </div>
      </header>

      <PlatformDownloadSection />

      {/* Version history link */}
      <div className="max-w-2xl mx-auto px-4 text-center pb-24">
        <Link
          href="/versions"
          className="inline-flex items-center gap-2 text-zinc-500 hover:text-amber-400 text-sm transition-colors"
        >
          <Clock className="w-4 h-4" />
          View all versions & release notes
          <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

function PlatformDownloadSection() {
  return (
    <main className="max-w-4xl mx-auto px-4 pt-12 pb-16">
      {/* Title */}
      <div className="text-center mb-10">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
          <Download className="w-8 h-8 text-amber-500" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">
          Download FilmSnaps
        </h1>
        <p className="text-zinc-400 text-sm">
          Choose your platform — same great experience everywhere
        </p>
      </div>

      {/* Download cards — one per platform */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {PLATFORMS.map((platform) => {
          const downloadUrl = getDownloadUrl(platform.id);
          const version = getVersion(platform.id);
          const fileSize = getFileSize(platform.id);
          const hasDownload = downloadUrl !== null && downloadUrl !== '#';

          return (
            <div
              key={platform.id}
              className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 hover:border-zinc-700 transition-all group"
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-3">
                <span className="text-zinc-400 group-hover:text-white transition-colors">
                  {platform.icon}
                </span>
                <div>
                  <h2 className="text-white font-bold">{platform.label}</h2>
                  <p className="text-zinc-500 text-xs">{platform.requirements}</p>
                </div>
              </div>

              <p className="text-zinc-400 text-xs mb-4 leading-relaxed">
                {platform.description}
              </p>

              {/* Version badge */}
              <div className="flex items-center gap-2 mb-4">
                <span className="text-zinc-600 text-[11px] uppercase tracking-wider">
                  Latest
                </span>
                <span className="text-white text-sm font-mono font-bold">
                  v{version}
                </span>
                {fileSize && (
                  <span className="text-zinc-600 text-xs ml-auto">
                    {fileSize}
                  </span>
                )}
              </div>

              {/* Download button */}
              <a
                href={downloadUrl ?? '#'}
                download={platform.id === 'android'}
                className={`w-full py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-bold transition-all ${
                  hasDownload
                    ? 'bg-amber-500 text-black hover:bg-amber-400 active:scale-[0.98]'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}
              >
                <Download className="w-4 h-4" />
                {hasDownload ? platform.downloadLabel : 'Coming Soon'}
              </a>
            </div>
          );
        })}
      </div>

      {/* Platform-specific info cards */}
      {PLATFORMS.map((platform) => {
        const notes = PLATFORM_NOTES[platform.id];
        if (!notes) return null;
        return (
          <div
            key={`notes-${platform.id}`}
            className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 p-4 mb-3 last:mb-0"
          >
            <h3 className="text-white text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
              {platform.icon}
              <span>{platform.label}</span>
            </h3>
            <div className="grid gap-3">
              {notes.map((note, i) => (
                <div key={i} className="flex items-start gap-3">
                  {note.icon}
                  <div>
                    <h4 className="text-white text-sm font-semibold mb-0.5">
                      {note.title}
                    </h4>
                    <p className="text-zinc-500 text-xs leading-relaxed">
                      {note.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </main>
  );
}
