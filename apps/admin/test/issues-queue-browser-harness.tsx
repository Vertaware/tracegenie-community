import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import { IssuesPage } from "../src/features/issues/IssuesPage";
import { api } from "../src/lib/api";
import "../src/styles/index.css";

const issue = {
  id: "queue-proof-1",
  ticketNumber: 401,
  title: "Enterprise checkout fails after SSO redirect",
  description: "The payment confirmation request fails after the requester returns from SSO.",
  project: { key: "checkout", name: "Checkout" },
  status: "triaged",
  severity: "critical",
  issueType: "bug",
  labels: ["enterprise", "regression"],
  currentUrl: "https://app.example.test/checkout/confirm",
  reporterName: "Ada Lovelace",
  reporterEmail: "ada@example.test",
  productContextSummary: null,
  customerImpactSummary: {
    summary: "Enterprise checkout is blocked",
    affectedUsers: 240,
    affectedAccounts: 12,
    revenueAtRisk: "$84k ARR",
    churnRisk: "critical",
  },
  duplicateOf: null,
  duplicateCount: 3,
  requesterLoop: {
    canEmailRequester: true,
    lastRequesterUpdateAt: null,
    updateDue: true,
    failedCount: 0,
  },
  releaseSignal: null,
  owner: { id: "owner-1", name: "Priya Shah" },
  convertedToBacklog: false,
  attachmentCount: 2,
  createdAt: "2026-07-14T12:00:00.000Z",
  updatedAt: "2026-07-14T14:00:00.000Z",
};

const lockedIssue = {
  ...issue,
  id: "queue-proof-locked",
  ticketNumber: 402,
  title: "Invoice export times out",
  isOverageLocked: true,
  attachmentCount: 0,
  customerImpactSummary: null,
  requesterLoop: undefined,
  owner: null,
};

const pageTwoIssue = {
  ...issue,
  id: "queue-proof-page-2",
  ticketNumber: 403,
  title: "Page two identity remains stable",
  status: "in_progress",
};

Object.assign(api, {
  getProjects: async () => ({ projects: [{ key: "checkout", name: "Checkout" }] }),
  getSavedIssueViews: async () => ({ views: [] }),
  getFeedbackList: async (search: URLSearchParams) => ({
    pagination: { total: 3, page: Number(search.get("page") ?? "1"), pageSize: 20, pageCount: 2 },
    assignableUsers: [{ id: "owner-1", name: "Priya Shah", email: "priya@example.test", role: "member" }],
    items: search.get("page") === "2" ? [pageTwoIssue] : [issue, lockedIssue],
  }),
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
});

function IssuesQueueBrowserHarness() {
  return (
    <main id="issues-queue-browser-harness" className="min-h-screen bg-surface-muted/25 px-4 py-6">
      <section id="issues-queue-proof-surface" className="mx-auto w-full max-w-7xl">
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/issues?page=1"]}>
            <IssuesPage organizationId="organization-proof" />
          </MemoryRouter>
        </QueryClientProvider>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Issues queue browser harness root is missing.");
createRoot(root).render(<IssuesQueueBrowserHarness />);
