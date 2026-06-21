import Link from 'next/link';
import { Download, Smartphone, Shield, ExternalLink, Clock } from 'lucide-react';
import versionsData from '../../public/versions.json';

const versions = versionsData.versions;
const latest = versions[0];
const APK_URL = process.env.NEXT_PUBLIC_APK_DOWNLOAD_URL || latest?.downloadUrl || '#';
const LATEST_VERSION = latest?.version || '1.0.0';

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

      <main className="max-w-2xl mx-auto px-4 pt-16 pb-24">
        {/* Title */}
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
            <Download className="w-8 h-8 text-amber-500" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">
            Download FilmSnaps
          </h1>
          <p className="text-zinc-400 text-sm">
            Get the official FilmSnaps Android app
          </p>
        </div>

        {/* Version card */}
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-zinc-400 text-xs uppercase tracking-wider">
                Latest Version
              </span>
              <p className="text-white text-xl font-bold mt-0.5">
                v{LATEST_VERSION}
              </p>
            </div>
            <span className="bg-emerald-500/10 text-emerald-400 text-xs px-3 py-1 rounded-full font-medium">
              Stable
            </span>
          </div>

          <a
            href={APK_URL}
            download
            className={`w-full py-3.5 rounded-xl flex items-center justify-center gap-2 text-base font-bold transition-all ${
              APK_URL === '#'
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                : 'bg-amber-500 text-black hover:bg-amber-400 active:scale-[0.98]'
            }`}
          >
            <Download className="w-5 h-5" />
            {APK_URL === '#' ? 'Coming Soon' : 'Download APK'}
          </a>

          <p className="text-zinc-600 text-xs text-center mt-3">
            {APK_URL === '#'
              ? 'APK is being built — check back soon'
              : 'Direct APK download • ~90MB'}
          </p>
        </div>

        {/* Version history link */}
        <Link
          href="/versions"
          className="flex items-center justify-center gap-2 text-zinc-500 hover:text-amber-400 text-sm transition-colors mb-8"
        >
          <Clock className="w-4 h-4" />
          View all versions & release notes
        </Link>

        {/* Info cards */}
        <div className="grid gap-3">
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 p-4 flex items-start gap-3">
            <Smartphone className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-white text-sm font-semibold mb-1">
                Android Only
              </h3>
              <p className="text-zinc-500 text-xs leading-relaxed">
                Requires Android 8.0+ (API 26+). iOS version coming soon.
              </p>
            </div>
          </div>

          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 p-4 flex items-start gap-3">
            <Shield className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-white text-sm font-semibold mb-1">
                Sideload Only
              </h3>
              <p className="text-zinc-500 text-xs leading-relaxed">
                Not available on Google Play. You may need to enable{' '}
                <span className="text-zinc-300">Install from unknown sources</span>{' '}
                in your device settings.
              </p>
            </div>
          </div>

          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 p-4 flex items-start gap-3">
            <ExternalLink className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-white text-sm font-semibold mb-1">
                Updates
              </h3>
              <p className="text-zinc-500 text-xs leading-relaxed">
                The app checks for updates automatically on launch. You can also
                revisit this page for the latest version.
              </p>
            </div>
          </div>
        </div>

        {/* How to install */}
        <details className="mt-8 group">
          <summary className="text-zinc-400 text-sm cursor-pointer hover:text-zinc-300 transition-colors select-none">
            How to install on Android
          </summary>
          <ol className="mt-4 text-zinc-500 text-xs space-y-2 list-decimal list-inside">
            <li>Download the APK file above</li>
            <li>
              Open the file from your notification bar or Downloads folder
            </li>
            <li>
              If prompted, tap <span className="text-zinc-300">Settings</span>{' '}
              and enable{' '}
              <span className="text-zinc-300">
                Allow from this source
              </span>
            </li>
            <li>Tap <span className="text-zinc-300">Install</span></li>
            <li>Open FilmSnaps and enjoy!</li>
          </ol>
        </details>
      </main>
    </div>
  );
}
