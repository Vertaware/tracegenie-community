import type { OrgRole,Prisma,ProjectRole } from "@prisma/client";

import type { Request } from "express";

import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";

const ORG_ROLE_RANK: Record<OrgRole, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  VIEWER: 1,
  TRIAGER: 2,
  PROJECT_ADMIN: 3,
};

export function isGlobalAdmin(_request: Request) { return false; }

export function getRequestedOrganizationId(request: Request) {
  const value = request.query.organizationId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function requireOrgAccessForUser(userId: string, organizationId: string, roles?: OrgRole[]) {
  const membership = await prisma.orgMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId,
      },
    },
  });

  if (!membership || membership.status !== "ACTIVE") {
    throw new AppError(403, "org.access_denied", "You do not have access to this organization.", {
      entitlementDenial: "PRODUCT_SCOPE_DENIED",
      scope: "organization",
    });
  }

  if (roles && !roles.includes(membership.role)) {
    throw new AppError(403, "org.insufficient_role", "Your organization role does not allow this action.", {
      entitlementDenial: "ROLE_DENIED",
      requiredRoles: roles,
    });
  }

  return membership;
}

export async function requireProjectAccessForUser(userId: string, projectId: string, projectRoles?: ProjectRole[]) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, organizationId: true },
  });

  if (!project) {
    throw new AppError(404, "projects.not_found", "Project configuration was not found.");
  }

  const [orgMembership, projectMembership] = await Promise.all([
    prisma.orgMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: project.organizationId,
          userId,
        },
      },
    }),
    prisma.projectMembership.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    }),
  ]);

  if (!orgMembership || orgMembership.status !== "ACTIVE") {
    throw new AppError(403, "projects.access_denied", "You do not have access to this project.", {
      entitlementDenial: "PRODUCT_SCOPE_DENIED",
      scope: "product",
    });
  }

  if (ORG_ROLE_RANK[orgMembership.role] >= ORG_ROLE_RANK.ADMIN) {
    return { orgMembership, projectMembership };
  }

  if (!projectMembership || projectMembership.status !== "ACTIVE") {
    throw new AppError(403, "projects.access_denied", "You do not have access to this project.", {
      entitlementDenial: "PRODUCT_SCOPE_DENIED",
      scope: "product",
    });
  }

  if (projectRoles && !projectRoles.some((role) => PROJECT_ROLE_RANK[projectMembership.role] >= PROJECT_ROLE_RANK[role])) {
    throw new AppError(403, "projects.insufficient_role", "Your project role does not allow this action.", {
      entitlementDenial: "ROLE_DENIED",
      requiredRoles: projectRoles,
    });
  }

  return { orgMembership, projectMembership };
}

async function getProjectIdsForGlobalAdmin(organizationId?: string) {
  const projects = await prisma.project.findMany({
    where: organizationId ? { organizationId } : undefined,
    select: { id: true },
  });
  return projects.map((project) => project.id);
}

async function getScopedProjectIdsForUser(userId: string, organizationId: string, projectRoles?: ProjectRole[]) {
  const orgMembership = await requireOrgAccessForUser(userId, organizationId);

  if (ORG_ROLE_RANK[orgMembership.role] >= ORG_ROLE_RANK.ADMIN) {
    const projects = await prisma.project.findMany({
      where: { organizationId },
      select: { id: true },
    });
    return projects.map((project) => project.id);
  }

  const memberships = await prisma.projectMembership.findMany({
    where: {
      userId,
      status: "ACTIVE",
      ...(projectRoles ? { role: { in: projectRoles } } : {}),
      project: { organizationId },
    },
    select: { projectId: true },
  });

  return memberships.map((membership) => membership.projectId);
}

async function getProjectIdsForUser(userId: string, projectRoles?: ProjectRole[]) {
  const orgMemberships = await prisma.orgMembership.findMany({
    where: {
      userId,
      status: "ACTIVE",
    },
    select: {
      organizationId: true,
      role: true,
    },
  });
  const activeOrgIds = orgMemberships.map((membership) => membership.organizationId);
  const adminOrgIds = orgMemberships
    .filter((membership) => ORG_ROLE_RANK[membership.role] >= ORG_ROLE_RANK.ADMIN)
    .map((membership) => membership.organizationId);
  const [orgProjects, projectMemberships] = await Promise.all([
    adminOrgIds.length > 0
      ? prisma.project.findMany({
          where: { organizationId: { in: adminOrgIds } },
          select: { id: true },
        })
      : Promise.resolve([]),
    activeOrgIds.length > 0
      ? prisma.projectMembership.findMany({
          where: {
            userId,
            status: "ACTIVE",
            ...(projectRoles ? { role: { in: projectRoles } } : {}),
            project: { organizationId: { in: activeOrgIds } },
          },
          select: { projectId: true },
        })
      : Promise.resolve([]),
  ]);

  return Array.from(new Set([
    ...orgProjects.map((project) => project.id),
    ...projectMemberships.map((membership) => membership.projectId),
  ]));
}

export async function getAccessibleProjectIds(request: Request, organizationId = getRequestedOrganizationId(request)) {
  if (!request.adminUser) {
    throw new AppError(401, "auth.missing_token", "Admin authentication is required.");
  }

  if (isGlobalAdmin(request)) {
    return getProjectIdsForGlobalAdmin(organizationId);
  }

  if (organizationId) {
    return getScopedProjectIdsForUser(request.adminUser.id, organizationId);
  }

  return getProjectIdsForUser(request.adminUser.id);
}

export async function getWritableProjectIds(request: Request, organizationId = getRequestedOrganizationId(request)) {
  if (!request.adminUser) {
    throw new AppError(401, "auth.missing_token", "Admin authentication is required.");
  }

  if (isGlobalAdmin(request)) {
    return getProjectIdsForGlobalAdmin(organizationId);
  }

  if (organizationId) {
    return getScopedProjectIdsForUser(request.adminUser.id, organizationId, ["PROJECT_ADMIN", "TRIAGER"]);
  }

  return getProjectIdsForUser(request.adminUser.id, ["PROJECT_ADMIN", "TRIAGER"]);
}

export async function assertOrgWritable(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      status: true,
      ...{},
    },
  });

  if (org.status === "READ_ONLY") {
    throw new AppError(403, "project.read_only", "This project is read-only.");
  }

  if (org.status === "SUSPENDED") {
    throw new AppError(403, "org.unavailable", "This organization is unavailable.");
  }
}

export async function writePlatformAudit(input: {
  organizationId?: string | null;
  actorUserId?: string | null;
  eventType: string;
  reason?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
}, client: typeof prisma | Prisma.TransactionClient = prisma) {
  await client.platformAuditEvent.create({
    data: {
      organizationId: input.organizationId ?? null,
      actorUserId: input.actorUserId ?? null,
      eventType: input.eventType,
      reason: input.reason ?? null,
      beforeJson: input.beforeJson === undefined ? undefined : input.beforeJson as object,
      afterJson: input.afterJson === undefined ? undefined : input.afterJson as object,
    },
  });
}
