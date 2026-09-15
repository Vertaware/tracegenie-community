import { STATUS_META,type FeedbackStatus } from "@tracegenie/shared";

import { cn } from "../../lib/utils";

const DOT: Record<FeedbackStatus, string> = {
  new: "bg-primary",
  triaged: "bg-brand-400",
  blocked: "bg-warning",
  duplicate: "bg-brand-400",
  backlog: "bg-brand-400",
  in_progress: "bg-primary",
  fixed: "bg-success",
  closed: "bg-brand-400",
};

/** Status rendered as dot + word. The single status treatment for the admin. */
export function StatusChip({ status, className }: { status: string; className?: string }) {
  const key = (status in STATUS_META ? status : "new") as FeedbackStatus;

  return (
    <span className={cn("tg-status-chip inline-flex items-center gap-1.5 text-label text-foreground", className)}>
      <span key={key} className="tg-status-change inline-flex items-center gap-1.5">
      <span className={cn("tg-status-dot size-1.5 rounded-full", DOT[key])} aria-hidden="true" />
        {STATUS_META[key].label}
      </span>
    </span>
  );
}
