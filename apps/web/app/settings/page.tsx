/**
 * Settings — parity with mobile's settings screen.
 *
 * Inside Electron, the desktop app exposes native ops (cache clear, download
 * folder, speed limit) via the electron API. The rest — server preference,
 * server tips toggle, legal links — works identically in the web build.
 *
 * On the public web (no Electron runtime) the native-only rows render as
 * inert labels that link to the install page, so the settings surface is
 * visible but the unavailable actions are gated.
 */

"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Settings as SettingsIcon,
  Trash2,
  FolderOpen,
  Gauge,
  History,
  RefreshCw,
  Monitor,
  Github,
  Globe,
  ChevronRight,
  Info,
  Cloud,
  Clock,
  Bug,
  Shield,
  FileText,
  Package,
} from "lucide-react";
import { Header } from "@/components/Header";
import { PageShell } from "@/components/PageShell";
import {
  createLocalStorageAdapter,
  useWatchHistory,
  getEnabledProviders,
} from "@filmsnaps/shared";
import type { ProviderDefinition } from "@filmsnaps/shared";
import { useSettings } from "@/hooks/useSettings";
import { ServerDropdown } from "@/components/watch/ServerDropdown";

const storage = createLocalStorageAdapter();

const SPEED_LEVELS: Array<{
  level: "full" | "balanced" | "slower";
  label: string;
  sub: string;
}> = [
  { level: "full", label: "Full speed", sub: "Max throughput" },
  { level: "balanced", label: "Balanced", sub: "64% cap" },
  { level: "slower", label: "Slower", sub: "32% cap" },
];

const GITHUB_URL = "https://github.com/anonymous260260a-arch/filmsnaps";
const SITE_URL = "https://filmsnap-pro.netlify.app/";

function isDesktop(): boolean {
  return typeof window !== "undefined" && !!window.electronAPI?.isDesktop;
}

export default function SettingsPage() {
  const desktop = isDesktop();
  const { clearAll } = useWatchHistory(storage);
  const { settings, updateSetting } = useSettings();
  const api = window.electronAPI;

  // ── Provider health (for the default-source picker) ──
  const allProviders = useMemo(() => {
    // Mobile shows all enabled providers. Desktop hides download-only sources.
    return getEnabledProviders();
  }, []);

  // Default server selector state
  const [serverDropdownOpen, setServerDropdownOpen] = useState(false);
  const selectedProvider = allProviders.find(
    (p) => p.id === settings.defaultServer,
  );

  // Download folder + speed (speed sourced from the settings store)
  const [downloadFolder, setDownloadFolder] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

  // Load desktop-only state
  useEffect(() => {
    if (!api?.app) return;
    api.app.getDownloadFolder().then((p) => setDownloadFolder(p));
  }, [api?.app]);

  // Sync speed to electron when it changes
  useEffect(() => {
    if (api?.download && desktop) {
      api.download.setSpeedLimit(settings.downloadSpeedLimit);
    }
  }, [settings.downloadSpeedLimit, api?.download, desktop]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const handleClearCache = () =>
    run("clear-cache", () => api!.app.clearCache());

  const handlePickFolder = () =>
    run("pick-folder", async () => {
      const dir = await api!.app.pickDownloadFolder();
      if (dir) {
        await api!.app.setDownloadFolder(dir);
        // Apply immediately so new downloads land in the chosen folder.
        await api!.download?.setSaveDir?.(dir);
        setDownloadFolder(dir);
      }
    });

  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const handleClearHistory = () =>
    run("clear-history", async () => {
      await clearAll();
      setConfirmClearHistory(false);
    });

  const handleResetLibrary = () =>
    run("reset-library", () => api!.app.clearCache());

  const handleServerSelect = (provider: ProviderDefinition | null) => {
    updateSetting("defaultServer", provider ? provider.id : "");
  };

  const handleSpeed = (level: "full" | "balanced" | "slower") => {
    updateSetting("downloadSpeedLimit", level);
  };

  // ═════════════════════════════════════════════════════════════════
  // Public web fallback (no Electron runtime) — shows a short landing
  // that links to the install page.
  // ═════════════════════════════════════════════════════════════════
  if (!desktop) {
    return (
      <div className="min-h-screen bg-[#070708] text-foreground">
        <Header />
        <PageShell maxWidth="2xl">
          <div className="rounded-xl border border-white/[0.06] bg-[#0E0E11] px-6 py-14 text-center">
            <div className="w-16 h-16 rounded-full bg-[#16161A] flex items-center justify-center mx-auto mb-5">
              <SettingsIcon className="h-8 w-8 text-[#D4A237]" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight mb-2">Settings</h1>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              App settings only apply inside the FilmSnaps desktop app, where
              downloads, cache management and the native provider session are
              available.
            </p>
            <Link
              href="/download"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4A237] text-[#070708] text-sm font-semibold hover:bg-[#B88B2A] transition-all"
            >
              <Monitor size={14} />
              Get FilmSnaps Desktop
            </Link>
          </div>
        </PageShell>
      </div>
    );
  }

  const disabled = (label: string) => busy === label;

  return (
    <div className="min-h-screen bg-[#070708] text-foreground">
      <Header />
      <PageShell maxWidth="3xl">
        {/* Page header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-[#D4A237]/10 flex items-center justify-center">
            <SettingsIcon size={20} className="text-[#D4A237]" />
          </div>
          <div>
            <h1
              className="text-2xl sm:text-3xl font-bold tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Settings
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Desktop app maintenance
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {/* ── Data & Storage ── */}
          <Section
            icon={<Cloud size={16} className="text-[#D4A237]" />}
            title="Data & Storage"
            sub="Downloads, cache and bandwidth."
          >
            <SettingsRow
              icon={<Trash2 size={14} />}
              label="Clear Cache"
              subtitle="Cookies, HTTP cache and provider session storage."
              color="#E05252"
              right={
                <button
                  onClick={handleClearCache}
                  disabled={disabled("clear-cache")}
                  className="ml-auto text-xs font-medium text-[#E05252] hover:text-[#ff6b6b] disabled:opacity-60"
                >
                  {disabled("clear-cache") ? "Clearing…" : "Clear"}
                </button>
              }
            />
            <Divider />
            <SettingsRow
              icon={<FolderOpen size={14} />}
              label="Downloads Storage"
              subtitle={
                downloadFolder
                  ? downloadFolder
                  : "Where offline media files are saved."
              }
              color={undefined}
              right={
                <button
                  onClick={handlePickFolder}
                  disabled={disabled("pick-folder")}
                  className="ml-auto text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
                >
                  {disabled("pick-folder") ? "..." : "Change"}
                </button>
              }
            />
            <Divider />
            <SettingsRow
              icon={<Gauge size={14} />}
              label="Download Speed"
              subtitle={
                settings.downloadSpeedLimit === "full"
                  ? "Full speed (unlimited)"
                  : settings.downloadSpeedLimit === "balanced"
                    ? "Balanced (~64% cap)"
                    : "Slower (~32% cap)"
              }
              color={undefined}
              right={
                <div className="ml-auto flex gap-0.5">
                  {SPEED_LEVELS.map((s) => (
                    <button
                      key={s.level}
                      onClick={() => handleSpeed(s.level)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                        settings.downloadSpeedLimit === s.level
                          ? "bg-[#D4A237] text-[#070708]"
                          : "text-faint hover:text-foreground hover:bg-white/[0.06]"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              }
            />
            <Divider />
            <SettingsRow
              icon={<Clock size={14} />}
              label="Clear Watch History"
              subtitle="Removes all saved progress and history entries."
              color="#E05252"
              right={
                confirmClearHistory ? (
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="text-[11px] text-faint">Sure?</span>
                    <button
                      onClick={() => setConfirmClearHistory(false)}
                      className="px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleClearHistory}
                      disabled={disabled("clear-history")}
                      className="px-2 py-1 rounded-md text-xs font-medium bg-[#E05252] text-white hover:bg-[#ff6b6b] disabled:opacity-60"
                    >
                      {disabled("clear-history") ? "Clearing…" : "Confirm"}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmClearHistory(true)}
                    className="ml-auto text-xs font-medium text-[#E05252] hover:text-[#ff6b6b]"
                  >
                    Clear
                  </button>
                )
              }
            />
          </Section>

          {/* ── 3. Default Source ── */}
          <Section
            icon={<Monitor size={16} className="text-[#D4A237]" />}
            title="Default Source"
            sub="Preferred streaming source (tried first when available)."
          >
            <div className="relative">
              <button
                onClick={() => setServerDropdownOpen(true)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left hover:bg-white/[0.06] transition-colors"
              >
                <span className="text-sm text-foreground">
                  {selectedProvider
                    ? selectedProvider.displayName || selectedProvider.name
                    : "Auto (first available)"}
                </span>
                <span className="text-xs text-faint">
                  {selectedProvider ? selectedProvider.id : "auto"}
                </span>
              </button>
              <ServerDropdown
                isOpen={serverDropdownOpen}
                onClose={() => setServerDropdownOpen(false)}
                providers={allProviders}
                selectedId={settings.defaultServer}
                onSelect={handleServerSelect}
              />
            </div>
          </Section>

          {/* ── 4. Reset library cache ── */}
          <Section
            icon={<RefreshCw size={16} className="text-[#D4A237]" />}
            title="Library Cache"
            sub="Forces a fresh pull of movie/TV metadata on next launch."
          >
            <button
              onClick={handleResetLibrary}
              disabled={disabled("reset-library")}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium border border-white/[0.08] text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all disabled:opacity-60"
            >
              <RefreshCw size={14} />
              {disabled("reset-library") ? "Resetting…" : "Reset library cache"}
            </button>
          </Section>

          {/* ── 5. Support ── */}
          <Section
            icon={<Bug size={16} className="text-[#D4A237]" />}
            title="Support"
            sub="Help, feedback and account resources."
          >
            <SupportRow
              icon={<Info size={14} />}
              label="Transparency & Security"
              subtitle="Ad blocking, streaming security & how it works"
              href="/transparency"
            />
            <Divider />
            <SupportRow
              icon={<Bug size={14} />}
              label="Feedback"
              subtitle="Report bugs, request features, view roadmap"
              href="https://github.com/anonymous260260a-arch/filmsnaps/issues"
              external
            />
            <Divider />
            <SupportRow
              icon={<Shield size={14} />}
              label="Privacy Policy"
              subtitle="How we handle your data"
              href="/privacy"
            />
            <Divider />
            <SupportRow
              icon={<FileText size={14} />}
              label="Legal & DMCA"
              subtitle="Disclaimer, copyright, and terms"
              href="/legal"
            />
          </Section>

          {/* ── 6. Community ── */}
          <Section
            icon={<Github size={16} className="text-[#D4A237]" />}
            title="Community"
            sub="Open source & links."
          >
            <SupportRow
              icon={<Github size={14} />}
              label="GitHub Repository"
              subtitle="View source, report issues, and contribute"
              href={GITHUB_URL}
              external
            />
            <Divider />
            <SupportRow
              icon={<Globe size={14} />}
              label="Website"
              subtitle="filmsnap-pro.netlify.app"
              href={SITE_URL}
              external
            />
          </Section>

          {/* ── 7. App Info ── */}
          <Section
            icon={<Package size={16} className="text-[#D4A237]" />}
            title="App Info"
            sub="Version and build information."
          >
            <SettingsRow
              icon={<Package size={14} />}
              label="Version"
              subtitle={api?.appVersion || "Unknown"}
              color={undefined}
              right={
                <span className="text-[11px] text-faint font-mono">
                  {api?.platform || "web"}
                </span>
              }
            />
            <Divider />
            <SupportRow
              icon={<Clock size={14} />}
              label="Release History"
              subtitle="View all versions and changelog"
              href="/versions"
            />
          </Section>
        </div>
      </PageShell>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────── */

function Section({
  icon,
  title,
  sub,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0E0E11] p-4 sm:p-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="flex-1">
          <h2 className="font-sans text-sm font-semibold text-foreground">
            {title}
          </h2>
          <p className="text-xs text-faint mt-0.5">{sub}</p>
        </div>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-white/[0.06] my-1" />;
}

function SettingsRow({
  icon,
  label,
  subtitle,
  color,
  right,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle?: string;
  color?: string;
  right: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors">
      {icon}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {subtitle && (
          <p className="text-xs text-faint mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
      {right}
    </div>
  );
}

function SupportRow({
  icon,
  label,
  subtitle,
  href,
  external = false,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  href: string;
  external?: boolean;
}) {
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors"
      >
        {icon}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">{label}</span>
          <p className="text-xs text-faint mt-0.5 truncate">{subtitle}</p>
        </div>
        <ChevronRight size={14} className="text-faint shrink-0" />
      </a>
    );
  }
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors"
    >
      {icon}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <p className="text-xs text-faint mt-0.5 truncate">{subtitle}</p>
      </div>
      <ChevronRight size={14} className="text-faint shrink-0" />
    </Link>
  );
}
