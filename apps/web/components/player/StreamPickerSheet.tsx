/**
 * StreamPickerSheet — desktop source picker modal.
 *
 * Matches mobile's StreamPickerSheet UX: language filter chips,
 * probe status icons, badges, section headers, dead link section.
 */

"use client";

import React, { useState, useMemo } from "react";
import {
  X,
  RefreshCw,
  CheckCircle,
  XCircle,
  HelpCircle,
  Star,
  Clock,
  ArrowDownToLine,
  Music,
} from "lucide-react";
import type { ProbeOutcome, LinkLanguage } from "@/lib/probeStream";
import {
  parseLinkLanguage,
  compactLanguageLabel,
  formatSize,
} from "@/lib/probeStream";
import { isDownloadOnlyLink } from "@/lib/streamSelector";

interface StreamLink {
  quality: string;
  name: string;
  id: string;
  size?: string;
  url: string;
  type: string;
  _meta?: {
    codec: string;
    audio: string;
    source: string;
    isDownloadOnly: boolean;
    isWebReady: boolean;
    sizeBytes?: number;
  };
}

interface StreamPickerSheetProps {
  open: boolean;
  links: StreamLink[];
  activeIndex: number;
  linkStatuses?: Map<number, ProbeOutcome>;
  recommendedIndex?: number;
  /** Rank position per link id from the smart selector — orders rows so the
   *  auto-pick's reasoning is visible (best candidates on top). */
  rankById?: Map<string, number>;
  /** Index of the source the user last successfully watched this title with. */
  lastUsedIndex?: number;
  /** Human-readable reason the source was auto-picked (e.g. "1080p · mp4 · multi"). */
  selectionReason?: string;
  onRetest?: () => void;
  onSelect: (index: number) => void;
  onClose: () => void;
}

type LanguageFilter = "all" | LinkLanguage;

const LANGUAGE_LABELS: Record<LinkLanguage, string> = {
  hindi: "Hindi",
  english: "English",
  multi: "Multi",
  unknown: "",
};

export function StreamPickerSheet({
  open,
  links,
  activeIndex,
  linkStatuses,
  recommendedIndex,
  rankById,
  lastUsedIndex,
  selectionReason,
  onRetest,
  onSelect,
  onClose,
}: StreamPickerSheetProps) {
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>("all");

  const verifiedCount = useMemo(
    () =>
      linkStatuses
        ? Array.from(linkStatuses.values()).filter((v) => v === "valid").length
        : 0,
    [linkStatuses],
  );

  // Detect available languages
  const availableLanguages = useMemo(() => {
    const langs = new Set<LinkLanguage>();
    for (const link of links) {
      const lang = parseLinkLanguage(link.name);
      if (lang !== "unknown") langs.add(lang);
    }
    return Array.from(langs);
  }, [links]);

  // Group links into sections
  const { sections, deadSection } = useMemo(() => {
    const alive: Array<{ link: StreamLink; index: number }> = [];
    const dead: Array<{ link: StreamLink; index: number }> = [];

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const outcome = linkStatuses?.get(i);

      // Apply language filter
      if (languageFilter !== "all") {
        const lang = parseLinkLanguage(link.name);
        if (lang !== languageFilter && lang !== "unknown") continue;
      }

      if (outcome === "dead") {
        dead.push({ link, index: i });
      } else {
        alive.push({ link, index: i });
      }
    }

    // Rank order within each section — the picker should read top-down in the
    // same order the auto-pick would try them, so "why is this on top" is
    // answered by the badges instead of mystery.
    const rankOf = (l: StreamLink) =>
      rankById?.get(l.id) ?? Number.MAX_SAFE_INTEGER;
    const byRank = (
      a: { link: StreamLink; index: number },
      b: { link: StreamLink; index: number },
    ) => rankOf(a.link) - rankOf(b.link);

    // Group alive links by language section
    const sectionMap = new Map<
      string,
      Array<{ link: StreamLink; index: number }>
    >();
    for (const item of alive) {
      const lang = parseLinkLanguage(item.link.name);
      const sectionKey = lang === "unknown" ? "default" : lang;
      if (!sectionMap.has(sectionKey)) sectionMap.set(sectionKey, []);
      sectionMap.get(sectionKey)!.push(item);
    }

    // Build ordered sections: multi, hindi, english, default
    const orderedKeys = ["multi", "hindi", "english", "default"];
    const sections: Array<{
      label: string;
      items: Array<{ link: StreamLink; index: number }>;
    }> = [];
    for (const key of orderedKeys) {
      const items = sectionMap.get(key);
      if (items && items.length > 0) {
        items.sort(byRank);
        sections.push({
          label:
            key === "default"
              ? "Other"
              : LANGUAGE_LABELS[key as LinkLanguage] || key,
          items,
        });
      }
    }

    dead.sort(byRank);

    return { sections, deadSection: dead };
  }, [links, linkStatuses, languageFilter, rankById]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Panel */}
      <div
        className="relative bg-[#16161A] rounded-2xl w-[440px] max-h-[80vh] flex flex-col border border-white/[0.08] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white">Sources</h3>
              {verifiedCount > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-400/25 text-[10px] font-semibold text-emerald-400">
                  {verifiedCount} verified
                </span>
              )}
            </div>
            <p className="text-[11px] text-white/40 mt-0.5 leading-relaxed">
              Switch here if the video doesn't play or keeps buffering.
              {selectionReason ? ` Auto-picked: ${selectionReason}.` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onRetest && (
              <button
                onClick={onRetest}
                className="w-8 h-8 flex items-center justify-center rounded-full border border-[#D4A237]/40 text-[#D4A237] hover:bg-[#D4A237]/10 transition-colors"
                title="Retest all sources"
              >
                <RefreshCw size={15} />
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Language filter chips */}
        {availableLanguages.length > 0 && (
          <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.04]">
            <Chip
              label="All"
              active={languageFilter === "all"}
              onClick={() => setLanguageFilter("all")}
            />
            {availableLanguages.map((lang) => (
              <Chip
                key={lang}
                label={LANGUAGE_LABELS[lang]}
                active={languageFilter === lang}
                onClick={() => setLanguageFilter(lang)}
              />
            ))}
          </div>
        )}

        {/* Link list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {sections.length === 0 && deadSection.length === 0 && (
            <div className="flex items-center justify-center py-12 text-sm text-white/40">
              No sources match this language.
            </div>
          )}

          {sections.map((section) => (
            <div key={section.label}>
              <div className="px-5 py-2 bg-[#222226]">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#D4A237]">
                  {section.label}
                </span>
              </div>
              {section.items.map(({ link, index }) => (
                <LinkRow
                  key={link.id}
                  link={link}
                  index={index}
                  isActive={index === activeIndex}
                  isRecommended={index === recommendedIndex}
                  isLastUsed={index === lastUsedIndex}
                  outcome={linkStatuses?.get(index)}
                  onClick={() => {
                    onSelect(index);
                    onClose();
                  }}
                />
              ))}
            </div>
          ))}

          {/* Dead links section */}
          {deadSection.length > 0 && (
            <div>
              <div className="px-5 py-2 bg-[#222226]">
                <span className="text-[11px] font-bold uppercase tracking-wider text-red-400">
                  Failed
                </span>
              </div>
              {deadSection.map(({ link, index }) => (
                <LinkRow
                  key={link.id}
                  link={link}
                  index={index}
                  isActive={index === activeIndex}
                  isRecommended={index === recommendedIndex}
                  isLastUsed={index === lastUsedIndex}
                  outcome="dead"
                  isDead
                  onClick={() => {
                    onSelect(index);
                    onClose();
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
        active
          ? "bg-[#D4A237]/15 border border-[#D4A237]/50 text-[#D4A237]"
          : "border border-white/[0.08] text-white/50 hover:text-white/70 hover:border-white/20"
      }`}
    >
      {label}
    </button>
  );
}

function ProbeIcon({ outcome }: { outcome?: ProbeOutcome }) {
  switch (outcome) {
    case "valid":
      return <CheckCircle size={18} className="text-emerald-400 shrink-0" />;
    case "dead":
      return <XCircle size={18} className="text-red-400 shrink-0" />;
    default:
      return <HelpCircle size={18} className="text-white/30 shrink-0" />;
  }
}

function LinkRow({
  link,
  index,
  isActive,
  isRecommended,
  isLastUsed,
  outcome,
  isDead,
  onClick,
}: {
  link: StreamLink;
  index: number;
  isActive: boolean;
  isRecommended?: boolean;
  isLastUsed?: boolean;
  outcome?: ProbeOutcome;
  isDead?: boolean;
  onClick: () => void;
}) {
  const meta = link._meta;
  const sizeBytes = meta?.sizeBytes;
  const langLabel = compactLanguageLabel(link.name);
  const sizeLabel = formatSize(sizeBytes) || link.size || "";

  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-start gap-2 px-5 py-3 transition-colors border-l-[3px] ${
        isDead
          ? "bg-red-500/[0.06] border-l-red-400 hover:bg-red-500/[0.1]"
          : isActive
            ? "bg-[#D4A237]/15 border-l-[#D4A237]/60"
            : isRecommended
              ? "border-l-[#D4A237]/40 hover:bg-white/[0.03]"
              : "border-l-transparent hover:bg-white/[0.03]"
      }`}
    >
      {/* Probe status */}
      <div className="pt-0.5 w-5 shrink-0">
        <ProbeIcon outcome={outcome} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Top row: quality + language + size */}
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-white truncate">
            {link.quality || "Unknown"}
          </span>
          {langLabel && langLabel !== "Default" && (
            <span className="text-xs text-white/40 shrink-0">{langLabel}</span>
          )}
          {sizeLabel && (
            <span className="text-xs text-white/30 ml-auto shrink-0">
              {sizeLabel}
            </span>
          )}
        </div>

        {/* Badges row */}
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {isRecommended && !isActive && (
            <Badge
              icon={<Star size={10} />}
              label="Best for you"
              color="gold"
            />
          )}
          {isLastUsed && !isActive && (
            <Badge icon={<Clock size={10} />} label="Last used" color="blue" />
          )}
          {meta?.isDownloadOnly || isDownloadOnlyLink(link) ? (
            <Badge
              icon={<ArrowDownToLine size={10} />}
              label="Download only"
              color="orange"
            />
          ) : null}
          {meta?.source && (
            <span className="text-[10px] text-white/25 font-mono">
              {meta.source}
            </span>
          )}
        </div>
      </div>

      {/* Active indicator */}
      {isActive && (
        <CheckCircle size={18} className="text-[#D4A237] shrink-0 mt-0.5" />
      )}
    </button>
  );
}

function Badge({
  icon,
  label,
  color,
}: {
  icon?: React.ReactNode;
  label: string;
  color: "gold" | "blue" | "red" | "orange";
}) {
  const colors = {
    gold: "bg-[#D4A237]/15 border-[#D4A237]/40 text-[#D4A237]",
    blue: "bg-blue-500/15 border-blue-400/30 text-blue-400",
    red: "bg-red-500/12 border-red-400/30 text-red-400",
    orange: "bg-orange-500/15 border-orange-400/30 text-orange-400",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${colors[color]}`}
    >
      {icon}
      {label}
    </span>
  );
}
