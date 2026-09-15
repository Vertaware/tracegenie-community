import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { IssueDetailPage } from "../src/features/issues/IssueDetailPage";
import { api } from "../src/lib/api";
import "../src/styles/index.css";

const feedback = {
  id: "issue-proof",
  ticketNumber: 641,
  project: { id: "project-1", key: "checkout", name: "Checkout" },
  status: "triaged",
  issueType: "bug",
  severity: "high",
  title: "Checkout confirmation stalls after payment",
  description: "Payment succeeds but confirmation never completes.",
  isOverageLocked: false,
  stepsToReproduce: "Open checkout, enter a valid card, and select Pay now.",
  expectedResult: "The receipt appears.",
  actualResult: "The confirmation remains busy.",
  labels: ["checkout", "regression"],
  route: { url: "https://app.example.test/checkout/confirm" },
  release: { appName: "Storefront", appEnvironment: "production", appVersion: "2026.7.15" },
  releaseSignal: null,
  browser: { userAgent: "proof", viewportWidth: 1440, viewportHeight: 1000 },
  reporter: { id: "reporter-1", email: "maya@northwind.example", name: "Maya Patel" },
  subscribers: [{
    id: "subscriber-1",
    email: "support@northwind.example",
    name: "Northwind Support",
    recipientType: "external_subscriber",
    notifyOnTriage: true,
    notifyOnStatusChange: true,
    isActive: true,
  }],
  requesterNotificationsEnabled: true,
  clientTimestamp: "2026-07-15T13:45:00.000Z",
  duplicateCandidates: [], duplicateOf: null, duplicates: [],
  duplicateCommentConsolidation: { totalCount: 0, omittedCount: 0, comments: [] },
  duplicateGroup: null, convertedToBacklog: false, externalTicketRef: null,
  externalRefs: [], engineeringLifecycle: null, attachments: [],
  consoleEntries: [{ level: "error", message: "POST /orders timed out" }],
  clientErrorContext: null, extraContext: null, comments: [],
  owner: { id: "owner-1", name: "Avery Chen", email: "avery@example.test", role: "admin" },
  statusHistory: [], triageHistory: [], auditHistory: [], notificationHistory: [],
  createdAt: "2026-07-15T13:45:00.000Z", updatedAt: "2026-07-15T14:00:00.000Z",
};

const response = () => ({ feedback: structuredClone(feedback), assignableUsers: [feedback.owner] });
const calls: Array<{ feedbackId: string; body: Record<string, unknown> }> = [];
let requesterAttempts = 0;

Object.assign(api, {
  getFeedbackDetail: async () => response(),
  getFeedbackActivity: async () => ({ items: [], pagination: { page: 1, pageSize: 30, total: 0, pageCount: 1, hasMore: false } }),
  getProjectEngineeringContext: async () => ({
    project: feedback.project,
    engineeringContext: {
      repositoryUrl: "https://github.com/example/storefront", defaultBranch: "main", worktreePath: "/workspace/storefront",
      installCommand: "npm ci", testCommand: "npm test -- checkout", buildCommand: "npm run build",
      autoFixPolicy: "SUGGEST_ONLY", reviewerPolicy: "NONE", requesterNotificationPolicy: "EXPLICIT_ONLY",
      notes: null, createdAt: null, updatedAt: null,
    },
  }),
  addComment: async (feedbackId: string, body: Record<string, unknown>) => {
    calls.push({ feedbackId, body: structuredClone(body) });
    if (body.notifyRequester === true) {
      requesterAttempts += 1;
      if (requesterAttempts === 1) throw new Error("Proof delivery failure");
    }
    return { comment: { id: `comment-${calls.length}` } };
  },
});

Object.assign(window, {
  __communicationProof: {
    get calls() { return calls; },
    get requesterAttempts() { return requesterAttempts; },
  },
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY }, mutations: { retry: false } },
});
const root = document.getElementById("root");
if (!root) throw new Error("Communication proof root is missing.");
createRoot(root).render(
  <main id="issue-communication-browser-harness" className="min-h-screen overflow-x-clip bg-surface">
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/issues/issue-proof"]}>
        <Routes>
          <Route path="/issues/:feedbackId" element={<IssueDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  </main>,
);
