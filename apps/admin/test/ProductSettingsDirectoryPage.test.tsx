import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectInstallDiagnosticsResponse, ProjectSummary } from "@tracegenie/shared";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ProductSettingsDirectoryPage } from "../src/features/projects/ProductSettingsDirectoryPage";
import { api } from "../src/lib/api";
import { copy } from "../src/lib/copy";
import { isAdminFeatureDiscoverable } from "../src/lib/featureExposure";

vi.mock("../src/lib/featureExposure", () => ({
  isAdminFeatureDiscoverable: vi.fn(() => true),
}));

const queryClients: QueryClient[] = [];

const project: ProjectSummary = {
  id: "project-1",
  key: "checkout",
  name: "Checkout",
  description: "Checkout feedback",
  defaultEnvironment: "production",
  allowedOrigins: ["https://app.example.test", "https://admin.example.test"],
  notificationEmails: ["product@example.test"],
  requesterEmailProductName: "Checkout",
  widgetConfig: {},
  isActive: true,
  createdAt: "2026-07-16T12:00:00.000Z",
  updatedAt: "2026-07-16T12:00:00.000Z",
};

function diagnostics(report: "missing" | "verified" = "missing"): ProjectInstallDiagnosticsResponse {
  return {
    projectKey: "checkout",
    projectName: "Checkout",
    status: report === "verified" ? "ready" : "action_required",
    checkedAt: "2026-07-16T12:00:00.000Z",
    testOrigin: "https://app.example.test",
    testedOrigin: "https://app.example.test",
    lastWidgetLoadedAt: "2026-07-16T11:58:00.000Z",
    lastWidgetSessionIssuedAt: "2026-07-16T11:58:00.000Z",
    firstReportReceivedAt: report === "verified" ? "2026-07-16T12:00:00.000Z" : null,
    firstReportId: report === "verified" ? "feedback-104" : null,
    firstReportTicketNumber: report === "verified" ? 104 : null,
    screenshotProofReceivedAt: null,
    notificationProofRecordedAt: null,
    privacyReadiness: {
      status: "ready",
      enforced: false,
      owner: null,
      policyUrl: null,
      issueRetentionDays: 365,
      attachmentRetentionDays: 30,
      collectorRedactionReady: true,
      selectedTextSuppressed: true,
      mcpEvidencePolicy: "metadata_only",
      blockers: [],
    },
    proofs: [
      { id: "origin", label: "Allowed origin", status: "verified", detail: "Origin evidence", evidenceAt: "2026-07-16T11:50:00.000Z", scheduledDeletionAt: null, action: null },
      { id: "session", label: "Token and session", status: "verified", detail: "Session evidence", evidenceAt: "2026-07-16T11:58:00.000Z", scheduledDeletionAt: null, action: null },
      { id: "first_report", label: "First report", status: report, detail: "Report evidence", evidenceAt: report === "verified" ? "2026-07-16T12:00:00.000Z" : null, scheduledDeletionAt: null, action: report === "verified" ? null : { label: "Send test report", href: "/projects/checkout" } },
      { id: "attachment", label: "Attachment path", status: "manual", detail: "Optional", evidenceAt: null, scheduledDeletionAt: null, action: null },
      { id: "notification", label: "Notification event", status: "missing", detail: "Optional", evidenceAt: null, scheduledDeletionAt: null, action: null },
      { id: "provider", label: "Provider connection", status: "manual", detail: "Optional", evidenceAt: null, scheduledDeletionAt: null, action: null },
    ],
  };
}

afterEach(() => {
  cleanup();
  queryClients.splice(0).forEach((queryClient) => queryClient.clear());
  vi.restoreAllMocks();
  vi.mocked(isAdminFeatureDiscoverable).mockReset();
  vi.mocked(isAdminFeatureDiscoverable).mockReturnValue(true);
});

function renderPage(projectKey = "checkout") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClients.push(queryClient);

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/projects/${projectKey}/settings`]}>
        <Routes>
          <Route
            path="/projects/:projectKey/settings"
            element={<ProductSettingsDirectoryPage organizationId="organization-1" />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const coreDestinations = [
  ["General", "/projects/checkout/settings/general"],
  ["Installation", "/projects/checkout/settings/installation"],
  ["Widget", "/projects/checkout/settings/widget"],
  ["Evidence", "/projects/checkout/settings/evidence"],
] as const;

const afterCaptureDestinations = [
  ["Surveys", "/projects/checkout/surveys"],
  ["Notifications", "/projects/checkout/settings/notifications"],
  ["Privacy", "/projects/checkout/settings/privacy"],
  ["Engineering", "/projects/checkout/settings/engineering"],
] as const;

test("shows capture settings first and folds the rest until a report arrives", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project] });
  vi.spyOn(api, "getProjectInstallDiagnostics").mockResolvedValue(diagnostics("missing"));
  renderPage();

  expect(screen.getByRole("status", { name: "Loading product settings" })).toBeVisible();
  expect(await screen.findByRole("heading", { name: project.name, level: 1 })).toBeVisible();
  expect(screen.getByRole("link", { name: "Back to products" })).toHaveAttribute("href", "/projects");
  expect(screen.getByText("Active", { exact: true })).toBeVisible();
  expect(screen.getByText("Production environment")).toBeVisible();
  expect(screen.getByText(/2 origins/)).toBeVisible();
  const productNavigation = screen.getByRole("navigation", { name: "Product sections" });
  expect(within(productNavigation).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");

  const directory = document.querySelector("#product-settings-directory-links");
  expect(directory).not.toBeNull();
  expect(within(directory!).getAllByRole("link")).toHaveLength(coreDestinations.length);
  for (const [name, href] of coreDestinations) {
    expect(within(directory!).getByRole("link", { name })).toHaveAttribute("href", href);
  }

  expect(await screen.findByText(copy.projects.settingsAfterCaptureSummary)).toBeVisible();
  expect(screen.queryByRole("link", { name: "Privacy" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Engineering" })).not.toBeInTheDocument();
  await user.click(screen.getByText(copy.projects.settingsAfterCaptureSummary));

  const afterCapture = document.querySelector("#product-settings-after-capture-links");
  expect(afterCapture).not.toBeNull();
  for (const [name, href] of afterCaptureDestinations) {
    expect(within(afterCapture!).getByRole("link", { name })).toHaveAttribute("href", href);
  }
});

test("reveals after-capture settings once capture is verified", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project] });
  vi.spyOn(api, "getProjectInstallDiagnostics").mockResolvedValue(diagnostics("verified"));
  renderPage();

  expect(await screen.findByRole("heading", { name: copy.projects.settingsAfterCaptureTitle, level: 2 })).toBeVisible();
  expect(screen.queryByText(copy.projects.settingsAfterCaptureSummary)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/projects/checkout/settings/privacy");
  expect(screen.getByRole("link", { name: "Engineering" })).toHaveAttribute("href", "/projects/checkout/settings/engineering");
});

test("keeps after-capture settings reachable when diagnostics fail", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project] });
  vi.spyOn(api, "getProjectInstallDiagnostics").mockRejectedValue(new Error("diagnostics unavailable"));
  renderPage();

  expect(await screen.findByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/projects/checkout/settings/privacy");
});

test("hides the Surveys destination when survey management is unavailable", async () => {
  vi.mocked(isAdminFeatureDiscoverable).mockImplementation((featureId) => featureId !== "action.survey.manage");
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project] });
  vi.spyOn(api, "getProjectInstallDiagnostics").mockResolvedValue(diagnostics("verified"));
  renderPage();

  expect(await screen.findByRole("heading", { name: project.name, level: 1 })).toBeVisible();
  expect(await screen.findByRole("link", { name: "Privacy" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "Surveys" })).not.toBeInTheDocument();
});

test("handles project load failure, retry, and project not found", async () => {
  const user = userEvent.setup();
  const getProjects = vi.spyOn(api, "getProjects")
    .mockRejectedValueOnce(new Error("products unavailable"))
    .mockResolvedValueOnce({ projects: [] });
  renderPage("missing");

  expect(await screen.findByRole("heading", { name: "Couldn't load product settings" })).toBeVisible();
  expect(screen.getByRole("navigation", { name: "Product sections" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Retry" }));

  expect(await screen.findByRole("heading", { name: "Product not found" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Back to products" })).toHaveAttribute("href", "/projects");
  await waitFor(() => expect(getProjects).toHaveBeenCalledTimes(2));
});
