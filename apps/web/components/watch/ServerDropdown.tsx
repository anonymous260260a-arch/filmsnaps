/**
 * ServerDropdown — compact popover server selector for desktop.
 *
 * Replaces the full-screen ServerPickerSheet bottom sheet on desktop (≥1280px).
 * 320px wide popover anchored to the server pill, with:
 * - All servers listed in registry order (getEnabledProviders order) — no ping rearrangement
 * - Health indicators, latency, quality tier
 * - Keyboard navigation
 */

"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { RefreshCw } from "lucide-react";
import type {
  ProviderDefinition,
  HealthCache,
  HealthResult,
} from "@filmsnaps/shared";

function getHealthColor(health: HealthResult | undefined): string {
  if (!health) return "bg-[#52525B]"; // gray = not checked
  if (!health.alive) return "bg-[#E05252]"; // red = dead
  if (health.latencyMs < 300) return "bg-[#4CAF82]"; // green = fast
  if (health.latencyMs <= 600) return "bg-[#E0A237]"; // amber = moderate
  return "bg-[#E05252]"; // red = slow
}

function getHealthGlow(health: HealthResult | undefined): string {
  if (!health?.alive) return "";
  if (health.latencyMs < 300) return "shadow-[0_0_8px_rgba(76,175,130,0.4)]";
  if (health.latencyMs <= 600) return "shadow-[0_0_8px_rgba(224,162,55,0.4)]";
  return "";
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${Math.round(ms / 1000)}s`;
}

function getRelativeTime(timestampMs: number): string {
  if (!timestampMs) return "";
  const seconds = Math.floor((Date.now() - timestampMs) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  return `${mins}m ago`;
}

interface ServerDropdownProps {
  /** All available providers */
  providers: ProviderDefinition[];
  /** Currently selected provider id (null = Auto mode) */
  selectedId: string | null;
  /** Called when a provider is selected */
  onSelect: (provider: ProviderDefinition | null) => void;
  /** Current health data, refreshed externally */
  healthCache: HealthCache;
  /** Timestamp (epoch ms) of last health refresh */
  lastCheckedAt: number;
  /** Callback to trigger re-check */
  onRefresh: () => void;
  /** Whether a health check is in progress */
  isRefreshing: boolean;
  /** Whether the dropdown is open */
  isOpen: boolean;
  /** Called when the dropdown should close */
  onClose: () => void;
}

export function ServerDropdown({
  providers,
  selectedId,
  onSelect,
  healthCache,
  lastCheckedAt,
  onRefresh,
  isRefreshing,
  isOpen,
  onClose,
}: ServerDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  // ── Close on click outside ──
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    // Delay to avoid closing from the trigger click itself
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [isOpen, onClose]);

  // ── Keyboard navigation ──
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = listRef.current?.querySelectorAll("[data-server-option]");
        if (!items || items.length === 0) return;

        const currentIndex = Array.from(items).findIndex(
          (el) => el === document.activeElement,
        );
        const nextIndex =
          e.key === "ArrowDown"
            ? Math.min(currentIndex + 1, items.length - 1)
            : Math.max(currentIndex - 1, 0);

        (items[nextIndex] as HTMLElement).focus();
      }

      if (e.key === "Enter") {
        const active = document.activeElement as HTMLElement;
        active?.click();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // ── Focus active item on open ──
  useEffect(() => {
    if (isOpen && activeItemRef.current) {
      activeItemRef.current.focus();
    }
  }, [isOpen]);

  const handleSelect = useCallback(
    (provider: ProviderDefinition | null) => {
      onSelect(provider);
      onClose();
    },
    [onSelect, onClose],
  );

  if (!isOpen) return null;

  return (
    <div
      ref={dropdownRef}
      className="absolute top-full mt-2 right-0 z-50 w-80 bg-[#16161A] border border-[#222226]
        rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.6)] overflow-hidden animate-scale-in origin-top-right"
      role="listbox"
      aria-label="Source Server"
    >
      {/* ── Header ── */}
      <div className="px-3 py-2.5 border-b border-[#222226]">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
          SOURCE SERVER
        </p>
      </div>

      {/* ── Scrollable list — registry order, no rearrangement ── */}
      <div
        ref={listRef}
        className="max-h-[380px] overflow-y-auto p-1.5 space-y-0.5"
      >
        {providers.map((p) => {
          const health = healthCache.get(p.id);
          const isActive = p.id === selectedId;
          const healthColor = getHealthColor(health);
          const healthGlow = getHealthGlow(health);

          return (
            <button
              key={p.id}
              data-server-option={p.id}
              onClick={() => handleSelect(p)}
              ref={isActive ? activeItemRef : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all border
                ${
                  isActive
                    ? "bg-[#D4A237]/10 border-l-2 border-[#D4A237] border-y-0 border-r-0"
                    : "border border-transparent hover:bg-[#111113]"
                }`}
              role="option"
              aria-selected={isActive}
            >
              {/* Health dot */}
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${healthColor} ${healthGlow}`}
              />

              {/* Provider info */}
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-semibold truncate ${isActive ? "text-[#D4A237]" : "text-[#F4F4F5]"}`}
                >
                  {p.displayName || p.name}
                </p>
                {p.note && (
                  <span
                    className="mt-1 inline-flex items-center px-2 py-0.5 rounded-full
                    bg-[#D4A237]/15 text-[#D4A237] text-[9px] font-bold
                    border border-[#D4A237]/30"
                  >
                    {p.note}
                  </span>
                )}
              </div>

              {/* Latency */}
              {health?.alive && health.latencyMs > 0 && (
                <span className="text-[11px] font-mono text-zinc-500 shrink-0">
                  {formatLatency(health.latencyMs)}
                </span>
              )}

              {/* Quality tier badge */}
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#222226] text-zinc-500 shrink-0">
                {getQualityLabel(p)}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Footer: Refresh ── */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-[#222226] bg-[#0E0E11]">
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-zinc-500 hover:text-[#F4F4F5] hover:bg-white/[0.06] transition-colors disabled:opacity-50"
          aria-label="Refresh server health"
        >
          <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />
          Refresh
        </button>
        {lastCheckedAt > 0 && (
          <span className="text-[10px] text-zinc-600">
            Last: {getRelativeTime(lastCheckedAt)}
          </span>
        )}
      </div>
    </div>
  );
}

function getQualityLabel(provider: ProviderDefinition): string {
  const name = (provider.displayName || provider.name).toLowerCase();
  if (name.includes("4k") || name.includes("2160")) return "4K";
  if (name.includes("1080") || name.includes("hd")) return "1080p";
  if (name.includes("720")) return "720p";
  if (name.includes("480") || name.includes("sd")) return "480p";
  return "HD";
}
