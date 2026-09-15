export const ISSUE_TYPES = [
  "bug",
  "ux",
  "enhancement",
  "performance",
  "data",
  "other",
] as const;

export const SEVERITY_LEVELS = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export const FEEDBACK_STATUSES = [
  "new",
  "triaged",
  "blocked",
  "duplicate",
  "backlog",
  "in_progress",
  "fixed",
  "closed",
] as const;

/** Allowed user-driven transitions; duplicate linking remains a separate action. */
export const FEEDBACK_STATUS_TRANSITIONS: Record<FeedbackStatus, FeedbackStatus[]> = {
  new: ["triaged", "blocked", "duplicate", "backlog", "closed"],
  triaged: ["in_progress", "blocked", "duplicate", "backlog", "closed"],
  blocked: ["triaged", "in_progress", "backlog", "closed"],
  in_progress: ["fixed", "blocked", "backlog", "closed"],
  fixed: ["closed", "backlog", "in_progress"],
  backlog: ["triaged", "in_progress", "blocked", "closed"],
  duplicate: ["triaged", "closed"],
  closed: ["triaged", "backlog", "in_progress"],
};

export const FEEDBACK_LABELS = [
  "bug",
  "ux",
  "enhancement",
  "blocker",
  "performance",
  "release",
  "data",
] as const;

export const ATTACHMENT_TYPES = [
  "screenshot",
  "file",
] as const;

export const COMMENT_VISIBILITY = [
  "internal",
  "public",
] as const;

export const FEEDBACK_RECIPIENT_TYPES = [
  "requester",
  "external_subscriber",
  "internal_subscriber",
] as const;

/** Matches eligible customer recipients; internal followers never require a customer reply. */
export function hasCustomerStatusRecipient(feedback: {
  reporterEmail?: string | null;
  requesterNotificationsEnabled: boolean;
  subscribers: ReadonlyArray<{
    email: string;
    recipientType: string;
    isActive: boolean;
    notifyOnStatusChange: boolean;
  }>;
}) {
  const reporterEmail = feedback.reporterEmail?.trim();
  return Boolean(reporterEmail && feedback.requesterNotificationsEnabled)
    || feedback.subscribers.some((subscriber) => subscriber.isActive
      && Boolean(subscriber.email.trim())
      && ["requester", "external_subscriber"].includes(subscriber.recipientType.toLowerCase())
      && (subscriber.notifyOnStatusChange || !reporterEmail));
}

export const PROJECT_ENVIRONMENTS = [
  "local",
  "development",
  "staging",
  "production",
] as const;

export const DEFAULT_WIDGET_SHORTCUT = "mod+shift+b";

/* ── Presentation metadata: the single source of truth for how severity and
   status render across the admin. Page-local tone maps are not allowed. ── */

export type IssueType = (typeof ISSUE_TYPES)[number];
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const ISSUE_TYPE_META: Record<IssueType, { label: string }> = {
  bug: { label: "Bug" },
  ux: { label: "UX issue" },
  enhancement: { label: "Enhancement" },
  performance: { label: "Performance" },
  data: { label: "Data issue" },
  other: { label: "Other" },
};

export const SEVERITY_META: Record<SeverityLevel, { label: string; rank: number }> = {
  low: { label: "Low", rank: 0 },
  medium: { label: "Medium", rank: 1 },
  high: { label: "High", rank: 2 },
  critical: { label: "Critical", rank: 3 },
};

export const STATUS_META: Record<FeedbackStatus, { label: string; group: "open" | "active" | "done" }> = {
  new: { label: "New", group: "open" },
  triaged: { label: "Triaged", group: "active" },
  blocked: { label: "Blocked", group: "active" },
  duplicate: { label: "Duplicate", group: "done" },
  backlog: { label: "Backlog", group: "active" },
  in_progress: { label: "In progress", group: "active" },
  fixed: { label: "Fixed", group: "done" },
  closed: { label: "Closed", group: "done" },
};
