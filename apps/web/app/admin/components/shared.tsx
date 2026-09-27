"use client";

import type { ReactNode } from "react";

/** Dashboard section wrapper — every section answers one product question. */
export function Section({
  question,
  title,
  icon,
  children,
}: {
  question: string;
  title: string;
  icon: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-10 animate-fade-in">
      <div className="flex items-center gap-3 mb-1">
        <span className="text-lg">{icon}</span>
        <h2 className="text-[17px] font-bold text-white tracking-tight">
          {title}
        </h2>
      </div>
      <p className="text-[12.5px] text-white/[0.38] mb-4 pl-8 italic">
        {question}
      </p>
      {children}
    </section>
  );
}

/** Card container inside a section. */
export function Card({
  title,
  hint,
  children,
  wide,
  className,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`
        bg-[#141417] border border-white/[0.07] rounded-2xl p-4 min-w-0
        transition-all duration-200 hover:border-white/[0.12] hover:shadow-lg hover:shadow-black/20
        ${wide ? "col-span-full" : ""}
        ${className ?? ""}
      `}
    >
      <div className="flex items-baseline gap-2 mb-3">
        <h3 className="text-[11.5px] font-bold tracking-wider uppercase text-white/[0.5]">
          {title}
        </h3>
        {hint && (
          <span className="text-[11px] text-white/[0.25]">— {hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/** Period-over-period delta indicator. */
export function Delta({
  cur,
  prev,
  goodWhenDown,
}: {
  cur: number;
  prev: number;
  goodWhenDown?: boolean;
}) {
  if (prev <= 0) {
    return cur > 0 ? (
      <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">
        new
      </span>
    ) : null;
  }
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) {
    return (
      <span className="text-[11px] text-white/[0.35] bg-white/5 px-1.5 py-0.5 rounded">
        ±0%
      </span>
    );
  }
  const up = pct > 0;
  const good = goodWhenDown ? !up : up;
  return (
    <span
      className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
        good
          ? "text-emerald-400 bg-emerald-400/10"
          : "text-red-400 bg-red-400/10"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

/** Empty-data placeholder. */
export function NoData({
  message = "No data in range",
}: { message?: string } = {}) {
  return (
    <div className="flex items-center justify-center py-8 text-white/[0.25] text-sm">
      <svg
        className="w-4 h-4 mr-2 opacity-40"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M20 12H4M12 4v16"
        />
      </svg>
      {message}
    </div>
  );
}

/** Loading skeleton pulse block. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-white/[0.04] rounded-xl ${className ?? "h-32"}`}
    />
  );
}

/** Tooltip layer. Positioned via fixed CSS based on mouse coords. */
export function TooltipLayer({
  tip,
}: {
  tip: { x: number; y: number; node: ReactNode } | null;
}) {
  if (!tip) return null;
  return (
    <div
      className="fixed z-[90] pointer-events-none bg-[rgba(18,18,22,0.97)] border border-white/[0.14] rounded-xl px-3 py-2 text-xs leading-relaxed text-white/[0.92] shadow-2xl max-w-[280px]"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.node}
    </div>
  );
}
