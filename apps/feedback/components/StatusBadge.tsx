import type { FeedbackStatus, Severity } from "@/lib/types";
import { STATUS_LABELS, SEVERITY_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: FeedbackStatus;
  className?: string;
}

const STATUS_COLORS: Record<FeedbackStatus, string> = {
  open: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  planned: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  "in-progress":
    "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  completed:
    "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
  declined: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        STATUS_COLORS[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  high: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  medium:
    "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  low: "bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30",
};

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        SEVERITY_COLORS[severity],
        className,
      )}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}
