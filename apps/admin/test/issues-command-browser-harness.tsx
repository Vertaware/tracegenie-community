import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import { IssuesPage } from "../src/features/issues/IssuesPage";
import { api } from "../src/lib/api";
import "../src/styles/index.css";

Object.assign(api, {
  getProjects: async () => ({ projects: [] }),
  getSavedIssueViews: async () => ({ views: [] }),
  getFeedbackList: async () => ({
    pagination: { total: 0, page: 1, pageSize: 20, pageCount: 0 },
    assignableUsers: [],
    items: [],
  }),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
  },
});

function IssuesCommandBrowserHarness() {
  return (
    <main id="issues-command-browser-harness" className="min-h-screen bg-surface-muted/25 px-4 py-6">
      <section id="issues-command-proof-surface" className="mx-auto w-full max-w-7xl">
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/issues?page=4&query=checkout&releaseRegression=true&sortBy=severity&sortDir=asc"]}>
            <IssuesPage organizationId="organization-proof" />
          </MemoryRouter>
        </QueryClientProvider>
      </section>
    </main>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Issues command browser harness root is missing.");
}

createRoot(root).render(<IssuesCommandBrowserHarness />);
