import Link from 'next/link';
import { Download, ArrowLeft, Clock, Github } from 'lucide-react';
import versionsData from '../../public/versions.json';

type VersionEntry = {
  version: string;
  date: string;
  releaseNotes: string;
  downloadUrl: string;
  size: string;
};

const versions: VersionEntry[] = versionsData.versions;

export default function VersionsPage() {
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
        <div className="text-center mb-12">
          <Clock className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h1 className="text-3xl font-bold text-white mb-2">
            Release History
          </h1>
          <p className="text-zinc-400 text-sm">
            Every version of FilmSnaps, with what changed in each release
          </p>
        </div>

        {/* Version list */}
        <div className="space-y-4">
          {versions.map((entry, index) => (
            <div
              key={entry.version}
              className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-white text-lg font-bold">
                      v{entry.version}
                    </h2>
                    {index === 0 && (
                      <span className="bg-amber-500/10 text-amber-400 text-xs px-2.5 py-0.5 rounded-full font-medium">
                        Latest
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-500 text-xs">{entry.date}</p>
                </div>
                <span className="text-zinc-600 text-xs">{entry.size}</span>
              </div>

              {/* Release notes */}
              <p className="text-zinc-300 text-sm leading-relaxed mb-4">
                {entry.releaseNotes}
              </p>

              {/* Download button */}
              <div className="flex items-center gap-2">
                <a
                  href={entry.downloadUrl}
                  className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold px-4 py-2 rounded-lg transition-colors active:scale-[0.97]"
                >
                  <Download className="w-4 h-4" />
                  Download APK
                </a>
              </div>
            </div>
          ))}
        </div>

        {/* Info */}
        <div className="mt-8 bg-zinc-900/50 rounded-xl border border-zinc-800/50 p-4">
          <div className="flex items-start gap-3">
            <Github className="w-5 h-5 text-zinc-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-white text-sm font-semibold mb-1">
                APK Downloads
              </h3>
              <p className="text-zinc-500 text-xs leading-relaxed">
                Each APK is hosted on GitHub Releases. Your device may warn about
                installing apps from outside the Play Store — tap <span className="text-zinc-300">Settings</span> and
                enable <span className="text-zinc-300">Allow from this source</span> to proceed.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
