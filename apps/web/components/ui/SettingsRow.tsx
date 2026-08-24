import * as React from "react";
import { cn } from "@/lib/utils";

export interface SettingsRowProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  description?: string;
  icon?: React.ReactNode;
  /** Right-aligned control (switch, input, select, etc.) */
  control?: React.ReactNode;
}

/**
 * Unified row for settings items: label / description on the left,
 * interactive control on the right. Consistent height, focus ring,
 * and typography tokens across the desktop settings surfaces.
 */
export function SettingsRow({
  label,
  description,
  icon,
  control,
  className,
  ...props
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between py-3",
        "first:pt-0 last:pb-0",
        className,
      )}
      {...props}
    >
      <div className="flex items-start gap-3">
        {icon && (
          <div className="mt-0.5 shrink-0 text-muted-foreground">{icon}</div>
        )}
        <div>
          <span className="text-sm font-medium text-foreground">{label}</span>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground leading-normal">
              {description}
            </p>
          )}
        </div>
      </div>
      {control && <div className="shrink-0">{control}</div>}
    </div>
  );
}
