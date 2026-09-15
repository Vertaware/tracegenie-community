import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { IssueDetailPage } from "../src/features/issues/IssueDetailPage";
import { api } from "../src/lib/api";
import "../src/styles/index.css";

const mode = new URLSearchParams(window.location.search).get("state") === "missing" ? "missing" : "complete";
const project = { id: "project-1", key: "checkout", name: "Checkout" };
const feedback = {
  id: "issue-ai-task-proof",
  ticketNumber: 842,
  project,
  status: "triaged",
  issueType: "bug",
  severity: "high",
  title: "Checkout confirmation stalls after payment",
  description: "Payment succeeds, but the confirmation view remains in a loading state.",
  isOverageLocked: false,
  stepsToReproduce: "Open checkout, enter a valid test card, and select Pay now.",
  expectedResult: "The order confirmation appears once payment succeeds.",
  actualResult: "The loading state remains until the page is refreshed.",
  labels: ["checkout", "regression"],
  route: { url: "https://app.example.test/checkout/confirm?session=private" },
  release: { appName: "Storefront", appEnvironment: "production", appVersion: "2026.7.15", buildNumber: "1842" },
  releaseSignal: null,
  browser: { userAgent: "proof", browserName: "Chrome", browserVersion: "150", osName: "macOS", osVersion: "15.5", viewportWidth: 1440, viewportHeight: 1000 },
  reporter: { id: "reporter-1", email: "private@example.test", name: "Private reporter" },
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
  engineeringLifecycle: null,
  attachments: [{ id: "attachment-1", fileName: "checkout-stall.png", mimeType: "image/png", byteSize: 184000, createdAt: "2026-07-15T13:45:00.000Z" }],
  consoleEntries: [{ level: "error", message: "Order confirmation timed out" }],
  clientErrorContext: { name: "TimeoutError", message: "Confirmation request exceeded 10s" },
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

const repository = mode === "complete"
  ? { url: "https://github.com/example/storefront", worktreePath: "/workspace/storefront", defaultBranch: "main" }
  : { url: null, worktreePath: null, defaultBranch: null };
const task = {
  prompt: "Evidence-backed prompt that executes nothing.",
  preview: {
    ticket: { number: 842, title: feedback.title, severity: "high", status: "triaged", url: "https://app.example.test/checkout/confirm", release: "Storefront / production / 2026.7.15 / 1842" },
    repository,
    filesToInspect: mode === "complete" ? ["apps/web/src/checkout/confirmation.tsx", "apps/web/test/confirmation.test.tsx"] : [],
    commands: mode === "complete" ? { test: "npm test -- confirmation", build: "npm run build" } : { test: null, build: null },
    expectedOutcome: ["Expected: The order confirmation appears once payment succeeds.", "Current: The loading state remains until refresh."],
    evidenceGaps: mode === "complete" ? [] : ["Validated files to inspect", "Repository URL", "Local worktree", "Test command", "Build command"],
    ownerHints: mode === "complete" ? [{ file: "apps/web/src/checkout/confirmation.tsx", owners: ["@checkout-platform"], pattern: "apps/web/src/checkout/**" }] : [],
    reviewerPolicy: "HUMAN_REVIEW_REQUIRED" as const,
  },
};

Object.assign(api, {
  getFeedbackDetail: async () => ({ feedback, assignableUsers: [feedback.owner] }),
  getFeedbackActivity: async () => ({ items: [], pagination: { page: 1, pageSize: 30, total: 0, pageCount: 1, hasMore: false } }),
  getProjectEngineeringContext: async () => ({ project, engineeringContext: { repositoryUrl: repository.url, defaultBranch: repository.defaultBranch, worktreePath: repository.worktreePath, installCommand: null, testCommand: task.preview.commands.test, buildCommand: task.preview.commands.build, autoFixPolicy: "SUGGEST_ONLY", reviewerPolicy: "HUMAN_REVIEW_REQUIRED", requesterNotificationPolicy: "EXPLICIT_ONLY", notes: null, createdAt: null, updatedAt: null } }),
  createAiCodingTask: async () => task,
});
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => undefined } });

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY }, mutations: { retry: false } } });
const root = document.getElementById("root");
if (!root) throw new Error("AI coding task harness root is missing.");
createRoot(root).render(
  <main id="ai-coding-task-browser-harness" className="min-h-screen overflow-x-clip bg-surface px-4 py-6 md:px-8 md:py-8">
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/issues/issue-ai-task-proof"]}>
        <Routes>
          <Route path="/issues/:feedbackId" element={<IssueDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  </main>,
);
