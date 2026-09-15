import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

import type { MembershipStatus, OrgRole, PlatformRole, ProjectRole } from "@prisma/client";

import { createApp } from "../../app";
import { prisma } from "../../lib/prisma";
import { authService } from "../auth/auth.service";
import { env } from "../../config/env";

type ProjectCapabilities = {
  canManageProject: boolean;
  canWriteProject: boolean;
  canTriageProject: boolean;
  canViewProject: boolean;
};

type AccessCapabilities = ProjectCapabilities & {
  canManageOrganization: boolean;
  canManageTeam: boolean;
  canInviteMembers: boolean;
  canManageOwners: boolean;
  canManagePlatform: boolean;
};

type UserProjection = {
  id: string;
  role: "ADMIN" | "TRIAGER";
  platformRole: PlatformRole;
  isActive: boolean;
  organizationRole: OrgRole | null;
  organizationMembershipStatus: MembershipStatus | null;
  orgMemberships: Array<{
    organizationId: string;
    role: OrgRole;
    status: MembershipStatus;
  }>;
  projectMemberships: Array<{
    project: { id: string; key: string; name: string };
    role: ProjectRole;
    status: MembershipStatus;
    capabilities: ProjectCapabilities;
  }>;
  effectiveAccess: {
    scope: "NONE" | "PLATFORM" | "MULTI_ORGANIZATION" | "ALL_PROJECTS" | "SELECTED_PROJECTS" | "NO_PROJECTS";
    allProjects: boolean;
    assignedProjectCount: number;
    capabilities: AccessCapabilities;
  };
};

type UsersResponse = {
  data: UserProjection[];
  actor: {
    id: string;
    platformRole: PlatformRole;
    isGlobalAdmin: boolean;
    organizationId: string | null;
    organizationRole: OrgRole | null;
    organizationMembershipStatus: MembershipStatus | null;
    capabilities: AccessCapabilities;
  };
  error?: { code: string };
};

function testSlug(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function listen(server: http.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.equal(typeof address, "object");
      assert.ok(address);
      resolve((address as AddressInfo).port);
    });
  });
}

async function requestUsers(port: number, token: string, organizationId?: string) {
  const query = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
  const response = await fetch(`http://127.0.0.1:${port}/api/admin/users${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = await response.json() as UsersResponse;
  return { response, payload };
}

async function requestSelf(port: number, token: string, options: {
  organizationId?: string;
  method?: "GET" | "PATCH";
  body?: Record<string, unknown>;
} = {}) {
  const query = options.organizationId ? `?organizationId=${encodeURIComponent(options.organizationId)}` : "";
  const method = options.method ?? "GET";
  const response = await fetch(`http://127.0.0.1:${port}/api/admin/users/me${query}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(method === "PATCH" ? { "content-type": "application/json", origin: env.ADMIN_APP_URL } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json() as { data?: UserProjection & { name: string; email: string }; error?: { code: string } };
  return { response, payload };
}

async function createUsersFixture() {
  const organization = await prisma.organization.create({
    data: { name: "Users projection org", slug: testSlug("users-projection-org") },
  });
  const otherOrganization = await prisma.organization.create({
    data: { name: "Other users projection org", slug: testSlug("other-users-projection-org") },
  });
  const [adminProject, triageProject, viewerProject, otherProject] = await Promise.all([
    prisma.project.create({
      data: {
        organizationId: organization.id,
        key: testSlug("users-admin-project"),
        name: "Admin product",
        defaultEnvironment: "test",
      },
    }),
    prisma.project.create({
      data: {
        organizationId: organization.id,
        key: testSlug("users-triage-project"),
        name: "Triage product",
        defaultEnvironment: "test",
      },
    }),
    prisma.project.create({
      data: {
        organizationId: organization.id,
        key: testSlug("users-viewer-project"),
        name: "Viewer product",
        defaultEnvironment: "test",
      },
    }),
    prisma.project.create({
      data: {
        organizationId: otherOrganization.id,
        key: testSlug("users-other-project"),
        name: "Other tenant product",
        defaultEnvironment: "test",
      },
    }),
  ]);

  async function createUser(input: {
    label: string;
    platformRole?: PlatformRole;
    memberships?: Array<{ organizationId: string; role: OrgRole; status?: MembershipStatus }>;
    projects?: Array<{ projectId: string; role: ProjectRole; status?: MembershipStatus }>;
  }) {
    const primaryOrgRole = input.memberships?.[0]?.role;
    return prisma.adminUser.create({
      data: {
        email: `${testSlug(`users-${input.label}`)}@traceitgenie.test`,
        name: `Users ${input.label}`,
        passwordHash: "not-used",
        role: primaryOrgRole === "OWNER" || primaryOrgRole === "ADMIN" || input.platformRole === "GLOBAL_ADMIN" ? "ADMIN" : "TRIAGER",
        platformRole: input.platformRole ?? "USER",
        orgMemberships: input.memberships
          ? {
              create: input.memberships.map((membership) => ({
                organizationId: membership.organizationId,
                role: membership.role,
                status: membership.status,
              })),
            }
          : undefined,
        projectMemberships: input.projects
          ? {
              create: input.projects.map((membership) => ({
                projectId: membership.projectId,
                role: membership.role,
                status: membership.status,
              })),
            }
          : undefined,
      },
    });
  }

  const owner = await createUser({
    label: "owner",
    memberships: [{ organizationId: organization.id, role: "OWNER" }],
  });
  const admin = await createUser({
    label: "admin",
    memberships: [{ organizationId: organization.id, role: "ADMIN" }],
    projects: [{ projectId: viewerProject.id, role: "VIEWER", status: "DISABLED" }],
  });
  const projectAdmin = await createUser({
    label: "project-admin",
    memberships: [{ organizationId: organization.id, role: "MEMBER" }],
    projects: [{ projectId: adminProject.id, role: "PROJECT_ADMIN" }],
  });
  const triager = await createUser({
    label: "triager",
    memberships: [{ organizationId: organization.id, role: "MEMBER" }],
    projects: [{ projectId: triageProject.id, role: "TRIAGER" }],
  });
  const viewer = await createUser({
    label: "viewer",
    memberships: [{ organizationId: organization.id, role: "MEMBER" }],
    projects: [{ projectId: viewerProject.id, role: "VIEWER" }],
  });
  const noProjects = await createUser({
    label: "no-projects",
    memberships: [{ organizationId: organization.id, role: "MEMBER" }],
  });
  const disabled = await createUser({
    label: "disabled",
    memberships: [{ organizationId: organization.id, role: "MEMBER", status: "DISABLED" }],
    projects: [{ projectId: viewerProject.id, role: "VIEWER" }],
  });
  const dualTenant = await createUser({
    label: "dual-tenant",
    memberships: [
      { organizationId: organization.id, role: "MEMBER" },
      { organizationId: otherOrganization.id, role: "ADMIN" },
    ],
    projects: [
      { projectId: triageProject.id, role: "TRIAGER" },
      { projectId: otherProject.id, role: "PROJECT_ADMIN" },
    ],
  });
  const foreignAdmin = await createUser({
    label: "foreign-admin",
    memberships: [{ organizationId: otherOrganization.id, role: "ADMIN" }],
  });
  const globalAdmin = await createUser({ label: "global-admin", platformRole: "GLOBAL_ADMIN" });

  const users = { owner, admin, projectAdmin, triager, viewer, noProjects, disabled, dualTenant, foreignAdmin, globalAdmin };
  const sessions = Object.fromEntries(
    await Promise.all(Object.entries(users).map(async ([key, user]) => [key, (await authService.createSession(user.id)).sessionToken])),
  ) as Record<keyof typeof users, string>;

  return {
    organization,
    otherOrganization,
    projects: { adminProject, triageProject, viewerProject, otherProject },
    users,
    sessions,
  };
}

async function cleanupUsersFixture(fixture: Awaited<ReturnType<typeof createUsersFixture>>) {
  await prisma.organization.deleteMany({
    where: { id: { in: [fixture.organization.id, fixture.otherOrganization.id] } },
  });
  await prisma.adminUser.deleteMany({
    where: { id: { in: Object.values(fixture.users).map((user) => user.id) } },
  });
}

function projectionFor(payload: UsersResponse, userId: string) {
  const projection = payload.data.find((user) => user.id === userId);
  assert.ok(projection, `Expected user ${userId} in response`);
  return projection;
}

test("users projection exposes exact role and effective-access matrix", async () => {
  const fixture = await createUsersFixture();
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const ownerResult = await requestUsers(port, fixture.sessions.owner, fixture.organization.id);
    assert.equal(ownerResult.response.status, 200);
    assert.deepEqual(
      {
        organizationRole: ownerResult.payload.actor.organizationRole,
        isGlobalAdmin: ownerResult.payload.actor.isGlobalAdmin,
        canManageTeam: ownerResult.payload.actor.capabilities.canManageTeam,
        canManageOwners: ownerResult.payload.actor.capabilities.canManageOwners,
        canManagePlatform: ownerResult.payload.actor.capabilities.canManagePlatform,
      },
      {
        organizationRole: "OWNER",
        isGlobalAdmin: false,
        canManageTeam: true,
        canManageOwners: true,
        canManagePlatform: false,
      },
    );

    const owner = projectionFor(ownerResult.payload, fixture.users.owner.id);
    assert.equal(owner.organizationRole, "OWNER");
    assert.equal(owner.role, "ADMIN");
    assert.equal(owner.effectiveAccess.scope, "ALL_PROJECTS");
    assert.equal(owner.effectiveAccess.allProjects, true);
    assert.equal(owner.effectiveAccess.capabilities.canManageOrganization, true);

    const admin = projectionFor(ownerResult.payload, fixture.users.admin.id);
    assert.equal(admin.organizationRole, "ADMIN");
    assert.equal(admin.role, "ADMIN");
    assert.equal(admin.effectiveAccess.scope, "ALL_PROJECTS");
    assert.equal(admin.effectiveAccess.capabilities.canManageOwners, false);
    assert.deepEqual(admin.projectMemberships[0]?.capabilities, {
      canManageProject: true,
      canWriteProject: true,
      canTriageProject: true,
      canViewProject: true,
    });

    const projectAdmin = projectionFor(ownerResult.payload, fixture.users.projectAdmin.id);
    assert.equal(projectAdmin.organizationRole, "MEMBER");
    assert.equal(projectAdmin.role, "TRIAGER");
    assert.equal(projectAdmin.effectiveAccess.scope, "SELECTED_PROJECTS");
    assert.deepEqual(projectAdmin.projectMemberships, [{
      project: {
        id: fixture.projects.adminProject.id,
        key: fixture.projects.adminProject.key,
        name: fixture.projects.adminProject.name,
      },
      role: "PROJECT_ADMIN",
      status: "ACTIVE",
      capabilities: {
        canManageProject: true,
        canWriteProject: true,
        canTriageProject: true,
        canViewProject: true,
      },
    }]);

    const triager = projectionFor(ownerResult.payload, fixture.users.triager.id);
    assert.equal(triager.organizationRole, "MEMBER");
    assert.equal(triager.projectMemberships[0]?.role, "TRIAGER");
    assert.deepEqual(triager.projectMemberships[0]?.capabilities, {
      canManageProject: false,
      canWriteProject: true,
      canTriageProject: true,
      canViewProject: true,
    });

    const viewer = projectionFor(ownerResult.payload, fixture.users.viewer.id);
    assert.equal(viewer.organizationRole, "MEMBER");
    assert.equal(viewer.projectMemberships[0]?.role, "VIEWER");
    assert.deepEqual(viewer.projectMemberships[0]?.capabilities, {
      canManageProject: false,
      canWriteProject: false,
      canTriageProject: false,
      canViewProject: true,
    });

    const noProjects = projectionFor(ownerResult.payload, fixture.users.noProjects.id);
    assert.equal(noProjects.effectiveAccess.scope, "NO_PROJECTS");
    assert.equal(noProjects.effectiveAccess.assignedProjectCount, 0);
    assert.equal(noProjects.effectiveAccess.capabilities.canViewProject, false);

    const disabled = projectionFor(ownerResult.payload, fixture.users.disabled.id);
    assert.equal(disabled.organizationMembershipStatus, "DISABLED");
    assert.equal(disabled.isActive, false);
    assert.equal(disabled.effectiveAccess.scope, "NONE");
    assert.equal(disabled.effectiveAccess.capabilities.canViewProject, false);
    assert.equal(disabled.projectMemberships[0]?.capabilities.canViewProject, false);

    const adminResult = await requestUsers(port, fixture.sessions.admin, fixture.organization.id);
    assert.equal(adminResult.response.status, 200);
    assert.equal(adminResult.payload.actor.organizationRole, "ADMIN");
    assert.equal(adminResult.payload.actor.capabilities.canManageTeam, true);
    assert.equal(adminResult.payload.actor.capabilities.canManageOwners, false);

    for (const role of ["projectAdmin", "triager", "viewer"] as const) {
      const denied = await requestUsers(port, fixture.sessions[role], fixture.organization.id);
      assert.equal(denied.response.status, 403, `${role} should not list Team`);
      assert.equal(denied.payload.error?.code, "org.insufficient_role");
    }

    const globalResult = await requestUsers(port, fixture.sessions.globalAdmin, fixture.organization.id);
    assert.equal(globalResult.response.status, 200);
    assert.equal(globalResult.payload.actor.organizationRole, null);
    assert.equal(globalResult.payload.actor.isGlobalAdmin, true);
    assert.equal(globalResult.payload.actor.capabilities.canManagePlatform, true);
    assert.equal(globalResult.payload.actor.capabilities.canManageOwners, true);

    const globalUnscopedResult = await requestUsers(port, fixture.sessions.globalAdmin);
    assert.equal(globalUnscopedResult.response.status, 200);
    const globalAdmin = projectionFor(globalUnscopedResult.payload, fixture.users.globalAdmin.id);
    assert.equal(globalAdmin.platformRole, "GLOBAL_ADMIN");
    assert.equal(globalAdmin.organizationRole, null);
    assert.equal(globalAdmin.effectiveAccess.scope, "PLATFORM");
    assert.equal(globalAdmin.effectiveAccess.allProjects, true);
    assert.equal(globalAdmin.effectiveAccess.capabilities.canManagePlatform, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupUsersFixture(fixture);
  }
});

test("users projection never leaks memberships or projects across tenants", async () => {
  const fixture = await createUsersFixture();
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const scoped = await requestUsers(port, fixture.sessions.owner, fixture.organization.id);
    assert.equal(scoped.response.status, 200);
    assert.equal(scoped.payload.data.some((user) => user.id === fixture.users.foreignAdmin.id), false);
    const scopedDualTenant = projectionFor(scoped.payload, fixture.users.dualTenant.id);
    assert.deepEqual(scopedDualTenant.orgMemberships.map((membership) => membership.organizationId), [fixture.organization.id]);
    assert.deepEqual(scopedDualTenant.projectMemberships.map((membership) => membership.project.id), [fixture.projects.triageProject.id]);
    assert.equal(JSON.stringify(scopedDualTenant).includes(fixture.otherOrganization.id), false);
    assert.equal(JSON.stringify(scopedDualTenant).includes(fixture.projects.otherProject.id), false);
    assert.equal(JSON.stringify(scopedDualTenant).includes(fixture.projects.otherProject.key), false);
    assert.equal(JSON.stringify(scopedDualTenant).includes(fixture.projects.otherProject.name), false);

    const deniedOtherTenant = await requestUsers(port, fixture.sessions.owner, fixture.otherOrganization.id);
    assert.equal(deniedOtherTenant.response.status, 403);
    assert.equal(deniedOtherTenant.payload.error?.code, "org.access_denied");

    const unscoped = await requestUsers(port, fixture.sessions.owner);
    assert.equal(unscoped.response.status, 200);
    assert.equal(unscoped.payload.actor.organizationId, null);
    assert.equal(unscoped.payload.actor.organizationRole, null);
    assert.equal(unscoped.payload.actor.capabilities.canManageTeam, false);
    assert.equal(unscoped.payload.actor.capabilities.canManageOwners, false);
    assert.equal(unscoped.payload.data.some((user) => user.id === fixture.users.foreignAdmin.id), false);
    const unscopedDualTenant = projectionFor(unscoped.payload, fixture.users.dualTenant.id);
    assert.deepEqual(unscopedDualTenant.orgMemberships.map((membership) => membership.organizationId), [fixture.organization.id]);
    assert.deepEqual(unscopedDualTenant.projectMemberships.map((membership) => membership.project.id), [fixture.projects.triageProject.id]);

    const globalScoped = await requestUsers(port, fixture.sessions.globalAdmin, fixture.organization.id);
    assert.equal(globalScoped.response.status, 200);
    assert.equal(globalScoped.payload.data.some((user) => user.id === fixture.users.foreignAdmin.id), false);
    const globalScopedDualTenant = projectionFor(globalScoped.payload, fixture.users.dualTenant.id);
    assert.deepEqual(globalScopedDualTenant.orgMemberships.map((membership) => membership.organizationId), [fixture.organization.id]);
    assert.deepEqual(globalScopedDualTenant.projectMemberships.map((membership) => membership.project.id), [fixture.projects.triageProject.id]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupUsersFixture(fixture);
  }
});

test("non-admin members can read only their tenant-scoped self profile", async () => {
  const fixture = await createUsersFixture();
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const result = await requestSelf(port, fixture.sessions.dualTenant, {
      organizationId: fixture.organization.id,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.data?.id, fixture.users.dualTenant.id);
    assert.equal(result.payload.data?.organizationRole, "MEMBER");
    assert.equal(result.payload.data?.effectiveAccess.scope, "SELECTED_PROJECTS");
    assert.deepEqual(result.payload.data?.projectMemberships.map((membership) => membership.project.id), [
      fixture.projects.triageProject.id,
    ]);
    assert.equal(JSON.stringify(result.payload).includes(fixture.otherOrganization.id), false);
    assert.equal(JSON.stringify(result.payload).includes(fixture.projects.otherProject.id), false);

    assert.deepEqual(result.payload.data?.orgMemberships.map((membership) => membership.organizationId), [
      fixture.organization.id,
    ]);

    const foreignTenant = await requestSelf(port, fixture.sessions.triager, {
      organizationId: fixture.otherOrganization.id,
    });
    assert.equal(foreignTenant.response.status, 403);
    assert.equal(foreignTenant.payload.error?.code, "org.access_denied");

    const unscoped = await requestSelf(port, fixture.sessions.dualTenant);
    assert.equal(unscoped.response.status, 400);
    assert.equal(unscoped.payload.error?.code, "users.organization_required");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupUsersFixture(fixture);
  }
});

test("non-admin members can update their own profile without changing access", async () => {
  const fixture = await createUsersFixture();
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const unscopedUpdate = await requestSelf(port, fixture.sessions.viewer, {
      method: "PATCH",
      body: { name: "Unscoped Viewer" },
    });
    assert.equal(unscopedUpdate.response.status, 400);
    assert.equal(unscopedUpdate.payload.error?.code, "users.organization_required");

    const updated = await requestSelf(port, fixture.sessions.viewer, {
      method: "PATCH",
      body: {
        organizationId: fixture.organization.id,
        name: "Updated Viewer",
      },
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.payload.data?.id, fixture.users.viewer.id);
    assert.equal(updated.payload.data?.name, "Updated Viewer");
    assert.equal("role" in (updated.payload.data ?? {}), false);

    const rejected = await requestSelf(port, fixture.sessions.viewer, {
      method: "PATCH",
      body: {
        organizationId: fixture.organization.id,
        name: "Escalated Viewer",
        role: "ADMIN",
        isActive: false,
      },
    });
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.payload.error?.code, "validation.invalid_request");

    const persisted = await prisma.adminUser.findUniqueOrThrow({ where: { id: fixture.users.viewer.id } });
    const membership = await prisma.orgMembership.findUniqueOrThrow({
      where: {
        organizationId_userId: {
          organizationId: fixture.organization.id,
          userId: fixture.users.viewer.id,
        },
      },
    });
    assert.equal(persisted.name, "Updated Viewer");
    assert.equal(persisted.role, "TRIAGER");
    assert.equal(persisted.isActive, true);
    assert.equal(membership.role, "MEMBER");
    assert.equal(membership.status, "ACTIVE");

    const passwordChanged = await requestSelf(port, fixture.sessions.viewer, {
      method: "PATCH",
      body: {
        organizationId: fixture.organization.id,
        password: "replacement-password",
      },
    });
    assert.equal(passwordChanged.response.status, 200);

    const passwordUser = await prisma.adminUser.findUniqueOrThrow({ where: { id: fixture.users.viewer.id } });
    assert.ok(passwordUser.passwordChangedAt);
    assert.equal(await bcrypt.compare("replacement-password", passwordUser.passwordHash), true);

    const staleSession = await requestSelf(port, fixture.sessions.viewer, {
      organizationId: fixture.organization.id,
    });
    assert.equal(staleSession.response.status, 401);
    assert.equal(staleSession.payload.error?.code, "auth.stale_session");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupUsersFixture(fixture);
  }
});
