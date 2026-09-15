import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { IssueDetailPage } from "../src/features/issues/IssueDetailPage";
import { api } from "../src/lib/api";
import "../src/styles/index.css";

const providerProof = new URLSearchParams(window.location.search).get("provider") === "1";
const activityProof = new URLSearchParams(window.location.search).get("activity");

const feedback = {
  id: "issue-lifecycle-proof",
  ticketNumber: 743,
  project: { id: "project-1", key: "checkout", name: "Checkout" },
  status: "in_progress",
  issueType: "bug",
  severity: "high",
  title: "Checkout confirmation stalls after payment",
  description: "Payment succeeds but confirmation never completes.",
  isOverageLocked: false,
  stepsToReproduce: "Open checkout, enter a valid card, and select Pay now.",
  expectedResult: "The receipt appears.",
  actualResult: "The confirmation remains busy and logs a timeout.",
  labels: ["checkout", "regression"],
  route: { url: "https://app.example.test/checkout/confirm" },
  release: { appName: "Storefront", appEnvironment: "production", appVersion: "2026.7.15" },
  releaseSignal: null,
  browser: { userAgent: "proof", viewportWidth: 1440, viewportHeight: 1000 },
  reporter: { id: "reporter-1", email: "maya@northwind.example", name: "Maya Patel" },
  subscribers: [],
  requesterNotificationsEnabled: true,
  clientTimestamp: "2026-07-15T13:45:00.000Z",
  duplicateCandidates: [],
  duplicateOf: null,
  duplicates: [],
  duplicateCommentConsolidation: { totalCount: 0, omittedCount: 0, comments: [] },
  duplicateGroup: null,
  convertedToBacklog: false,
  externalTicketRef: null,
  externalRefs: [],
  engineeringLifecycle: {
    branchName: "codex/fix-checkout-confirmation",
    branchUrl: "https://github.com/example/storefront/tree/codex/fix-checkout-confirmation",
    pullRequestUrl: "https://github.com/example/storefront/pull/743",
    deployUrl: "https://deploy.example.test/storefront/743",
    verificationState: "deployed",
    closingOutcome: null,
  },
  engineeringLifecycleHistory: providerProof ? [
    { id: "transition-1", provider: "github", source: "provider", stage: "branch", state: "created", externalId: "branch-743", externalUrl: "https://github.com/example/storefront/tree/codex/fix-checkout-confirmation", label: "Branch created", details: { branch: "codex/fix-checkout-confirmation" }, observedAt: "2026-07-15T13:50:00.000Z", createdAt: "2026-07-15T13:50:01.000Z" },
    { id: "transition-2", provider: "github", source: "provider", stage: "pull_request", state: "open", externalId: "pr-743", externalUrl: "https://github.com/example/storefront/pull/743", label: "PR #743 opened", details: { repository: "example/storefront" }, observedAt: "2026-07-15T13:52:00.000Z", createdAt: "2026-07-15T13:52:01.000Z" },
    { id: "transition-3", provider: "github", source: "provider", stage: "check", state: "success", externalId: "check-743", externalUrl: "https://github.com/example/storefront/actions/runs/743", label: "CI passed", details: { checkName: "CI" }, observedAt: "2026-07-15T13:54:00.000Z", createdAt: "2026-07-15T13:54:01.000Z" },
    { id: "transition-4", provider: "github", source: "provider", stage: "review", state: "approved", externalId: "review-743", externalUrl: "https://github.com/example/storefront/pull/743#pullrequestreview-743", label: "Review approved", details: { actorName: "reviewer" }, observedAt: "2026-07-15T13:56:00.000Z", createdAt: "2026-07-15T13:56:01.000Z" },
    { id: "transition-5", provider: "github", source: "provider", stage: "merge", state: "merged", externalId: "pr-743", externalUrl: "https://github.com/example/storefront/pull/743", label: "Merged to main", details: { commitSha: "abcdef1234567890" }, observedAt: "2026-07-15T13:58:00.000Z", createdAt: "2026-07-15T13:58:01.000Z" },
    { id: "transition-6", provider: "github", source: "provider", stage: "deploy", state: "success", externalId: "deploy-743", externalUrl: "https://deploy.example.test/storefront/743", label: "Production deployed", details: { environment: "production" }, observedAt: "2026-07-15T14:00:00.000Z", createdAt: "2026-07-15T14:00:01.000Z" },
    { id: "transition-7", provider: "manual", source: "manual", stage: "manual", state: "recorded", externalId: null, externalUrl: null, label: null, details: null, observedAt: "2026-07-15T14:01:00.000Z", createdAt: "2026-07-15T14:01:00.000Z" },
  ] : [],
  attachments: [],
  consoleEntries: [{ level: "error", message: "POST /orders timed out" }],
  clientErrorContext: null,
  extraContext: null,
  comments: [],
  owner: { id: "owner-1", name: "Avery Chen", email: "avery@example.test", role: "admin" },
  statusHistory: [],
  triageHistory: [],
  auditHistory: [],
  notificationHistory: [],
  createdAt: "2026-07-15T13:45:00.000Z",
  updatedAt: "2026-07-15T14:00:00.000Z",
};

const calls: Array<Record<string, unknown>> = [];
const response = () => ({ feedback: structuredClone(feedback), assignableUsers: [feedback.owner] });

Object.assign(api, {
  getFeedbackDetail: async () => response(),
  getFeedbackActivity: async (_feedbackId: string, page = 1) => {
    if (activityProof === "error") throw new Error("Deterministic activity failure");
    if (activityProof !== "rich") {
      return { items: [], pagination: { page: 1, pageSize: 30, total: 0, pageCount: 1, hasMore: false } };
    }
    const items = page === 1 ? [
      { id: "notification-failed", kind: "notification", occurredAt: "2026-07-15T14:06:00.000Z", actor: { label: "TraceGenie delivery", type: "system" }, provenance: "Requester delivery", title: "Status Change Requester · Failed", summary: null, outcome: "failed", visibility: "system", safeDetails: ["Attempt 2", "Automatic retry scheduled"], retry: { notificationId: "notification-7", label: "Retry delivery" } },
      { id: "lifecycle-check", kind: "lifecycle", occurredAt: "2026-07-15T14:04:00.000Z", actor: { label: "GitHub", type: "provider" }, provenance: "GitHub observed", title: "Check · Success", summary: "CI passed", outcome: "success", visibility: "system", safeDetails: [], retry: null },
      { id: "requester-update", kind: "note", occurredAt: "2026-07-15T14:03:00.000Z", actor: { label: "Avery Chen", type: "admin" }, provenance: "Requester-visible update", title: "Requester update recorded", summary: "The fix is in verification.", outcome: "neutral", visibility: "requester", safeDetails: [], retry: null },
      { id: "private-note", kind: "note", occurredAt: "2026-07-15T14:02:00.000Z", actor: { label: "Avery Chen", type: "admin" }, provenance: "Private internal note", title: "Internal note added", summary: "Rollback is ready if verification fails.", outcome: "neutral", visibility: "internal", safeDetails: [], retry: null },
    ] : [
      { id: "status-created", kind: "status", occurredAt: "2026-07-15T13:45:00.000Z", actor: { label: "TraceGenie", type: "system" }, provenance: "Issue status", title: "Issue created as New", summary: null, outcome: "neutral", visibility: "system", safeDetails: [], retry: null },
    ];
    return { items, pagination: { page, pageSize: 4, total: 5, pageCount: 2, hasMore: page === 1 } };
  },
  getProjectEngineeringContext: async () => ({
    project: feedback.project,
    engineeringContext: {
      repositoryUrl: "https://github.com/example/storefront",
      defaultBranch: "main",
      worktreePath: "/workspace/storefront",
      installCommand: "npm ci",
      testCommand: "npm test -- checkout",
      buildCommand: "npm run build",
      autoFixPolicy: "SUGGEST_ONLY",
      reviewerPolicy: "REQUIRED",
      requesterNotificationPolicy: "EXPLICIT_ONLY",
      notes: null,
      createdAt: null,
      updatedAt: null,
    },
  }),
  updateFeedback: async (_feedbackId: string, body: Record<string, unknown>) => {
    calls.push(structuredClone(body));
    if (body.engineeringLifecycle && typeof body.engineeringLifecycle === "object") {
      Object.assign(feedback.engineeringLifecycle, body.engineeringLifecycle);
    }
    feedback.updatedAt = "2026-07-15T14:05:00.000Z";
    return response();
  },
  replayNotification: async (notificationId: string) => ({ notification: { id: notificationId, status: "pending" } }),
});

Object.assign(window, {
  __lifecycleProof: {
    get calls() {
      return calls;
    },
  },
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY }, mutations: { retry: false } },
});
const root = document.getElementById("root");
if (!root) throw new Error("Lifecycle proof root is missing.");

createRoot(root).render(
  <main id="issue-lifecycle-browser-harness" className="min-h-screen overflow-x-clip bg-surface">
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/issues/issue-lifecycle-proof"]}>
        <Routes>
          <Route path="/issues/:feedbackId" element={<IssueDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  </main>,
);
