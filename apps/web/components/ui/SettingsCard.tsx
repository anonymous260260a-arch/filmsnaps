import * as React from "react";
import { cn } from "@/lib/utils";

export interface SettingsCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
}

/**
 * Unified card wrapper for settings sections.
 * Provides a consistent surface, header, and padding rhythm
 * that matches the Precision Dark desktop aesthetic.
 */
export function SettingsCard({
  title,
  description,
  icon,
  className,
  children,
  ...props
}: SettingsCardProps) {
  return (
    <div
      className={cn("bg-card border border-border rounded-xl p-6", className)}
      {...props}
    >
      {(title || description || icon) && (
        <div className="mb-4 flex items-start gap-3">
          {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
          <div>
            {title && (
              <h3 className="text-base font-medium text-foreground leading-tight">
                {title}
              </h3>
            )}
            {description && (
              <p className="mt-0.5 text-sm text-muted-foreground leading-normal">
                {description}
              </p>
            )}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
