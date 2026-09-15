import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { MembershipStatus,OrgRole,PlatformRole,Prisma,ProjectRole } from "@prisma/client";

import { asyncHandler } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { requireAdmin } from "../auth/auth.middleware";
import { AppError } from "../../lib/errors";
import { assertOrgWritable,requireOrgAccessForUser,writePlatformAudit } from "../organizations/access";

const router = Router();

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

type OrganizationMembershipProjection = {
  organizationId: string;
  role: OrgRole;
  status: MembershipStatus;
};

type ProjectMembershipProjection = {
  role: ProjectRole;
  status: MembershipStatus;
  project: {
    organizationId: string;
  };
};

type UserProjectionSource = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "TRIAGER";
  platformRole: PlatformRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  orgMemberships: OrganizationMembershipProjection[];
  projectMemberships: Array<ProjectMembershipProjection & {
    projectId: string;
    project: {
      id: string;
      organizationId: string;
      key: string;
      name: string;
    };
  }>;
};

const selfUpdateSchema = z
  .object({
    organizationId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(100).optional(),
    password: z.string().min(8).optional(),
  })
  .strict()
  .refine((body) => body.name !== undefined || body.password !== undefined, {
    message: "A profile change is required.",
  });

function projectCapabilities(role: ProjectRole | undefined, enabled: boolean): ProjectCapabilities {
  if (!enabled || !role) {
    return {
      canManageProject: false,
      canWriteProject: false,
      canTriageProject: false,
      canViewProject: false,
    };
  }

  return {
    canManageProject: role === "PROJECT_ADMIN",
    canWriteProject: role === "PROJECT_ADMIN" || role === "TRIAGER",
    canTriageProject: role === "PROJECT_ADMIN" || role === "TRIAGER",
    canViewProject: true,
  };
}

function accessCapabilities(input: {
  isActive: boolean;
  platformRole: PlatformRole;
  organizationMemberships: OrganizationMembershipProjection[];
  projectMemberships: ProjectMembershipProjection[];
}): AccessCapabilities {
  if (!input.isActive) {
    return {
      ...projectCapabilities(undefined, false),
      canManageOrganization: false,
      canManageTeam: false,
      canInviteMembers: false,
      canManageOwners: false,
      canManagePlatform: false,
    };
  }

  if (input.platformRole === "GLOBAL_ADMIN") {
    return {
      canManageProject: true,
      canWriteProject: true,
      canTriageProject: true,
      canViewProject: true,
      canManageOrganization: true,
      canManageTeam: true,
      canInviteMembers: true,
      canManageOwners: true,
      canManagePlatform: true,
    };
  }

  const activeOrganizationMemberships = input.organizationMemberships.filter((membership) => membership.status === "ACTIVE");
  const activeOrganizationIds = new Set(activeOrganizationMemberships.map((membership) => membership.organizationId));
  const hasOrganizationAdminAccess = activeOrganizationMemberships.some(
    (membership) => membership.role === "OWNER" || membership.role === "ADMIN",
  );
  const hasOwnerAccess = activeOrganizationMemberships.some((membership) => membership.role === "OWNER");
  const activeProjectCapabilities = input.projectMemberships
    .filter((membership) => membership.status === "ACTIVE" && activeOrganizationIds.has(membership.project.organizationId))
    .map((membership) => projectCapabilities(membership.role, true));

  return {
    canManageProject: hasOrganizationAdminAccess || activeProjectCapabilities.some((capability) => capability.canManageProject),
    canWriteProject: hasOrganizationAdminAccess || activeProjectCapabilities.some((capability) => capability.canWriteProject),
    canTriageProject: hasOrganizationAdminAccess || activeProjectCapabilities.some((capability) => capability.canTriageProject),
    canViewProject: hasOrganizationAdminAccess || activeProjectCapabilities.some((capability) => capability.canViewProject),
    canManageOrganization: hasOrganizationAdminAccess,
    canManageTeam: hasOrganizationAdminAccess,
    canInviteMembers: hasOrganizationAdminAccess,
    canManageOwners: hasOwnerAccess,
    canManagePlatform: false,
  };
}

function effectiveAccessScope(input: {
  isActive: boolean;
  platformRole: PlatformRole;
  isOrganizationScoped: boolean;
  organizationMemberships: OrganizationMembershipProjection[];
  projectMemberships: ProjectMembershipProjection[];
}) {
  if (!input.isActive) return "NONE" as const;
  if (input.platformRole === "GLOBAL_ADMIN") return "PLATFORM" as const;

  const activeOrganizationMemberships = input.organizationMemberships.filter((membership) => membership.status === "ACTIVE");
  const activeOrganizationIds = new Set(activeOrganizationMemberships.map((membership) => membership.organizationId));
  if (activeOrganizationMemberships.length === 0) return "NONE" as const;
  if (!input.isOrganizationScoped && activeOrganizationMemberships.length > 1) return "MULTI_ORGANIZATION" as const;
  if (activeOrganizationMemberships.some((membership) => membership.role === "OWNER" || membership.role === "ADMIN")) {
    return "ALL_PROJECTS" as const;
  }
  if (input.projectMemberships.some(
    (membership) => membership.status === "ACTIVE" && activeOrganizationIds.has(membership.project.organizationId),
  )) return "SELECTED_PROJECTS" as const;
  return "NO_PROJECTS" as const;
}

function scopedConsoleRole(membershipRole: "OWNER" | "ADMIN" | "MEMBER") {
  return membershipRole === "OWNER" || membershipRole === "ADMIN" ? "ADMIN" : "TRIAGER";
}

function orgRoleFromConsoleRole(role: "ADMIN" | "TRIAGER") {
  return role === "ADMIN" ? "ADMIN" : "MEMBER";
}

function userAuditState(user: { id: string; email: string; name: string; role: string; isActive: boolean }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
  };
}

function membershipAuditState(membership: { userId: string; organizationId: string; role: string; status: string }) {
  return {
    userId: membership.userId,
    organizationId: membership.organizationId,
    role: membership.role,
    status: membership.status,
  };
}

function projectUser(user: UserProjectionSource, organizationId?: string) {
  const scopedMembership = organizationId ? user.orgMemberships[0] : undefined;
  const projectedProjectMemberships = user.projectMemberships
    .map((membership) => {
      const organizationMembership = user.orgMemberships.find(
        (candidate) => candidate.organizationId === membership.project.organizationId,
      );
      const hasOrganizationWideAccess = user.platformRole === "GLOBAL_ADMIN"
        || (organizationMembership?.status === "ACTIVE"
          && (organizationMembership.role === "OWNER" || organizationMembership.role === "ADMIN"));
      return {
        project: {
          id: membership.project.id,
          key: membership.project.key,
          name: membership.project.name,
        },
        role: membership.role,
        status: membership.status,
        capabilities: hasOrganizationWideAccess
          ? projectCapabilities("PROJECT_ADMIN", user.isActive)
          : projectCapabilities(
              membership.role,
              user.isActive && membership.status === "ACTIVE" && organizationMembership?.status === "ACTIVE",
            ),
      };
    })
    .sort((left, right) => left.project.name.localeCompare(right.project.name) || left.project.key.localeCompare(right.project.key));
  const capabilities = accessCapabilities({
    isActive: user.isActive,
    platformRole: user.platformRole,
    organizationMemberships: user.orgMemberships,
    projectMemberships: user.projectMemberships,
  });
  const scope = effectiveAccessScope({
    isActive: user.isActive,
    platformRole: user.platformRole,
    isOrganizationScoped: Boolean(organizationId),
    organizationMemberships: user.orgMemberships,
    projectMemberships: user.projectMemberships,
  });
  const { projectMemberships: _projectMemberships, ...compatibleUser } = user;
  return {
    ...compatibleUser,
    role: scopedMembership ? scopedConsoleRole(scopedMembership.role) : user.role,
    isActive: scopedMembership ? user.isActive && scopedMembership.status === "ACTIVE" : user.isActive,
    organizationRole: scopedMembership?.role ?? null,
    organizationMembershipStatus: scopedMembership?.status ?? null,
    projectMemberships: projectedProjectMemberships,
    effectiveAccess: {
      scope,
      allProjects: scope === "ALL_PROJECTS" || scope === "PLATFORM",
      assignedProjectCount: projectedProjectMemberships.filter((membership) => membership.status === "ACTIVE").length,
      capabilities,
    },
  };
}

async function updateOwnProfile(input: {
  userId: string;
  actorPlatformRole?: string;
  body: z.infer<typeof selfUpdateSchema>;
}) {
  if (!input.body.organizationId && input.actorPlatformRole !== "GLOBAL_ADMIN") {
    throw new AppError(400, "users.organization_required", "Organization context is required to update your profile.");
  }
  if (input.body.organizationId && input.actorPlatformRole !== "GLOBAL_ADMIN") {
    await requireOrgAccessForUser(input.userId, input.body.organizationId);
  }

  const updateData: Prisma.AdminUserUpdateInput = {};
  if (input.body.name !== undefined) {
    updateData.name = input.body.name;
  }
  if (input.body.password) {
    updateData.passwordHash = await bcrypt.hash(input.body.password, 10);
    updateData.passwordChangedAt = new Date();
  }

  return prisma.$transaction(async (transaction) => {
    const before = await transaction.adminUser.findUniqueOrThrow({
      where: { id: input.userId },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    const updatedUser = await transaction.adminUser.update({
      where: { id: input.userId },
      data: updateData,
      select: { id: true, email: true, name: true, role: true, platformRole: true, isActive: true },
    });

    await writePlatformAudit({
      organizationId: input.body.organizationId,
      actorUserId: input.userId,
      eventType: "users.self_updated",
      beforeJson: {
        ...userAuditState(before),
        passwordChanged: false,
      },
      afterJson: {
        ...userAuditState(updatedUser),
        passwordChanged: Boolean(input.body.password),
      },
    }, transaction);

    return updatedUser;
  });
}

async function assertOwnerMembershipUpdateAllowed(input: {
  actorUserId?: string;
  actorPlatformRole?: string;
  organizationId: string;
  targetUserId: string;
  nextRole?: "ADMIN" | "TRIAGER";
  nextIsActive?: boolean;
  auditReason?: string;
}) {
  const targetMembership = await prisma.orgMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.targetUserId,
      },
    },
  });
  if (!targetMembership) {
    throw new AppError(403, "users.access_denied", "This member does not belong to the selected organization.");
  }

  const nextMembershipRole = input.nextRole ? orgRoleFromConsoleRole(input.nextRole) : targetMembership.role;
  const nextMembershipStatus = input.nextIsActive === undefined ? targetMembership.status : input.nextIsActive ? "ACTIVE" : "DISABLED";
  const removesOwner = targetMembership.role === "OWNER" && (nextMembershipRole !== "OWNER" || nextMembershipStatus !== "ACTIVE");
  if (!removesOwner) {
    return targetMembership;
  }

  if (input.actorPlatformRole !== "GLOBAL_ADMIN") {
    const actorMembership = input.actorUserId
      ? await prisma.orgMembership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: input.organizationId,
              userId: input.actorUserId,
            },
          },
        })
      : null;
    if (actorMembership?.role !== "OWNER" || actorMembership.status !== "ACTIVE") {
      throw new AppError(403, "users.owner_protected", "Only an organization owner can change another owner's access.");
    }
  }

  if (targetMembership.status === "ACTIVE") {
    const activeOwners = await prisma.orgMembership.count({
      where: {
        organizationId: input.organizationId,
        role: "OWNER",
        status: "ACTIVE",
      },
    });
    if (activeOwners <= 1 && input.actorPlatformRole !== "GLOBAL_ADMIN") {
      throw new AppError(409, "users.last_owner_protected", "An organization must keep at least one active owner.");
    }
    if (activeOwners <= 1 && !input.auditReason?.trim()) {
      throw new AppError(400, "users.audit_reason_required", "A global admin audit reason is required to remove the last active owner.");
    }
  }

  return targetMembership;
}

// Retrieve all users
router.get(
  "/",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const actor = request.adminUser!;
    const actorPlatformRole: PlatformRole = actor.platformRole === "GLOBAL_ADMIN" ? "GLOBAL_ADMIN" : "USER";
    const requestedOrganizationId = typeof request.query.organizationId === "string" ? request.query.organizationId.trim() : "";
    const organizationId = requestedOrganizationId || undefined;
    let accessibleOrgIds: string[] | undefined;
    let actorOrganizationMemberships: OrganizationMembershipProjection[] = [];
    if (organizationId && actorPlatformRole !== "GLOBAL_ADMIN") {
      const membership = await requireOrgAccessForUser(actor.id, organizationId, ["OWNER", "ADMIN"]);
      actorOrganizationMemberships = [{ organizationId, role: membership.role, status: membership.status }];
    }
    if (organizationId && actorPlatformRole === "GLOBAL_ADMIN") {
      const membership = await prisma.orgMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: actor.id,
          },
        },
        select: { organizationId: true, role: true, status: true },
      });
      actorOrganizationMemberships = membership ? [membership] : [];
    }
    if (!organizationId && actorPlatformRole !== "GLOBAL_ADMIN") {
      const memberships = await prisma.orgMembership.findMany({
        where: {
          userId: actor.id,
          status: "ACTIVE",
          role: { in: ["OWNER", "ADMIN"] },
        },
        select: { organizationId: true, role: true, status: true },
      });
      accessibleOrgIds = memberships.map((membership) => membership.organizationId);
      actorOrganizationMemberships = memberships;
    }
    const users = await prisma.adminUser.findMany({
      where: organizationId
        ? {
            orgMemberships: {
              some: {
                organizationId,
              },
            },
          }
        : actorPlatformRole === "GLOBAL_ADMIN"
          ? undefined
          : {
              orgMemberships: {
                some: {
                  organizationId: { in: accessibleOrgIds ?? [] },
                },
              },
            },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        platformRole: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        orgMemberships: {
          where: organizationId ? { organizationId } : accessibleOrgIds ? { organizationId: { in: accessibleOrgIds } } : undefined,
          select: { organizationId: true, role: true, status: true },
        },
        projectMemberships: {
          where: organizationId
            ? { project: { organizationId } }
            : accessibleOrgIds
              ? { project: { organizationId: { in: accessibleOrgIds } } }
              : undefined,
          select: {
            projectId: true,
            role: true,
            status: true,
            project: {
              select: {
                id: true,
                organizationId: true,
                key: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    response.json({
      data: users.map((user) => projectUser(user, organizationId)),
      actor: {
        id: actor.id,
        platformRole: actorPlatformRole,
        isGlobalAdmin: actorPlatformRole === "GLOBAL_ADMIN",
        organizationId: organizationId ?? null,
        organizationRole: organizationId ? actorOrganizationMemberships[0]?.role ?? null : null,
        organizationMembershipStatus: organizationId ? actorOrganizationMemberships[0]?.status ?? null : null,
        capabilities: accessCapabilities({
          isActive: true,
          platformRole: actorPlatformRole,
          organizationMemberships: organizationId || actorPlatformRole === "GLOBAL_ADMIN"
            ? actorOrganizationMemberships
            : [],
          projectMemberships: [],
        }),
      },
    });
  })
);

router.get(
  "/me",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const requestedOrganizationId = typeof request.query.organizationId === "string" ? request.query.organizationId.trim() : "";
    const organizationId = requestedOrganizationId || undefined;
    if (!organizationId && request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      throw new AppError(400, "users.organization_required", "Organization context is required to load your profile.");
    }
    if (organizationId && request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireOrgAccessForUser(request.adminUser!.id, organizationId);
    }

    const user = await prisma.adminUser.findUniqueOrThrow({
      where: { id: request.adminUser!.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        platformRole: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        orgMemberships: {
          where: organizationId ? { organizationId } : undefined,
          select: { organizationId: true, role: true, status: true },
        },
        projectMemberships: {
          where: organizationId ? { project: { organizationId } } : undefined,
          select: {
            projectId: true,
            role: true,
            status: true,
            project: {
              select: { id: true, organizationId: true, key: true, name: true },
            },
          },
        },
      },
    });

    response.json({ data: projectUser(user, organizationId) });
  }),
);

router.patch(
  "/me",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const body = selfUpdateSchema.parse(request.body);
    const user = await updateOwnProfile({
      userId: request.adminUser!.id,
      actorPlatformRole: request.adminUser?.platformRole,
      body,
    });
    response.json({
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        isActive: user.isActive,
      },
    });
  }),
);

// Create a new user
router.post(
  "/",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const body = z
      .object({
        email: z.string().email(),
        name: z.string().min(1).max(100),
        role: z.enum(["ADMIN", "TRIAGER"]),
        password: z.string().min(8),
        organizationId: z.string().trim().min(1),
        orgRole: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
      })
      .parse(request.body);
    await assertOrgWritable(body.organizationId);
    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireOrgAccessForUser(request.adminUser!.id, body.organizationId, ["OWNER", "ADMIN"]);
    }

    const existing = await prisma.adminUser.findUnique({
      where: { email: body.email.toLowerCase().trim() },
    });

    if (existing) {
      throw new AppError(400, "users.email_in_use", "A user with this email already exists.");
    }

    const passwordHash = await bcrypt.hash(body.password, 10);

    const user = await prisma.$transaction(async (transaction) => {
      const createdUser = await transaction.adminUser.create({
        data: {
          email: body.email.toLowerCase().trim(),
          name: body.name.trim(),
          role: body.role,
          passwordHash,
          isActive: true,
          orgMemberships: {
            create: {
              organizationId: body.organizationId,
              role: body.orgRole,
            },
          },
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      await writePlatformAudit({
        organizationId: body.organizationId,
        actorUserId: request.adminUser?.id,
        eventType: "users.user_created",
        afterJson: {
          ...userAuditState(createdUser),
          orgRole: body.orgRole,
        },
      }, transaction);

      return createdUser;
    });

    response.status(201).json({ data: user });
  })
);

// Update a user (or soft delete by setting isActive=false)
router.patch(
  "/:id",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const id = request.params.id as string;
    
    // Prevent an admin from disabling or demoting themselves
    if (id === request.adminUser?.id) {
       const body = selfUpdateSchema.parse(request.body);
       const user = await updateOwnProfile({
         userId: id,
         actorPlatformRole: request.adminUser?.platformRole,
         body,
       });
       
       response.json({ data: user });
       return;
    }

    const body = z
      .object({
        organizationId: z.string().trim().min(1).optional(),
        name: z.string().min(1).max(100).optional(),
        role: z.enum(["ADMIN", "TRIAGER"]).optional(),
        isActive: z.boolean().optional(),
        password: z.string().min(8).optional(),
        auditReason: z.string().trim().min(3).max(500).optional(),
      })
      .parse(request.body);

    if (body.organizationId) {
      await assertOrgWritable(body.organizationId);
    }

    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      if (!body.organizationId) {
        throw new AppError(400, "users.organization_required", "Organization context is required to update a member.");
      }
      await requireOrgAccessForUser(request.adminUser!.id, body.organizationId, ["OWNER", "ADMIN"]);
      const targetMembership = await assertOwnerMembershipUpdateAllowed({
        actorUserId: request.adminUser?.id,
        actorPlatformRole: request.adminUser?.platformRole,
        organizationId: body.organizationId,
        targetUserId: id,
        nextRole: body.role,
        nextIsActive: body.isActive,
      });
      if (body.password) {
        throw new AppError(403, "users.password_self_service", "Members must manage their own password.");
      }

      const { membership, user } = await prisma.$transaction(async (transaction) => {
        const updatedMembership = await transaction.orgMembership.update({
          where: {
            organizationId_userId: {
              organizationId: body.organizationId!,
              userId: id,
            },
          },
          data: {
            role: body.role ? orgRoleFromConsoleRole(body.role) : undefined,
            status: body.isActive === undefined ? undefined : body.isActive ? "ACTIVE" : "DISABLED",
          },
        });
        const updatedUser = await transaction.adminUser.findUniqueOrThrow({
          where: { id },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
          },
        });

        await writePlatformAudit({
          organizationId: body.organizationId,
          actorUserId: request.adminUser?.id,
          eventType: "users.membership_updated",
          beforeJson: membershipAuditState(targetMembership),
          afterJson: membershipAuditState(updatedMembership),
        }, transaction);

        return {
          membership: updatedMembership,
          user: updatedUser,
        };
      });

      response.json({
        data: {
          ...user,
          role: scopedConsoleRole(membership.role),
          isActive: user.isActive && membership.status === "ACTIVE",
        },
      });
      return;
    }

    if (body.organizationId) {
      const targetMembership = await assertOwnerMembershipUpdateAllowed({
        actorUserId: request.adminUser?.id,
        actorPlatformRole: request.adminUser?.platformRole,
        organizationId: body.organizationId,
        targetUserId: id,
        nextRole: body.role,
        nextIsActive: body.isActive,
        auditReason: body.auditReason,
      });
      if (body.password) {
        throw new AppError(403, "users.password_self_service", "Members must manage their own password.");
      }

      const { membership, user } = await prisma.$transaction(async (transaction) => {
        const updatedMembership = await transaction.orgMembership.update({
          where: {
            organizationId_userId: {
              organizationId: body.organizationId!,
              userId: id,
            },
          },
          data: {
            role: body.role ? orgRoleFromConsoleRole(body.role) : undefined,
            status: body.isActive === undefined ? undefined : body.isActive ? "ACTIVE" : "DISABLED",
          },
        });
        const updatedUser = await transaction.adminUser.findUniqueOrThrow({
          where: { id },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
          },
        });

        await writePlatformAudit({
          organizationId: body.organizationId,
          actorUserId: request.adminUser?.id,
          eventType: "users.membership_updated",
          beforeJson: membershipAuditState(targetMembership),
          afterJson: {
            ...membershipAuditState(updatedMembership),
            auditReason: body.auditReason,
          },
        }, transaction);

        return {
          membership: updatedMembership,
          user: updatedUser,
        };
      });

      response.json({
        data: {
          ...user,
          role: scopedConsoleRole(membership.role),
          isActive: user.isActive && membership.status === "ACTIVE",
        },
      });
      return;
    }

    const updateData: Prisma.AdminUserUpdateInput = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.role !== undefined) updateData.role = body.role;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    if (body.password) {
      updateData.passwordHash = await bcrypt.hash(body.password, 10);
      updateData.passwordChangedAt = new Date();
    }

    const user = await prisma.$transaction(async (transaction) => {
      const before = await transaction.adminUser.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
        },
      });

      const updatedUser = await transaction.adminUser.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
        },
      });

      await writePlatformAudit({
        actorUserId: request.adminUser?.id,
        eventType: "users.user_updated",
        beforeJson: {
          ...userAuditState(before),
          passwordChanged: false,
        },
        afterJson: {
          ...userAuditState(updatedUser),
          passwordChanged: Boolean(body.password),
        },
      }, transaction);

      return updatedUser;
    });

    response.json({ data: user });
  })
);

export { router as usersRouter };
