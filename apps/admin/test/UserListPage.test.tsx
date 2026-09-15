import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";

import { UserListPage } from "../src/features/users/UserListPage";
import { api } from "../src/lib/api";
import type { AccessCapabilities, AdminUsersResponse, AdminUserSummary } from "../src/lib/api";

const queryClients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  queryClients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

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

function makeUser(index: number): AdminUserSummary {
  const organizationRole: AdminUserSummary["organizationRole"] = index === 0
    ? "OWNER"
    : index === 1 || index === 2
      ? "MEMBER"
      : index === 3 ? null : "ADMIN";
  const isActive = index !== 10;
  const hasDirectAssignment = (organizationRole === "MEMBER" && index === 1) || (organizationRole === "ADMIN" && index === 4);
  const projectMemberships: AdminUserSummary["projectMemberships"] = hasDirectAssignment ? [{
    project: { id: `product-${index + 1}`, key: `product-${index + 1}`, name: `Product ${String(index + 1).padStart(2, "0")}` },
    role: index === 1 ? "TRIAGER" : "VIEWER",
    status: "ACTIVE",
    capabilities: {
      canManageProject: false,
      canWriteProject: index === 1,
      canTriageProject: index === 1,
      canViewProject: true,
    },
  }] : [];
  const capabilities: AccessCapabilities = !isActive ? noCapabilities : organizationRole === null ? {
    canManageProject: true,
    canWriteProject: true,
    canTriageProject: true,
    canViewProject: true,
    canManageOrganization: true,
    canManageTeam: true,
    canInviteMembers: true,
    canManageOwners: true,
    canManagePlatform: true,
  } : organizationRole === "OWNER" ? {
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
  } : projectMemberships.length > 0 ? {
    ...noCapabilities,
    canWriteProject: true,
    canTriageProject: true,
    canViewProject: true,
  } : noCapabilities;

  return {
    id: `user-${index + 1}`,
    name: `Member ${String(index + 1).padStart(2, "0")}`,
    email: `member-${index + 1}@example.test`,
    role: organizationRole === "MEMBER" ? "TRIAGER" : "ADMIN",
    platformRole: organizationRole === null ? "GLOBAL_ADMIN" : "USER",
    isActive,
    lastLoginAt: index === 0 ? null : new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    createdAt: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
    organizationRole,
    organizationMembershipStatus: organizationRole === null ? null : isActive ? "ACTIVE" : "DISABLED",
    orgMemberships: organizationRole === null ? [] : [{ organizationId: "organization-1", role: organizationRole, status: isActive ? "ACTIVE" : "DISABLED" }],
    projectMemberships,
    effectiveAccess: {
      scope: !isActive
        ? "NONE"
        : organizationRole === null
          ? "PLATFORM"
          : organizationRole === "MEMBER"
            ? projectMemberships.length ? "SELECTED_PROJECTS" : "NO_PROJECTS"
            : "ALL_PROJECTS",
      allProjects: isActive && (organizationRole === null || organizationRole !== "MEMBER"),
      assignedProjectCount: projectMemberships.length,
      capabilities,
    },
  };
}

function makeActor(capabilities: Partial<AccessCapabilities> = {}): AdminUsersResponse["actor"] {
  return {
    id: "actor-1",
    platformRole: "USER",
    isGlobalAdmin: false,
    organizationId: "organization-1",
    organizationRole: "OWNER",
    organizationMembershipStatus: "ACTIVE",
    capabilities: {
      ...noCapabilities,
      canManageProject: true,
      canWriteProject: true,
      canTriageProject: true,
      canViewProject: true,
      canManageOrganization: true,
      canManageTeam: true,
      canInviteMembers: true,
      canManageOwners: true,
      ...capabilities,
    },
  };
}

function renderUserList({ actor = makeActor() }: { actor?: AdminUsersResponse["actor"] } = {}) {
  const users = Array.from({ length: 11 }, (_, index) => makeUser(index));
  vi.spyOn(api, "getUsers").mockResolvedValue({ data: users, actor });

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  queryClients.push(queryClient);

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UserListPage organizationId="organization-1" organizationName="Northwind" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("desktop table and mobile cards keep access summaries compact", async () => {
  renderUserList();

  await screen.findByText("Manage roles and product access for Northwind.");
  const table = document.querySelector<HTMLElement>("[data-table-contract='users']");
  expect(table).not.toBeNull();
  expect(await within(table!).findByText("OWNER")).toBeInTheDocument();
  expect(within(table!).getAllByText("ADMIN").length).toBeGreaterThan(0);
  expect(within(table!).getAllByText("MEMBER").length).toBeGreaterThan(0);
  expect(within(table!).getAllByText("All products").length).toBeGreaterThan(0);
  expect(table).toHaveTextContent("1 direct assignment");
  expect(table).not.toHaveTextContent("Manage owners");
  expect(table).not.toHaveTextContent("Access comes from the organization or platform role");

  const mobileCards = document.querySelectorAll<HTMLElement>(".tg-mobile-card");
  expect(mobileCards).toHaveLength(10);
  expect(within(mobileCards[0]).getByRole("button", { name: "Open Member 01" })).toBeInTheDocument();
  expect(within(mobileCards[0]).getByText("OWNER")).toBeInTheDocument();
  expect(within(mobileCards[0]).getByText("All products")).toBeInTheDocument();
  expect(within(mobileCards[1]).getByText("MEMBER")).toBeInTheDocument();
  expect(within(mobileCards[1]).getByText("Selected products")).toBeInTheDocument();
  expect(within(mobileCards[1]).getByText("1 direct assignment")).toBeInTheDocument();
  expect(within(mobileCards[2]).getByText("No products")).toBeInTheDocument();
  expect(within(mobileCards[3]).getByText("NONE")).toBeInTheDocument();
  expect(within(mobileCards[3]).getByText("Platform")).toBeInTheDocument();
  expect(mobileCards[3]).not.toHaveTextContent("Manage platform, organizations, teams, owners, and products");
});

test("actor capability context hides invite affordances and uses review copy", async () => {
  renderUserList({ actor: makeActor({ canManageTeam: false, canInviteMembers: false }) });

  expect(await screen.findByText("Review roles and product access for Northwind.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
});

test("mobile sort selects an option, reorders cards, and resets pagination", async () => {
  const user = userEvent.setup();
  renderUserList();

  expect(await screen.findByText("Manage roles and product access for Northwind.")).toBeVisible();

  const sortSelect = await screen.findByLabelText("Sort by");
  expect(sortSelect).toHaveValue("name:asc");
  expect(document.getElementById("user-list-mobile-filters")).toHaveClass("min-[1024px]:hidden");

  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByText("11-11 of 11")).toBeInTheDocument();

  await user.selectOptions(sortSelect, "lastLogin:desc");

  expect(sortSelect).toHaveValue("lastLogin:desc");
  expect(screen.getByText("1-10 of 11")).toBeInTheDocument();
  const mobileCards = document.querySelectorAll<HTMLElement>(".tg-mobile-card");
  expect(mobileCards).toHaveLength(10);
  expect(within(mobileCards[0]).getByText("Member 11")).toBeInTheDocument();
  expect(within(mobileCards[1]).getByText("Member 10")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(within(document.querySelectorAll<HTMLElement>(".tg-mobile-card")[0]).getByText("Member 01")).toBeInTheDocument();

  await user.selectOptions(sortSelect, "lastLogin:asc");
  expect(within(document.querySelectorAll<HTMLElement>(".tg-mobile-card")[0]).getByText("Member 02")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(within(document.querySelectorAll<HTMLElement>(".tg-mobile-card")[0]).getByText("Member 01")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Name" }));
  expect(sortSelect).toHaveValue("name:asc");
  expect(screen.getByText("1-10 of 11")).toBeInTheDocument();
});

test("filtered empty team results expose a working clear action", async () => {
  const user = userEvent.setup();
  renderUserList();

  const search = (await screen.findAllByPlaceholderText("Search name or email"))[0]!;
  await user.type(search, "not-a-member");

  expect(await screen.findAllByText("No team members match these filters")).toHaveLength(2);
  await user.click(screen.getAllByRole("button", { name: "Clear team filters" })[0]!);

  expect(search).toHaveValue("");
  expect(await screen.findAllByText("Member 01")).not.toHaveLength(0);
});
