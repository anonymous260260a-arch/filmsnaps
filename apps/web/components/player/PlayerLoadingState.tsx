/**
 * PlayerLoadingState — branded loading screen for the player.
 */

'use client';

import React from 'react';
import { RefreshCw } from 'lucide-react';

export function PlayerLoadingState() {
  return (
    <div className="absolute inset-0 bg-[#070708] flex flex-col items-center justify-center z-50 gap-4">
      <RefreshCw className="animate-spin text-[#D4A237]" size={32} />
      <p className="text-[#A1A1AA] text-sm font-medium">
        Scanning projection room...
      </p>
    </div>
  );
}
