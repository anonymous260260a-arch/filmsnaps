/**
 * ServerPickerSheet — provider selector with health indicators.
 */

'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { ChevronDown, AlertCircle } from 'lucide-react';
import { getEnabledProviders, checkAllProviders } from '@filmsnaps/shared';
import type { ProviderDefinition, HealthCache } from '@filmsnaps/shared';
import { usePlayer } from './PlayerProvider';

interface ServerPickerSheetProps {
  /** Called with the selected provider id */
  onSelect: (provider: ProviderDefinition) => void;
  /** Currently selected provider id */
  selectedId: string | null;
}

export function ServerPickerSheet({ onSelect, selectedId }: ServerPickerSheetProps) {
  const { minimal } = usePlayer();

  const [healthCache, setHealthCache] = useState<HealthCache>(new Map());

  const providers = useMemo(() => getEnabledProviders(), []);

  // Check provider health on mount (for status indicators only — doesn't affect order)
  useEffect(() => {
    let alive = true;
    checkAllProviders(providers, { timeoutMs: 5000 }).then((cache) => {
      if (alive) setHealthCache(cache);
    });
    return () => { alive = false; };
  }, [providers]);

  if (minimal) return null;

  return (
    <div className="relative group mb-4 sm:mb-6">
      <div className="absolute -top-2.5 left-4 px-2 bg-[#070708] text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 z-10 group-focus-within:text-[#D4A237] transition-colors">
        Server
      </div>
      <div className="relative flex items-center">
        <select
          value={selectedId ?? ''}
          onChange={(e) => {
            const p = providers.find((pr) => pr.id === e.target.value);
            if (p) onSelect(p);
          }}
          aria-label="Select Server"
          className="w-full bg-[#0E0E11]/80 backdrop-blur hover:bg-[#16161A] focus:bg-[#16161A] transition-all border border-[#222226] focus:border-[#D4A237]/30 text-[#F4F4F5] text-sm font-bold py-4 px-5 rounded-2xl outline-none appearance-none cursor-pointer shadow-[0_8px_30px_rgba(0,0,0,0.4)] focus-visible:ring-2 focus-visible:ring-[#D4A237]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070708]"
        >
          {providers.map((p) => {
            const health = healthCache.get(p.id);
            const statusDot = health?.alive
              ? health.latencyMs < 2000
                ? '🟢'
                : '🟡'
              : health !== undefined
                ? '🔴'
                : '⚪';

            return (
              <option
                key={p.id}
                value={p.id}
                className="bg-[#0E0E11] text-[#F4F4F5] py-4"
              >
                {statusDot} {p.displayName || p.name}
              </option>
            );
          })}
        </select>
        <ChevronDown
          className="absolute right-5 text-zinc-500 group-hover:text-[#F4F4F5] transition-colors pointer-events-none"
          size={18}
        />
      </div>
    </div>
  );
}
