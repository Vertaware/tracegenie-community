import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";

import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { asyncHandler,getSingleParam } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { randomToken,sha256 } from "../../lib/security";

import { requireAdmin } from "../auth/auth.middleware";

import { authService } from "../auth/auth.service";
import { ADMIN_SESSION_COOKIE_NAME,buildAdminSessionCookieOptions } from "../auth/auth.session";
import { notifyInvite } from "../email/notifications";
import { assertOrgWritable,requireOrgAccessForUser,writePlatformAudit } from "./access";
import {
type DsarDeletionRequest,
claimPendingDsarDeletionRequest,
completeDsarDeletionRequest,
createDsarDeletionRequest,
createDsarExportRequest,
deleteDsarSubject,
getDsarDeletionRequests,
getDsarExportArtifactContent,
getDsarExportRequests,
getDsarSubjectExport,
getPendingDsarDeletionRequest,
publicDsarDeletionRequest,
publicDsarExportRequest,
rejectPendingDsarDeletionRequest,
releaseDsarDeletionRequestClaim,
} from "./dsar.service";

const router = Router();

const orgBrandingSchema = z.object({
  brandName: z.string().trim().min(2).max(120).nullable().optional(),
  logoUrl: z.string().trim().url().nullable().optional(),
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  emailFooterText: z.string().trim().max(500).nullable().optional(),
});

const auditDateOnlySchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Date must be valid.");

const auditExportQuerySchema = z.object({
  fromDate: auditDateOnlySchema.optional(),
  toDate: auditDateOnlySchema.optional(),
  scope: z.enum(["all", "platform", "feedback"]).default("all"),
}).refine((value) => !value.fromDate || !value.toDate || value.fromDate <= value.toDate, {
  message: "fromDate must be before or equal to toDate.",
  path: ["fromDate"],
});

const dsarEmailSchema = z.string().trim().email().max(255).transform((value) => value.toLowerCase());

const dsarExportRequestSchema = z.object({
  email: dsarEmailSchema,
  reason: z.string().trim().min(10).max(500),
});

const dsarDeleteSchema = z.object({
  email: dsarEmailSchema,
  confirm: z.literal("delete"),
  legalHoldConfirmed: z.literal(true),
  reason: z.string().trim().min(10).max(500),
});

const dsarDeleteRequestSchema = z.object({
  email: dsarEmailSchema,
  reason: z.string().trim().min(10).max(500),
});

const dsarDeleteRejectSchema = z.object({
  reason: z.string().trim().min(10).max(500),
});

const inviteCreateSchema = z.object({
  email: z.string().email(),
  orgRole: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
  projectId: z.string().trim().min(1).optional(),
  projectIds: z.array(z.string().trim().min(1)).optional(),
  projectRole: z.enum(["PROJECT_ADMIN", "TRIAGER", "VIEWER"]).optional(),
}).superRefine((value, context) => {
  const hasProjectAccess = Boolean(value.projectId) || Boolean(value.projectIds?.length);
  if (value.projectRole && !hasProjectAccess) {
    context.addIssue({
      code: "custom",
      path: ["projectIds"],
      message: "Project role requires a project.",
    });
  }
  if (hasProjectAccess && !value.projectRole) {
    context.addIssue({
      code: "custom",
      path: ["projectRole"],
      message: "Project invites require a project role.",
    });
  }
});

const inviteContextSchema = z.object({
  token: z.string().trim().min(20).max(512),
});

type InviteProjectAccess = {
  projectId: string;
  role: "PROJECT_ADMIN" | "TRIAGER" | "VIEWER";
};

function getInviteProjectAccess(invite: {
  projectId: string | null;
  projectIdsJson: unknown;
  projectRole: InviteProjectAccess["role"] | null;
  projectLinks?: InviteProjectAccess[];
}) {
  if (invite.projectLinks?.length) {
    return invite.projectLinks.map((project) => ({ projectId: project.projectId, role: project.role }));
  }
  if (!invite.projectRole) {
    return [];
  }
  if (Array.isArray(invite.projectIdsJson)) {
    return invite.projectIdsJson
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((projectId) => ({ projectId, role: invite.projectRole! }));
  }
  return invite.projectId ? [{ projectId: invite.projectId, role: invite.projectRole }] : [];
}

function getInviteEffectiveAccess(
  orgRole: "OWNER" | "ADMIN" | "MEMBER" | null,
  products: Array<{ productRole: "PROJECT_ADMIN" | "TRIAGER" | "VIEWER" }>,
) {
  if (orgRole === "OWNER" || orgRole === "ADMIN") {
    return {
      productScope: "ALL" as const,
      summary: "Can manage the organization and access all current and future products.",
    };
  }
  if (products.length === 0) {
    return {
      productScope: "NONE" as const,
      summary: "Organization member with no product access.",
    };
  }

  const roles = new Set(products.map((product) => product.productRole));
  const roleLabels = {
    PROJECT_ADMIN: "product administrator",
    TRIAGER: "triager",
    VIEWER: "viewer",
  } as const;
  const roleSummary = roles.size === 1 ? ` with the ${roleLabels[products[0]!.productRole]} role` : " with the listed roles";
  return {
    productScope: "SCOPED" as const,
    summary: `Organization member with access to ${products.length} selected product${products.length === 1 ? "" : "s"}${roleSummary}.`,
  };
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const normalized = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${normalized.replaceAll('"', '""')}"`;
}

function csvRows(rows: Array<Record<string, unknown>>) {
  const headers = [
    "createdAt",
    "source",
    "eventType",
    "actor",
    "projectKey",
    "ticketNumber",
    "requestId",
    "idempotencyKey",
    "reason",
    "detailType",
    "detailSummary",
    "mcpToolName",
    "mcpLatencyMs",
    "mcpStatus",
  ];

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
}

function auditDateRange(input: z.infer<typeof auditExportQuerySchema>) {
  const createdAt: { gte?: Date; lt?: Date } = {};
  if (input.fromDate) {
    createdAt.gte = new Date(`${input.fromDate}T00:00:00.000Z`);
  }
  if (input.toDate) {
    const end = new Date(`${input.toDate}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    createdAt.lt = end;
  }
  return Object.keys(createdAt).length > 0 ? createdAt : undefined;
}

function asAuditObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function platformAuditActor(event: {
  actorUser?: { name: string | null; email: string } | null;
  actorUserId: string | null;
}) {
  return event.actorUser?.email ?? event.actorUser?.name ?? event.actorUserId ?? "";
}

function feedbackAuditActor(event: {
  actorType: string;
  adminUser?: { name: string | null; email: string } | null;
  integrationClient?: { name: string } | null;
  adminUserId: string | null;
  integrationClientId: string | null;
}) {
  return event.adminUser?.email ??
    event.adminUser?.name ??
    event.integrationClient?.name ??
    event.adminUserId ??
    event.integrationClientId ??
    event.actorType.toLowerCase();
}

function feedbackAuditSafeDetail(before: Record<string, unknown>, after: Record<string, unknown>, eventType: string) {
  if (eventType === "ADMIN_ATTACHMENT_READ" || eventType === "MCP_ATTACHMENT_READ") {
    const fileName = typeof after.fileName === "string" ? after.fileName : "attachment";
    const mimeType = typeof after.mimeType === "string" ? after.mimeType : "unknown type";
    const byteSize = typeof after.byteSize === "number" ? `${after.byteSize} bytes` : "unknown size";
    return {
      detailType: "attachment",
      detailSummary: `${fileName} | ${mimeType} | ${byteSize}`,
    };
  }

  if (eventType === "RAW_EVIDENCE_READ") {
    const disclosed = [
      after.consoleEntries === true ? "console entries" : null,
      after.clientErrorContext === true ? "client error context" : null,
    ].filter(Boolean);
    return {
      detailType: "raw_evidence",
      detailSummary: disclosed.length ? disclosed.join(", ") : "none",
    };
  }

  if (eventType === "MCP_EXTERNAL_EVENT_READ") {
    const provider = typeof after.provider === "string" ? after.provider : "external";
    const label = typeof after.externalLabel === "string" ? after.externalLabel : null;
    const ticket = typeof after.sourceTicketNumber === "number" ? `ticket #${after.sourceTicketNumber}` : null;
    return {
      detailType: "external_event",
      detailSummary: [provider, label, ticket].filter(Boolean).join(" | "),
    };
  }

  if (eventType === "MCP_TICKET_READ") {
    const ticket = typeof after.ticketNumber === "number" ? `ticket #${after.ticketNumber}` : "ticket";
    const rawEvidence = after.rawEvidenceIncluded === true ? "raw evidence included" : "metadata only";
    return {
      detailType: "ticket_resource",
      detailSummary: `${ticket} | ${rawEvidence}`,
    };
  }

  if (eventType === "REQUESTER_NOTIFICATIONS_UPDATED") {
    return {
      detailType: "requester_notifications",
      detailSummary: after.enabled === true ? "enabled" : "disabled",
    };
  }

  if (eventType === "REQUESTER_NOTIFICATION_SKIPPED") {
    const deliveryEventType = typeof after.eventType === "string" ? after.eventType : "notification";
    const skipReason = typeof after.skipReason === "string" ? after.skipReason : "reason unavailable";
    return {
      detailType: "requester_notification_delivery",
      detailSummary: `${deliveryEventType} | skipped | ${skipReason}`,
    };
  }

  if (eventType === "REQUESTER_NOTIFICATION_REPLAYED") {
    const status = typeof after.status === "string" ? after.status.toLowerCase() : "status unavailable";
    return {
      detailType: "requester_notification_delivery",
      detailSummary: `replayed | ${status}`,
    };
  }

  if (
    eventType === "REQUESTER_NOTIFICATION_SENT" ||
    eventType === "REQUESTER_NOTIFICATION_FAILED" ||
    eventType === "REQUESTER_CONFIRMATION_SENT" ||
    eventType === "REQUESTER_CONFIRMATION_FAILED" ||
    eventType === "NEW_ISSUE_NOTIFICATION_SENT" ||
    eventType === "NEW_ISSUE_NOTIFICATION_FAILED"
  ) {
    const deliveryEventType = typeof after.eventType === "string"
      ? after.eventType
      : eventType.replace(/_(SENT|FAILED)$/, "");
    const outcome = eventType.endsWith("_SENT") ? "sent" : "failed";
    const recipientType = typeof after.recipientType === "string" ? after.recipientType.toLowerCase() : "recipient";
    const attempts = typeof after.attemptCount === "number"
      ? `${after.attemptCount} attempt${after.attemptCount === 1 ? "" : "s"}`
      : "attempt count unavailable";
    const retryState = outcome === "failed"
      ? after.nextAttemptAt ? " | retry scheduled" : " | no retry scheduled"
      : "";
    return {
      detailType: "notification_delivery",
      detailSummary: `${deliveryEventType} | ${outcome} | ${recipientType} | ${attempts}${retryState}`,
    };
  }

  if (eventType === "REPORTER_MARKED_STILL_HAPPENING" || eventType === "REPORTER_CONFIRMED_FIXED") {
    const status = typeof after.status === "string" ? after.status : "status unavailable";
    const action = eventType === "REPORTER_MARKED_STILL_HAPPENING" ? "still happening" : "confirmed fixed";
    return {
      detailType: "reporter_close_loop",
      detailSummary: `${action} | ${status}`,
    };
  }

  if (eventType === "DUPLICATE_UPDATED") {
    const status = typeof after.status === "string" ? after.status : "status unavailable";
    const notifyRequester = after.notifyRequester === true ? "notify requester" : "no requester notification";
    return {
      detailType: "duplicate_link",
      detailSummary: `updated | ${status} | ${notifyRequester}`,
    };
  }

  if (eventType === "DUPLICATE_ATTACHED" || eventType === "DUPLICATE_DETACHED") {
    return {
      detailType: "duplicate_link",
      detailSummary: eventType === "DUPLICATE_ATTACHED" ? "attached" : "detached",
    };
  }

  if (eventType === "DUPLICATE_LABELS_MERGED") {
    const labels = auditArrayDelta(before.labels, after.labels);
    return {
      detailType: "duplicate_merge",
      detailSummary: `labels merged | ${auditCountLabel(labels, "label")}`,
    };
  }

  if (eventType === "DUPLICATE_SUBSCRIBERS_MERGED") {
    const subscribers = auditArrayDelta(before.subscriberEmails, after.subscriberEmails);
    return {
      detailType: "duplicate_merge",
      detailSummary: `subscribers merged | ${auditCountLabel(subscribers, "subscriber")}`,
    };
  }

  if (eventType === "DUPLICATE_EXTERNAL_REFS_MERGED") {
    const refs = Array.isArray(after.externalRefs) ? after.externalRefs : [];
    const mergedRefs = auditArrayDelta(before.externalRefs, after.externalRefs);
    const providers = Array.from(new Set(refs.flatMap((ref) => {
      const record = asAuditObject(ref);
      return typeof record.provider === "string" ? [record.provider] : [];
    })));
    return {
      detailType: "duplicate_merge",
      detailSummary: `external refs merged | ${auditCountLabel(mergedRefs, "ref")} | ${auditList(providers)}`,
    };
  }

  if (eventType === "TRIAGE_SAVED") {
    const version = typeof after.triageVersion === "string" ? after.triageVersion : "version unavailable";
    const status = typeof after.statusAfter === "string" ? after.statusAfter : "status unavailable";
    const notifyRequester = after.notifyRequester === true ? "notify requester" : "no requester notification";
    return {
      detailType: "integration_write",
      detailSummary: `triage saved | ${version} | status: ${status} | ${notifyRequester}`,
    };
  }

  if (eventType === "STATUS_CHANGED") {
    const provider = typeof after.provider === "string" ? `${after.provider} | ` : "";
    const beforeStatus = typeof before.status === "string" ? before.status : "status unavailable";
    const afterStatus = typeof after.status === "string" ? after.status : "status unavailable";
    const notifyRequester = typeof after.notifyRequester === "boolean"
      ? ` | ${after.notifyRequester ? "notify requester" : "no requester notification"}`
      : "";
    return {
      detailType: "integration_write",
      detailSummary: `${provider}status changed | ${beforeStatus} -> ${afterStatus}${notifyRequester}`,
    };
  }

  if (eventType === "COMMENT_ADDED") {
    const visibility = typeof after.visibility === "string" ? after.visibility : "visibility unavailable";
    const notifyRequester = after.notifyRequester === true ? "notify requester" : "no requester notification";
    return {
      detailType: "integration_write",
      detailSummary: `comment added | ${visibility} | ${notifyRequester}`,
    };
  }

  if (eventType === "ADMIN_UPDATED") {
    const parts: string[] = [];
    const transition = (label: string, beforeValue: unknown, afterValue: unknown) => {
      const beforeText = typeof beforeValue === "string" ? beforeValue : "unavailable";
      const afterText = typeof afterValue === "string" ? afterValue : "unavailable";
      if (beforeText !== afterText) {
        parts.push(`${label}: ${beforeText} -> ${afterText}`);
      }
    };
    const stateChange = (beforeValue: unknown, afterValue: unknown, noun: string) => {
      const hadBefore = typeof beforeValue === "string" && beforeValue.length > 0;
      const hasAfter = typeof afterValue === "string" && afterValue.length > 0;
      if (!hadBefore && hasAfter) {
        parts.push(`${noun} assigned`);
      } else if (hadBefore && !hasAfter) {
        parts.push(`${noun} unassigned`);
      } else if (hadBefore && hasAfter && beforeValue !== afterValue) {
        parts.push(`${noun} changed`);
      }
    };

    transition("status", before.status, after.status);
    transition("severity", before.severity, after.severity);
    stateChange(before.ownerId, after.ownerId, "owner");
    stateChange(before.duplicateOfId, after.duplicateOfId, "duplicate");

    const beforeLabelCount = Array.isArray(before.labels) ? before.labels.length : 0;
    const afterLabelCount = Array.isArray(after.labels) ? after.labels.length : 0;
    if (beforeLabelCount !== afterLabelCount) {
      parts.push(`labels: ${beforeLabelCount} -> ${afterLabelCount}`);
    }

    if (typeof before.convertedToBacklog === "boolean" && typeof after.convertedToBacklog === "boolean" && before.convertedToBacklog !== after.convertedToBacklog) {
      parts.push(`backlog: ${before.convertedToBacklog} -> ${after.convertedToBacklog}`);
    }

    const beforeRefs = Array.isArray(before.externalRefs) ? before.externalRefs : [];
    const afterRefs = Array.isArray(after.externalRefs) ? after.externalRefs : [];
    if (JSON.stringify(beforeRefs) !== JSON.stringify(afterRefs)) {
      const providers = Array.from(new Set(afterRefs.flatMap((ref) => {
        const record = asAuditObject(ref);
        return typeof record.provider === "string" ? [record.provider] : [];
      })));
      parts.push(`external refs: ${beforeRefs.length} -> ${auditCountLabel(afterRefs.length, "ref")} | providers: ${auditList(providers)}`);
    }

    const beforeLifecycle = asAuditObject(before.engineeringLifecycle);
    const afterLifecycle = asAuditObject(after.engineeringLifecycle);
    transition("verification", beforeLifecycle.verificationState, afterLifecycle.verificationState);

    return {
      detailType: "admin_update",
      detailSummary: parts.length ? parts.join(" | ") : "admin update",
    };
  }

  if (eventType === "EXTERNAL_ISSUE_CREATED" || eventType === "EXTERNAL_ISSUE_SYNCED") {
    const provider = typeof after.provider === "string" ? after.provider : "provider";
    const ref = asAuditObject(after.externalRef);
    const label = typeof after.externalTicketRef === "string"
      ? after.externalTicketRef
      : typeof ref.label === "string" ? ref.label : "external issue";
    const action = eventType === "EXTERNAL_ISSUE_CREATED" ? "created" : "synced";
    return {
      detailType: "external_issue",
      detailSummary: `${provider} | ${action} | ${label}`,
    };
  }

  if (
    eventType === "EXTERNAL_ISSUE_CREATE_FAILED" ||
    eventType === "EXTERNAL_ISSUE_SYNC_FAILED" ||
    eventType === "EXTERNAL_ISSUE_SYNC_RETRY_FAILED"
  ) {
    const provider = typeof after.provider === "string" ? after.provider : "provider";
    const operation = typeof after.operation === "string" ? after.operation : "operation";
    const error = asAuditObject(after.error);
    const code = typeof error.code === "string" ? error.code : "provider_error";
    const retrySummary = eventType === "EXTERNAL_ISSUE_SYNC_RETRY_FAILED"
      ? ` retry | ${typeof after.attemptCount === "number" ? `${after.attemptCount} attempts | ` : ""}`
      : " ";
    return {
      detailType: "external_issue_failure",
      detailSummary: `${provider} | ${operation}${retrySummary}failed | ${code}`,
    };
  }

  if (eventType === "EXTERNAL_REF_UPDATED") {
    const refs = Array.isArray(after.externalRefs) ? after.externalRefs : [];
    const providers = Array.from(new Set(refs.flatMap((ref) => {
      const record = asAuditObject(ref);
      return typeof record.provider === "string" ? [record.provider] : [];
    })));
    const ticketRef = typeof after.externalTicketRef === "string" ? after.externalTicketRef : "no primary ref";
    return {
      detailType: "external_refs",
      detailSummary: `${ticketRef} | ${refs.length} refs | ${auditList(providers)}`,
    };
  }

  if (eventType === "PROVIDER_TICKET_IMPORTED") {
    const provider = typeof after.provider === "string" ? after.provider : "provider";
    const label = typeof after.providerLabel === "string" ? after.providerLabel : "provider ticket";
    const refs = Array.isArray(after.externalRefs) ? after.externalRefs : [];
    const status = typeof after.status === "string" ? ` | status: ${after.status}` : "";
    return {
      detailType: "provider_import",
      detailSummary: `${provider} | imported | ${label} | ${refs.length} refs${status}`,
    };
  }

  return {
    detailType: "",
    detailSummary: "",
  };
}

function auditList(value: unknown, emptyLabel = "none") {
  return Array.isArray(value) && value.length > 0
    ? value.map((entry) => String(entry)).join("; ")
    : emptyLabel;
}

function auditArrayDelta(before: unknown, after: unknown) {
  const beforeCount = Array.isArray(before) ? before.length : 0;
  const afterCount = Array.isArray(after) ? after.length : 0;
  return Math.max(0, afterCount - beforeCount);
}

function auditCountLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function auditCountSummary(value: unknown, emptyLabel = "counts unavailable") {
  const entries = Object.entries(asAuditObject(value))
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, count]) => (
      typeof count === "number" ? [`${key}: ${count}`] : []
    ));
  return entries.length ? entries.join("; ") : emptyLabel;
}

function platformAuditSafeDetail(before: Record<string, unknown>, after: Record<string, unknown>, eventType: string) {
  

  

  

  

  

  

  

  

  

  

  

  

  

  

  

  if (eventType === "reporter.portal_access_granted") {
    const authMethod = typeof after.authMethod === "string" ? after.authMethod : "unknown auth";
    const productScope = typeof after.projectId === "string" ? "scoped product" : "all products";
    const productCount = typeof after.accessibleProjectCount === "number"
      ? `${after.accessibleProjectCount} products`
      : "product count unavailable";
    return {
      detailType: "reporter_portal_access",
      detailSummary: `${authMethod} | ${productScope} | ${productCount}`,
    };
  }

  if (eventType === "reporter.otp_requested") {
    const delivery = asAuditObject(after.emailDelivery);
    const sent = delivery.sent === true ? "sent" : "not sent";
    const skippedReason = typeof delivery.skippedReason === "string" ? ` | ${delivery.skippedReason}` : "";
    const productScope = typeof after.projectId === "string" ? "scoped product" : "all products";
    return {
      detailType: "reporter_otp_request",
      detailSummary: `${sent}${skippedReason} | ${productScope}`,
    };
  }

  if (eventType === "org.invite_created") {
    const projectCount = Array.isArray(after.projectIds)
      ? after.projectIds.length
      : typeof after.projectId === "string" ? 1 : 0;
    return {
      detailType: "org_invite",
      detailSummary: `created | projects: ${projectCount}`,
    };
  }

  if (eventType === "org.invite_accepted") {
    const projectCount = Array.isArray(after.projectAccess) ? after.projectAccess.length : 0;
    return {
      detailType: "org_invite",
      detailSummary: `accepted | projects: ${projectCount}`,
    };
  }

  if (eventType === "org.invite_email_delivery") {
    const delivery = asAuditObject(after.emailDelivery);
    const sent = delivery.sent === true ? "sent" : "not sent";
    const skippedReason = typeof delivery.skippedReason === "string" ? ` | ${delivery.skippedReason}` : "";
    return {
      detailType: "org_invite",
      detailSummary: `email delivery | ${sent}${skippedReason}`,
    };
  }

  if (eventType === "org.dsar_subject_exported" || eventType === "reporter.dsar_subject_exported") {
    const source = eventType.startsWith("reporter.") ? "reporter export" : "admin export";
    return {
      detailType: "dsar_export",
      detailSummary: `${source} | ${auditCountSummary(after.counts)}`,
    };
  }

  if (eventType === "org.dsar_export_queued") {
    const requestId = typeof after.requestId === "string" ? after.requestId : "dsar export request";
    return {
      detailType: "dsar_export_request",
      detailSummary: `${requestId} | queued`,
    };
  }

  if (eventType === "org.dsar_export_requested") {
    const requestId = typeof after.requestId === "string" ? after.requestId : "dsar export request";
    const artifact = asAuditObject(after.artifact);
    const byteSize = typeof artifact.byteSize === "number" ? `${artifact.byteSize} bytes` : "artifact stored";
    return {
      detailType: "dsar_export_request",
      detailSummary: `${requestId} | completed | ${byteSize} | ${auditCountSummary(after.counts)}`,
    };
  }

  if (eventType === "org.dsar_export_failed") {
    const requestId = typeof after.requestId === "string" ? after.requestId : "dsar export request";
    const failure = asAuditObject(after.failure);
    const code = typeof failure.code === "string" ? failure.code : "dsar.export_failed";
    return {
      detailType: "dsar_export_request",
      detailSummary: `${requestId} | failed | ${code}`,
    };
  }

  if (eventType === "org.dsar_export_downloaded") {
    const requestId = typeof after.requestId === "string" ? after.requestId : "dsar export request";
    const byteSize = typeof after.byteSize === "number" ? `${after.byteSize} bytes` : "artifact downloaded";
    return {
      detailType: "dsar_export_request",
      detailSummary: `${requestId} | downloaded | ${byteSize}`,
    };
  }

  if (eventType === "org.dsar_export_artifacts_cleaned") {
    const cleaned = typeof after.cleaned === "number" ? `${after.cleaned} artifacts` : "artifacts";
    return {
      detailType: "dsar_export_request",
      detailSummary: `expired cleanup | ${cleaned}`,
    };
  }

  if (eventType === "org.dsar_deletion_requested") {
    const requestId = typeof after.requestId === "string" ? after.requestId : "dsar request";
    const source = typeof after.source === "string" ? after.source : "admin";
    return {
      detailType: "dsar_deletion_request",
      detailSummary: `${requestId} | ${source} | ${auditCountSummary(after.counts)}`,
    };
  }

  if (eventType === "org.dsar_deletion_approved" || eventType === "org.dsar_deletion_rejected") {
    const requestId = typeof after.requestId === "string" ? after.requestId : "dsar request";
    const status = eventType.endsWith("_approved") ? "completed" : "rejected";
    const deletedSummary = auditCountSummary(after.deleted, "");
    return {
      detailType: "dsar_deletion_resolution",
      detailSummary: [requestId, status, deletedSummary].filter(Boolean).join(" | "),
    };
  }

  if (eventType === "org.dsar_subject_deleted") {
    return {
      detailType: "dsar_subject_deletion",
      detailSummary: `subject deleted | ${auditCountSummary(after)}`,
    };
  }

  return {
    detailType: "",
    detailSummary: "",
  };
}

router.get("/", requireAdmin, asyncHandler(async (request, response) => {
     const organizations = await prisma.organization.findMany({ where: { memberships: { some: { userId: request.adminUser!.id, status: "ACTIVE" } } }, select: { id: true, name: true, slug: true, status: true } });
     response.json({ organizations });
   }));

router.post(
  "/:organizationId/compliance/dsar.json",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const organizationId = getSingleParam(request.params.organizationId);
    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireOrgAccessForUser(request.adminUser!.id, organizationId, ["OWNER", "ADMIN"]);
    }
    const body = dsarExportRequestSchema.parse(request.body);
    const payload = await getDsarSubjectExport(organizationId, body.email);

    await writePlatformAudit({
      organizationId,
      actorUserId: request.adminUser?.id,
      eventType: "org.dsar_subject_exported",
      reason: body.reason,
      afterJson: {
        subjectEmailHash: payload.subject.emailHash,
        counts: payload.counts,
      },
    });

    response.setHeader("Content-Disposition", `attachment; filename="tracegenie-dsar-${payload.subject.emailHash.slice(0, 12)}.json"`);
    response.json(payload);
  }),
);

router.get(
  "/:organizationId/compliance/dsar/export-requests",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const organizationId = getSingleParam(request.params.organizationId);
    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireOrgAccessForUser(request.adminUser!.id, organizationId, ["OWNER", "ADMIN"]);
    }

    response.json({
      requests: (await getDsarExportRequests(organizationId)).map(publicDsarExportRequest),
    });
  }),
);

router.get(
  "/:organizationId/compliance/dsar/export-requests/:requestId/download",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const organizationId = getSingleParam(request.params.organizationId);
    const requestId = getSingleParam(request.params.requestId);
    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireOrgAccessForUser(request.adminUser!.id, organizationId, ["OWNER", "ADMIN"]);
    }

    const content = await getDsarExportArtifactContent({
      organizationId,
      requestId,
    });

    await writePlatformAudit({
      organizationId,
      actorUserId: request.adminUser?.id,
      eventType: "org.dsar_export_downloaded",
      afterJson: {
        requestId,
        byteSize: content.artifact.byteSize,
        checksumSha256: content.artifact.checksumSha256,
      },
    });

    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", content.artifact.mimeType);
    response.setHeader("Content-Length", String(content.artifact.byteSize));
    response.setHeader("Content-Disposition", `attachment; filename="${content.artifact.fileName.replace(/"/g, "")}"`);
    response.send(content.buffer);
  }),
);

router.post(
  "/:organizationId/compliance/dsar/export-requests",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const organizationId = getSingleParam(request.params.organizationId);
    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireOrgAccessForUser(request.adminUser!.id, organizationId, ["OWNER", "ADMIN"]);
    }
    const body = dsarExportRequestSchema.parse(request.body);
    const created = await createDsarExportRequest({
      organizationId,
      actorUserId: request.adminUser?.id,
      email: body.email,
      reason: body.reason,
    });

    response.status(202).json({ request: publicDsarExportRequest(created) });
  }),
);

router.get(
  "/:organizationId/compliance/dsar/deletion-requests",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const organizationId = getSingleParam(request.params.organizationId);
    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireOrgAccessForUser(request.adminUser!.id, organizationId, ["OWNER", "ADMIN"]);
    }

    response.json({
      requests: (await getDsarDeletionRequests(organizationId)).map(publicDsarDeletionRequest),
    });
  }),
);

router.post(
  "/:organizationId/compliance/dsar/deletion-requests",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const organizationId = getSingleParam(request.params.organizationId);
    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireOrgAccessForUser(request.adminUser!.id, organizationId, ["OWNER", "ADMIN"]);
    }
    const body = dsarDeleteRequestSchema.parse(request.body);
    const created = await createDsarDeletionRequest({
      organizationId,
      actorUserId: request.adminUser?.id,
      email: body.email,
      reason: body.reason,
    });

    response.status(201).json({ request: publicDsarDeletionRequest(created) });
  }),
);

router.post(
  "/:organizationId/compliance/dsar/deletion-requests/:requestId/approve",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const organizationId = getSingleParam(request.params.organizationId);
    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireOrgAccessForUser(request.adminUser!.id, organizationId, ["OWNER", "ADMIN"]);
    }
    const requestId = getSingleParam(request.params.requestId);
    const body = dsarDeleteSchema.parse(request.body);
    const deletionRequest = await getPendingDsarDeletionRequest(organizationId, requestId);
    if (deletionRequest.subjectEmailHash !== sha256(body.email)) {
      throw new AppError(422, "dsar.subject_mismatch", "Subject email does not match this deletion request.");
    }

    const deletionClaim = await claimPendingDsarDeletionRequest(organizationId, requestId);
    let resolvedRequest: DsarDeletionRequest | null = null;
    try {
      const deleted = await deleteDsarSubject({
        organizationId,
        email: body.email,
        actorUserId: request.adminUser?.id,
        reason: body.reason,
        afterDelete: async (transaction, deletedCounts) => {
          resolvedRequest = await completeDsarDeletionRequest({
            organizationId,
            actorUserId: request.adminUser?.id,
            requestId,
            reason: body.reason,
            deleted: deletedCounts,
            claimToken: deletionClaim.claimToken,
            legalHoldConfirmed: body.legalHoldConfirmed,
          }, transaction);
        },
      });
      if (!resolvedRequest) {
        throw new AppError(500, "dsar.request_resolve_failed", "DSAR deletion request could not be resolved.");
      }

      response.json({
        deleted,
        request: publicDsarDeletionRequest(resolvedRequest),
      });
    } catch (error) {
      await releaseDsarDeletionRequestClaim(organizationId, requestId, deletionClaim.claimToken);
      throw error;
    }
  }),
);

router.post(
  "/:organizationId/compliance/dsar/deletion-requests/:requestId/reject",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const organizationId = getSingleParam(request.params.organizationId);
    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireOrgAccessForUser(request.adminUser!.id, organizationId, ["OWNER", "ADMIN"]);
    }
    const requestId = getSingleParam(request.params.requestId);
    const body = dsarDeleteRejectSchema.parse(request.body);
    const resolvedRequest = await rejectPendingDsarDeletionRequest({
      organizationId,
      actorUserId: request.adminUser?.id,
      requestId,
      reason: body.reason,
    });
    response.json({
      request: publicDsarDeletionRequest(resolvedRequest),
    });
  }),
);

router.delete(
  "/:organizationId/compliance/dsar",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const organizationId = getSingleParam(request.params.organizationId);
    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireOrgAccessForUser(request.adminUser!.id, organizationId, ["OWNER", "ADMIN"]);
    }
    throw new AppError(410, "dsar.direct_delete_disabled", "Direct DSAR deletion is disabled. Create and approve a deletion request instead.");
  }),
);

router.get(
  "/:organizationId/compliance/audit.csv",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const organizationId = getSingleParam(request.params.organizationId);
    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireOrgAccessForUser(request.adminUser!.id, organizationId, ["OWNER", "ADMIN"]);
    }
    const query = auditExportQuerySchema.parse(request.query);
    const createdAt = auditDateRange(query);

    await writePlatformAudit({
      organizationId,
      actorUserId: request.adminUser?.id,
      eventType: "org.audit_exported",
      afterJson: {
        scope: query.scope,
        fromDate: query.fromDate ?? null,
        toDate: query.toDate ?? null,
      },
    });

    const [platformEvents, feedbackEvents] = await Promise.all([
      query.scope === "feedback"
        ? []
        : prisma.platformAuditEvent.findMany({
            where: {
              organizationId,
              ...(createdAt ? { createdAt } : {}),
            },
            include: {
              actorUser: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
            orderBy: { createdAt: "desc" },
          }),
      query.scope === "platform"
        ? []
        : prisma.feedbackAuditEvent.findMany({
            where: {
              project: {
                organizationId,
              },
              ...(createdAt ? { createdAt } : {}),
            },
            include: {
              adminUser: {
                select: {
                  name: true,
                  email: true,
                },
              },
              integrationClient: {
                select: {
                  name: true,
                },
              },
              project: {
                select: {
                  key: true,
                },
              },
              feedbackItem: {
                select: {
                  ticketNumber: true,
                },
              },
            },
            orderBy: { createdAt: "desc" },
          }),
    ]);

    const rows = [
      ...platformEvents.map((event) => {
        const before = asAuditObject(event.beforeJson);
        const after = asAuditObject(event.afterJson);
        const safeDetail = platformAuditSafeDetail(before, after, event.eventType);
        return {
          createdAt: event.createdAt.toISOString(),
          source: "platform",
          eventType: event.eventType,
          actor: platformAuditActor(event),
          projectKey: "",
          ticketNumber: "",
          requestId: "",
          idempotencyKey: "",
          reason: event.reason ?? "",
          detailType: safeDetail.detailType,
          detailSummary: safeDetail.detailSummary,
          mcpToolName: after.mcpToolName,
          mcpLatencyMs: after.mcpLatencyMs,
          mcpStatus: after.status,
        };
      }),
      ...feedbackEvents.map((event) => {
        const before = asAuditObject(event.beforeJson);
        const after = asAuditObject(event.afterJson);
        const safeDetail = feedbackAuditSafeDetail(before, after, event.eventType);
        return {
          createdAt: event.createdAt.toISOString(),
          source: "feedback",
          eventType: event.eventType,
          actor: feedbackAuditActor(event),
          projectKey: event.project.key,
          ticketNumber: event.feedbackItem.ticketNumber,
          requestId: event.requestId ?? "",
          idempotencyKey: event.idempotencyKey ?? "",
          reason: "",
          detailType: safeDetail.detailType,
          detailSummary: safeDetail.detailSummary,
          mcpToolName: after.mcpToolName,
          mcpLatencyMs: after.mcpLatencyMs,
          mcpStatus: after.status,
        };
      }),
    ].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));

    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="tracegenie-audit-${organizationId}.csv"`);
    response.send(`\uFEFF${csvRows(rows)}\n`);
  }),
);

router.patch(
  "/:organizationId/branding",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const organizationId = getSingleParam(request.params.organizationId);
    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireOrgAccessForUser(request.adminUser!.id, organizationId, ["OWNER", "ADMIN"]);
      await assertOrgWritable(organizationId);
    }
    const body = orgBrandingSchema.parse(request.body);
    const organization = await prisma.$transaction(async (transaction) => {
      const before = await transaction.organization.findUniqueOrThrow({ where: { id: organizationId } });
      const updated = await transaction.organization.update({
        where: { id: organizationId },
        data: body,
      });
      await writePlatformAudit({
        organizationId,
        actorUserId: request.adminUser?.id,
        eventType: "org.branding_updated",
        beforeJson: {
          brandName: before.brandName,
          logoUrl: before.logoUrl,
          primaryColor: before.primaryColor,
          accentColor: before.accentColor,
          emailFooterText: before.emailFooterText,
        },
        afterJson: {
          brandName: updated.brandName,
          logoUrl: updated.logoUrl,
          primaryColor: updated.primaryColor,
          accentColor: updated.accentColor,
          emailFooterText: updated.emailFooterText,
        },
      }, transaction);

      return updated;
    });

    response.json({ organization });
  }),
);

router.post(
  "/invites/context",
  asyncHandler(async (request, response) => {
    const { token } = inviteContextSchema.parse(request.body);
    const invite = await prisma.invite.findUnique({
      where: { tokenHash: sha256(token) },
      select: {
        status: true,
        expiresAt: true,
        orgRole: true,
        projectRole: true,
        invitedByName: true,
        organization: {
          select: {
            name: true,
            brandName: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        projectLinks: {
          select: {
            role: true,
            project: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!invite) {
      throw new AppError(404, "invites.not_found", "This invite link is invalid.");
    }
    if (invite.status === "ACCEPTED") {
      throw new AppError(409, "invites.already_accepted", "This invite has already been accepted.");
    }
    if (invite.status === "REVOKED") {
      throw new AppError(410, "invites.revoked", "This invite has been revoked.");
    }
    if (invite.status === "EXPIRED" || invite.expiresAt <= new Date()) {
      throw new AppError(410, "invites.expired", "This invite has expired.");
    }

    const products = (invite.projectLinks.length > 0
      ? invite.projectLinks.map((link) => ({
          id: link.project.id,
          name: link.project.name,
          productRole: link.role,
        }))
      : invite.project && invite.projectRole
        ? [{
            id: invite.project.id,
            name: invite.project.name,
            productRole: invite.projectRole,
          }]
        : [])
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .map(({ name, productRole }) => ({ name, productRole }));

    response.json({
      context: {
        organization: {
          name: invite.organization.name,
          displayName: invite.organization.brandName ?? invite.organization.name,
        },
        inviter: {
          displayName: invite.invitedByName?.trim() || "TraceGenie administrator",
        },
        organizationRole: invite.orgRole,
        products,
        effectiveAccess: getInviteEffectiveAccess(invite.orgRole, products),
        status: invite.status,
        expiresAt: invite.expiresAt,
      },
    });
  }),
);

router.post(
  "/:organizationId/invites",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const organizationId = getSingleParam(request.params.organizationId);
    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireOrgAccessForUser(request.adminUser!.id, organizationId, ["OWNER", "ADMIN"]);
    }
    await assertOrgWritable(organizationId);
    const body = inviteCreateSchema.parse(request.body);
    const token = randomToken();
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const projectIds = Array.from(new Set(body.projectIds?.length ? body.projectIds : body.projectId ? [body.projectId] : []));
    if (projectIds.length > 0) {
      const projectCount = await prisma.project.count({
        where: {
          id: { in: projectIds },
          organizationId,
        },
      });
      if (projectCount !== projectIds.length) {
        throw new AppError(422, "invites.project_org_mismatch", "The invited project does not belong to this organization.");
      }
    }
    const invite = await prisma.$transaction(async (transaction) => {
      const createdInvite = await transaction.invite.create({
        data: {
          organizationId,
          projectId: projectIds[0],
          projectIdsJson: projectIds.length > 0 ? projectIds : undefined,
          invitedByUserId: request.adminUser!.id,
          invitedByName: request.adminUser!.name,
          email: body.email.toLowerCase().trim(),
          orgRole: body.orgRole,
          projectRole: body.projectRole,
          projectLinks: body.projectRole && projectIds.length > 0
            ? {
                create: projectIds.map((projectId) => ({
                  projectId,
                  role: body.projectRole!,
                })),
              }
            : undefined,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      await writePlatformAudit({
        organizationId,
        actorUserId: request.adminUser?.id,
        eventType: "org.invite_created",
        afterJson: {
          inviteId: createdInvite.id,
          email: createdInvite.email,
          orgRole: createdInvite.orgRole,
          projectId: createdInvite.projectId,
          projectIds,
          projectRole: createdInvite.projectRole,
        },
      }, transaction);

      return createdInvite;
    });

    const acceptUrl = `${env.ADMIN_APP_URL}/accept-invite?token=${token}`;
    const emailDelivery = await notifyInvite({
      to: invite.email,
      organizationName: organization.name,
      acceptUrl,
      invitedByName: invite.invitedByName,
      logoUrl: organization.logoUrl,
      primaryColor: organization.primaryColor,
      accentColor: organization.accentColor,
      emailFooterText: organization.emailFooterText,
    });
    await writePlatformAudit({
      organizationId,
      actorUserId: request.adminUser?.id,
      eventType: "org.invite_email_delivery",
      afterJson: {
        inviteId: invite.id,
        email: invite.email,
        emailDelivery,
      },
    });

    response.status(201).json({
      invite: {
        ...invite,
        acceptUrl,
        emailDelivery,
      },
    });
  }),
);

router.post(
  "/invites/accept",
  asyncHandler(async (request, response) => {
    const body = z
      .object({
        token: z.string().min(20),
        name: z.string().trim().min(1).max(100),
        password: z.string().min(8),
      })
      .parse(request.body);
    const tokenHash = sha256(body.token);
    const passwordHash = await bcrypt.hash(body.password, 10);

    const user = await prisma.$transaction(async (transaction) => {
      const invite = await transaction.invite.findUnique({
        where: { tokenHash },
        include: {
          projectLinks: true,
        },
      });
      const now = new Date();

      if (!invite || invite.status !== "PENDING" || invite.expiresAt < now) {
        throw new AppError(404, "invites.not_found", "This invite is invalid or expired.");
      }

      const organization = await transaction.organization.findUniqueOrThrow({
        where: { id: invite.organizationId },
        select: { status: true, ...{} },
      });
      if (organization.status === "READ_ONLY") {
        throw new AppError(403, "project.read_only", "This project is read-only.");
      }
      if (organization.status === "SUSPENDED") {
        throw new AppError(403, "org.unavailable", "This organization is unavailable.");
      }

      const projectAccess = getInviteProjectAccess(invite);
      if (projectAccess.length > 0) {
        const projectCount = await transaction.project.count({
          where: {
            id: { in: projectAccess.map((project) => project.projectId) },
            organizationId: invite.organizationId,
          },
        });
        if (projectCount !== projectAccess.length) {
          throw new AppError(422, "invites.project_org_mismatch", "The invited project no longer belongs to this organization.");
        }
      }

      const consumeResult = await transaction.invite.updateMany({
        where: {
          id: invite.id,
          status: "PENDING",
          expiresAt: { gt: now },
        },
        data: {
          status: "ACCEPTED",
          acceptedAt: now,
        },
      });

      if (consumeResult.count !== 1) {
        throw new AppError(404, "invites.not_found", "This invite is invalid or expired.");
      }

      const acceptedUser = await transaction.adminUser.upsert({
        where: { email: invite.email },
        update: {
          name: body.name,
          passwordHash,
          isActive: true,
        },
        create: {
          email: invite.email,
          name: body.name,
          passwordHash,
          role: invite.orgRole === "ADMIN" ? "ADMIN" : "TRIAGER",
          isActive: true,
        },
      });

      if (invite.orgRole) {
        await transaction.orgMembership.upsert({
          where: {
            organizationId_userId: {
              organizationId: invite.organizationId,
              userId: acceptedUser.id,
            },
          },
          update: { role: invite.orgRole, status: "ACTIVE" },
          create: {
            organizationId: invite.organizationId,
            userId: acceptedUser.id,
            role: invite.orgRole,
          },
        });
      }

      if (projectAccess.length > 0) {
        for (const project of projectAccess) {
          await transaction.projectMembership.upsert({
            where: {
              projectId_userId: {
                projectId: project.projectId,
                userId: acceptedUser.id,
              },
            },
            update: { role: project.role, status: "ACTIVE" },
            create: {
              projectId: project.projectId,
              userId: acceptedUser.id,
              role: project.role,
            },
          });
        }
      }

      await writePlatformAudit({
        organizationId: invite.organizationId,
        actorUserId: acceptedUser.id,
        eventType: "org.invite_accepted",
        afterJson: {
          inviteId: invite.id,
          acceptedUserId: acceptedUser.id,
          acceptedEmail: acceptedUser.email,
          orgRole: invite.orgRole,
          projectAccess: projectAccess
            .map((project) => ({
              projectId: project.projectId,
              role: project.role,
            }))
            .sort((left, right) => left.projectId.localeCompare(right.projectId)),
        },
      }, transaction);

      return acceptedUser;
    });

    const result = await authService.createSession(user.id);
    response.cookie(ADMIN_SESSION_COOKIE_NAME, result.sessionToken, buildAdminSessionCookieOptions());
    response.json({ token: "cookie-session", user: result.user });
  }),
);

export { router as organizationsRouter };
