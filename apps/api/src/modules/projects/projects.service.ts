import crypto from "node:crypto";

import { Prisma } from "@prisma/client";
import type { ProjectEngineeringContextResponse,ProjectInstallDiagnosticsResponse,ProjectSettingsDestination } from "@tracegenie/shared";
import { getProductionPrivacyReadiness,projectKeySchema,projectSettingsDestinationSchema,projectSettingsPatchSchemas,projectUpsertSchema,widgetProjectConfigSchema } from "@tracegenie/shared";
import jwt from "jsonwebtoken";
import { z } from "zod";

import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { randomToken,sha256 } from "../../lib/security";
import { writePlatformAudit } from "../organizations/access";

type WidgetSessionPayload = {
  sub: string;
  projectKey: string;
  origin: string;
  scope: "widget_public" | "hosted_feedback" | "admin_preview";
};

type ActiveProjectOptions = {
  allowPublicAppOrigins?: boolean;
  skipOriginCheck?: boolean;
};

const WIDGET_JWT_ISSUER = "tracegenie-api";
const WIDGET_JWT_AUDIENCE = "tracegenie-widget";
const WIDGET_INSTALL_PROOF_TTL_MS = 15 * 60 * 1000;

export const PAYMENT_GRACE_PERIOD_MS = 60 * 24 * 60 * 60 * 1000;

const widgetSessionRequestSchema = z.object({
  clientSecret: z.string().trim().min(1),
  origin: z.string().trim().url(),
});

const widgetPreviewSessionRequestSchema = z.object({
  origin: z.string().trim().url(),
});

function hashClientSecret(secret: string) {
  return sha256(secret);
}

function secretsMatch(expectedHash: string, providedSecret: string) {
  const expected = Buffer.from(expectedHash, "hex");
  const provided = Buffer.from(hashClientSecret(providedSecret), "hex");
  if (expected.length !== provided.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, provided);
}

function generateWidgetClientSecret() {
  return `tgws_${randomToken()}${randomToken()}`;
}

const projectAuditSelect = {
  id: true,
  organizationId: true,
  key: true,
  name: true,
  description: true,
  defaultEnvironment: true,
  allowedOrigins: true,
  notificationEmails: true,
  requesterEmailProductName: true,
  widgetClientSecretHash: true,
  widgetClientSecretRotatedAt: true,
  widgetSessionLastIssuedAt: true,
  widgetConfig: true,
  onboardingVersion: true,
  onboardingCompletedStep: true,
  onboardingCompletedAt: true,
  onboardingInstallMethod: true,
  onboardingWebsite: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;

type ProjectAuditRecord = Prisma.ProjectGetPayload<{ select: typeof projectAuditSelect }>;
type ActivationProof = ProjectInstallDiagnosticsResponse["proofs"][number];

const projectEngineeringContextSelect = {
  repositoryUrl: true,
  defaultBranch: true,
  worktreePath: true,
  installCommand: true,
  testCommand: true,
  buildCommand: true,
  autoFixPolicy: true,
  reviewerPolicy: true,
  requesterNotificationPolicy: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectEngineeringContextSelect;

const engineeringContextProjectSelect = {
  id: true,
  organizationId: true,
  key: true,
  name: true,
  engineeringContext: {
    select: projectEngineeringContextSelect,
  },
} satisfies Prisma.ProjectSelect;

type ProjectEngineeringContextRecord = Prisma.ProjectEngineeringContextGetPayload<{ select: typeof projectEngineeringContextSelect }>;
type EngineeringContextProjectRecord = Prisma.ProjectGetPayload<{ select: typeof engineeringContextProjectSelect }>;

function projectAuditState(project: ProjectAuditRecord) {
  const widgetConfig = widgetProjectConfigSchema.parse(project.widgetConfig);
  const { customRedactionTerms, ...privacy } = widgetConfig.privacy;

  return {
    id: project.id,
    organizationId: project.organizationId,
    key: project.key,
    name: project.name,
    description: project.description,
    defaultEnvironment: project.defaultEnvironment,
    allowedOrigins: project.allowedOrigins,
    notificationEmails: project.notificationEmails,
    requesterEmailProductName: project.requesterEmailProductName,
    isActive: project.isActive,
    clientSecretConfigured: Boolean(project.widgetClientSecretHash),
    widgetSecretRotatedAt: project.widgetClientSecretRotatedAt?.toISOString() ?? null,
    onboardingVersion: project.onboardingVersion,
    onboardingCompletedStep: project.onboardingCompletedStep,
    onboardingCompletedAt: project.onboardingCompletedAt?.toISOString() ?? null,
    onboardingInstallMethod: project.onboardingInstallMethod,
    onboardingWebsite: project.onboardingWebsite,
    widgetConfig: {
      ...widgetConfig,
      privacy: {
        ...privacy,
        customRedactionTermCount: customRedactionTerms.length,
      },
    },
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function serializeEngineeringContext(
  context: ProjectEngineeringContextRecord | null,
): ProjectEngineeringContextResponse["engineeringContext"] {
  if (!context) {
    return {
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
    };
  }

  return {
    repositoryUrl: context.repositoryUrl,
    defaultBranch: context.defaultBranch,
    worktreePath: context.worktreePath,
    installCommand: context.installCommand,
    testCommand: context.testCommand,
    buildCommand: context.buildCommand,
    autoFixPolicy: context.autoFixPolicy,
    reviewerPolicy: context.reviewerPolicy,
    requesterNotificationPolicy: context.requesterNotificationPolicy,
    notes: context.notes,
    createdAt: context.createdAt.toISOString(),
    updatedAt: context.updatedAt.toISOString(),
  };
}

function engineeringContextResponse(
  project: EngineeringContextProjectRecord,
  context = project.engineeringContext,
): ProjectEngineeringContextResponse {
  return {
    project: {
      id: project.id,
      key: project.key,
      name: project.name,
    },
    engineeringContext: serializeEngineeringContext(context),
  };
}

function parseActorUserId(input: unknown) {
  const actorUserId = (input as { actorUserId?: unknown }).actorUserId;
  return typeof actorUserId === "string" && actorUserId.trim() ? actorUserId.trim() : null;
}

function activationProof(
  id: ActivationProof["id"],
  label: string,
  status: ActivationProof["status"],
  detail: string,
  evidenceAt: Date | null,
  action: ActivationProof["action"],
  scheduledDeletionAt: Date | null = null,
): ActivationProof {
  return {
    id,
    label,
    status,
    detail,
    evidenceAt: evidenceAt?.toISOString() ?? null,
    scheduledDeletionAt: scheduledDeletionAt?.toISOString() ?? null,
    action,
  };
}

function retainedUntil(createdAt: Date | null, retentionDays: number | null) {
  if (!createdAt || retentionDays === null) return null;
  return new Date(createdAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

function originFormatError(origin: string) {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return "Enter a full origin such as https://app.example.com.";
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return "Use an http or https origin.";
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    return `Use only the origin: ${url.origin}. Remove paths, query strings, and fragments.`;
  }
  return null;
}

function normalizeOrigin(origin: string | undefined) {
  if (!origin) {
    return null;
  }

  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function isPublicAppOrigin(origin: string | undefined) {
  const normalized = normalizeOrigin(origin);
  return Boolean(normalized && env.publicAppOrigins.some((value) => normalizeOrigin(value) === normalized));
}

function publicWidgetConfig(input: ReturnType<typeof widgetProjectConfigSchema.parse>) {
  const {
    customRedactionTerms: _customRedactionTerms,
    privacyOwnerEmail: _privacyOwnerEmail,
    ...privacy
  } = input.privacy;
  return {
    ...input,
    privacy,
  };
}

function createWidgetSession(
  project: { id: string; key: string },
  origin: string,
  scope: WidgetSessionPayload["scope"] = "widget_public",
) {
  const expiresAt = new Date(Date.now() + env.WIDGET_SESSION_TTL_MINUTES * 60 * 1000);
  const token = jwt.sign(
    {
      sub: project.id,
      projectKey: project.key,
      origin,
      scope,
    } satisfies WidgetSessionPayload,
    env.JWT_SECRET,
    {
      expiresIn: `${env.WIDGET_SESSION_TTL_MINUTES}m`,
      issuer: WIDGET_JWT_ISSUER,
      audience: WIDGET_JWT_AUDIENCE,
    },
  );

  return {
    token,
    expiresAt,
  };
}

export class ProjectService {
  async getEngineeringContext(projectKey: string): Promise<ProjectEngineeringContextResponse> {
    const key = projectKeySchema.parse(projectKey);
    const project = await prisma.project.findUnique({
      where: { key },
      select: engineeringContextProjectSelect,
    });

    if (!project) {
      throw new AppError(404, "projects.not_found", "Project configuration was not found.");
    }

    return engineeringContextResponse(project);
  }


  async list(projectIds?: string[]) {
    const projects = await prisma.project.findMany({
      where: projectIds ? { id: { in: projectIds } } : undefined,
      include: { organization: true },
      orderBy: { name: "asc" },
    });

    return projects.map(({ widgetClientSecretHash, ...project }) => ({
      ...project,
      clientSecretConfigured: Boolean(widgetClientSecretHash),
      widgetSecretRotatedAt: project.widgetClientSecretRotatedAt,
      widgetConfig: widgetProjectConfigSchema.parse(project.widgetConfig),
    }));
  }

  async getActiveProject(projectKey: string, origin?: string, options: ActiveProjectOptions = {}) {
    const key = projectKeySchema.parse(projectKey);
    const project = await prisma.project.findUnique({
      where: { key },
      include: { organization: true },
    });

    if (!project || !project.isActive) {
      throw new AppError(404, "projects.not_found", "Project configuration was not found.");
    }

    if (project.organization.status === "SUSPENDED") {
      throw new AppError(403, "org.suspended", "This organization is suspended.");
    }

    const allowedOrigins = Array.from(new Set([
      ...project.allowedOrigins,
      ...(options.allowPublicAppOrigins
        ? env.publicAppOrigins.map(normalizeOrigin).filter((origin): origin is string => Boolean(origin))
        : []),
    ]));
    if (!options.skipOriginCheck && allowedOrigins.length > 0 && (!origin || !allowedOrigins.includes(origin))) {
      throw new AppError(403, "projects.origin_not_allowed", "This application origin is not allowed for the project.");
    }

    return project;
  }

  async getPublicConfig(projectKey: string, origin?: string) {
    const project = await this.getActiveProject(projectKey, origin);
    const widgetConfig = widgetProjectConfigSchema.parse(project.widgetConfig);
    await this.recordWidgetScriptLoad(project.id);

    return {
      key: project.key,
      name: project.name,
      organizationName: project.organization.name,
      defaultEnvironment: project.defaultEnvironment,
      widgetConfig: publicWidgetConfig(widgetConfig),
    };
  }

  async getHostedFeedbackConfig(projectKey: string, origin?: string) {
    if (!isPublicAppOrigin(origin)) {
      throw new AppError(403, "projects.hosted_origin_not_allowed", "Hosted feedback is only available from a TraceGenie public page.");
    }

    const project = await this.getActiveProject(projectKey, origin, { allowPublicAppOrigins: true });
    const widgetConfig = widgetProjectConfigSchema.parse(project.widgetConfig);

    return {
      key: project.key,
      name: project.name,
      organizationName: project.organization.name,
      defaultEnvironment: project.defaultEnvironment,
      widgetConfig: publicWidgetConfig(widgetConfig),
    };
  }

  private async recordWidgetScriptLoad(projectId: string) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - WIDGET_INSTALL_PROOF_TTL_MS);

    await prisma.$executeRaw`
      UPDATE "projects"
      SET "widget_last_loaded_at" = ${now}
      WHERE "id" = ${projectId}
        AND ("widget_last_loaded_at" IS NULL OR "widget_last_loaded_at" < ${cutoff})
    `;
  }

  private async recordWidgetSessionIssued(projectId: string) {
    const now = new Date();

    await prisma.$executeRaw`
      UPDATE "projects"
      SET "widget_session_last_issued_at" = ${now}
      WHERE "id" = ${projectId}
    `;
  }

  async issueWidgetSession(projectKey: string, input: unknown) {
    const body = widgetSessionRequestSchema.parse(input);
    const clientSecret = body.clientSecret;
    const origin = body.origin;

    const project = await this.getActiveProject(projectKey, origin);
    if (!project.widgetClientSecretHash || !secretsMatch(project.widgetClientSecretHash, clientSecret)) {
      throw new AppError(401, "projects.invalid_client_secret", "A valid widget client secret is required.");
    }

    await this.recordWidgetSessionIssued(project.id);

    return createWidgetSession(project, origin);
  }

  async issueAdminPreviewWidgetSession(projectKey: string, input: unknown) {
    const body = widgetPreviewSessionRequestSchema.parse(input);
    const project = await this.getActiveProject(projectKey, body.origin, { allowPublicAppOrigins: true });

    return createWidgetSession(project, body.origin, "admin_preview");
  }

  async issueHostedFeedbackSession(projectKey: string, input: unknown) {
    const body = widgetPreviewSessionRequestSchema.parse(input);
    if (!isPublicAppOrigin(body.origin)) {
      throw new AppError(403, "projects.hosted_origin_not_allowed", "Hosted feedback is only available from a TraceGenie public page.");
    }

    const project = await this.getActiveProject(projectKey, body.origin, { allowPublicAppOrigins: true });

    // ponytail: hosted fallback mints a short public-page token; add stronger abuse controls when public hosted intake scales.
    return createWidgetSession(project, body.origin, "hosted_feedback");
  }

  async verifyWidgetSessionContext(projectKey: string, sessionToken: string | undefined, origin?: string) {
    if (!sessionToken) {
      if (env.ALLOW_INSECURE_PUBLIC_SUBMISSIONS) {
        return { project: await this.getActiveProject(projectKey, origin), scope: "insecure_public" as const };
      }

      throw new AppError(401, "projects.widget_session_required", "A valid widget session token is required.");
    }

    try {
      const payload = jwt.verify(sessionToken, env.JWT_SECRET, {
        issuer: WIDGET_JWT_ISSUER,
        audience: WIDGET_JWT_AUDIENCE,
      }) as WidgetSessionPayload;

      if (!origin || payload.origin !== origin) {
        throw new AppError(403, "projects.origin_not_allowed", "This application origin is not allowed for the project.");
      }

      const allowPublicAppOrigins = (payload.scope === "hosted_feedback" || payload.scope === "admin_preview") && isPublicAppOrigin(origin);
      const project = await this.getActiveProject(projectKey, origin, { allowPublicAppOrigins });

      if (
        (payload.scope !== "widget_public" && payload.scope !== "hosted_feedback" && payload.scope !== "admin_preview") ||
        payload.projectKey !== project.key ||
        payload.sub !== project.id
      ) {
        throw new AppError(401, "projects.invalid_widget_session", "The widget session token is invalid.");
      }

      return { project, scope: payload.scope };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(401, "projects.invalid_widget_session", "The widget session token is invalid.", error);
    }
  }

  async verifyWidgetSession(projectKey: string, sessionToken: string | undefined, origin?: string) {
    return (await this.verifyWidgetSessionContext(projectKey, sessionToken, origin)).project;
  }

  async rotateWidgetClientSecret(
    projectKey: string,
    projectIds?: string[],
    options: {
      actorUserId?: string | null;
      eventType?: string;
      reason?: string | null;
    } = {},
  ) {
    const key = projectKeySchema.parse(projectKey);
    const project = await prisma.project.findUnique({
      where: { key },
      select: projectAuditSelect,
    });

    if (!project) {
      throw new AppError(404, "projects.not_found", "Project configuration was not found.");
    }
    if (projectIds && !projectIds.includes(project.id)) {
      throw new AppError(403, "projects.access_denied", "You do not have access to this project.");
    }

    const widgetClientSecret = generateWidgetClientSecret();
    const updated = await prisma.$transaction(async (transaction) => {
      const updatedProject = await transaction.project.update({
        where: { id: project.id },
        data: {
          widgetClientSecretHash: hashClientSecret(widgetClientSecret),
          widgetClientSecretRotatedAt: new Date(),
        },
        select: projectAuditSelect,
      });

      await writePlatformAudit({
        organizationId: project.organizationId,
        actorUserId: options.actorUserId ?? null,
        eventType: options.eventType ?? "projects.widget_secret_rotated",
        reason: options.reason ?? null,
        beforeJson: projectAuditState(project),
        afterJson: projectAuditState(updatedProject),
      }, transaction);

      return updatedProject;
    });

    return {
      project: {
        id: updated.id,
        key: updated.key,
        name: updated.name,
        widgetSecretRotatedAt: updated.widgetClientSecretRotatedAt,
      },
      widgetClientSecret,
    };
  }

  async getInstallDiagnostics(projectKey: string, projectIds?: string[], originToTest?: string): Promise<ProjectInstallDiagnosticsResponse> {
    const key = projectKeySchema.parse(projectKey);
    const project = await prisma.project.findUnique({
      where: { key },
      select: {
        id: true,
        organizationId: true,
        key: true,
        name: true,
        defaultEnvironment: true,
        allowedOrigins: true,
        isActive: true,
        notificationEmails: true,
        widgetClientSecretHash: true,
        widgetConfig: true,
        widgetLastLoadedAt: true,
        widgetSessionLastIssuedAt: true,
      },
    });

    if (!project) {
      throw new AppError(404, "projects.not_found", "Project configuration was not found.");
    }
    if (projectIds && !projectIds.includes(project.id)) {
      throw new AppError(403, "projects.access_denied", "You do not have access to this project.");
    }

    const realFeedbackWhere = {
      projectId: project.id,
      NOT: {
        appVersion: "install-check",
        browserPlatform: "server",
        browserName: "TraceGenie",
      },
    } satisfies Prisma.FeedbackItemWhereInput;
    const [firstReport, screenshotProof, notificationProof] = await Promise.all([prisma.feedbackItem.findFirst({
        where: realFeedbackWhere,
        orderBy: { createdAt: "asc" },
        select: { id: true, createdAt: true, currentUrl: true, ticketNumber: true },
      }),
prisma.feedbackAttachment.findFirst({
        where: { projectId: project.id, kind: "SCREENSHOT", feedbackItem: realFeedbackWhere },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, linkedAt: true, expiresAt: true, fileName: true },
      }),
prisma.feedbackNotification.findFirst({
        where: {
          eventType: "NEW_ISSUE_ADMIN",
          recipientType: "INTERNAL_SUBSCRIBER",
          feedbackItem: realFeedbackWhere,
        },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      })]);
    const widgetConfig = widgetProjectConfigSchema.parse(project.widgetConfig);
    const privacyBlockers = getProductionPrivacyReadiness(widgetConfig);
    const privacyEnforced = project.defaultEnvironment.trim().toLowerCase() === "production";
    const scriptLoadedAt = project.widgetLastLoadedAt ?? firstReport?.createdAt ?? null;
    const screenshotRequired = widgetConfig.allowScreenshot;
    const screenshotProofAt = screenshotProof?.linkedAt ?? screenshotProof?.createdAt ?? null;
    const notificationProofAt = notificationProof?.createdAt ?? null;
    const screenshotAttached = Boolean(screenshotProofAt);
    const notificationRecorded = Boolean(notificationProofAt);
    
    const testedOrigin = originToTest?.trim() || null;
    const testedOriginFormatError = testedOrigin ? originFormatError(testedOrigin) : null;
    let observedOrigin: string | null = null;
    try {
      observedOrigin = firstReport?.currentUrl ? new URL(firstReport.currentUrl).origin : null;
    } catch {
      observedOrigin = null;
    }
    const testOrigin = testedOrigin ?? observedOrigin ?? project.allowedOrigins[0] ?? null;
    const testedOriginAllowed = testedOrigin && !testedOriginFormatError ? project.allowedOrigins.includes(testedOrigin) : null;
    const observedOriginAllowed = observedOrigin ? project.allowedOrigins.includes(observedOrigin) : null;
    const originProofAllowed = observedOriginAllowed === true;
    const originConfigured = project.allowedOrigins.length > 0 && testedOriginAllowed !== false && !testedOriginFormatError;
    const originProofAt = observedOriginAllowed ? firstReport?.createdAt ?? null : null;
    const originProofStatus: ActivationProof["status"] = testedOriginFormatError || testedOriginAllowed === false || observedOriginAllowed === false
      ? "failed"
      : project.allowedOrigins.length === 0
        ? "missing"
        : originProofAllowed
          ? "verified"
          : "configured";
    const originProofDetail = testedOriginFormatError
      ?? (testedOriginAllowed === false
        ? `${testedOrigin} is not in the allowed origins list.`
        : observedOrigin && observedOriginAllowed === false
          ? `${observedOrigin} was observed on the first report but is no longer allowed.`
          : observedOrigin && observedOriginAllowed
            ? `${observedOrigin} was observed on the first real report and remains allowed.`
            : testedOriginAllowed
              ? `${testedOrigin} matches this product's configuration; runtime proof still requires a real report from that origin.`
              : project.allowedOrigins.length > 0
                ? `${project.allowedOrigins.length} origin${project.allowedOrigins.length === 1 ? " is" : "s are"} configured; run the check for the exact install origin.`
                : "No browser origin is configured for this product.");
    const sessionIssuedAt = project.widgetSessionLastIssuedAt;
    const staleBefore = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const projectInstallHref = `/projects/${encodeURIComponent(project.key)}?section=install`;
    const proofs: ProjectInstallDiagnosticsResponse["proofs"] = [
      activationProof(
        "origin",
        "Allowed origin",
        originProofStatus,
        originProofDetail,
        originProofAt,
        originProofAllowed ? null : { label: originConfigured ? "Send test report" : project.allowedOrigins.length > 0 ? "Verify origin" : "Add origin", href: originConfigured ? `${projectInstallHref}#widget-install-check-controls` : `${projectInstallHref}#project-allowed-origins-section` },
      ),
      activationProof(
        "session",
        "Token and session",
        !project.isActive || !project.widgetClientSecretHash
          ? "failed"
          : sessionIssuedAt && sessionIssuedAt < staleBefore
            ? "stale"
            : sessionIssuedAt
              ? "verified"
              : "configured",
        !project.isActive
          ? "The product is inactive, so installed clients cannot create sessions."
          : !project.widgetClientSecretHash
            ? "No backend-only widget secret is configured."
            : sessionIssuedAt
              ? `A production widget session was issued${scriptLoadedAt && sessionIssuedAt >= scriptLoadedAt ? " after the widget loaded" : ""}.`
              : "The secret is configured, but no production widget session has been observed.",
        sessionIssuedAt,
        sessionIssuedAt && sessionIssuedAt >= staleBefore ? null : { label: !project.widgetClientSecretHash ? "Generate secret" : "Verify session", href: `${projectInstallHref}#widget-snippet-details` },
      ),
      activationProof("first_report", "First report", firstReport ? "verified" : "missing", firstReport ? `Report #${firstReport.ticketNumber} reached this product through the intake path.` : "No report has been received for this product.", firstReport?.createdAt ?? null, firstReport ? null : { label: "Send test report", href: `${projectInstallHref}#widget-install-check-controls` }, retainedUntil(firstReport?.createdAt ?? null, widgetConfig.privacy.retentionDays)),
      activationProof(
        "attachment",
        "Attachment path",
        !screenshotRequired ? "manual" : screenshotAttached ? "verified" : "missing",
        !screenshotRequired
          ? "Screenshot capture is disabled; confirm that this is the intended evidence policy."
          : screenshotAttached
            ? `${screenshotProof?.fileName ?? "Screenshot evidence"} was stored and linked to a report for this product.`
            : "No screenshot is linked to a report for this product.",
        screenshotProofAt,
        screenshotAttached ? null : { label: !screenshotRequired ? "Review capture policy" : "Send report with screenshot", href: !screenshotRequired ? `/projects/${encodeURIComponent(project.key)}?section=capture` : `${projectInstallHref}#widget-install-check-controls` },
        screenshotProof?.expiresAt ?? retainedUntil(screenshotProof?.createdAt ?? null, widgetConfig.privacy.attachmentRetentionDays),
      ),
      activationProof(
        "notification",
        "Notification event",
        project.notificationEmails.length === 0 ? "failed" : notificationRecorded ? "verified" : "missing",
        project.notificationEmails.length === 0
          ? "No internal notification recipient is configured."
          : notificationRecorded
            ? "An internal new-issue notification event was created for this product."
            : "Recipients are configured, but no internal new-issue notification event exists for this product.",
        notificationProofAt,
        notificationRecorded ? null : { label: project.notificationEmails.length === 0 ? "Add recipient" : "Verify notification", href: `/projects/${encodeURIComponent(project.key)}?section=notifications#project-notification-recipients-section` },
      ),
      ...[],
    ];
    const hasFailure = proofs.some((proof) => proof.status === "failed")
      || (privacyEnforced && privacyBlockers.length > 0);
    const needsVerification = proofs.some((proof) => proof.status !== "verified");

    return {
      projectKey: project.key,
      projectName: project.name,
      status: hasFailure ? "action_required" : needsVerification ? "verification_needed" : "ready",
      checkedAt: new Date().toISOString(),
      testOrigin,
      testedOrigin,
      lastWidgetLoadedAt: project.widgetLastLoadedAt?.toISOString() ?? null,
      lastWidgetSessionIssuedAt: project.widgetSessionLastIssuedAt?.toISOString() ?? null,
      firstReportReceivedAt: firstReport?.createdAt.toISOString() ?? null,
      firstReportId: firstReport?.id ?? null,
      firstReportTicketNumber: firstReport?.ticketNumber ?? null,
      screenshotProofReceivedAt: screenshotProofAt?.toISOString() ?? null,
      notificationProofRecordedAt: notificationProofAt?.toISOString() ?? null,
      privacyReadiness: {
        status: privacyBlockers.length > 0 ? "action_required" : "ready",
        enforced: privacyEnforced,
        owner: widgetConfig.privacy.privacyOwnerEmail || null,
        policyUrl: widgetConfig.privacy.privacyUrl || null,
        issueRetentionDays: widgetConfig.privacy.retentionDays,
        attachmentRetentionDays: widgetConfig.privacy.attachmentRetentionDays,
        collectorRedactionReady: !privacyBlockers.some((blocker) => blocker.id === "collector_redaction"),
        selectedTextSuppressed: widgetConfig.privacy.suppressSelectedText,
        mcpEvidencePolicy: widgetConfig.privacy.mcpEvidenceSharing,
        blockers: privacyBlockers,
      },
      proofs,
    };
  }

  

  

  async patchSettings(
    projectKey: string,
    destinationInput: ProjectSettingsDestination,
    input: unknown,
    options: { actorUserId?: string | null; organizationId?: string } = {},
  ) {
    const key = projectKeySchema.parse(projectKey);
    const destination = projectSettingsDestinationSchema.parse(destinationInput);
    const data = projectSettingsPatchSchemas[destination].parse(input);
    const expectedUpdatedAt = new Date(data.expectedUpdatedAt);

    const project = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.project.findUnique({
        where: { key },
        select: projectAuditSelect,
      });
      if (!existing || (options.organizationId && existing.organizationId !== options.organizationId)) {
        throw new AppError(404, "projects.not_found", "Project configuration was not found.");
      }
      if (existing.updatedAt.toISOString() !== expectedUpdatedAt.toISOString()) {
        throw new AppError(409, "projects.settings_conflict", "Project settings changed since this page was loaded.");
      }

      const currentWidgetConfig = widgetProjectConfigSchema.parse(existing.widgetConfig);
      let nextWidgetConfig = currentWidgetConfig;
      const update: Prisma.ProjectUpdateManyMutationInput = {};

      switch (destination) {
        case "general": {
          const patch = projectSettingsPatchSchemas.general.parse(input);
          if (patch.name !== undefined) update.name = patch.name;
          if (patch.description !== undefined) update.description = patch.description;
          if (patch.defaultEnvironment !== undefined) update.defaultEnvironment = patch.defaultEnvironment;
          if (patch.isActive !== undefined) update.isActive = patch.isActive;
          break;
        }
        case "installation": {
          const patch = projectSettingsPatchSchemas.installation.parse(input);
          if (patch.allowedOrigins !== undefined) update.allowedOrigins = patch.allowedOrigins;
          break;
        }
        case "widget": {
          const patch = projectSettingsPatchSchemas.widget.parse(input);
          nextWidgetConfig = widgetProjectConfigSchema.parse({
            ...currentWidgetConfig,
            appearance: patch.appearance
              ? { ...currentWidgetConfig.appearance, ...patch.appearance }
              : currentWidgetConfig.appearance,
            notificationBranding: patch.notificationBranding
              ? { ...currentWidgetConfig.notificationBranding, ...patch.notificationBranding }
              : currentWidgetConfig.notificationBranding,
          });
          update.widgetConfig = nextWidgetConfig as Prisma.InputJsonValue;
          break;
        }
        case "evidence": {
          const patch = projectSettingsPatchSchemas.evidence.parse(input);
          const { expectedUpdatedAt: _version, fields, surveyPrompt, ...evidencePatch } = patch;
          const nextFields = { ...currentWidgetConfig.fields };
          if (fields) {
            for (const field of Object.keys(fields) as Array<keyof typeof fields>) {
              const fieldPatch = fields[field];
              if (fieldPatch) {
                nextFields[field] = { ...currentWidgetConfig.fields[field], ...fieldPatch };
              }
            }
          }
          nextWidgetConfig = widgetProjectConfigSchema.parse({
            ...currentWidgetConfig,
            ...evidencePatch,
            fields: nextFields,
            surveyPrompt: surveyPrompt
              ? { ...currentWidgetConfig.surveyPrompt, ...surveyPrompt }
              : currentWidgetConfig.surveyPrompt,
          });
          update.widgetConfig = nextWidgetConfig as Prisma.InputJsonValue;
          break;
        }
        case "notifications": {
          const patch = projectSettingsPatchSchemas.notifications.parse(input);
          if (patch.notificationEmails !== undefined) update.notificationEmails = patch.notificationEmails;
          if (patch.requesterEmailProductName !== undefined) update.requesterEmailProductName = patch.requesterEmailProductName;
          if (patch.notificationBranding) {
            nextWidgetConfig = widgetProjectConfigSchema.parse({
              ...currentWidgetConfig,
              notificationBranding: {
                ...currentWidgetConfig.notificationBranding,
                ...patch.notificationBranding,
              },
            });
            update.widgetConfig = nextWidgetConfig as Prisma.InputJsonValue;
          }
          break;
        }
        case "privacy": {
          const patch = projectSettingsPatchSchemas.privacy.parse(input);
          nextWidgetConfig = widgetProjectConfigSchema.parse({
            ...currentWidgetConfig,
            privacy: {
              ...currentWidgetConfig.privacy,
              ...patch.privacy,
            },
          });
          update.widgetConfig = nextWidgetConfig as Prisma.InputJsonValue;
          break;
        }
      }

      const nextIsActive = destination === "general" && "isActive" in data && data.isActive !== undefined
        ? data.isActive
        : existing.isActive;
      const nextDefaultEnvironment = destination === "general"
        && "defaultEnvironment" in data
        && data.defaultEnvironment !== undefined
        ? data.defaultEnvironment
        : existing.defaultEnvironment;
      const privacyBlockers = nextIsActive && nextDefaultEnvironment.trim().toLowerCase() === "production"
        ? getProductionPrivacyReadiness(nextWidgetConfig)
        : [];
      if (privacyBlockers.length > 0) {
        throw new AppError(
          422,
          "projects.privacy_readiness_required",
          `Production activation is blocked: ${privacyBlockers.map((blocker) => blocker.label).join(", ")}.`,
          { blockers: privacyBlockers },
        );
      }

      const changed = await transaction.project.updateMany({
        where: { id: existing.id, updatedAt: expectedUpdatedAt },
        data: update,
      });
      if (changed.count !== 1) {
        throw new AppError(409, "projects.settings_conflict", "Project settings changed since this page was loaded.");
      }

      const updatedProject = await transaction.project.findUniqueOrThrow({
        where: { id: existing.id },
        select: projectAuditSelect,
      });
      await writePlatformAudit({
        organizationId: existing.organizationId,
        actorUserId: options.actorUserId ?? null,
        eventType: `projects.settings_${destination}_updated`,
        beforeJson: projectAuditState(existing),
        afterJson: projectAuditState(updatedProject),
      }, transaction);

      return updatedProject;
    });

    const { widgetClientSecretHash, ...safeProject } = project;
    return {
      project: {
        ...safeProject,
        clientSecretConfigured: Boolean(widgetClientSecretHash),
        widgetSecretRotatedAt: project.widgetClientSecretRotatedAt,
        widgetConfig: widgetProjectConfigSchema.parse(project.widgetConfig),
      },
    };
  }

  

  

  

  async upsert(input: unknown, options: { generateWidgetClientSecret?: boolean } = {}) {
    const data = projectUpsertSchema.parse(input);
    const organizationId = z.string().trim().min(1).parse((input as { organizationId?: unknown }).organizationId);
    const actorUserId = parseActorUserId(input);
    const existing = await prisma.project.findUnique({
      where: { key: data.key },
      select: projectAuditSelect,
    });
    if (existing && existing.organizationId !== organizationId) {
      throw new AppError(409, "projects.key_in_use", "This project key is already used by another organization.");
    }

    const activatesProduction = data.isActive
      && data.defaultEnvironment.trim().toLowerCase() === "production"
      && (!existing?.isActive || existing.defaultEnvironment.trim().toLowerCase() !== "production");
    const privacyBlockers = activatesProduction ? getProductionPrivacyReadiness(data.widgetConfig) : [];
    if (privacyBlockers.length > 0) {
      throw new AppError(
        422,
        "projects.privacy_readiness_required",
        `Production activation is blocked: ${privacyBlockers.map((blocker) => blocker.label).join(", ")}.`,
        { blockers: privacyBlockers },
      );
    }

    const widgetClientSecret = options.generateWidgetClientSecret !== false && !existing?.widgetClientSecretHash
      ? generateWidgetClientSecret()
      : null;
    let created = false;
    let project;

    if (existing) {
      project = await prisma.$transaction(async (transaction) => {
        const updatedProject = await transaction.project.update({
          where: { key: data.key },
          data: {
            name: data.name,
            description: data.description,
            defaultEnvironment: data.defaultEnvironment,
            allowedOrigins: data.allowedOrigins,
            notificationEmails: data.notificationEmails,
            requesterEmailProductName: data.requesterEmailProductName,
            widgetConfig: data.widgetConfig as Prisma.InputJsonValue,
            isActive: data.isActive,
            widgetClientSecretHash: existing.widgetClientSecretHash ?? (widgetClientSecret ? hashClientSecret(widgetClientSecret) : undefined),
            ...(widgetClientSecret ? { widgetClientSecretRotatedAt: new Date() } : {}),
          },
          select: projectAuditSelect,
        });

        await writePlatformAudit({
          organizationId,
          actorUserId,
          eventType: "projects.updated",
          beforeJson: projectAuditState(existing),
          afterJson: projectAuditState(updatedProject),
        }, transaction);

        return updatedProject;
      });
    } else { throw new AppError(409, "projects.single_project", "This installation already has its project. Configure it in settings."); }

    if (!project) {
      throw new AppError(500, "projects.create_failed", "Project could not be saved.");
    }

    const { widgetClientSecretHash, ...safeProject } = project;
    return {
      project: {
        ...safeProject,
        clientSecretConfigured: Boolean(widgetClientSecretHash),
        widgetClientSecret,
        widgetSecretRotatedAt: project.widgetClientSecretRotatedAt,
        widgetConfig: widgetProjectConfigSchema.parse(project.widgetConfig),
      },
      created,
    };
  }
}

export const projectService = new ProjectService();
