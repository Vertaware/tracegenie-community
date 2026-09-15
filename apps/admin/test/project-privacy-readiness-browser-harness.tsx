import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import { ProjectFormPage } from "../src/features/projects/ProjectFormPage";
import "../src/styles/index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

function ProjectPrivacyReadinessBrowserHarness() {
  return (
    <main id="project-privacy-readiness-browser-harness" className="min-h-screen bg-surface-muted/25 px-3 py-5 md:px-6">
      <section id="project-privacy-readiness-proof-surface" className="mx-auto w-full max-w-[1440px]">
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/projects/new"]}>
            <ProjectFormPage organizationId="organization-proof" />
          </MemoryRouter>
        </QueryClientProvider>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Project privacy readiness browser harness root is missing.");
createRoot(root).render(<ProjectPrivacyReadinessBrowserHarness />);
