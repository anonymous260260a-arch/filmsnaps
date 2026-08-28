/**
 * ServerPickerSheet — provider selector with glassmorphism bottom sheet.
 *
 * Mobile: full-width bottom sheet with drag handle portaled to document.body
 * Desktop: centered popover card
 * Clean list: index number + provider name + registry note. No health pings,
 * latency, or refresh — providers load directly in the WebView.
 */

"use client";

import React, { useMemo, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, X } from "lucide-react";
import { getEnabledProviders } from "@filmsnaps/shared";
import type { ProviderDefinition } from "@filmsnaps/shared";
import { usePlayer } from "./PlayerProvider";

interface ServerPickerSheetProps {
  /** Called with the selected provider */
  onSelect: (provider: ProviderDefinition) => void;
  /** Currently selected provider id */
  selectedId: string | null;
  /**
   * Optional pre-filtered provider list.
   * When provided, this list is used instead of the internal
   * getEnabledProviders() filtered by platforms. Used by
   * the desktop Electron view which shows all providers.
   */
  providers?: ProviderDefinition[];
}

export function ServerPickerSheet({
  onSelect,
  selectedId,
  providers: externalProviders,
}: ServerPickerSheetProps) {
  const { minimal, setOverlayActive } = usePlayer();
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const providers = useMemo(
    () =>
      externalProviders ??
      // Registry default: providers with no platforms field show everywhere.
      getEnabledProviders().filter(
        (p) => !p.platforms || p.platforms.includes("web"),
      ),
    [externalProviders],
  );

  const currentProvider = useMemo(
    () => providers.find((p) => p.id === selectedId) ?? providers[0],
    [providers, selectedId],
  );

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // Lock body scroll when sheet is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Sync sheet open state with overlayActive so the native view hides.
  useEffect(() => {
    setOverlayActive(isOpen);
  }, [isOpen, setOverlayActive]);

  const handleSelect = useCallback(
    (p: ProviderDefinition) => {
      onSelect(p);
      setIsOpen(false);
    },
    [onSelect],
  );

  if (minimal || providers.length === 0) return null;

  return (
    <>
      {/* ── Trigger Button (Compact & Click to Toggle) ── */}
      <div className="relative">
        <button
          onClick={() => setIsOpen((prev) => !prev)}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border transition-all duration-200 active:scale-95 text-left ${
            isOpen
              ? "bg-[#D4A237]/15 border-[#D4A237]/40 shadow-sm"
              : "bg-white/[0.06] border-white/[0.08] hover:border-white/20 hover:bg-white/[0.1]"
          }`}
          aria-label="Select Server"
          title="Switch Source Server"
        >
          <div className="min-w-0">
            <p className="text-[8px] font-black text-zinc-500 uppercase tracking-wider leading-none">
              Server
            </p>
            <p className="text-xs font-bold text-foreground truncate leading-tight mt-0.5 max-w-[95px] sm:max-w-[120px]">
              {currentProvider.displayName || currentProvider.name}
            </p>
          </div>
          <ChevronDown
            size={13}
            className={`text-zinc-400 shrink-0 transition-transform duration-200 ${
              isOpen ? "rotate-180 text-white" : ""
            }`}
          />
        </button>
      </div>

      {/* ── Bottom Sheet Backdrop (Portaled to document.body to avoid parent containment bugs) ── */}
      {isOpen &&
        mounted &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[99999] flex items-end justify-center"
            onClick={() => setIsOpen(false)}
          >
            {/* Glassmorphism backdrop */}
            <div className="absolute inset-0 bg-[#070708]/80 backdrop-blur-md animate-fade-in" />

            {/* Bottom Sheet Card */}
            <div
              className="relative w-full max-w-lg bg-[#141418] rounded-t-3xl border-t border-white/[0.1] p-5 pb-8 shadow-[0_-16px_60px_rgba(0,0,0,0.95)] max-h-[82vh] flex flex-col z-10 animate-in slide-in-from-bottom-6 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag handle (mobile) */}
              <div
                className="absolute top-2.5 left-1/2 -translate-x-1/2 w-10 h-1
              bg-white/20 rounded-full"
              />

              {/* Header */}
              <div className="flex items-center justify-between mb-4 mt-2">
                <div>
                  <h3
                    className="text-base font-bold text-foreground"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    Select Source Server
                  </h3>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Choose a source for playback
                  </p>
                </div>

                <button
                  onClick={() => setIsOpen(false)}
                  className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-zinc-400 hover:text-white transition-colors"
                  aria-label="Close"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Provider list */}
              <div className="space-y-1.5 overflow-y-auto flex-1 -mx-2 px-2">
                {providers.map((p) => {
                  const isActive = p.id === selectedId;

                  return (
                    <button
                      key={p.id}
                      onClick={() => handleSelect(p)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl
                      transition-all duration-200 text-left border ${
                        isActive
                          ? "bg-[#D4A237]/10 border-[#D4A237]/40 shadow-sm"
                          : "bg-[#0E0E11] border-white/[0.04] hover:border-white/15 hover:bg-white/[0.04]"
                      }`}
                    >
                      {/* Name + note */}
                      <span className="flex-1 min-w-0">
                        <span
                          className={`block text-xs font-semibold truncate ${
                            isActive ? "text-[#D4A237]" : "text-foreground"
                          }`}
                        >
                          {p.displayName || p.name}
                        </span>
                        {p.note && (
                          <span
                            className="mt-1 inline-flex items-center px-1.5 py-0.5 rounded
                          bg-white/[0.06] text-[11px] font-medium text-zinc-300
                          border border-white/[0.08]"
                          >
                            {p.note}
                          </span>
                        )}
                      </span>

                      {/* Active check */}
                      {isActive && (
                        <Check size={16} className="text-[#D4A237] shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
