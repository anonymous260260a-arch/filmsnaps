/**
 * LegalPrimitives — shared typography/content primitives for the legal pages
 * (/transparency, /privacy, /legal). Extracted from the local copies that were
 * copy-pasted into each page so the three pages stay visually consistent.
 */

import React from "react";

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function SubSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5 mt-5">
      <h3 className="mb-2 text-[15px] font-semibold text-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function Body({
  children,
  extraMargin,
}: {
  children: React.ReactNode;
  extraMargin?: boolean;
}) {
  return (
    <p
      className={`text-sm leading-6 text-muted-foreground ${
        extraMargin ? "mt-3" : "mb-4"
      }`}
    >
      {children}
    </p>
  );
}

export function Bold({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

export function Bullet({ text }: { text: string }) {
  return (
    <p className="mt-2 flex items-start gap-2.5 text-sm leading-5 text-muted-foreground">
      <span className="mt-1.5 text-[10px] leading-none text-primary">■</span>
      <span>{text}</span>
    </p>
  );
}
