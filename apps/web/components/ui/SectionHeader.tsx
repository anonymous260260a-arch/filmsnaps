import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  icon?: React.ReactNode;
  count?: number | string;
  seeAllHref?: string;
  seeAllLabel?: string;
}

/**
 * Header row for content sections (Continue Watching, History,
 * Downloads, etc.). Left side holds icon + title + optional count;
 * right side holds an optional "See all" link.
 */
export function SectionHeader({
  title,
  icon,
  count,
  seeAllHref,
  seeAllLabel = "See all",
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div
      className={cn("mb-4 flex items-center justify-between", className)}
      {...props}
    >
      <div className="flex items-center gap-2">
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <h2 className="text-lg font-semibold text-foreground leading-tight">
          {title}
        </h2>
        {count !== undefined && (
          <span className="text-sm text-muted-foreground">({count})</span>
        )}
      </div>
      {seeAllHref && (
        <Link
          href={seeAllHref}
          className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
        >
          {seeAllLabel}
        </Link>
      )}
    </div>
  );
}
