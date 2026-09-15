import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { IssueDetailPage } from "../src/features/issues/IssueDetailPage";
import { api, ApiError } from "../src/lib/api";
import "../src/styles/index.css";

const state = new URLSearchParams(window.location.search).get("state") ?? "blocked";
const baseFeedback = {
  id: "issue-proof",
  ticketNumber: 640,
  project: { id: "project-1", key: "checkout", name: "Checkout" },
  status: "triaged",
  issueType: "bug",
  severity: "high",
  title: "Checkout confirmation stalls after payment",
  description: "The customer completes payment but the confirmation screen never resolves.",
  isOverageLocked: false,
  stepsToReproduce: null,
  expectedResult: null,
  actualResult: null,
  labels: ["checkout", "regression"],
  route: { url: "https://app.example.test/checkout/confirm" },
  release: { appName: "Storefront", appEnvironment: "production", appVersion: "2026.7.15", buildNumber: "1842" },
  releaseSignal: null,
  browser: { userAgent: "proof", browserName: "Chrome", browserVersion: "150", osName: "macOS", osVersion: "15.5", viewportWidth: 1440, viewportHeight: 1000 },
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
  engineeringLifecycle: null,
  attachments: [],
  consoleEntries: null,
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

function feedbackFor(mode: string) {
  const feedback = structuredClone(baseFeedback);
  if (mode === "strong") {
    feedback.stepsToReproduce = "Open checkout, enter a valid card, and select Pay now.";
    feedback.actualResult = "Payment fails with an error.";
    feedback.consoleEntries = [{ level: "error", message: "POST /orders timed out" }];
  }
  if (mode === "override") {
    feedback.extraContext = {
      evidenceGateOverride: {
        reason: "Production impact requires immediate engineering investigation.",
        evidenceScore: 38,
        missing: ["screenshot", "console-error", "steps", "account", "repro-confidence"],
        createdAt: "2026-07-15T14:05:00.000Z",
      },
    };
    feedback.updatedAt = "2026-07-15T14:05:00.000Z";
  }
  return feedback;
}

let currentMode = state === "strong" ? "strong" : "blocked";
let overrideAttempts = 0;
const response = () => ({
  feedback: feedbackFor(currentMode),
  assignableUsers: [{ id: "owner-1", name: "Avery Chen", email: "avery@example.test", role: "admin" }],
});

Object.assign(api, {
  getFeedbackDetail: async () => response(),
  getFeedbackActivity: async () => ({ items: [], pagination: { page: 1, pageSize: 30, total: 0, pageCount: 1, hasMore: false } }),
  getProjectEngineeringContext: async () => ({
    project: baseFeedback.project,
    engineeringContext: {
      repositoryUrl: "https://github.com/example/storefront",
      defaultBranch: "main",
      worktreePath: "/workspace/storefront",
      installCommand: "npm ci",
      testCommand: "npm test -- checkout",
      buildCommand: "npm run build",
      autoFixPolicy: "SUGGEST_ONLY",
      reviewerPolicy: "NONE",
      requesterNotificationPolicy: "EXPLICIT_ONLY",
      notes: null,
      createdAt: null,
      updatedAt: null,
    },
  }),
  overrideFeedbackEvidenceGate: async (_feedbackId: string, body: { reason: string; expectedUpdatedAt: string }) => {
    overrideAttempts += 1;
    if (overrideAttempts === 1) throw new ApiError(503, "Override unavailable.", "feedback.override_unavailable");
    currentMode = "override";
    return response();
  },
  createAiCodingTask: async () => ({ prompt: "Inspect checkout and run the focused payment tests." }),
});

Object.assign(window, { __evidenceGateProof: { get overrideAttempts() { return overrideAttempts; } } });
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => undefined } });

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY }, mutations: { retry: false } },
});
const root = document.getElementById("root");
if (!root) throw new Error("Evidence gate harness root is missing.");
createRoot(root).render(
  <main id="issue-evidence-gate-browser-harness" className="min-h-screen overflow-x-clip bg-surface px-4 py-6 md:px-8 md:py-8">
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/issues/issue-proof"]}>
        <Routes>
          <Route path="/issues/:feedbackId" element={<IssueDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  </main>,
);
