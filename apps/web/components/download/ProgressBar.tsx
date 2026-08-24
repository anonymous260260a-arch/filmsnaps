"use client";

/**
 * ProgressBar — rounded progress bar with an optional percentage label.
 * Used by the Download Manager rows and (later) progress overlays.
 */

interface ProgressBarProps {
  /** 0…1 */
  value: number;
  /** Tailwind color class for the fill (default gold). */
  colorClass?: string;
  /** Show the percentage to the right of the bar. */
  showPercent?: boolean;
  /** Render the percentage inside a tiny label. */
  heightClass?: string;
}

export function ProgressBar({
  value,
  colorClass = "bg-[#D4A237]",
  showPercent = false,
  heightClass = "h-1.5",
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, Math.round(value * 100)));
  return (
    <div className="flex items-center gap-2 w-full">
      <div
        className={`flex-1 overflow-hidden rounded-full bg-white/[0.07] ${heightClass}`}
      >
        <div
          className={`h-full rounded-full ${colorClass} transition-[width] duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showPercent && (
        <span className="text-[11px] tabular-nums text-muted-foreground w-9 text-right shrink-0">
          {pct}%
        </span>
      )}
    </div>
  );
}
