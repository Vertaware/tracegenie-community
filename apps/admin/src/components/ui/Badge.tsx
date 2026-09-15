import { cn } from "../../lib/utils";

type BadgeProps = {
  children: string;
  tone?: "neutral" | "primary";
  className?: string;
};

/**
 * Label pill. For user-defined labels and quiet tags only.
 * Severity uses SeverityIndicator; status uses StatusChip.
 */
export function Badge({ children, tone = "neutral", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "tg-badge inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium",
        tone === "neutral" && "bg-surface-muted text-muted",
        tone === "primary" && "bg-primary-light text-primary",
        className,
      )}
    >
      {children}
    </span>
  );
}
