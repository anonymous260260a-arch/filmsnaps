/**
 * ServerPickerSheet — provider selector with glassmorphism bottom sheet.
 *
 * Mobile: full-width bottom sheet with drag handle
 * Desktop: centered popover card
 * Uses health check indicators for server availability.
 */

'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { ChevronDown, Check, RefreshCw } from 'lucide-react';
import { getEnabledProviders, checkAllProviders } from '@filmsnaps/shared';
import type { ProviderDefinition, HealthCache } from '@filmsnaps/shared';
import { usePlayer } from './PlayerProvider';

interface ServerPickerSheetProps {
  /** Called with the selected provider */
  onSelect: (provider: ProviderDefinition) => void;
  /** Currently selected provider id */
  selectedId: string | null;
}

export function ServerPickerSheet({ onSelect, selectedId }: ServerPickerSheetProps) {
  const { minimal } = usePlayer();
  const [isOpen, setIsOpen] = useState(false);
  const [healthCache, setHealthCache] = useState<HealthCache>(new Map());

  const providers = useMemo(
    () => getEnabledProviders().filter((p) => p.platforms?.includes('web')),
    [],
  );

  // Check provider health on mount (for status indicators only)
  useEffect(() => {
    let alive = true;
    checkAllProviders(providers, { timeoutMs: 5000 }).then((cache) => {
      if (alive) setHealthCache(cache);
    });
    return () => { alive = false; };
  }, [providers]);

  const currentProvider = useMemo(
    () => providers.find((p) => p.id === selectedId) ?? providers[0],
    [providers, selectedId],
  );

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // Lock body scroll when sheet is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

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
      {/* ── Trigger Button ── */}
      <div className="relative">
        <button
          onClick={() => setIsOpen(true)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3
            bg-[#0E0E11]/80 backdrop-blur-xl border border-[#222226]
            hover:border-[#D4A237]/30 rounded-xl text-left
            transition-all duration-200 cursor-pointer
            shadow-[0_8px_30px_rgba(0,0,0,0.4)]
            focus-visible:ring-2 focus-visible:ring-[#D4A237]/30
            focus-visible:ring-offset-2 focus-visible:ring-offset-[#070708]"
          aria-label="Select Server"
        >
          <div className="flex items-center gap-3 min-w-0">
            {/* Health Dot */}
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              healthCache.get(currentProvider.id)?.alive
                ? 'bg-[#4CAF82] shadow-[0_0_8px_rgba(76,175,130,0.4)]'
                : healthCache.has(currentProvider.id)
                  ? 'bg-[#E05252]'
                  : 'bg-[#52525B]'
            }`} />
            <div className="min-w-0">
              <p className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-0.5">
                Source Server
              </p>
              <p className="text-sm font-bold text-[#F4F4F5] truncate">
                {currentProvider.displayName || currentProvider.name}
              </p>
            </div>
          </div>
          <ChevronDown size={18} className="text-zinc-500 flex-shrink-0" />
        </button>
      </div>

      {/* ── Bottom Sheet Backdrop ── */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end md:items-center justify-center"
          onClick={() => setIsOpen(false)}
        >
          {/* Glassmorphism backdrop */}
          <div className="absolute inset-0 bg-[#070708]/80 backdrop-blur-sm animate-fade-in" />

          {/* Sheet / Card */}
          <div
            className="relative w-full md:max-w-md bg-[#16161A] md:rounded-2xl rounded-t-3xl
              shadow-[0_-8px_60px_rgba(0,0,0,0.8)] border-t md:border border-[#222226]
              p-6 pb-10 animate-slide-up max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle (mobile) */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1.5
              bg-[#222226] rounded-full md:hidden" />

            {/* Header */}
            <div className="flex items-center justify-between mb-6 mt-2 md:mt-0">
              <h3
                className="text-lg font-bold text-[#F4F4F5]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Select Source
              </h3>
              <button
                onClick={() => {
                  setHealthCache(new Map());
                  checkAllProviders(providers, { timeoutMs: 5000 }).then((cache) => {
                    setHealthCache(cache);
                  });
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                  bg-white/5 hover:bg-white/10 text-xs text-zinc-400
                  hover:text-white transition-colors"
                aria-label="Recheck server health"
              >
                <RefreshCw size={12} />
                Refresh
              </button>
            </div>

            {/* Provider list */}
            <div className="space-y-2 overflow-y-auto flex-1 -mx-2 px-2">
              {providers.map((p) => {
                const health = healthCache.get(p.id);
                const isActive = p.id === selectedId;
                const isAlive = health?.alive;

                return (
                  <button
                    key={p.id}
                    onClick={() => handleSelect(p)}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl
                      transition-all duration-200 text-left
                      ${isActive
                        ? 'bg-[#D4A237]/10 border border-[#D4A237]/40'
                        : 'bg-[#0E0E11] border border-transparent hover:border-white/10'
                      }`}
                  >
                    {/* Health indicator */}
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      !health
                        ? 'bg-[#52525B]'
                        : isAlive
                          ? 'bg-[#4CAF82] shadow-[0_0_8px_rgba(76,175,130,0.4)]'
                          : 'bg-[#E05252]'
                    }`} />

                    {/* Name */}
                    <span
                      className={`flex-1 text-sm font-semibold ${
                        isActive ? 'text-[#D4A237]' : 'text-[#F4F4F5]'
                      }`}
                    >
                      {p.displayName || p.name}
                    </span>

                    {/* Latency */}
                    {health?.alive && health.latencyMs && (
                      <span className="text-[10px] font-medium text-zinc-500">
                        {health.latencyMs < 2000
                          ? `${health.latencyMs}ms`
                          : `${Math.round(health.latencyMs / 1000)}s`}
                      </span>
                    )}

                    {/* Active check */}
                    {isActive && (
                      <Check size={18} className="text-[#D4A237] flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
