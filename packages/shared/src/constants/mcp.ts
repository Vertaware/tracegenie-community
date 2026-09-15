export const MCP_INTEGRATION_ACTIONS = [
  "ticket.read",
  "evidence.read",
  "repo.read",
  "comment.write",
  "external.write",
  "external.create",
  "triage.write",
  "status.write",
  "notify.requester",
] as const;

export const MCP_EXTERNAL_FEEDBACK_STATUSES = [
  "open",
  "triaged",
  "blocked",
  "duplicate",
  "backlog",
  "in_progress",
  "resolved",
  "closed",
] as const;

export const MCP_NOTIFICATION_EVENT_TYPES = [
  "triage_requester",
  "status_change_requester",
  "fixed_requester",
  "reopen_requester",
] as const;

export const MCP_NOTIFICATION_STATUSES = [
  "pending",
  "sent",
  "skipped",
  "failed",
] as const;

export const MCP_STATUS_ALIAS_TO_CANONICAL = {
  open: "new",
  triaged: "triaged",
  blocked: "blocked",
  duplicate: "duplicate",
  backlog: "backlog",
  in_progress: "in_progress",
  resolved: "fixed",
  closed: "closed",
} as const;

export const MCP_STATUS_CANONICAL_TO_EXTERNAL = {
  new: "open",
  triaged: "triaged",
  blocked: "blocked",
  duplicate: "duplicate",
  backlog: "backlog",
  in_progress: "in_progress",
  fixed: "resolved",
  closed: "closed",
} as const;
