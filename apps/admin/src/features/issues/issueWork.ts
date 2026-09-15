import type { FeedbackListItem } from "@tracegenie/shared";

export const ISSUE_WORK_VALUES = ["follow-up", "assign", "triage", "blocker", "review"] as const;

export type IssueWork = (typeof ISSUE_WORK_VALUES)[number];
export type IssueDetailTab = "overview" | "investigate" | "resolve" | "conversation" | "activity";

export function issueDetailTab(searchParams: URLSearchParams): IssueDetailTab {
  const tab = searchParams.get("tab");
  if (tab === "overview" || tab === "investigate" || tab === "resolve" || tab === "conversation" || tab === "activity") return tab;
  const work = parseIssueWork(searchParams.get("work"));
  return work === "follow-up" ? "activity"
    : work === "assign" || work === "triage" || work === "blocker" ? "resolve" : "overview";
}

export type NextTriageWork = {
  label: string;
  work: IssueWork;
};

export function nextTriageWork(item: Pick<FeedbackListItem, "owner" | "status" | "requesterLoop">): NextTriageWork {
  if (item.requesterLoop?.failedCount || item.requesterLoop?.updateDue) {
    return { label: "Follow up", work: "follow-up" };
  }
  if (!item.owner) {
    return { label: "Assign owner", work: "assign" };
  }
  if (item.status === "new") {
    return { label: "Triage", work: "triage" };
  }
  if (item.status === "blocked") {
    return { label: "Review blocker", work: "blocker" };
  }
  return { label: "Review", work: "review" };
}

export function parseIssueWork(value: string | null): IssueWork | null {
  return ISSUE_WORK_VALUES.includes(value as IssueWork) ? value as IssueWork : null;
}

export function issueListSearchParams(searchParams: URLSearchParams) {
  const next = new URLSearchParams(searchParams);
  next.delete("work");
  next.delete("from");
  next.delete("tab");
  return next;
}

export function issueDetailReturnTo(searchParams: URLSearchParams) {
  if (searchParams.get("from") === "overview") {
    return "/home";
  }
  const listParams = issueListSearchParams(searchParams);
  const query = listParams.toString();
  return query ? `/issues?${query}` : "/issues";
}

export function issueNeighborSearch(searchParams: URLSearchParams) {
  const next = new URLSearchParams(searchParams);
  next.delete("work");
  return next.toString();
}
