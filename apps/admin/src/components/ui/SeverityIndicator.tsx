import { SEVERITY_META,type SeverityLevel } from "@tracegenie/shared";

import { cn } from "../../lib/utils";

const COLOR: Record<SeverityLevel, string> = {
  low: "text-severity-low",
  medium: "text-severity-medium",
  high: "text-severity-high",
  critical: "text-severity-critical",
};

/**
 * Severity rendered as a filled-bars glyph plus the word. Color is never
 * the only signal. The single severity treatment for the whole admin.
 */
export function SeverityIndicator({ severity, className }: { severity: string; className?: string }) {
  const level = (severity in SEVERITY_META ? severity : "low") as SeverityLevel;
  const meta = SEVERITY_META[level];

  return (
    <span className={cn("tg-severity-indicator inline-flex items-center gap-1.5 text-label font-medium text-foreground", className)}>
      <svg viewBox="0 0 12 12" width="12" height="12" className={COLOR[level]} aria-hidden="true">
        <rect x="0" y="8" width="2.6" height="4" rx="0.8" fill="currentColor" opacity={meta.rank >= 0 ? 1 : 0.25} />
        <rect x="4.7" y="4.5" width="2.6" height="7.5" rx="0.8" fill="currentColor" opacity={meta.rank >= 1 ? 1 : 0.25} />
        <rect x="9.4" y="1" width="2.6" height="11" rx="0.8" fill="currentColor" opacity={meta.rank >= 2 ? 1 : 0.25} />
      </svg>
      {meta.label}
    </span>
  );
}
