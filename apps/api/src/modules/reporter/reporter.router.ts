import crypto from "node:crypto";

import { AuditActorType,Prisma } from "@prisma/client";
import { Router } from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import { z } from "zod";

import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { asyncHandler,getSingleParam } from "../../lib/http";
import { prisma } from "../../lib/prisma";

import { notifyReporterOtp } from "../email/notifications";
import { feedbackAuditService } from "../feedback/feedback-audit.service";
import { feedbackNotificationService } from "../feedback/feedback-notification.service";
import { feedbackService } from "../feedback/feedback.service";

import { assertOrgWritable,writePlatformAudit } from "../organizations/access";
import {
createDsarDeletionRequest,
createDsarExportRequest,
getDsarDeletionRequests,
getDsarExportArtifactContent,
getDsarExportRequests,
getReporterDsarSubjectExport,
publicDsarDeletionRequest,
publicDsarExportRequest,
} from "../organizations/dsar.service";

import { readReporterBridgeToken } from "./reporter.bridge";
import {
consumeReporterOtp,
createReporterOtp,
REPORTER_OTP_RESEND_COOLDOWN_MS,
REPORTER_OTP_TTL_MS,
} from "./reporter.otp";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_BYTES,
  },
});

type ReporterPayload = {
  email: string;
  scope: "reporter";
  organizationId: string;
  projectId?: string;
  feedbackId?: string;
};

type ReporterScopePayload = {
  email: string;
  scope: "reporter_scope";
};

const REPORTER_JWT_ISSUER = "tracegenie-api";
const REPORTER_JWT_AUDIENCE = "tracegenie-reporter";
const REPORTER_OTP_REQUEST_MINIMUM_MS = 400;

const reporterCommentSchema = z.object({
  body: z.string().trim().min(1).max(3000),
  clientRequestId: z.string().trim().min(24).max(100)
    .refine((value) => value.startsWith("reporter-comment:"), "Comment request ID is invalid."),
});

const reporterNotificationSchema = z.object({
  enabled: z.boolean(),
  clientRequestId: z.string().trim().min(24).max(100)
    .refine((value) => value.startsWith("reporter-follow:"), "Notification request ID is invalid."),
});

const reporterAttachmentRequestIdSchema = z.string().trim().min(24).max(100)
  .refine((value) => value.startsWith("reporter-attachment:"), "Attachment request ID is invalid.");

function publicReporterDsarDeletionRequest(request: ReturnType<typeof publicDsarDeletionRequest>) {
  return {
    id: request.id,
    status: request.status,
    requestedAt: request.requestedAt,
    resolvedAt: request.resolvedAt,
  };
}

function publicReporterDsarExportRequest(request: ReturnType<typeof publicDsarExportRequest>) {
  return {
    id: request.id,
    status: request.status,
    requestedAt: request.requestedAt,
    completedAt: request.completedAt,
    failedAt: request.failedAt,
    expiresAt: request.expiresAt,
    downloadStatus: request.downloadStatus,
    failure: request.failure,
  };
}

function reporterResolutionSchema(action: "confirm" | "reopen") {
  return z.object({
    body: z.string().trim().min(1).max(3000).optional(),
    clientRequestId: z.string().trim().min(24).max(100)
      .refine((value) => value.startsWith(`reporter-${action}:`), "Resolution request ID does not match this action."),
  });
}

async function findReporterResolutionReplay(
  feedbackItemId: string,
  clientRequestId: string,
  commentBody: string,
  eventType: "REPORTER_CONFIRMED_FIXED" | "REPORTER_MARKED_STILL_HAPPENING",
) {
  const existing = await prisma.feedbackComment.findUnique({
    where: { feedbackItemId_clientRequestId: { feedbackItemId, clientRequestId } },
    select: { body: true, visibility: true },
  });
  if (!existing) return null;
  if (existing.body !== commentBody || existing.visibility !== "PUBLIC") {
    throw new AppError(409, "reporter.resolution_idempotency_conflict", "That response request ID was already used for different content.");
  }
  const audit = await prisma.feedbackAuditEvent.findFirst({
    where: { feedbackItemId, eventType, idempotencyKey: clientRequestId },
    select: { beforeJson: true, afterJson: true },
  });
  const before = audit?.beforeJson && typeof audit.beforeJson === "object" && !Array.isArray(audit.beforeJson)
    ? audit.beforeJson as Record<string, unknown>
    : null;
  const after = audit?.afterJson && typeof audit.afterJson === "object" && !Array.isArray(audit.afterJson)
    ? audit.afterJson as Record<string, unknown>
    : null;
  if (typeof after?.commentId !== "string" || typeof after.statusHistoryId !== "string" || typeof before?.status !== "string") {
    throw new AppError(409, "reporter.resolution_replay_incomplete", "The prior response is still being finalized. Retry shortly.");
  }
  return {
    commentId: after.commentId,
    statusHistoryId: after.statusHistoryId,
    fromStatus: before.status,
  };
}

async function waitForReporterResolutionReplay(
  feedbackItemId: string,
  clientRequestId: string,
  commentBody: string,
  eventType: "REPORTER_CONFIRMED_FIXED" | "REPORTER_MARKED_STILL_HAPPENING",
) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      const replay = await findReporterResolutionReplay(feedbackItemId, clientRequestId, commentBody, eventType);
      if (replay) return replay;
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "reporter.resolution_replay_incomplete") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

async function ensureReporterReopenSideEffects(input: {
  feedbackItemId: string;
  commentBody: string;
  commentId: string;
  statusHistoryId: string;
  fromStatus: string;
  requestId: string | null;
}) {
  
  try {
    await feedbackNotificationService.sendReopenNotification({
      feedbackItemId: input.feedbackItemId,
      publicSummary: input.commentBody,
      dedupeKey: `reporter-reopen:${input.feedbackItemId}:${input.commentId}`,
      requestId: input.requestId,
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
  }
  
  
}

async function ensureReporterConfirmSideEffects(input: {
  feedbackItemId: string;
  commentId: string;
  statusHistoryId: string;
  fromStatus: string;
  commentBody: string;
}) {
  
  
  
}

function makeOtp() {
  return String(crypto.randomInt(100000, 999999));
}

function getReporterSession(authorization?: string) {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
  if (!token) {
    throw new AppError(401, "reporter.missing_token", "Reporter authentication is required.");
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: REPORTER_JWT_ISSUER,
      audience: REPORTER_JWT_AUDIENCE,
    }) as ReporterPayload;
    if (payload.scope !== "reporter") {
      throw new AppError(401, "reporter.invalid_token", "Reporter session is invalid.");
    }
    return {
      email: payload.email.toLowerCase(),
      organizationId: payload.organizationId,
      projectId: payload.projectId,
      feedbackId: payload.feedbackId,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(401, "reporter.invalid_token", "Reporter session is invalid.", error);
  }
}

function assertReporterAccountSession(session: ReturnType<typeof getReporterSession>) {
  if (session.feedbackId || session.projectId) {
    throw new AppError(403, "reporter.account_session_required", "Sign in from the reporter portal to manage all reporter data.");
  }
}

function getReporterScopeSession(token: string) {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: REPORTER_JWT_ISSUER,
      audience: REPORTER_JWT_AUDIENCE,
    }) as ReporterScopePayload;
    if (payload.scope !== "reporter_scope") {
      throw new AppError(401, "reporter.invalid_scope_token", "Reporter scope selection is invalid.");
    }
    return {
      email: payload.email.toLowerCase(),
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(401, "reporter.invalid_scope_token", "Reporter scope selection is invalid.", error);
  }
}

function formatReporterTicket(ticket: Awaited<ReturnType<typeof findReporterTicket>>) {
  if (!ticket) {
    return null;
  }

  const latestReporterResolution = [...ticket.statusHistory].reverse().find((entry) =>
    entry.note === "Reporter confirmed this is fixed."
    || entry.note === "Reporter marked this as still happening.",
  );
  const resolutionFeedback = ticket.status === "FIXED"
    ? { state: "awaiting_confirmation" as const, respondedAt: null }
    : latestReporterResolution?.note === "Reporter confirmed this is fixed." && ticket.status === "CLOSED"
      ? { state: "confirmed_fixed" as const, respondedAt: latestReporterResolution.createdAt }
      : latestReporterResolution?.note === "Reporter marked this as still happening." && ticket.status === "IN_PROGRESS"
        ? { state: "still_happening" as const, respondedAt: latestReporterResolution.createdAt }
        : ticket.status === "CLOSED"
          ? { state: "closed" as const, respondedAt: null }
          : null;

  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status.toLowerCase(),
    severity: ticket.severity.toLowerCase(),
    issueType: ticket.issueType.toLowerCase(),
    isOverageLocked: ticket.isOverageLocked,
    requesterNotificationsEnabled: ticket.requesterNotificationsEnabled,
    resolutionFeedback,
    project: {
      organizationId: ticket.organizationId,
      organizationName: ticket.organization.name,
      key: ticket.project.key,
      name: ticket.project.name,
    },
    comments: [...ticket.comments].reverse().map((comment) => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt,
      // Do not guess the author of legacy or imported comments with no actor.
      author: comment.authorId ? "team" : /^reporter-(comment|confirm|reopen):/.test(comment.clientRequestId ?? "") ? "reporter" : "unknown",
    })),
    attachments: ticket.attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind.toLowerCase(),
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
      expiresAt: attachment.expiresAt,
      downloadStatus: attachment.expiresAt && attachment.expiresAt.getTime() <= Date.now() ? "expired" : "ready",
      createdAt: attachment.createdAt,
    })),
    statusHistory: [...ticket.statusHistory].reverse().map((entry) => ({
      id: entry.id,
      fromStatus: entry.fromStatus?.toLowerCase() ?? null,
      toStatus: entry.toStatus.toLowerCase(),
      createdAt: entry.createdAt,
    })),
    notificationHistory: ticket.notifications.map((notification) => ({
      id: notification.id,
      eventType: notification.eventType.toLowerCase(),
      status: notification.status.toLowerCase(),
      triggerStatus: notification.triggerStatus?.toLowerCase() ?? null,
      subject: notification.subjectSnapshot,
      skipReason: notification.skipReason,
      createdAt: notification.createdAt,
      sentAt: notification.sentAt,
    })),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

async function getReporterPrivacyRequests(session: ReturnType<typeof getReporterSession>) {
  assertReporterAccountSession(session);
  const subject = await getReporterDsarSubjectExport(session.organizationId, session.email);
  const [exports, deletions] = await Promise.all([
    getDsarExportRequests(session.organizationId),
    getDsarDeletionRequests(session.organizationId),
  ]);
  return {
    exports: exports
      .filter((request) => request.subjectEmailHash === subject.subject.emailHash && request.source === "reporter")
      .map((request) => publicReporterDsarExportRequest(publicDsarExportRequest(request))),
    deletions: deletions
      .filter((request) => request.subjectEmailHash === subject.subject.emailHash && request.source === "reporter")
      .map((request) => publicReporterDsarDeletionRequest(publicDsarDeletionRequest(request))),
  };
}

async function findReporterTicket(
  session: {
    email: string;
    organizationId: string;
    projectId?: string;
    feedbackId?: string;
  },
  feedbackId: string,
) {
  return prisma.feedbackItem.findFirst({
    where: {
      id: feedbackId,
      reporterEmail: session.email,
      organizationId: session.organizationId,
      ...(session.projectId ? { projectId: session.projectId } : {}),
      ...(session.feedbackId ? { id: session.feedbackId } : {}),
    },
    include: {
      organization: true,
      project: true,
      comments: {
        where: { visibility: "PUBLIC" },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      attachments: {
        where: { visibility: "PUBLIC" },
        orderBy: { createdAt: "desc" },
        take: 25,
      },
      statusHistory: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      notifications: {
        where: {
          recipientType: "REQUESTER",
          recipientEmail: session.email,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
}

async function resolveReporterBridge(token: string) {
  const bridge = readReporterBridgeToken(token);
  const ticket = await prisma.feedbackItem.findFirst({
    where: {
      id: bridge.feedbackId,
      organizationId: bridge.organizationId,
      projectId: bridge.projectId,
      reporterEmail: { not: null },
    },
    select: {
      id: true,
      ticketNumber: true,
      reporterEmail: true,
      organizationId: true,
      projectId: true,
      organization: { select: { name: true } },
      project: { select: { name: true } },
    },
  });
  const reporterEmail = ticket?.reporterEmail;
  if (!ticket || !reporterEmail) {
    throw new AppError(404, "reporter.bridge_not_found", "This report link is no longer available.");
  }
  return { bridge, ticket: { ...ticket, reporterEmail } };
}

router.post(
  "/bridge/resolve",
  asyncHandler(async (request, response) => {
    const body = z.object({ bridgeToken: z.string().min(24).max(2000) }).parse(request.body);
    const { ticket } = await resolveReporterBridge(body.bridgeToken);
    response.setHeader("Cache-Control", "no-store");
    response.json({
      bridge: {
        ticketNumber: ticket.ticketNumber,
        organizationName: ticket.organization.name,
        projectName: ticket.project.name,
      },
    });
  }),
);

async function getReporterScopes(email: string) {
  const tickets = await prisma.feedbackItem.findMany({
    where: { reporterEmail: email },
    select: {
      organizationId: true,
      projectId: true,
      organization: { select: { id: true, name: true } },
      project: { select: { id: true, key: true, name: true } },
    },
    distinct: ["organizationId", "projectId"],
    orderBy: { createdAt: "desc" },
  });

  const scopes = new Map<string, {
    organizationId: string;
    organizationName: string;
    projects: Array<{ projectId: string; projectKey: string; projectName: string }>;
  }>();

  for (const ticket of tickets) {
    const scope = scopes.get(ticket.organizationId) ?? {
      organizationId: ticket.organizationId,
      organizationName: ticket.organization.name,
      projects: [],
    };
    if (!scope.projects.some((project) => project.projectId === ticket.projectId)) {
      scope.projects.push({
        projectId: ticket.projectId,
        projectKey: ticket.project.key,
        projectName: ticket.project.name,
      });
    }
    scopes.set(ticket.organizationId, scope);
  }

  return [...scopes.values()];
}

router.post(
  "/otp/request",
  asyncHandler(async (request, response) => {
    const requestStartedAt = Date.now();
    const body = z
      .object({
        email: z.string().email(),
        organizationId: z.string().optional(),
        projectId: z.string().optional(),
        bridgeToken: z.string().min(24).max(2000).optional(),
      })
      .parse(request.body);
    const email = body.email.toLowerCase().trim();
    const bridged = body.bridgeToken ? await resolveReporterBridge(body.bridgeToken) : null;
    const exists = bridged
      ? bridged.ticket.reporterEmail.toLowerCase() === email ? bridged.ticket : null
      : await prisma.feedbackItem.findFirst({
        where: {
          reporterEmail: email,
          ...(body.organizationId ? { organizationId: body.organizationId } : {}),
          ...(body.projectId ? { projectId: body.projectId } : {}),
        },
        select: { id: true, organizationId: true, projectId: true },
        orderBy: { createdAt: "desc" },
      });

    if (exists) {
      const code = makeOtp();
      const otp = await createReporterOtp(email, code);
      if (otp.created) {
        const emailDelivery = await notifyReporterOtp({ to: email, code });
        await writePlatformAudit({
          organizationId: exists.organizationId,
          eventType: "reporter.otp_requested",
          afterJson: {
            email,
            projectId: exists.projectId,
            otpId: otp.otp.id,
            emailDelivery,
          },
        });
      }
    }

    const remainingDelay = REPORTER_OTP_REQUEST_MINIMUM_MS - (Date.now() - requestStartedAt);
    if (remainingDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, remainingDelay));
    }

    response.setHeader("Cache-Control", "no-store");
    response.json({
      ok: true,
      retryAfterSeconds: REPORTER_OTP_RESEND_COOLDOWN_MS / 1000,
      expiresInSeconds: REPORTER_OTP_TTL_MS / 1000,
    });
  }),
);

router.post(
  "/otp/verify",
  asyncHandler(async (request, response) => {
    const body = z
      .object({
        email: z.string().email(),
        code: z.string().trim().regex(/^\d{6}$/).optional(),
        scopeToken: z.string().min(16).optional(),
        organizationId: z.string().optional(),
        projectId: z.string().optional(),
        bridgeToken: z.string().min(24).max(2000).optional(),
      })
      .refine((value) => value.code || value.scopeToken, {
        message: "An access code or scope token is required.",
      })
      .parse(request.body);
    const email = body.email.toLowerCase().trim();
    const bridged = body.bridgeToken ? await resolveReporterBridge(body.bridgeToken) : null;
    if (bridged && bridged.ticket.reporterEmail.toLowerCase() !== email) {
      throw new AppError(403, "reporter.bridge_unauthorized", "That email cannot access this report.");
    }

    if (body.scopeToken) {
      const scopeSession = getReporterScopeSession(body.scopeToken);
      if (scopeSession.email !== email) {
        throw new AppError(401, "reporter.invalid_scope_token", "Reporter scope selection is invalid.");
      }
    } else {
      const consumed = await consumeReporterOtp(email, body.code!);
      if (!consumed) {
        throw new AppError(401, "reporter.invalid_otp", "The code is invalid or expired.");
      }
    }

    const scopes = await getReporterScopes(email);
    const selectedOrganizationId = bridged?.ticket.organizationId ?? body.organizationId ?? (scopes.length === 1 ? scopes[0]?.organizationId : undefined);
    const selectedScope = selectedOrganizationId ? scopes.find((scope) => scope.organizationId === selectedOrganizationId) : undefined;
    if (!selectedScope) {
      const scopeToken = jwt.sign(
        {
          email,
          scope: "reporter_scope",
        } satisfies ReporterScopePayload,
        env.JWT_SECRET,
        {
          expiresIn: "5m",
          issuer: REPORTER_JWT_ISSUER,
          audience: REPORTER_JWT_AUDIENCE,
        },
      );
      throw new AppError(409, "reporter.scope_required", "Choose an organization before viewing reports.", { scopes, scopeToken });
    }
    const selectedProjectId = bridged?.ticket.projectId ?? body.projectId;
    if (selectedProjectId && !selectedScope.projects.some((project) => project.projectId === selectedProjectId)) {
      throw new AppError(404, "reporter.scope_not_found", "Reporter scope not found.");
    }

    const token = jwt.sign(
      {
        email,
        scope: "reporter",
        organizationId: selectedScope.organizationId,
        projectId: selectedProjectId,
        feedbackId: bridged?.ticket.id,
      } satisfies ReporterPayload,
      env.JWT_SECRET,
      {
        expiresIn: "12h",
        issuer: REPORTER_JWT_ISSUER,
        audience: REPORTER_JWT_AUDIENCE,
      },
    );
    await writePlatformAudit({
      organizationId: selectedScope.organizationId,
      eventType: "reporter.portal_access_granted",
      afterJson: {
        email,
        authMethod: body.scopeToken ? "scope_token" : "otp_code",
        projectId: selectedProjectId ?? null,
        bridgedTicketId: bridged?.ticket.id ?? null,
        accessibleProjectCount: selectedScope.projects.length,
      },
    });
    response.json({ token });
  }),
);

router.get(
  "/dsar.json",
  asyncHandler(async (request, response) => {
    const session = getReporterSession(request.header("authorization"));
    assertReporterAccountSession(session);
    const payload = await getReporterDsarSubjectExport(session.organizationId, session.email);

    await writePlatformAudit({
      organizationId: session.organizationId,
      eventType: "reporter.dsar_subject_exported",
      afterJson: {
        subjectEmailHash: payload.subject.emailHash,
        counts: payload.counts,
        projectId: session.projectId ?? null,
      },
    });

    response.setHeader("Content-Disposition", `attachment; filename="tracegenie-dsar-${payload.subject.emailHash.slice(0, 12)}.json"`);
    response.json(payload);
  }),
);

router.get(
  "/dsar/requests",
  asyncHandler(async (request, response) => {
    const session = getReporterSession(request.header("authorization"));
    response.setHeader("Cache-Control", "no-store");
    response.json(await getReporterPrivacyRequests(session));
  }),
);

router.post(
  "/dsar/export-requests",
  asyncHandler(async (request, response) => {
    const session = getReporterSession(request.header("authorization"));
    const current = await getReporterPrivacyRequests(session);
    const existing = current.exports.find((item) => item.status === "queued" || item.status === "processing");
    if (existing) {
      response.json({ request: existing });
      return;
    }
    const created = await createDsarExportRequest({
      organizationId: session.organizationId,
      email: session.email,
      reason: "Reporter requested a scoped data export from the reporter portal.",
      source: "reporter",
    });
    response.status(201).json({ request: publicReporterDsarExportRequest(publicDsarExportRequest(created)) });
  }),
);

router.get(
  "/dsar/export-requests/:requestId/download",
  asyncHandler(async (request, response) => {
    const session = getReporterSession(request.header("authorization"));
    const requestId = getSingleParam(request.params.requestId);
    const current = await getReporterPrivacyRequests(session);
    if (!current.exports.some((item) => item.id === requestId)) {
      throw new AppError(404, "dsar.export_not_found", "Data export was not found.");
    }
    const content = await getDsarExportArtifactContent({ organizationId: session.organizationId, requestId });
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", content.artifact.mimeType);
    response.setHeader("Content-Length", String(content.artifact.byteSize));
    response.setHeader("Content-Disposition", `attachment; filename="${content.artifact.fileName.replace(/"/g, "")}"`);
    response.send(content.buffer);
  }),
);

router.post(
  "/dsar/deletion-requests",
  asyncHandler(async (request, response) => {
    const session = getReporterSession(request.header("authorization"));
    const current = await getReporterPrivacyRequests(session);
    const existing = current.deletions.find((item) => item.status === "pending");
    if (existing) {
      response.json({ request: existing });
      return;
    }
    const created = await createDsarDeletionRequest({
      organizationId: session.organizationId,
      email: session.email,
      reason: "Reporter requested deletion from the reporter portal.",
      source: "reporter",
    });

    response.status(201).json({ request: publicReporterDsarDeletionRequest(publicDsarDeletionRequest(created)) });
  }),
);

router.delete(
  "/dsar",
  asyncHandler(async (request, response) => {
    const session = getReporterSession(request.header("authorization"));
    assertReporterAccountSession(session);
    throw new AppError(403, "reporter.dsar_admin_approval_required", "Deletion requests require administrator approval.");
  }),
);

router.get(
  "/tickets",
  asyncHandler(async (request, response) => {
    const session = getReporterSession(request.header("authorization"));
    const query = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
    }).parse(request.query);
    const where = {
      reporterEmail: session.email,
      organizationId: session.organizationId,
      ...(session.projectId ? { projectId: session.projectId } : {}),
      ...(session.feedbackId ? { id: session.feedbackId } : {}),
    };
    const total = await prisma.feedbackItem.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, pageCount);
    const tickets = await prisma.feedbackItem.findMany({
        where,
        include: {
          organization: true,
          project: true,
          comments: {
            where: { visibility: "PUBLIC" },
            orderBy: { createdAt: "desc" },
            take: 50,
          },
          attachments: {
            where: { visibility: "PUBLIC" },
            orderBy: { createdAt: "desc" },
            take: 25,
          },
          statusHistory: {
            orderBy: { createdAt: "desc" },
            take: 50,
          },
          notifications: {
            where: {
              recipientType: "REQUESTER",
              recipientEmail: session.email,
            },
            orderBy: { createdAt: "desc" },
            take: 20,
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * query.pageSize,
        take: query.pageSize,
      });

    response.json({
      tickets: tickets.map((ticket) => formatReporterTicket(ticket)),
      pagination: {
        page,
        pageSize: query.pageSize,
        pageCount,
        total,
        hasPreviousPage: page > 1,
        hasNextPage: page < pageCount,
      },
    });
  }),
);

router.get(
  "/tickets/:feedbackId",
  asyncHandler(async (request, response) => {
    const session = getReporterSession(request.header("authorization"));
    const ticket = await findReporterTicket(session, getSingleParam(request.params.feedbackId));
    if (!ticket) {
      throw new AppError(404, "reporter.ticket_not_found", "Ticket not found.");
    }
    response.json({ ticket: formatReporterTicket(ticket) });
  }),
);

router.post(
  "/tickets/:feedbackId/comments",
  asyncHandler(async (request, response) => {
    const session = getReporterSession(request.header("authorization"));
    const body = reporterCommentSchema.parse(request.body);
    const ticket = await findReporterTicket(session, getSingleParam(request.params.feedbackId));
    if (!ticket) {
      throw new AppError(404, "reporter.ticket_not_found", "Ticket not found.");
    }
    
    await assertOrgWritable(ticket.organizationId);

    const replay = await prisma.feedbackComment.findUnique({
      where: { feedbackItemId_clientRequestId: { feedbackItemId: ticket.id, clientRequestId: body.clientRequestId } },
    });
    if (replay && (replay.body !== body.body || replay.visibility !== "PUBLIC")) {
      throw new AppError(409, "reporter.comment_idempotency_conflict", "That update request was already used for different content.");
    }
    let comment = replay;
    if (!comment) {
      try {
        comment = await prisma.feedbackComment.create({
          data: {
            feedbackItemId: ticket.id,
            body: body.body,
            visibility: "PUBLIC",
            clientRequestId: body.clientRequestId,
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
        comment = await prisma.feedbackComment.findUnique({
          where: { feedbackItemId_clientRequestId: { feedbackItemId: ticket.id, clientRequestId: body.clientRequestId } },
        });
        if (!comment || comment.body !== body.body || comment.visibility !== "PUBLIC") {
          throw new AppError(409, "reporter.comment_idempotency_conflict", "That update request was already used for different content.");
        }
      }
    }

    response.status(201).json({
      comment: {
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
      },
    });
  }),
);

router.patch(
  "/tickets/:feedbackId/notifications",
  asyncHandler(async (request, response) => {
    const session = getReporterSession(request.header("authorization"));
    const body = reporterNotificationSchema.parse(request.body);
    const ticket = await findReporterTicket(session, getSingleParam(request.params.feedbackId));
    if (!ticket) {
      throw new AppError(404, "reporter.ticket_not_found", "Ticket not found.");
    }

    let prior = await prisma.feedbackAuditEvent.findFirst({
      where: {
        feedbackItemId: ticket.id,
        eventType: "REQUESTER_NOTIFICATIONS_UPDATED",
        idempotencyKey: body.clientRequestId,
      },
      select: { afterJson: true },
    });
    const priorAfter = prior?.afterJson && typeof prior.afterJson === "object" && !Array.isArray(prior.afterJson)
      ? prior.afterJson as Record<string, unknown>
      : null;
    if (priorAfter && priorAfter.enabled !== body.enabled) {
      throw new AppError(409, "reporter.follow_idempotency_conflict", "That follow request was already used for a different preference.");
    }
    if (!prior) {
      try {
        prior = await prisma.$transaction(async (tx) => {
          // Lock the ticket before deciding whether this retry already completed.
          await tx.feedbackItem.update({
            where: { id: ticket.id },
            data: { updatedAt: new Date() },
          });
          const lockedPrior = await tx.feedbackAuditEvent.findFirst({
            where: {
              feedbackItemId: ticket.id,
              eventType: "REQUESTER_NOTIFICATIONS_UPDATED",
              idempotencyKey: body.clientRequestId,
            },
            select: { afterJson: true },
          });
          if (lockedPrior) return lockedPrior;
          await tx.feedbackItem.update({
            where: { id: ticket.id },
            data: { requesterNotificationsEnabled: body.enabled },
          });
          await feedbackAuditService.createEvent({
            feedbackItemId: ticket.id,
            projectId: ticket.projectId,
            actorType: AuditActorType.SYSTEM,
            eventType: "REQUESTER_NOTIFICATIONS_UPDATED",
            beforeJson: {
              enabled: ticket.requesterNotificationsEnabled,
            },
            afterJson: {
              enabled: body.enabled,
              reporterEmail: session.email,
            },
            requestId: request.header("x-request-id") ?? null,
            idempotencyKey: body.clientRequestId,
          }, tx);
          return null;
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
        prior = await prisma.feedbackAuditEvent.findFirst({
          where: {
            feedbackItemId: ticket.id,
            eventType: "REQUESTER_NOTIFICATIONS_UPDATED",
            idempotencyKey: body.clientRequestId,
          },
          select: { afterJson: true },
        });
        const replayAfter = prior?.afterJson && typeof prior.afterJson === "object" && !Array.isArray(prior.afterJson)
          ? prior.afterJson as Record<string, unknown>
          : null;
        if (!replayAfter || replayAfter.enabled !== body.enabled) {
          throw new AppError(409, "reporter.follow_idempotency_conflict", "That follow request was already used for a different preference.");
        }
      }
    }
    const replayAfter = prior?.afterJson && typeof prior.afterJson === "object" && !Array.isArray(prior.afterJson)
      ? prior.afterJson as Record<string, unknown>
      : null;
    if (replayAfter && replayAfter.enabled !== body.enabled) {
      throw new AppError(409, "reporter.follow_idempotency_conflict", "That follow request was already used for a different preference.");
    }

    const updatedTicket = await findReporterTicket(session, ticket.id);
    response.json({ ticket: formatReporterTicket(updatedTicket) });
  }),
);

router.post(
  "/tickets/:feedbackId/attachments",
  upload.single("file"),
  asyncHandler(async (request, response) => {
    const session = getReporterSession(request.header("authorization"));
    const ticket = await findReporterTicket(session, getSingleParam(request.params.feedbackId));
    if (!ticket) {
      throw new AppError(404, "reporter.ticket_not_found", "Ticket not found.");
    }

    const clientRequestId = reporterAttachmentRequestIdSchema.parse(request.body?.clientRequestId);
    const attachment = await feedbackService.addReporterAttachment(ticket.id, request.file!, request.ip, clientRequestId);
    response.status(201).json({ attachment });
  }),
);

router.get(
  "/tickets/:feedbackId/attachments/:attachmentId/download",
  asyncHandler(async (request, response) => {
    const session = getReporterSession(request.header("authorization"));
    const ticket = await findReporterTicket(session, getSingleParam(request.params.feedbackId));
    if (!ticket) {
      throw new AppError(404, "reporter.ticket_not_found", "Ticket not found.");
    }
    const attachmentId = getSingleParam(request.params.attachmentId);
    const attachment = ticket.attachments.find((item) => item.id === attachmentId);
    if (!attachment) {
      throw new AppError(404, "uploads.not_found", "Attachment was not found.");
    }
    if (attachment.expiresAt && attachment.expiresAt.getTime() <= Date.now()) {
      throw new AppError(410, "uploads.expired", "This attachment has expired under the product retention policy.");
    }
    const content = await feedbackService.getAttachmentContent(attachment.id, [ticket.projectId]);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", content.mimeType);
    response.setHeader("Content-Length", String(content.byteSize));
    response.setHeader("Content-Disposition", `attachment; filename="${content.fileName.replace(/"/g, "")}"`);
    response.send(content.buffer);
  }),
);

router.post(
  "/tickets/:feedbackId/still-happening",
  asyncHandler(async (request, response) => {
    const session = getReporterSession(request.header("authorization"));
    const body = reporterResolutionSchema("reopen").parse(request.body ?? {});
    const ticket = await findReporterTicket(session, getSingleParam(request.params.feedbackId));
    if (!ticket) {
      throw new AppError(404, "reporter.ticket_not_found", "Ticket not found.");
    }
    
    const commentBody = body.body ?? "Reporter marked this as still happening.";
    const existingReplay = await findReporterResolutionReplay(
      ticket.id,
      body.clientRequestId,
      commentBody,
      "REPORTER_MARKED_STILL_HAPPENING",
    );
    if (existingReplay) {
      await ensureReporterReopenSideEffects({
        feedbackItemId: ticket.id,
        commentBody,
        commentId: existingReplay.commentId,
        statusHistoryId: existingReplay.statusHistoryId,
        fromStatus: existingReplay.fromStatus,
        requestId: request.header("x-request-id") ?? null,
      });
      const updatedTicket = await findReporterTicket(session, ticket.id);
      response.json({ ticket: formatReporterTicket(updatedTicket) });
      return;
    }
    
    if (ticket.status !== "FIXED" && ticket.status !== "CLOSED") {
      const replay = await waitForReporterResolutionReplay(
        ticket.id,
        body.clientRequestId,
        commentBody,
        "REPORTER_MARKED_STILL_HAPPENING",
      );
      if (replay) {
        await ensureReporterReopenSideEffects({
          feedbackItemId: ticket.id,
          commentBody,
          commentId: replay.commentId,
          statusHistoryId: replay.statusHistoryId,
          fromStatus: replay.fromStatus,
          requestId: request.header("x-request-id") ?? null,
        });
        const updatedTicket = await findReporterTicket(session, ticket.id);
        response.json({ ticket: formatReporterTicket(updatedTicket) });
        return;
      }
      throw new AppError(409, "reporter.ticket_not_resolved", "Only fixed or closed reports can be marked still happening.");
    }
    await assertOrgWritable(ticket.organizationId);

    let result: { commentId: string; statusHistoryId: string; fromStatus: string };
    try {
      result = await prisma.$transaction(async (tx) => {
        const statusClaim = await tx.feedbackItem.updateMany({
          where: { id: ticket.id, status: ticket.status },
          data: { status: "IN_PROGRESS" },
        });
        if (statusClaim.count !== 1) {
          throw new AppError(409, "reporter.ticket_resolution_changed", "This report changed before your response was saved. Reload and try again.");
        }
        const statusHistory = await tx.feedbackStatusHistory.create({
          data: {
            feedbackItemId: ticket.id,
            fromStatus: ticket.status,
            toStatus: "IN_PROGRESS",
            note: "Reporter marked this as still happening.",
          },
        });
        const comment = await tx.feedbackComment.create({
          data: {
            feedbackItemId: ticket.id,
            body: commentBody,
            visibility: "PUBLIC",
            clientRequestId: body.clientRequestId,
          },
        });
        await feedbackAuditService.createEvent({
          feedbackItemId: ticket.id,
          projectId: ticket.projectId,
          actorType: AuditActorType.SYSTEM,
          eventType: "REPORTER_MARKED_STILL_HAPPENING",
          beforeJson: {
            status: ticket.status.toLowerCase(),
          },
          afterJson: {
            status: "in_progress",
            commentId: comment.id,
            statusHistoryId: statusHistory.id,
            reporterEmail: session.email,
          },
          requestId: request.header("x-request-id") ?? null,
          idempotencyKey: body.clientRequestId,
        }, tx);

        return { commentId: comment.id, statusHistoryId: statusHistory.id, fromStatus: ticket.status };
      });
    } catch (error) {
      const replayableRace = (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        || (error instanceof AppError && error.code === "reporter.ticket_resolution_changed");
      if (!replayableRace) throw error;
      const replay = await waitForReporterResolutionReplay(
        ticket.id,
        body.clientRequestId,
        commentBody,
        "REPORTER_MARKED_STILL_HAPPENING",
      );
      if (!replay) throw error;
      result = replay;
    }

    await ensureReporterReopenSideEffects({
      feedbackItemId: ticket.id,
      commentBody,
      commentId: result.commentId,
      statusHistoryId: result.statusHistoryId,
      fromStatus: result.fromStatus,
      requestId: request.header("x-request-id") ?? null,
    });

    const updatedTicket = await findReporterTicket(session, ticket.id);
    response.json({ ticket: formatReporterTicket(updatedTicket) });
  }),
);

router.post(
  "/tickets/:feedbackId/confirm-fixed",
  asyncHandler(async (request, response) => {
    const session = getReporterSession(request.header("authorization"));
    const body = reporterResolutionSchema("confirm").parse(request.body ?? {});
    const ticket = await findReporterTicket(session, getSingleParam(request.params.feedbackId));
    if (!ticket) {
      throw new AppError(404, "reporter.ticket_not_found", "Ticket not found.");
    }
    
    const commentBody = body.body ?? "Reporter confirmed this is fixed.";
    const existingReplay = await findReporterResolutionReplay(
      ticket.id,
      body.clientRequestId,
      commentBody,
      "REPORTER_CONFIRMED_FIXED",
    );
    if (existingReplay) {
      await ensureReporterConfirmSideEffects({
        feedbackItemId: ticket.id,
        commentId: existingReplay.commentId,
        statusHistoryId: existingReplay.statusHistoryId,
        fromStatus: existingReplay.fromStatus,
        commentBody,
      });
      const updatedTicket = await findReporterTicket(session, ticket.id);
      response.json({ ticket: formatReporterTicket(updatedTicket) });
      return;
    }
    
    if (ticket.status !== "FIXED") {
      const replay = await waitForReporterResolutionReplay(
        ticket.id,
        body.clientRequestId,
        commentBody,
        "REPORTER_CONFIRMED_FIXED",
      );
      if (replay) {
        await ensureReporterConfirmSideEffects({
          feedbackItemId: ticket.id,
          commentId: replay.commentId,
          statusHistoryId: replay.statusHistoryId,
          fromStatus: replay.fromStatus,
          commentBody,
        });
        const updatedTicket = await findReporterTicket(session, ticket.id);
        response.json({ ticket: formatReporterTicket(updatedTicket) });
        return;
      }
      throw new AppError(409, "reporter.ticket_not_fixed", "Only fixed reports can be confirmed.");
    }
    await assertOrgWritable(ticket.organizationId);

    let result: { commentId: string; statusHistoryId: string; fromStatus: string };
    try {
      result = await prisma.$transaction(async (tx) => {
        const statusClaim = await tx.feedbackItem.updateMany({
          where: { id: ticket.id, status: "FIXED" },
          data: { status: "CLOSED" },
        });
        if (statusClaim.count !== 1) {
          throw new AppError(409, "reporter.ticket_resolution_changed", "This report changed before your response was saved. Reload and try again.");
        }
        const statusHistory = await tx.feedbackStatusHistory.create({
          data: {
            feedbackItemId: ticket.id,
            fromStatus: "FIXED",
            toStatus: "CLOSED",
            note: "Reporter confirmed this is fixed.",
          },
        });
        const comment = await tx.feedbackComment.create({
          data: {
            feedbackItemId: ticket.id,
            body: commentBody,
            visibility: "PUBLIC",
            clientRequestId: body.clientRequestId,
          },
        });
        await feedbackAuditService.createEvent({
          feedbackItemId: ticket.id,
          projectId: ticket.projectId,
          actorType: AuditActorType.SYSTEM,
          eventType: "REPORTER_CONFIRMED_FIXED",
          beforeJson: {
            status: "fixed",
          },
          afterJson: {
            status: "closed",
            commentId: comment.id,
            statusHistoryId: statusHistory.id,
            reporterEmail: session.email,
          },
          requestId: request.header("x-request-id") ?? null,
          idempotencyKey: body.clientRequestId,
        }, tx);

        return { commentId: comment.id, statusHistoryId: statusHistory.id, fromStatus: "FIXED" };
      });
    } catch (error) {
      const replayableRace = (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        || (error instanceof AppError && error.code === "reporter.ticket_resolution_changed");
      if (!replayableRace) throw error;
      const replay = await waitForReporterResolutionReplay(
        ticket.id,
        body.clientRequestId,
        commentBody,
        "REPORTER_CONFIRMED_FIXED",
      );
      if (!replay) throw error;
      result = replay;
    }

    await ensureReporterConfirmSideEffects({
      feedbackItemId: ticket.id,
      commentId: result.commentId,
      statusHistoryId: result.statusHistoryId,
      fromStatus: result.fromStatus,
      commentBody,
    });

    const updatedTicket = await findReporterTicket(session, ticket.id);
    response.json({ ticket: formatReporterTicket(updatedTicket) });
  }),
);

export { router as reporterRouter };
