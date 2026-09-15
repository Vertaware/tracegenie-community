import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ProjectEngineeringContextResponse,
  ProjectInstallDiagnosticsResponse,
  ProjectSettingsDestination,
  ProjectSummary,
} from "@tracegenie/shared";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useLocation } from "react-router-dom";

import { AdminFormExitGuardProvider } from "../src/components/guards/AdminFormExitGuard";
import { ProjectFormPage } from "../src/features/projects/ProjectFormPage";
import { getLegacyProductSectionRedirect, type ProjectSectionId } from "../src/features/projects/projectSectionRoutes";
import { api, type AdminUsersResponse } from "../src/lib/api";
import { copy } from "../src/lib/copy";

vi.mock("../src/lib/featureExposure", () => ({
  isAdminFeatureDiscoverable: () => true,
  recordHiddenFeatureExposure: vi.fn(),
}));

const queryClients: QueryClient[] = [];

function diagnostics(overrides: Partial<ProjectInstallDiagnosticsResponse> = {}): ProjectInstallDiagnosticsResponse {
  return {
    projectKey: "checkout",
    projectName: "Checkout",
    status: "verification_needed",
    checkedAt: "2026-07-11T12:00:00.000Z",
    testOrigin: "https://app.example.test",
    testedOrigin: null,
    lastWidgetLoadedAt: null,
    lastWidgetSessionIssuedAt: "2026-07-11T11:00:00.000Z",
    firstReportReceivedAt: "2026-07-11T11:05:00.000Z",
    firstReportId: "feedback-104",
    firstReportTicketNumber: 104,
    screenshotProofReceivedAt: null,
    notificationProofRecordedAt: "2026-07-11T11:06:00.000Z",
    privacyReadiness: {
      status: "ready",
      enforced: true,
      owner: "privacy@example.test",
      policyUrl: "https://example.test/privacy",
      issueRetentionDays: 365,
      attachmentRetentionDays: 30,
      collectorRedactionReady: true,
      selectedTextSuppressed: true,
      mcpEvidencePolicy: "metadata_only",
      blockers: [],
    },
    proofs: [
      { id: "origin", label: "Allowed origin", status: "configured", detail: "One origin is configured; verify the exact install origin.", evidenceAt: null, scheduledDeletionAt: null, action: { label: "Verify origin", href: "/projects/checkout?section=install#project-allowed-origins-section" } },
      { id: "session", label: "Token and session", status: "verified", detail: "A production widget session was issued.", evidenceAt: "2026-07-11T11:00:00.000Z", scheduledDeletionAt: null, action: null },
      { id: "first_report", label: "First report", status: "verified", detail: "A report reached this product.", evidenceAt: "2026-07-11T11:05:00.000Z", scheduledDeletionAt: "2027-07-11T11:05:00.000Z", action: null },
      { id: "attachment", label: "Attachment path", status: "missing", detail: "No screenshot is linked to the first report.", evidenceAt: null, scheduledDeletionAt: null, action: { label: "Send report with screenshot", href: "/projects/checkout?section=install#widget-install-check-controls" } },
      { id: "notification", label: "Notification event", status: "verified", detail: "A notification event was created.", evidenceAt: "2026-07-11T11:06:00.000Z", scheduledDeletionAt: null, action: null },
      { id: "provider", label: "Provider connection", status: "manual", detail: "No active provider connection is scoped to this product.", evidenceAt: null, scheduledDeletionAt: null, action: { label: "Connect provider", href: "/integrations?view=connections" } },
    ],
    ...overrides,
  };
}

function usersResponse({
  collaborator = false,
  canInviteMembers = true,
  collaboratorHasProductAccess = true,
}: {
  collaborator?: boolean;
  canInviteMembers?: boolean;
  collaboratorHasProductAccess?: boolean;
} = {}): AdminUsersResponse {
  const capabilities = {
    canManageProject: true,
    canWriteProject: true,
    canTriageProject: true,
    canViewProject: true,
    canManageOrganization: canInviteMembers,
    canManageTeam: canInviteMembers,
    canInviteMembers,
    canManageOwners: canInviteMembers,
    canManagePlatform: false,
  };
  return {
    actor: {
      id: "actor-1",
      platformRole: "USER",
      isGlobalAdmin: false,
      organizationId: "organization-1",
      organizationRole: canInviteMembers ? "OWNER" : "MEMBER",
      organizationMembershipStatus: "ACTIVE",
      capabilities,
    },
    data: [
      {
        id: "actor-1",
        email: "owner@example.test",
        name: "Owner",
        role: "ADMIN",
        platformRole: "USER",
        isActive: true,
        createdAt: "2026-07-10T10:00:00.000Z",
        organizationRole: canInviteMembers ? "OWNER" : "MEMBER",
        organizationMembershipStatus: "ACTIVE",
        orgMemberships: [],
        projectMemberships: [],
        effectiveAccess: {
          scope: "ALL_PROJECTS",
          allProjects: true,
          assignedProjectCount: 1,
          capabilities,
        },
      },
      ...(collaborator ? [{
        id: "collaborator-1",
        email: "collaborator@example.test",
        name: "Collaborator",
        role: "TRIAGER" as const,
        platformRole: "USER" as const,
        isActive: true,
        createdAt: "2026-07-12T09:30:00.000Z",
        organizationRole: "MEMBER" as const,
        organizationMembershipStatus: "ACTIVE" as const,
        orgMemberships: [],
        projectMemberships: [],
        effectiveAccess: {
          scope: collaboratorHasProductAccess ? "ALL_PROJECTS" as const : "NO_PROJECTS" as const,
          allProjects: collaboratorHasProductAccess,
          assignedProjectCount: collaboratorHasProductAccess ? 1 : 0,
          capabilities: collaboratorHasProductAccess
            ? capabilities
            : {
                ...capabilities,
                canManageProject: false,
                canWriteProject: false,
                canTriageProject: false,
                canViewProject: false,
              },
        },
      }] : []),
    ],
  };
}

beforeEach(() => {
  vi.spyOn(api, "getProjectInstallDiagnostics").mockResolvedValue(diagnostics());
  vi.spyOn(api, "getUsers").mockResolvedValue(usersResponse());
  vi.spyOn(api, "getSelfProfile").mockResolvedValue({ data: usersResponse().data[0] });
});

afterEach(() => {
  cleanup();
  queryClients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

function project(widgetConfig: Record<string, unknown>): ProjectSummary {
  return {
    id: "project-1",
    key: "checkout",
    name: "Checkout",
    defaultEnvironment: "production",
    allowedOrigins: ["https://app.example.test"],
    notificationEmails: ["alerts@example.test"],
    requesterEmailProductName: "Checkout",
    widgetConfig,
    isActive: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    organization: { id: "organization-1", name: "Audit Org" },
  };
}

function engineeringContext(overrides: Partial<ProjectEngineeringContextResponse["engineeringContext"]> = {}): ProjectEngineeringContextResponse {
  return {
    project: { id: "project-1", key: "checkout", name: "Checkout" },
    engineeringContext: {
      repositoryUrl: null,
      defaultBranch: null,
      worktreePath: null,
      installCommand: null,
      testCommand: null,
      buildCommand: null,
      autoFixPolicy: "SUGGEST_ONLY",
      reviewerPolicy: "NONE",
      requesterNotificationPolicy: "EXPLICIT_ONLY",
      notes: null,
      createdAt: null,
      updatedAt: null,
      ...overrides,
    },
  };
}

function renderProjectPage(queryClient: QueryClient, initialEntry = "/projects/checkout") {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/projects/:projectKey" element={<ProjectFormPage organizationId="organization-1" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderGuardedProjectPage(queryClient: QueryClient, initialEntry = "/projects/checkout") {
  const router = createMemoryRouter([
    {
      path: "/projects/:projectKey",
      element: (
        <QueryClientProvider client={queryClient}>
          <AdminFormExitGuardProvider>
            <ProjectFormPage organizationId="organization-1" />
          </AdminFormExitGuardProvider>
        </QueryClientProvider>
      ),
    },
  ], { initialEntries: [initialEntry] });
  render(<RouterProvider router={router} />);
  return router;
}

function canonicalSectionForPath(pathname: string): ProjectSectionId {
  if (pathname.endsWith("/settings/installation")) return "install";
  if (pathname.endsWith("/settings/widget") || pathname.endsWith("/settings/evidence")) return "capture";
  if (pathname.endsWith("/surveys")) return "surveys";
  if (pathname.endsWith("/settings/engineering")) return "engineering";
  if (pathname.endsWith("/settings/notifications")) return "notifications";
  if (pathname.endsWith("/settings/privacy")) return "privacy";
  return "overview";
}

function CanonicalProjectRoute({ organizationId = "organization-1" }: { organizationId?: string }) {
  const location = useLocation();
  return <ProjectFormPage organizationId={organizationId} canonicalSection={canonicalSectionForPath(location.pathname)} />;
}

function renderCanonicalProjectPage(queryClient: QueryClient, initialEntry: string) {
  const router = createMemoryRouter([
    { path: "/issues", element: <h1>Product issues</h1> },
    {
      path: "/projects/:projectKey/*",
      element: (
        <QueryClientProvider client={queryClient}>
          <AdminFormExitGuardProvider>
            <CanonicalProjectRoute />
          </AdminFormExitGuardProvider>
        </QueryClientProvider>
      ),
    },
  ], { initialEntries: [initialEntry] });
  render(<RouterProvider router={router} />);
  return router;
}

function renderCanonicalSettingsPatchPage(
  queryClient: QueryClient,
  initialEntry: string,
  destination: ProjectSettingsDestination,
) {
  const router = createMemoryRouter([
    {
      path: "/projects/:projectKey/*",
      element: (
        <QueryClientProvider client={queryClient}>
          <AdminFormExitGuardProvider>
            <ProjectFormPage
              organizationId="organization-1"
              canonicalSection={canonicalSectionForPath(initialEntry.split(/[?#]/, 1)[0] ?? initialEntry)}
              settingsDestination={destination}
            />
          </AdminFormExitGuardProvider>
        </QueryClientProvider>
      ),
    },
  ], { initialEntries: [initialEntry] });
  render(<RouterProvider router={router} />);
  return router;
}

function renderNewProjectPage(queryClient: QueryClient, canonicalSection?: ProjectSectionId) {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects/new"]}>
        <Routes>
          <Route path="/projects/new" element={<ProjectFormPage organizationId="organization-1" canonicalSection={canonicalSection} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("new product is one vertical form with only the fields required for a usable product", async () => {
  const user = userEvent.setup();
  const updateProject = vi.spyOn(api, "updateProject").mockResolvedValue({ project: project({}) });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);

  renderNewProjectPage(queryClient);

  expect(await screen.findByRole("heading", { name: "New product", level: 1 })).toBeVisible();
  expect(screen.getAllByText("Step 1 of 3").length).toBeGreaterThan(0);
  expect(screen.getByLabelText("Name")).toBeVisible();
  expect(screen.getByLabelText("Product key")).toBeVisible();
  expect(screen.getByLabelText("Notification emails")).toBeVisible();
  expect(screen.queryByLabelText("Reporter email product name")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Default environment")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Product enabled")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Description")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Privacy controls" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create product" }).closest("form")).toHaveAttribute("id", "project-form-page");

  await user.type(screen.getByLabelText("Name"), "Checkout");
  await user.type(screen.getByLabelText("Product key"), "checkout");
  await user.type(screen.getByLabelText("Notification emails"), "alerts@example.test");
  await user.click(screen.getByRole("button", { name: "Create product" }));

  await waitFor(() => expect(updateProject).toHaveBeenCalledTimes(1));
  expect(updateProject).toHaveBeenCalledWith("checkout", expect.objectContaining({
    isActive: true,
    defaultEnvironment: "development",
    requesterEmailProductName: "Checkout",
    widgetConfig: expect.objectContaining({
      privacy: expect.objectContaining({
        retentionDays: 365,
        attachmentRetentionDays: 30,
        redactionMode: "technical_metadata",
        mcpEvidenceSharing: "metadata_only",
        suppressSelectedText: true,
      }),
    }),
  }));
});

test("retry sends the exact submitted project payload after live widget config changes", async () => {
  const user = userEvent.setup();
  const initialProject = project({ maxConsoleEntries: 41, appearance: { launcherLabel: "Initial label" } });
  const liveProject = project({ maxConsoleEntries: 99, appearance: { launcherLabel: "Live label" } });
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [initialProject] });
  const updateProject = vi.spyOn(api, "updateProject")
    .mockRejectedValueOnce(new Error("project service unavailable"))
    .mockResolvedValueOnce({ project: initialProject });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout/settings/widget");

  await screen.findAllByText("Checkout");
  await user.click(screen.getByRole("button", { name: "Edit widget and evidence" }));
  await user.clear(screen.getByLabelText("Launcher label"));
  await user.type(screen.getByLabelText("Launcher label"), "Submitted label");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save Checkout.");
  expect(updateProject).toHaveBeenCalledTimes(1);

  act(() => {
    queryClient.setQueryData(["project-detail", "organization-1", "checkout"], liveProject);
  });
  await waitFor(() => expect(screen.getByLabelText("Launcher label")).toHaveValue("Live label"));

  await user.click(screen.getByRole("button", { name: "Retry saving product" }));

  await waitFor(() => expect(updateProject).toHaveBeenCalledTimes(2));
  expect(updateProject.mock.calls[1]).toEqual(updateProject.mock.calls[0]);
  expect(updateProject.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
    widgetConfig: expect.objectContaining({
      maxConsoleEntries: 41,
      appearance: expect.objectContaining({ launcherLabel: "Submitted label" }),
    }),
  }));
});

test("project edits use the shared commit bar and discard restores the saved form", async () => {
  const user = userEvent.setup();
  const initialProject = project({ appearance: { launcherLabel: "Initial label" } });
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [initialProject] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout/settings/widget");

  await screen.findAllByText("Checkout");
  await user.click(screen.getByRole("button", { name: "Edit widget and evidence" }));
  await user.clear(screen.getByLabelText("Launcher label"));
  await user.type(screen.getByLabelText("Launcher label"), "Changed label");

  expect(screen.getByRole("complementary", { name: "Unsaved changes" })).toHaveAttribute("id", "project-form-commit-bar");
  await user.click(screen.getByRole("button", { name: "Discard" }));

  expect(screen.getByRole("button", { name: "Edit widget and evidence" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Edit widget and evidence" }));
  expect(screen.getByLabelText("Launcher label")).toHaveValue("Initial label");
});

test("configured secret rotation requires confirmation and keeps the new secret until acknowledgement", async () => {
  const user = userEvent.setup();
  const configuredProject = { ...project({}), clientSecretConfigured: true };
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [configuredProject] });
  const rotateProjectWidgetSecret = vi.spyOn(api, "rotateProjectWidgetSecret").mockResolvedValue({
    project: { key: "checkout", name: "Checkout", widgetSecretRotatedAt: "2026-07-11T01:00:00.000Z" },
    widgetClientSecret: "rotated-secret",
  });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout/settings/installation");

  await screen.findAllByText("Checkout");
  const rotateButton = screen.getByRole("button", { name: "Rotate secret" });
  await user.click(rotateButton);

  const dialog = await screen.findByRole("dialog", { name: "Rotate widget secret for Checkout?" });
  expect(dialog).toHaveTextContent("Audit Org / Checkout");
  expect(dialog).toHaveTextContent("The old secret stops working immediately.");
  expect(rotateProjectWidgetSecret).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(rotateProjectWidgetSecret).not.toHaveBeenCalled();
  expect(rotateButton).toHaveFocus();

  await user.click(rotateButton);
  const confirmDialog = await screen.findByRole("dialog", { name: "Rotate widget secret for Checkout?" });
  const confirmButton = within(confirmDialog).getByRole("button", { name: "Rotate secret" });
  fireEvent.click(confirmButton);
  fireEvent.click(confirmButton);

  await waitFor(() => expect(rotateProjectWidgetSecret).toHaveBeenCalledTimes(1));
  expect(await screen.findByDisplayValue("rotated-secret")).toBeInTheDocument();
  await waitFor(() => expect(document.getElementById("project-widget-secret-handoff")).toHaveFocus());

  const handoff = document.getElementById("project-widget-secret-handoff");
  expect(handoff).not.toBeNull();
  await user.click(within(handoff as HTMLElement).getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("rotated-secret");
  await user.click(screen.getByRole("button", { name: "I've stored this secret" }));

  await waitFor(() => expect(screen.getByRole("button", { name: "Rotate secret" })).toHaveFocus());
  expect(screen.queryByDisplayValue("rotated-secret")).not.toBeInTheDocument();
});

test("unconfigured secret generation remains direct without a confirmation dialog", async () => {
  const user = userEvent.setup();
  const unconfiguredProject = project({});
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [unconfiguredProject] });
  const rotateProjectWidgetSecret = vi.spyOn(api, "rotateProjectWidgetSecret").mockResolvedValue({
    project: { key: "checkout", name: "Checkout", widgetSecretRotatedAt: "2026-07-11T01:00:00.000Z" },
    widgetClientSecret: "generated-secret",
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout/settings/installation");

  await screen.findAllByText("Checkout");
  await user.click(screen.getByRole("button", { name: "Generate secret" }));

  await waitFor(() => expect(rotateProjectWidgetSecret).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(await screen.findByDisplayValue("generated-secret")).toBeInTheDocument();
});

test("product sections are stable deep links with one visible settings surface", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout/settings/notifications");

  await screen.findAllByText("Checkout");
  expect(screen.getByRole("link", { name: "All product settings" })).toHaveAttribute("href", "/projects/checkout/settings");
  const productNavigation = screen.getByRole("navigation", { name: "Product sections" });
  expect(within(productNavigation).getByRole("link", { name: "Issues" })).toHaveAttribute("href", "/issues?projectKey=checkout");
  expect(within(productNavigation).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  expect(within(productNavigation).getByRole("link", { name: "Integrations" })).toHaveAttribute("href", "/projects/checkout/integrations");
  expect(screen.getByRole("heading", { name: "Alert recipients" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Branding" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Identity" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Privacy controls" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit notifications" })).toBeVisible();
});

test("Surveys keeps the product navigation without exposing the generic settings editor", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  vi.spyOn(api, "getProductSurveys").mockResolvedValue({ campaigns: [] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout/surveys");

  expect(await screen.findByText("Start from a template")).toBeVisible();
  const productNavigation = screen.getByRole("navigation", { name: "Product sections" });
  expect(within(productNavigation).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("button", { name: "Edit surveys" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Cancel edit" })).not.toBeInTheDocument();
});

test("canonical product section prop wins over legacy query state", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(
    queryClient,
    "/projects/checkout/settings/notifications?section=privacy&source=shared-link#branding",
  );

  await screen.findAllByText("Checkout");
  expect(screen.getByRole("heading", { name: "Alert recipients" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Privacy controls" })).not.toBeInTheDocument();
});

test("existing product key stays visibly read-only on canonical routes", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout/settings/general");

  await screen.findAllByText("Checkout");
  await user.click(screen.getByRole("button", { name: "Edit general" }));
  expect(screen.getByText("checkout")).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "Product key" })).not.toBeInTheDocument();
});

test("general settings PATCH sends only general-owned fields with the saved version", async () => {
  const user = userEvent.setup();
  const existingProject = project({
    appearance: { launcherLabel: "Report issue" },
    surveyPrompt: { enabled: true, type: "csat", question: "How was checkout?" },
  });
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [existingProject] });
  const patchProjectSettings = vi.spyOn(api, "patchProjectSettings").mockResolvedValue({
    project: { ...existingProject, name: "Checkout Prime" },
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);

  renderCanonicalSettingsPatchPage(queryClient, "/projects/checkout/settings/general", "general");

  await screen.findAllByText("Checkout");
  await user.click(screen.getByRole("button", { name: "Edit general" }));
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Checkout Prime");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(patchProjectSettings).toHaveBeenCalledTimes(1));
  expect(patchProjectSettings).toHaveBeenCalledWith(
    "checkout",
    "general",
    {
      expectedUpdatedAt: "2026-07-11T00:00:00.000Z",
      name: "Checkout Prime",
      description: null,
      defaultEnvironment: "production",
      isActive: true,
    },
    "organization-1",
  );
  const payload = patchProjectSettings.mock.calls[0]?.[2];
  expect(payload).not.toHaveProperty("widgetConfig");
  expect(payload).not.toHaveProperty("notificationEmails");
  expect(payload).not.toHaveProperty("notificationBranding");
});

test("general settings save ignores invalid fields owned by another settings page", async () => {
  const user = userEvent.setup();
  const existingProject = { ...project({}), notificationEmails: [] };
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [existingProject] });
  const patchProjectSettings = vi.spyOn(api, "patchProjectSettings").mockResolvedValue({
    project: { ...existingProject, name: "Checkout Core" },
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);

  renderCanonicalSettingsPatchPage(queryClient, "/projects/checkout/settings/general", "general");

  await screen.findAllByText("Checkout");
  await user.click(screen.getByRole("button", { name: "Edit general" }));
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Checkout Core");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(patchProjectSettings).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).not.toBeInTheDocument();
});

test("product status pauses reports without routing through the edit form", async () => {
  const user = userEvent.setup();
  const existingProject = { ...project({}), notificationEmails: [] };
  const pausedProject = { ...existingProject, isActive: false, updatedAt: "2026-07-11T00:05:00.000Z" };
  vi.spyOn(api, "getProjects")
    .mockResolvedValueOnce({ projects: [existingProject] })
    .mockResolvedValue({ projects: [pausedProject] });
  const patchProjectSettings = vi.spyOn(api, "patchProjectSettings").mockResolvedValue({ project: pausedProject });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);

  renderCanonicalSettingsPatchPage(queryClient, "/projects/checkout/settings/general", "general");

  await user.click(await screen.findByRole("button", { name: "Pause new reports" }));
  const dialog = await screen.findByRole("dialog", { name: "Pause reports for Checkout?" });
  expect(dialog).toHaveTextContent("Existing reports, settings, and integrations stay intact.");
  await user.click(within(dialog).getByRole("button", { name: "Pause reports" }));

  await waitFor(() => expect(patchProjectSettings).toHaveBeenCalledWith(
    "checkout",
    "general",
    {
      expectedUpdatedAt: "2026-07-11T00:00:00.000Z",
      isActive: false,
    },
    "organization-1",
  ));
  expect(await screen.findByText("Reports paused")).toBeVisible();
  expect(screen.getByRole("button", { name: "Resume reports" })).toBeEnabled();
});

test("an inactive unused product exposes a guarded delete action", async () => {
  const user = userEvent.setup();
  const existingProject = { ...project({}), isActive: false };
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [existingProject] });
  vi.spyOn(api, "getAnalytics").mockResolvedValue({ byProject: [] } as never);
  const deleteProject = vi.spyOn(api, "deleteProject").mockResolvedValue({
    deleted: { key: "checkout", name: "Checkout" },
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);

  renderCanonicalSettingsPatchPage(queryClient, "/projects/checkout/settings/general", "general");

  await user.click(await screen.findByRole("button", { name: "Delete product" }));
  const dialog = await screen.findByRole("dialog", { name: "Delete Checkout?" });
  expect(dialog).toHaveTextContent("cannot be undone");
  await user.click(within(dialog).getByRole("button", { name: "Delete product" }));

  await waitFor(() => expect(deleteProject).toHaveBeenCalledWith("checkout", "organization-1"));
});

test("returning to all product settings protects an unsaved settings draft", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClients.push(queryClient);
  const router = renderCanonicalSettingsPatchPage(queryClient, "/projects/checkout/settings/widget", "widget");
  await user.click(await screen.findByRole("button", { name: "Edit widget" }));
  await user.clear(screen.getByLabelText("Launcher label"));
  await user.type(screen.getByLabelText("Launcher label"), "Unsaved label");
  await user.click(screen.getByRole("link", { name: "All product settings" }));
  const dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
  expect(router.state.location.pathname).toBe("/projects/checkout/settings/widget");
  expect(screen.getByLabelText("Launcher label")).toHaveValue("Unsaved label");
  await user.click(within(dialog).getByRole("button", { name: "Discard" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/projects/checkout/settings"));
});

test("widget settings PATCH sends appearance and colors without evidence or email-only fields", async () => {
  const user = userEvent.setup();
  const existingProject = project({
    allowScreenshot: true,
    appearance: { launcherLabel: "Report issue" },
    surveyPrompt: { enabled: true, type: "csat", question: "How was checkout?" },
  });
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [existingProject] });
  const patchProjectSettings = vi.spyOn(api, "patchProjectSettings").mockResolvedValue({
    project: existingProject,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);

  renderCanonicalSettingsPatchPage(queryClient, "/projects/checkout/settings/widget", "widget");

  await screen.findAllByText("Checkout");
  await user.click(screen.getByRole("button", { name: "Edit widget" }));
  await user.clear(screen.getByLabelText("Launcher label"));
  await user.type(screen.getByLabelText("Launcher label"), "Send feedback");
  await user.clear(screen.getByLabelText("Primary color"));
  await user.type(screen.getByLabelText("Primary color"), "#6754d7");
  await user.clear(screen.getByLabelText("Accent color"));
  await user.type(screen.getByLabelText("Accent color"), "#127a64");
  expect(screen.getByRole("complementary", { name: "Widget color preview" })).toHaveStyle({ "--brand-primary": "#6754d7", "--brand-accent": "#127a64" });
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(patchProjectSettings).toHaveBeenCalledTimes(1));
  expect(patchProjectSettings).toHaveBeenCalledWith(
    "checkout",
    "widget",
    expect.objectContaining({
      expectedUpdatedAt: "2026-07-11T00:00:00.000Z",
      appearance: expect.objectContaining({ launcherLabel: "Send feedback" }),
      notificationBranding: { primaryColor: "#6754d7", accentColor: "#127a64" },
    }),
    "organization-1",
  );
  const payload = patchProjectSettings.mock.calls[0]?.[2];
  expect(payload).not.toHaveProperty("allowScreenshot");
  expect(payload).not.toHaveProperty("allowPointSelection");
  expect(payload).not.toHaveProperty("allowConsoleCapture");
  expect(payload).not.toHaveProperty("allowClientErrorContext");
  expect(payload).not.toHaveProperty("allowNetworkSummary");
  expect(payload).not.toHaveProperty("surveyPrompt");
  expect(payload).not.toHaveProperty("fields");
  expect(payload).not.toHaveProperty("notificationEmails");
  expect(payload).not.toHaveProperty("notificationBranding.brandName");
  expect(payload).not.toHaveProperty("notificationBranding.logoUrl");
  expect(payload).not.toHaveProperty("notificationBranding.emailFooterText");
});

test("widget rejects invalid colors, focuses the field and discards color drafts", async () => {
  const user = userEvent.setup();
  const existingProject = project({ notificationBranding: { primaryColor: "#ffffff", accentColor: "#127a64" } });
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [existingProject] });
  const patch = vi.spyOn(api, "patchProjectSettings");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClients.push(queryClient);
  renderCanonicalSettingsPatchPage(queryClient, "/projects/checkout/settings/widget", "widget");

  await user.click(await screen.findByRole("button", { name: "Edit widget" }));
  expect(screen.getByRole("complementary", { name: "Widget color preview" })).toHaveStyle({ "--brand-primary": "#ffffff", "--brand-foreground": "#000000" });
  await user.clear(screen.getByLabelText("Primary color"));
  await user.type(screen.getByLabelText("Primary color"), "#123");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("Use a 6-digit hex color.")).toBeVisible();
  expect(screen.getByLabelText("Primary color")).toHaveFocus();
  expect(screen.getByLabelText("Primary color")).toHaveAttribute("aria-invalid", "true");
  expect(patch).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Cancel edit" }));
  await user.click(within(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).getByRole("button", { name: "Discard" }));
  expect(await screen.findByText("#ffffff")).toBeVisible();
  expect(screen.getByRole("complementary", { name: "Widget color preview" })).toHaveStyle({ "--brand-primary": "#ffffff" });
  expect(screen.queryByLabelText("Primary color")).not.toBeInTheDocument();
});

test("evidence settings PATCH sends evidence fields only and excludes widget appearance and status", async () => {
  const user = userEvent.setup();
  const existingProject = project({
    allowScreenshot: true,
    appearance: { launcherLabel: "Report issue" },
    surveyPrompt: { enabled: true, type: "csat", question: "How was checkout?" },
  });
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [existingProject] });
  const patchProjectSettings = vi.spyOn(api, "patchProjectSettings").mockResolvedValue({
    project: existingProject,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);

  renderCanonicalSettingsPatchPage(queryClient, "/projects/checkout/settings/evidence", "evidence");

  await screen.findAllByText("Checkout");
  await user.click(screen.getByRole("button", { name: "Edit evidence" }));
  await user.click(screen.getByLabelText(/Automatically capture a screenshot/));
  await user.click(screen.getByLabelText(/Allow multiple file attachments/));
  await user.clear(screen.getByLabelText("Question"));
  await user.type(screen.getByLabelText("Question"), "What prevented checkout?");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(patchProjectSettings).toHaveBeenCalledTimes(1));
  expect(patchProjectSettings).toHaveBeenCalledWith(
    "checkout",
    "evidence",
    expect.objectContaining({
      expectedUpdatedAt: "2026-07-11T00:00:00.000Z",
      allowScreenshot: true,
      autoCaptureScreenshot: false,
      allowFileAttachments: false,
      surveyPrompt: {
        enabled: true,
        type: "csat",
        question: "What prevented checkout?",
      },
      fields: expect.any(Object),
    }),
    "organization-1",
  );
  const payload = patchProjectSettings.mock.calls[0]?.[2];
  expect(payload).not.toHaveProperty("appearance");
  expect(payload).not.toHaveProperty("isActive");
  expect(payload).not.toHaveProperty("widgetConfig");
});

test("canonical section changes preserve unrelated query params and hashes through dirty guards", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);
  const router = renderCanonicalProjectPage(
    queryClient,
    "/projects/checkout/settings/notifications?source=shared-link#branding",
  );

  await screen.findByRole("heading", { name: "Alert recipients" });
  await user.click(screen.getByRole("button", { name: "Edit notifications" }));
  await user.clear(screen.getByLabelText("Notification emails"));
  await user.type(screen.getByLabelText("Notification emails"), "draft@example.test");
  void router.navigate("/projects/checkout/settings/privacy?source=shared-link#branding");
  await user.click(within(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).getByRole("button", { name: "Discard" }));

  expect(await screen.findByRole("heading", { name: "Privacy controls" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/projects/checkout/settings/privacy");
  expect(router.state.location.search).toBe("?source=shared-link");
  expect(router.state.location.hash).toBe("#branding");
});

test.each([
  ["?section=overview&source=shared-link", "", "/projects/checkout?source=shared-link"],
  ["?section=overview&source=shared-link", "#project-identity-section", "/projects/checkout/settings/general?source=shared-link#project-identity-section"],
  ["?section=install&source=shared-link", "#install-proof", "/projects/checkout/settings/installation?source=shared-link#install-proof"],
  ["?section=capture&source=shared-link", "#project-widget-appearance-section", "/projects/checkout/settings/widget?source=shared-link#project-widget-appearance-section"],
  ["?section=capture&source=shared-link", "#capture-fields", "/projects/checkout/settings/evidence?source=shared-link#capture-fields"],
  ["?section=surveys&source=shared-link", "", "/projects/checkout/surveys?source=shared-link"],
  ["?section=engineering&source=shared-link", "", "/projects/checkout/settings/engineering?source=shared-link"],
  ["?section=notifications&source=shared-link", "", "/projects/checkout/settings/notifications?source=shared-link"],
  ["?section=privacy&source=shared-link", "#readiness", "/projects/checkout/settings/privacy?source=shared-link#readiness"],
  ["?section=unknown&source=shared-link", "#unknown-anchor", "/projects/checkout?source=shared-link#unknown-anchor"],
])("legacy product section redirect maps %s and preserves non-routing location state", (search, hash, expected) => {
  expect(getLegacyProductSectionRedirect("checkout", { search, hash })).toBe(expected);
});

test("overview presents one five-step runway with one blocking action and the next two steps", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  vi.mocked(api.getProjectInstallDiagnostics).mockResolvedValue(diagnostics({
    firstReportReceivedAt: null,
    proofs: diagnostics().proofs.map((proof) => {
      if (proof.id === "origin") {
        return {
          ...proof,
          status: "missing",
          detail: "No browser origin is configured for this product.",
          action: { label: "Add origin", href: "/projects/checkout?section=install#project-allowed-origins-section" },
        };
      }
      if (proof.id === "first_report") {
        return {
          ...proof,
          status: "missing",
          detail: "No report has been received for this product.",
          evidenceAt: null,
          action: { label: "Send test report", href: "/projects/checkout?section=install#widget-install-check-controls" },
        };
      }
      return proof;
    }),
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout");

  expect(await screen.findByRole("heading", { name: "Complete installation" })).toBeVisible();
  const setupNavigation = within(screen.getByRole("navigation", { name: "Product sections" }));
  expect(setupNavigation.getByRole("link", { name: "Setup" })).toHaveAttribute("aria-current", "page");
  expect(setupNavigation.getByRole("link", { name: "Issues" })).toHaveAttribute("href", "/issues?projectKey=checkout");
  const runway = document.getElementById("product-activation-runway");
  expect(runway).not.toBeNull();
  expect(within(runway as HTMLElement).getAllByTestId("activation-runway-step")).toHaveLength(3);
  expect(within(runway as HTMLElement).getByText("Step 2 of 3")).toBeVisible();
  expect(within(document.getElementById("product-activation-current-install") as HTMLElement).getByText(
    "No browser origin is configured for this product.",
  )).toBeVisible();
  expect(within(runway as HTMLElement).getByRole("link", { name: "Add origin" })).toHaveAttribute(
    "href",
    "/projects/checkout?section=install#project-allowed-origins-section",
  );
  expect(within(runway as HTMLElement).getAllByRole("link")).toHaveLength(1);
  expect(within(runway as HTMLElement).getAllByText("Verify capture").length).toBeGreaterThan(0);
  expect(document.getElementById("first-run-setup-guide")).not.toBeInTheDocument();
  expect(document.getElementById("project-activation-checklist")).not.toBeInTheDocument();
  expect(document.getElementById("project-overview-primary-action")).not.toBeInTheDocument();
});

test("configured install state advances to capture verification without inventing an install timestamp", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  vi.mocked(api.getProjectInstallDiagnostics).mockResolvedValue(diagnostics({
    firstReportReceivedAt: null,
    proofs: diagnostics().proofs.map((proof) => {
      if (proof.id === "origin" || proof.id === "session") {
        return { ...proof, status: "configured", evidenceAt: null, action: null };
      }
      if (proof.id === "first_report") {
        return {
          ...proof,
          status: "missing",
          detail: "No report has been received for this product.",
          evidenceAt: null,
          action: { label: "Send test report", href: "/projects/checkout?section=install#widget-install-check-controls" },
        };
      }
      return proof;
    }),
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout");

  expect(await screen.findByRole("heading", { name: "Verify capture" })).toBeVisible();
  expect(screen.getByText("Step 3 of 3")).toBeVisible();
  expect(screen.getByRole("link", { name: "Send test report" })).toHaveAttribute(
    "href",
    "/projects/checkout?section=install#widget-install-check-controls",
  );
  const completedProof = document.getElementById("product-activation-completed-proof");
  expect(completedProof).not.toBeNull();
  expect(within(completedProof as HTMLElement).getByText("Install")).toBeVisible();
  expect(within(completedProof as HTMLElement).getByText("Install").parentElement).toHaveTextContent(/^Install$/);
});

test("completed setup replaces an overview bookmark with the product issues and preserves filters", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  vi.mocked(api.getProjectInstallDiagnostics).mockResolvedValue(diagnostics({
    status: "ready",
    proofs: diagnostics().proofs.map((proof) => ({ ...proof, status: "verified", action: null })),
  }));
  vi.mocked(api.getUsers).mockResolvedValue(usersResponse({ collaborator: true }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);

  const router = renderCanonicalProjectPage(queryClient, "/projects/checkout?status=new&page=2&projectKey=wrong-product");

  expect(await screen.findByRole("heading", { name: "Product issues" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/issues");
  expect(router.state.historyAction).toBe("REPLACE");
  expect(new URLSearchParams(router.state.location.search).get("projectKey")).toBe("checkout");
  expect(new URLSearchParams(router.state.location.search).get("status")).toBe("new");
  expect(new URLSearchParams(router.state.location.search).get("page")).toBe("2");
  expect(document.getElementById("product-activation-status-strip")).not.toBeInTheDocument();
  expect(document.getElementById("product-activation-runway")).not.toBeInTheDocument();
});

test("optional collaborator setup does not keep a verified product on the setup screen", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  vi.mocked(api.getProjectInstallDiagnostics).mockResolvedValue(diagnostics({
    status: "ready",
    proofs: diagnostics().proofs.map((proof) => ({ ...proof, status: "verified", action: null })),
  }));
  vi.mocked(api.getUsers).mockResolvedValue(usersResponse({
    collaborator: true,
    collaboratorHasProductAccess: false,
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout");

  expect(await screen.findByRole("heading", { name: "Product issues" })).toBeVisible();
  expect(document.getElementById("product-activation-optional")).not.toBeInTheDocument();
});

test("cached complete evidence becomes a stale status when refresh fails", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  vi.mocked(api.getProjectInstallDiagnostics).mockRejectedValue(new Error("refresh unavailable"));
  const completeDiagnostics = diagnostics({
    status: "ready",
    proofs: diagnostics().proofs.map((proof) => ({ ...proof, status: "verified", action: null })),
  });
  const completeTeam = usersResponse({ collaborator: true });
  vi.mocked(api.getUsers).mockResolvedValue(completeTeam);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["project-activation-proof", "organization-1", "checkout"], completeDiagnostics);
  queryClient.setQueryData(["organization-members", "product-activation", "organization-1"], completeTeam);
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout");

  expect(await screen.findByText("Saved activation complete")).toBeVisible();
  expect(screen.getByText("Last saved evidence completes capture, but current status could not be refreshed.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry activation status" })).toBeEnabled();
  expect(screen.queryByRole("link", { name: "Open issues" })).not.toBeInTheDocument();
});

test("optional privacy configuration does not block access to existing product issues", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({
    projects: [project({
      privacy: {
        privacyOwnerEmail: "",
        privacyUrl: "",
        retentionDays: null,
        attachmentRetentionDays: null,
        redactionMode: "standard",
        mcpEvidenceSharing: "raw_allowed",
        suppressSelectedText: false,
        customRedactionTerms: ["private-customer-marker"],
      },
    })],
  });
  vi.mocked(api.getProjectInstallDiagnostics).mockResolvedValue(diagnostics({
    status: "action_required",
    proofs: diagnostics().proofs.map((proof) => {
      if (proof.id === "origin" || proof.id === "session" || proof.id === "first_report" || proof.id === "attachment") {
        return { ...proof, status: "verified", evidenceAt: "2026-07-11T11:05:00.000Z", action: null };
      }
      return proof;
    }),
    privacyReadiness: {
      status: "action_required",
      enforced: true,
      owner: null,
      policyUrl: null,
      issueRetentionDays: null,
      attachmentRetentionDays: null,
      collectorRedactionReady: false,
      selectedTextSuppressed: false,
      mcpEvidencePolicy: "raw_allowed",
      blockers: [
        { id: "privacy_owner", label: "Privacy owner", detail: "Assign the email address responsible for this product's evidence policy." },
        { id: "privacy_url", label: "Privacy link", detail: "Add the public privacy policy reporters see before sending." },
        { id: "issue_retention", label: "Issue retention", detail: "Set an automatic issue-retention period." },
        { id: "attachment_retention", label: "Attachment retention", detail: "Set an automatic expiry for captured screenshots." },
        { id: "mcp_evidence", label: "MCP evidence", detail: "Default AI and MCP access to metadata only for captured evidence." },
      ],
    },
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout");

  expect(await screen.findByRole("heading", { name: "Product issues" })).toBeVisible();
  expect(document.body).not.toHaveTextContent("private-customer-marker");
});

test("a verified product opens issues when the operator cannot invite collaborators", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  vi.mocked(api.getProjectInstallDiagnostics).mockResolvedValue(diagnostics({
    proofs: diagnostics().proofs.map((proof) => (
      ["origin", "session", "first_report", "attachment"].includes(proof.id)
        ? { ...proof, status: "verified", evidenceAt: "2026-07-11T11:05:00.000Z", action: null }
        : proof
    )),
  }));
  vi.mocked(api.getUsers).mockResolvedValue(usersResponse({ canInviteMembers: false }));
  vi.mocked(api.getSelfProfile).mockResolvedValue({ data: usersResponse({ canInviteMembers: false }).data[0] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout");

  expect(await screen.findByRole("heading", { name: "Product issues" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "Invite collaborator" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Next" })).not.toBeInTheDocument();
  expect(document.getElementById("product-activation-upcoming")).toBeNull();
  expect(api.getUsers).not.toHaveBeenCalled();
});

test("failed installation stays on the blocking proof with one repair action", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  vi.mocked(api.getProjectInstallDiagnostics).mockResolvedValue(diagnostics({
    status: "action_required",
    proofs: diagnostics().proofs.map((proof) => proof.id === "origin"
      ? {
          ...proof,
          status: "failed",
          detail: "https://old.example.test was observed but is no longer allowed.",
          action: { label: "Repair origin", href: "/projects/checkout/settings/installation#project-allowed-origins-section" },
        }
      : proof),
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout");

  expect(await screen.findByRole("heading", { name: "Repair installation" })).toBeVisible();
  expect(screen.getAllByText("https://old.example.test was observed but is no longer allowed.").length).toBeGreaterThan(0);
  const runway = document.getElementById("product-activation-runway");
  expect(within(runway as HTMLElement).getByRole("link", { name: "Repair origin" })).toHaveAttribute(
    "href",
    "/projects/checkout/settings/installation#project-allowed-origins-section",
  );
  expect(within(runway as HTMLElement).getAllByRole("link")).toHaveLength(1);
});

test("installation blocker copy and action come from the same failed proof", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  vi.mocked(api.getProjectInstallDiagnostics).mockResolvedValue(diagnostics({
    proofs: diagnostics().proofs.map((proof) => {
      if (proof.id === "origin") {
        return { ...proof, status: "configured", action: { label: "Send test report", href: "/projects/checkout/settings/installation#widget-install-check-controls" } };
      }
      if (proof.id === "session") {
        return {
          ...proof,
          status: "failed",
          detail: "No backend-only widget secret is configured.",
          evidenceAt: null,
          action: { label: "Generate secret", href: "/projects/checkout/settings/installation#widget-snippet-details" },
        };
      }
      return proof;
    }),
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout");

  expect(await screen.findByRole("heading", { name: "Repair installation" })).toBeVisible();
  const current = document.getElementById("product-activation-current-install");
  expect(current).not.toBeNull();
  expect(within(current as HTMLElement).getByText("No backend-only widget secret is configured.")).toBeVisible();
  expect(within(current as HTMLElement).getByRole("link", { name: "Generate secret" })).toHaveAttribute(
    "href",
    "/projects/checkout/settings/installation#widget-snippet-details",
  );
  expect(within(current as HTMLElement).queryByRole("link", { name: "Send test report" })).not.toBeInTheDocument();
});

test("activation evidence failure provides a retry while optional collaborator failure does not block issues", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  vi.mocked(api.getProjectInstallDiagnostics).mockRejectedValueOnce(new Error("diagnostics offline"));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);

  renderCanonicalProjectPage(queryClient, "/projects/checkout");

  expect(await screen.findByRole("alert")).toHaveTextContent("Saved activation evidence could not be loaded");
  expect(screen.getByRole("button", { name: "Retry evidence" })).toBeEnabled();

  cleanup();
  vi.mocked(api.getProjectInstallDiagnostics).mockResolvedValue(diagnostics({
    proofs: diagnostics().proofs.map((proof) => (
      ["origin", "session", "first_report", "attachment"].includes(proof.id)
        ? { ...proof, status: "verified", evidenceAt: "2026-07-11T11:05:00.000Z", action: null }
        : proof
    )),
  }));
  vi.mocked(api.getUsers).mockRejectedValue(new Error("team offline"));
  const retryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(retryClient);
  renderCanonicalProjectPage(retryClient, "/projects/checkout");

  expect(await screen.findByRole("heading", { name: "Product issues" })).toBeVisible();
});

test("install section loads the same proof model and verifies the exact submitted origin", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  const getDiagnostics = vi.mocked(api.getProjectInstallDiagnostics);
  getDiagnostics.mockResolvedValue(diagnostics({
    proofs: diagnostics().proofs.map((proof) => proof.id === "provider"
      ? { ...proof, status: "stale", detail: "The last provider operation is older than 30 days.", evidenceAt: "2026-05-01T10:00:00.000Z", action: { label: "Test connection", href: "/integrations?view=connections" } }
      : proof),
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);

  renderProjectPage(queryClient, "/projects/checkout?section=install");

  await user.click(await screen.findByText("Install widget"));
  const addWidgetHeading = screen.getByText("2. Add the frontend widget");
  const secureSessionHeading = screen.getByText("Backend session token, required for production");
  const verifyHeading = screen.getByText("3. Verify installation");
  expect(addWidgetHeading.compareDocumentPosition(secureSessionHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(secureSessionHeading.compareDocumentPosition(verifyHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(addWidgetHeading.compareDocumentPosition(verifyHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.getElementById("widget-snippet-content")).not.toHaveTextContent("\\n+");
  await user.selectOptions(screen.getByLabelText("Install method"), "react");
  expect(screen.getByText("2. Add the React widget")).toBeVisible();
  expect(screen.getByText("Backend session token, required for production")).toBeVisible();
  expect(await screen.findByText("Stale proof")).toBeVisible();
  expect(screen.getByRole("link", { name: "Test connection" })).toHaveAttribute("href", "/integrations?view=connections");
  const origin = screen.getByLabelText("Origin to test");
  await user.clear(origin);
  await user.type(origin, "https://checkout.example.test");
  await user.click(screen.getByRole("button", { name: copy.projects.installCheckRun }));

  await waitFor(() => expect(getDiagnostics).toHaveBeenLastCalledWith("checkout", "https://checkout.example.test", "organization-1"));
  const installProofs = document.getElementById("widget-install-diagnostics-list");
  expect(installProofs).not.toBeNull();
  expect(within(installProofs as HTMLElement).queryByText(/Not tracked/i)).not.toBeInTheDocument();
});

test("install instructions copy the selected agent prompt and recover from clipboard failure", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);
  renderProjectPage(queryClient, "/projects/checkout?section=install");

  await screen.findByText("Install widget");
  expect(screen.getByRole("radio", { name: "Code", exact: true })).toBeChecked();
  await user.selectOptions(screen.getByLabelText("Framework"), "django");
  await user.click(screen.getByRole("radio", { name: "AI agent" }));
  const prompt = screen.getByLabelText("AI agent installation prompt");
  expect(prompt).toHaveTextContent("Script embed / Python / Django");
  expect(prompt).toHaveTextContent("def tracegenie_widget_session");
  expect(prompt).toHaveTextContent("/api/projects/server/checkout/widget-session");
  expect(prompt).toHaveTextContent("Do not claim installation is verified");
  expect(screen.getByText("3. Verify installation")).toBeVisible();

  const clipboard = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("Clipboard denied")).mockResolvedValue();
  await user.click(screen.getByRole("button", { name: "Copy prompt" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Select the prompt above and copy it manually");
  await user.click(screen.getByRole("button", { name: "Copy prompt" }));
  expect(clipboard).toHaveBeenLastCalledWith(prompt.textContent);
  expect(screen.queryByText(/Copying is unavailable/)).not.toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Install method"), "react");
  expect(prompt).toHaveTextContent("React component / React");
  expect(prompt).toHaveTextContent("getWidgetSessionToken");
  expect(prompt).not.toHaveTextContent("def tracegenie_widget_session");
  await user.click(screen.getByRole("button", { name: "Copy prompt" }));
  expect(clipboard).toHaveBeenLastCalledWith(prompt.textContent);
  await user.click(screen.getByRole("radio", { name: "Code", exact: true }));
  expect(screen.getByText("2. Add the React widget")).toBeVisible();
  expect(screen.getByText("Backend session token, required for production")).toBeVisible();
});

test("invalid legacy product sections canonicalize to the overview route", () => {
  expect(getLegacyProductSectionRedirect("checkout", {
    search: "?section=unknown&source=shared-link",
    hash: "#identity",
  })).toBe("/projects/checkout?source=shared-link#identity");
});

test("dirty section changes require an explicit discard", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);
  const router = renderCanonicalProjectPage(
    queryClient,
    "/projects/checkout/settings/notifications?source=shared-link#branding",
  );

  await screen.findByRole("heading", { name: "Alert recipients" });
  await user.click(screen.getByRole("button", { name: "Edit notifications" }));
  await user.clear(screen.getByLabelText("Notification emails"));
  await user.type(screen.getByLabelText("Notification emails"), "new-alerts@example.test");
  void router.navigate("/projects/checkout/settings/privacy?source=shared-link#branding");

  expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Stay" }));
  expect(screen.getByRole("heading", { name: "Alert recipients" })).toBeVisible();

  void router.navigate("/projects/checkout/settings/privacy?source=shared-link#branding");
  const discardDialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
  await user.click(within(discardDialog).getByRole("button", { name: "Discard" }));
  expect(await screen.findByRole("heading", { name: "Privacy controls" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/projects/checkout/settings/privacy");
  expect(router.state.location.search).toBe("?source=shared-link");
  expect(router.state.location.hash).toBe("#branding");
  expect(screen.queryByRole("complementary", { name: "Unsaved changes" })).not.toBeInTheDocument();
});

test("browser back and forward preserve section history and guard dirty drafts", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);
  const router = renderCanonicalProjectPage(queryClient, "/projects/checkout/settings/notifications");

  await screen.findByRole("heading", { name: "Alert recipients" });
  await router.navigate("/projects/checkout/settings/privacy");
  await screen.findByRole("heading", { name: "Privacy controls" });
  await user.click(screen.getByRole("button", { name: "Edit privacy" }));
  await user.clear(screen.getByLabelText("Privacy link"));
  await user.type(screen.getByLabelText("Privacy link"), "https://changed.example.test/privacy");

  await router.navigate(-1);
  expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Stay" }));
  expect(screen.getByRole("heading", { name: "Privacy controls" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/projects/checkout/settings/privacy");

  await router.navigate(-1);
  const discardDialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
  await user.click(within(discardDialog).getByRole("button", { name: "Discard" }));
  expect(await screen.findByRole("heading", { name: "Alert recipients" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/projects/checkout/settings/notifications");

  await router.navigate(1);
  expect(await screen.findByRole("heading", { name: "Privacy controls" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/projects/checkout/settings/privacy");
});

test("tenant switching clears product edit and draft state before showing the next tenant", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getProjects").mockImplementation(async (organizationId) => ({
    projects: [{
      ...project({}),
      id: `project-${organizationId}`,
      name: organizationId === "organization-2" ? "Checkout Europe" : "Checkout",
      organization: {
        id: organizationId ?? "organization-1",
        name: organizationId === "organization-2" ? "Europe Org" : "Audit Org",
      },
    }],
  }));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);
  const renderTree = (organizationId: string) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects/checkout?section=notifications"]}>
        <Routes>
          <Route path="/projects/:projectKey" element={<ProjectFormPage organizationId={organizationId} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(renderTree("organization-1"));

  await screen.findAllByText("Checkout");
  await user.click(screen.getByRole("button", { name: "Edit notifications" }));
  await user.clear(screen.getByLabelText("Notification emails"));
  await user.type(screen.getByLabelText("Notification emails"), "draft@example.test");
  expect(screen.getByRole("complementary", { name: "Unsaved changes" })).toBeVisible();

  view.rerender(renderTree("organization-2"));
  expect(await screen.findByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
  expect(await screen.findByText("Checkout Europe")).toBeVisible();
  expect(screen.getByRole("button", { name: "Edit notifications" })).toBeVisible();
  expect(screen.queryByRole("complementary", { name: "Unsaved changes" })).not.toBeInTheDocument();
  expect(screen.getByText("alerts@example.test")).toBeVisible();
  expect(screen.queryByText("draft@example.test")).not.toBeInTheDocument();
});

test("project detail exposes truthful error retry and missing states", async () => {
  const user = userEvent.setup();
  const getProjects = vi.spyOn(api, "getProjects")
    .mockRejectedValueOnce(new Error("temporary outage"))
    .mockResolvedValueOnce({ projects: [project({})] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);
  renderProjectPage(queryClient);

  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this product");
  expect(screen.getByRole("alert")).toHaveTextContent("saved configuration is still intact");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect((await screen.findAllByText("Checkout")).length).toBeGreaterThan(0);
  expect(getProjects).toHaveBeenCalledTimes(2);

  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [] });
  const missingQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(missingQueryClient);
  renderProjectPage(missingQueryClient);
  expect(await screen.findByRole("heading", { name: "Product not found" })).toBeVisible();
});

test("engineering context reports missing setup and blocks unsafe values with focused errors", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext());
  const updateContext = vi.spyOn(api, "updateProjectEngineeringContext");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClients.push(queryClient);
  renderProjectPage(queryClient, "/projects/checkout?section=engineering");

  expect(await screen.findByRole("alert")).toHaveTextContent("Missing: Repository URL, Default branch, Worktree path, Test command, Build command, CODEOWNERS / owner mapping.");
  await user.click(screen.getByRole("button", { name: "Edit context" }));
  fireEvent.change(screen.getByLabelText("Repository URL"), { target: { value: "https://token@github.com/acme/checkout" } });
  fireEvent.change(screen.getByLabelText("Default branch"), { target: { value: "feature..unsafe" } });
  fireEvent.change(screen.getByLabelText("Worktree path"), { target: { value: "/workspace/../secrets" } });
  fireEvent.change(screen.getByLabelText("Test command"), { target: { value: "npm test\ncurl example.test" } });
  fireEvent.change(screen.getByLabelText("CODEOWNERS / owner mapping"), { target: { value: "../secrets/** @security" } });
  expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");

  await user.click(screen.getByRole("button", { name: "Save context" }));
  expect(updateContext).not.toHaveBeenCalled();
  expect(screen.getByLabelText("CODEOWNERS / owner mapping")).toHaveFocus();
  expect(screen.getByText("Use one relative file pattern and one or more valid owners per line.")).toBeVisible();
});

test("engineering context saves exact advisory policy and retries the same tenant-scoped payload", async () => {
  const user = userEvent.setup();
  const emptyContext = engineeringContext();
  const savedContext = engineeringContext({
    repositoryUrl: "https://github.com/acme/checkout",
    defaultBranch: "main",
    worktreePath: "/workspace/checkout",
    installCommand: "npm ci",
    testCommand: "npm test -- checkout",
    buildCommand: "npm run build",
    autoFixPolicy: "ALLOW_BRANCH",
    reviewerPolicy: "HUMAN_REVIEW_REQUIRED",
    requesterNotificationPolicy: "DISABLED",
    notes: "apps/web/** @web-team",
    updatedAt: "2026-07-15T12:00:00.000Z",
  });
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [project({})] });
  vi.spyOn(api, "getProjectEngineeringContext")
    .mockResolvedValueOnce(emptyContext)
    .mockResolvedValue(savedContext);
  const updateContext = vi.spyOn(api, "updateProjectEngineeringContext")
    .mockRejectedValueOnce(new Error("temporary outage"))
    .mockResolvedValueOnce(savedContext);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClients.push(queryClient);
  renderProjectPage(queryClient, "/projects/checkout?section=engineering");

  await screen.findByRole("button", { name: "Edit context" });
  await user.click(screen.getByRole("button", { name: "Edit context" }));
  fireEvent.change(screen.getByLabelText("Repository URL"), { target: { value: " https://github.com/acme/checkout " } });
  await user.type(screen.getByLabelText("Default branch"), "main");
  await user.type(screen.getByLabelText("Worktree path"), "/workspace/checkout");
  await user.type(screen.getByLabelText("Install command"), "npm ci");
  await user.type(screen.getByLabelText("Test command"), "npm test -- checkout");
  await user.type(screen.getByLabelText("Build command"), "npm run build");
  await user.selectOptions(screen.getByLabelText("Auto-fix policy"), "ALLOW_BRANCH");
  await user.selectOptions(screen.getByLabelText("Reviewer policy"), "HUMAN_REVIEW_REQUIRED");
  await user.selectOptions(screen.getByLabelText("Reporter notification policy"), "DISABLED");
  fireEvent.change(screen.getByLabelText("CODEOWNERS / owner mapping"), { target: { value: "apps/web/** @web-team" } });
  await user.click(screen.getByRole("button", { name: "Save context" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save engineering context for Checkout.");
  expect(updateContext).toHaveBeenCalledWith("checkout", expect.objectContaining({
    repositoryUrl: "https://github.com/acme/checkout",
    autoFixPolicy: "ALLOW_BRANCH",
    reviewerPolicy: "HUMAN_REVIEW_REQUIRED",
    requesterNotificationPolicy: "DISABLED",
    notes: "apps/web/** @web-team",
  }), "organization-1");
  const firstCall = updateContext.mock.calls[0];
  await user.click(screen.getByRole("button", { name: "Retry saving engineering context" }));
  await waitFor(() => expect(updateContext).toHaveBeenCalledTimes(2));
  expect(updateContext.mock.calls[1]).toEqual(firstCall);
  await waitFor(() => expect(document.getElementById("project-engineering-context-save-state")).toHaveTextContent("Configured for AI task context"));
});
