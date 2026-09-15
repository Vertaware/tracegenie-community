import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from "react-router-dom";

import { AdminFormExitGuardProvider } from "../src/components/guards/AdminFormExitGuard";
import { UserFormPage } from "../src/features/users/UserFormPage";
import { api } from "../src/lib/api";
import type { AccessCapabilities, AdminUsersResponse, AdminUserSummary } from "../src/lib/api";

type TestUser = AdminUserSummary;

const noCapabilities: AccessCapabilities = {
  canManageProject: false,
  canWriteProject: false,
  canTriageProject: false,
  canViewProject: false,
  canManageOrganization: false,
  canManageTeam: false,
  canInviteMembers: false,
  canManageOwners: false,
  canManagePlatform: false,
};

function makeActor({ role = "OWNER", capabilities = {} }: {
  role?: "OWNER" | "ADMIN" | "MEMBER";
  capabilities?: Partial<AccessCapabilities>;
} = {}): AdminUsersResponse["actor"] {
  const managesTeam = role === "OWNER" || role === "ADMIN";
  return {
    id: "actor-1",
    platformRole: "USER",
    isGlobalAdmin: false,
    organizationId: "organization-1",
    organizationRole: role,
    organizationMembershipStatus: "ACTIVE",
    capabilities: {
      ...noCapabilities,
      canManageProject: managesTeam,
      canWriteProject: managesTeam,
      canTriageProject: managesTeam,
      canViewProject: managesTeam,
      canManageOrganization: managesTeam,
      canManageTeam: managesTeam,
      canInviteMembers: managesTeam,
      canManageOwners: role === "OWNER",
      ...capabilities,
    },
  };
}

function makeTestUser({
  id,
  name,
  email,
  organizationRole,
  isActive = true,
  projectMemberships = [],
}: {
  id: string;
  name: string;
  email: string;
  organizationRole: "OWNER" | "ADMIN" | "MEMBER";
  isActive?: boolean;
  projectMemberships?: AdminUserSummary["projectMemberships"];
}): TestUser {
  const capabilities: AccessCapabilities = !isActive ? noCapabilities : organizationRole === "OWNER" ? {
    ...noCapabilities,
    canManageProject: true,
    canWriteProject: true,
    canTriageProject: true,
    canViewProject: true,
    canManageOrganization: true,
    canManageTeam: true,
    canInviteMembers: true,
    canManageOwners: true,
  } : organizationRole === "ADMIN" ? {
    ...noCapabilities,
    canManageProject: true,
    canWriteProject: true,
    canTriageProject: true,
    canViewProject: true,
    canManageOrganization: true,
    canManageTeam: true,
    canInviteMembers: true,
  } : projectMemberships.some((membership) => membership.status === "ACTIVE") ? {
    ...noCapabilities,
    canWriteProject: true,
    canTriageProject: true,
    canViewProject: true,
  } : noCapabilities;

  return {
    id,
    name,
    email,
    role: organizationRole === "MEMBER" ? "TRIAGER" : "ADMIN",
    platformRole: "USER",
    isActive,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    organizationRole,
    organizationMembershipStatus: isActive ? "ACTIVE" : "DISABLED",
    orgMemberships: [{ organizationId: "organization-1", role: organizationRole, status: isActive ? "ACTIVE" : "DISABLED" }],
    projectMemberships,
    effectiveAccess: {
      scope: !isActive ? "NONE" : organizationRole === "MEMBER" ? projectMemberships.length ? "SELECTED_PROJECTS" : "NO_PROJECTS" : "ALL_PROJECTS",
      allProjects: isActive && organizationRole !== "MEMBER",
      assignedProjectCount: projectMemberships.filter((membership) => membership.status === "ACTIVE").length,
      capabilities,
    },
  };
}

const queryClients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  queryClients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

function newQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  queryClients.push(queryClient);
  return queryClient;
}

function renderUserPage({
  user,
  currentUserId,
  organizationId = "organization-1",
  organizationName = "Northwind",
  id = user?.id,
  actor = makeActor(),
  loadError,
}: {
  user?: TestUser;
  currentUserId?: string;
  organizationId?: string;
  organizationName?: string;
  id?: string;
  actor?: AdminUsersResponse["actor"];
  loadError?: Error;
} = {}) {
  if (user && id === currentUserId) {
    vi.spyOn(api, "getSelfProfile").mockResolvedValue({ data: user });
  } else {
    const getUsers = vi.spyOn(api, "getUsers");
    if (loadError) getUsers.mockRejectedValue(loadError);
    else getUsers.mockResolvedValue({ data: user ? [user] : [], actor });
  }
  const queryClient = newQueryClient();
  const path = id ? `/users/${id}` : "/users";

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/users/:id"
            element={<UserFormPage organizationId={organizationId} organizationName={organizationName} currentUserId={currentUserId} />}
          />
          <Route
            path="/users"
            element={<UserFormPage organizationId={organizationId} organizationName={organizationName} currentUserId={currentUserId} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderGuardedUserPage({ user, currentUserId }: { user: TestUser; currentUserId: string }) {
  vi.spyOn(api, "getSelfProfile").mockResolvedValue({ data: user });
  const queryClient = newQueryClient();
  const router = createMemoryRouter([
    {
      path: "/users/:id",
      element: (
        <AdminFormExitGuardProvider>
          <UserFormPage organizationId="organization-1" currentUserId={currentUserId} />
        </AdminFormExitGuardProvider>
      ),
    },
    { path: "/home", element: <h1>Overview</h1> },
  ], { initialEntries: [`/users/${user.id}`] });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const self: TestUser = makeTestUser({
  id: "user-self",
  name: "Current Admin",
  email: "self@example.test",
  organizationRole: "ADMIN",
});

const member: TestUser = makeTestUser({
  id: "user-member",
  name: "Member One",
  email: "member@example.test",
  organizationRole: "MEMBER",
  projectMemberships: [{
    project: { id: "product-1", key: "product-one", name: "Product One" },
    role: "TRIAGER",
    status: "ACTIVE",
    capabilities: {
      canManageProject: false,
      canWriteProject: true,
      canTriageProject: true,
      canViewProject: true,
    },
  }],
});

const owner: TestUser = makeTestUser({
  id: "user-owner",
  name: "Organization Owner",
  email: "owner@example.test",
  organizationRole: "OWNER",
});

test("self save sends only editable name and password fields", async () => {
  const user = userEvent.setup();
  const getUsers = vi.spyOn(api, "getUsers");
  const updateSelfProfile = vi.spyOn(api, "updateSelfProfile").mockResolvedValue({ data: self });
  renderUserPage({ user: self, currentUserId: self.id });

  await screen.findByRole("heading", { name: new RegExp(self.name), level: 1 });
  expect(screen.getByLabelText("Organization role")).toBeDisabled();
  expect(screen.getByLabelText("Email")).toBeDisabled();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();

  await user.clear(screen.getByLabelText("Full name"));
  await user.type(screen.getByLabelText("Full name"), "Updated Admin");
  await user.type(screen.getByLabelText("New password"), "new-password");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(updateSelfProfile).toHaveBeenCalledTimes(1));
  expect(updateSelfProfile).toHaveBeenCalledWith({
    organizationId: "organization-1",
    name: "Updated Admin",
    password: "new-password",
  });
  expect(getUsers).not.toHaveBeenCalled();
});

test("self password is blank or at least eight characters with an inline focused alert", async () => {
  const user = userEvent.setup();
  const updateSelfProfile = vi.spyOn(api, "updateSelfProfile").mockResolvedValue({ data: self });
  renderUserPage({ user: self, currentUserId: self.id });

  await screen.findByRole("heading", { name: new RegExp(self.name), level: 1 });
  await user.type(screen.getByLabelText("New password"), "short");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  const error = await screen.findByRole("alert");
  expect(error).toHaveTextContent("Password must be at least 8 characters.");
  expect(error).toHaveFocus();
  expect(screen.getByLabelText("New password")).toHaveClass("pr-10");
  expect(screen.getByLabelText("New password")).toHaveAttribute("aria-invalid", "true");
  expect(updateSelfProfile).not.toHaveBeenCalled();
});

test("dirty navigation confirms, while a pending commit bar save completes the requested exit", async () => {
  const user = userEvent.setup();
  let resolveUpdate!: (value: { data: TestUser }) => void;
  vi.spyOn(api, "updateSelfProfile").mockReturnValue(new Promise((resolve) => {
    resolveUpdate = resolve;
  }));
  renderGuardedUserPage({ user: self, currentUserId: self.id });

  await screen.findByRole("heading", { name: new RegExp(self.name), level: 1 });
  await user.type(screen.getByLabelText("New password"), "new-password");
  await user.click(screen.getByRole("button", { name: "Back to home" }));
  await user.click(await screen.findByRole("button", { name: "Stay" }));

  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("button", { name: "Saving..." })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Back to home" }));
  expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).not.toBeInTheDocument();

  resolveUpdate({ data: self });
  expect(await screen.findByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
});

test("password reveal preserves the entered value", async () => {
  const user = userEvent.setup();
  renderUserPage({ user: self, currentUserId: self.id });

  await screen.findByRole("heading", { name: new RegExp(self.name), level: 1 });
  const password = screen.getByLabelText("New password");
  await user.type(password, "new-password");
  await user.click(screen.getByRole("button", { name: "Show password" }));

  expect(password).toHaveAttribute("type", "text");
  expect(password).toHaveValue("new-password");
  expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
});

test("failed self save keeps password values available for retry", async () => {
  const user = userEvent.setup();
  const updateSelfProfile = vi.spyOn(api, "updateSelfProfile")
    .mockRejectedValueOnce(new Error("request failed"))
    .mockResolvedValueOnce({ data: self });
  renderUserPage({ user: self, currentUserId: self.id });

  await screen.findByRole("heading", { name: new RegExp(self.name), level: 1 });
  await user.type(screen.getByLabelText("New password"), "new-password");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  expect(await screen.findByText("Couldn't save Current Admin.")).toBeVisible();
  expect(screen.getByLabelText("New password")).toHaveValue("new-password");
  await user.click(screen.getByRole("button", { name: "Retry saving member" }));

  await waitFor(() => expect(updateSelfProfile).toHaveBeenCalledTimes(2));
  expect(updateSelfProfile.mock.calls[1]).toEqual(updateSelfProfile.mock.calls[0]);
});

test("successful self save clears the password, dirty state, and announces success", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "updateSelfProfile").mockResolvedValue({ data: self });
  renderUserPage({ user: self, currentUserId: self.id });

  await screen.findByRole("heading", { name: new RegExp(self.name), level: 1 });
  await user.type(screen.getByLabelText("New password"), "new-password");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  expect(await screen.findByRole("status")).toHaveTextContent("Current Admin saved.");
  expect(screen.getByLabelText("New password")).toHaveValue("");
  expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
});

test("self save omits a null organization scope", async () => {
  const user = userEvent.setup();
  const updateSelfProfile = vi.spyOn(api, "updateSelfProfile").mockResolvedValue({ data: self });
  renderUserPage({ user: self, currentUserId: self.id, organizationId: null });

  await screen.findByRole("heading", { name: new RegExp(self.name), level: 1 });
  await user.clear(screen.getByLabelText("Full name"));
  await user.type(screen.getByLabelText("Full name"), "Updated Admin");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(updateSelfProfile).toHaveBeenCalledTimes(1));
  expect(updateSelfProfile).toHaveBeenCalledWith({ name: "Updated Admin" });
});

test("managed member detail exposes exact role, effective scope, products, and capabilities", async () => {
  const getSelfProfile = vi.spyOn(api, "getSelfProfile");
  renderUserPage({ user: member });

  expect(await screen.findByRole("heading", { name: "Access in Northwind", level: 2 })).toBeVisible();
  expect(screen.getByLabelText("Organization role")).toHaveValue("MEMBER");
  expect(screen.getByText("Selected products")).toBeVisible();
  expect(screen.getByRole("list", { name: "Scoped products" })).toHaveTextContent("Product OneTriager");
  expect(screen.getByRole("list", { name: "Effective capabilities" })).toHaveTextContent("View, edit, and triage product feedback");
  expect(api.getUsers).toHaveBeenCalledWith("organization-1");
  expect(getSelfProfile).not.toHaveBeenCalled();
});

test("organization-wide access labels direct assignments as non-limiting", async () => {
  const adminWithDirectAssignment = makeTestUser({
    id: "user-admin-direct",
    name: "Admin With Assignment",
    email: "admin-direct@example.test",
    organizationRole: "ADMIN",
    projectMemberships: [{
      project: { id: "product-direct", key: "product-direct", name: "Direct Product" },
      role: "VIEWER",
      status: "ACTIVE",
      capabilities: {
        canManageProject: true,
        canWriteProject: true,
        canTriageProject: true,
        canViewProject: true,
      },
    }],
  });
  renderUserPage({ user: adminWithDirectAssignment });

  await screen.findByRole("heading", { name: "Access in Northwind", level: 2 });
  expect(screen.getByText("Direct assignments shown below do not limit all-product access.")).toBeVisible();
  expect(screen.getByRole("list", { name: "Scoped products" })).toHaveTextContent("Direct ProductViewer");
});

test("administrator actor can review but cannot mutate an owner", async () => {
  renderUserPage({ user: owner, actor: makeActor({ role: "ADMIN" }) });

  await screen.findByRole("heading", { name: new RegExp(owner.name), level: 1 });
  expect(screen.getByLabelText("Organization role")).toHaveValue("OWNER");
  expect(screen.getByLabelText("Organization role")).toBeDisabled();
  expect(screen.getByText("Only an organization owner can change another owner's access.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
});

test("non-self managed lookup failure shows a permission-oriented error", async () => {
  const user = userEvent.setup();
  renderUserPage({ user: member, loadError: new Error("forbidden") });

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Couldn't load this member");
  expect(alert).toHaveTextContent("You may not have permission");
  await user.click(within(alert).getByRole("button", { name: "Try again" }));
  expect(api.getUsers).toHaveBeenCalledTimes(2);
});

test("another member save sends only organization role", async () => {
  const user = userEvent.setup();
  const updateUser = vi.spyOn(api, "updateUser").mockResolvedValue({ data: { ...member, role: "ADMIN" } });
  renderUserPage({ user: member });

  await screen.findByRole("heading", { name: new RegExp(member.name), level: 1 });
  expect(screen.getByLabelText("Full name")).toBeDisabled();
  expect(screen.getByLabelText("Email")).toBeDisabled();
  expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Organization role"), "ADMIN");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
  expect(updateUser).toHaveBeenCalledWith(member.id, {
    organizationId: "organization-1",
    role: "ADMIN",
  });
});

test("canceling deactivation is a no-op", async () => {
  const user = userEvent.setup();
  const updateUser = vi.spyOn(api, "updateUser").mockResolvedValue({ data: member });
  renderUserPage({ user: member });

  await screen.findByRole("heading", { name: new RegExp(member.name), level: 1 });
  await user.click(screen.getByRole("button", { name: "Deactivate" }));
  const dialog = await screen.findByRole("dialog", { name: "Deactivate account" });
  expect(dialog).toHaveTextContent(`${member.name} will lose access to Northwind.`);
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

  expect(updateUser).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("confirmed deactivation uses one access mutation with the captured target", async () => {
  const user = userEvent.setup();
  let resolveUpdate!: (value: { data: TestUser }) => void;
  const updateUser = vi.spyOn(api, "updateUser").mockReturnValue(new Promise((resolve) => {
    resolveUpdate = resolve;
  }));
  renderUserPage({ user: member });

  await screen.findByRole("heading", { name: new RegExp(member.name), level: 1 });
  await user.click(screen.getByRole("button", { name: "Deactivate" }));
  const dialog = await screen.findByRole("dialog", { name: "Deactivate account" });
  const confirm = within(dialog).getByRole("button", { name: "Deactivate" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);

  await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
  expect(updateUser).toHaveBeenCalledWith(member.id, {
    organizationId: "organization-1",
    isActive: false,
  });

  resolveUpdate({ data: { ...member, isActive: false } });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("inactive member has a direct Reactivate action using the access mutation", async () => {
  const user = userEvent.setup();
  const inactiveMember = { ...member, isActive: false };
  const updateUser = vi.spyOn(api, "updateUser").mockResolvedValue({ data: { ...inactiveMember, isActive: true } });
  renderUserPage({ user: inactiveMember });

  await screen.findByRole("heading", { name: new RegExp(inactiveMember.name), level: 1 });
  await user.click(screen.getByRole("button", { name: "Reactivate" }));

  await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
  expect(updateUser).toHaveBeenCalledWith(inactiveMember.id, {
    organizationId: "organization-1",
    isActive: true,
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("failed deactivation closes the dialog and exposes recovery", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "updateUser").mockRejectedValue(new Error("request failed"));
  renderUserPage({ user: member });

  await screen.findByRole("heading", { name: new RegExp(member.name), level: 1 });
  await user.click(screen.getByRole("button", { name: "Deactivate" }));
  const dialog = await screen.findByRole("dialog", { name: "Deactivate account" });
  await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findByText("Couldn't deactivate Member One.")).toBeVisible();
});
