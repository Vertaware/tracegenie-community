import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import { IssuesPage } from "../src/features/issues/IssuesPage";
import { api } from "../src/lib/api";
import "../src/styles/index.css";

const issues = [
  {
    id: "expert-issue-1",
    ticketNumber: 781,
    title: "Enterprise checkout fails after SSO redirect",
    description: "Payment confirmation fails after the requester returns from SSO.",
    project: { key: "checkout", name: "Checkout" },
    status: "triaged",
    severity: "critical",
    issueType: "bug",
    labels: ["regression"],
    currentUrl: "https://app.example.test/checkout/confirm",
    reporterName: "Ada Lovelace",
    reporterEmail: "ada@example.test",
    productContextSummary: null,
    customerImpactSummary: { summary: "Enterprise checkout blocked", affectedUsers: 240, affectedAccounts: 12, revenueAtRisk: "$84k ARR", churnRisk: "critical" },
    duplicateOf: null,
    duplicateCount: 3,
    releaseSignal: null,
    owner: { id: "owner-1", name: "Priya Shah" },
    convertedToBacklog: false,
    attachmentCount: 2,
    createdAt: "2026-07-14T12:00:00.000Z",
    updatedAt: "2026-07-14T14:00:00.000Z",
  },
  {
    id: "expert-issue-2",
    ticketNumber: 782,
    title: "Invoice export times out for large accounts",
    description: "Exports above ten thousand rows time out before download.",
    project: { key: "billing", name: "Billing" },
    status: "new",
    severity: "high",
    issueType: "bug",
    labels: [],
    currentUrl: "https://app.example.test/invoices",
    reporterName: "Grace Hopper",
    reporterEmail: "grace@example.test",
    productContextSummary: null,
    customerImpactSummary: null,
    duplicateOf: null,
    duplicateCount: 0,
    releaseSignal: null,
    owner: null,
    convertedToBacklog: false,
    attachmentCount: 1,
    createdAt: "2026-07-14T13:00:00.000Z",
    updatedAt: "2026-07-14T14:10:00.000Z",
  },
];

Object.assign(api, {
  getProjects: async () => ({ projects: [{ key: "checkout", name: "Checkout" }, { key: "billing", name: "Billing" }] }),
  getSavedIssueViews: async () => ({ views: [] }),
  getFeedbackList: async () => ({
    pagination: { total: issues.length, page: 1, pageSize: 20, pageCount: 1 },
    assignableUsers: [
      { id: "owner-1", name: "Priya Shah", email: "priya@example.test", role: "member" },
      { id: "owner-2", name: "Mateo Ruiz", email: "mateo@example.test", role: "member" },
    ],
    items: issues,
  }),
  bulkUpdateFeedback: async () => ({
    succeeded: [{ feedbackId: "expert-issue-1", updatedAt: "2026-07-14T14:20:00.000Z", before: { status: "triaged", ownerId: "owner-1", labels: ["regression"] } }],
    failed: [{ feedbackId: "expert-issue-2", code: "feedback.stale_update", message: "This issue changed after it was loaded. Refresh it before retrying." }],
  }),
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
});

function ExpertIssueOperationsBrowserHarness() {
  return (
    <main id="expert-issue-operations-harness" className="min-h-screen bg-surface-muted/25 px-3 py-5 sm:px-5">
      <section id="expert-issue-operations-surface" className="mx-auto w-full max-w-7xl">
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
if (!root) throw new Error("Expert issue operations harness root is missing.");
createRoot(root).render(<ExpertIssueOperationsBrowserHarness />);
