/**
 * ServerDropdown — compact popover server selector for desktop.
 *
 * Replaces the full-screen ServerPickerSheet bottom sheet on desktop (≥1280px).
 * 320px wide popover anchored to the server pill, listing providers in registry
 * order with index number + name + registry note. No health pings, latency, or
 * quality tiers — providers load directly in the WebView.
 */

"use client";

import React, { useCallback, useEffect, useRef } from "react";
import type { ProviderDefinition } from "@filmsnaps/shared";

interface ServerDropdownProps {
  /** All available providers */
  providers: ProviderDefinition[];
  /** Currently selected provider id (null = Auto mode) */
  selectedId: string | null;
  /** Called when a provider is selected */
  onSelect: (provider: ProviderDefinition | null) => void;
  /** Whether the dropdown is open */
  isOpen: boolean;
  /** Called when the dropdown should close */
  onClose: () => void;
}

export function ServerDropdown({
  providers,
  selectedId,
  onSelect,
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
      className="absolute top-full mt-2 left-0 z-50 w-80 bg-[#16161A] border border-[#222226]
        rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.6)] overflow-hidden animate-scale-in origin-top-left"
      role="listbox"
      aria-label="Source Server"
    >
      {/* ── Header ── */}
      <div className="px-3 py-2.5 border-b border-[#222226]">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">
          SOURCE SERVER
        </p>
      </div>

      {/* ── Scrollable list — registry order ── */}
      <div
        ref={listRef}
        className="max-h-[380px] overflow-y-auto p-1.5 space-y-0.5"
      >
        {providers.map((p) => {
          const isActive = p.id === selectedId;

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
              {/* Provider info */}
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-semibold truncate ${isActive ? "text-[#D4A237]" : "text-foreground"}`}
                >
                  {p.displayName || p.name}
                </p>
                {p.note && (
                  <span
                    className="mt-1 inline-flex items-center px-1.5 py-0.5 rounded
                    bg-white/[0.06] text-[11px] font-medium text-zinc-300
                    border border-white/[0.08]"
                  >
                    {p.note}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
