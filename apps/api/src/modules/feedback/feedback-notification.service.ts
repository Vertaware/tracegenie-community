import {
AuditActorType,
FeedbackRecipientType,
FeedbackStatus,
NotificationEventType,
NotificationProvider,
NotificationStatus,
Prisma,
} from "@prisma/client";
import {
renderRequesterStatusEmail,
renderRequesterTriageEmail,
renderNewIssueEmail,
renderRequesterConfirmationEmail,
} from "@vertaware/email";
import { feedbackCustomerImpactSchema,widgetProjectConfigSchema } from "@tracegenie/shared";

import { installationMailer,resolveEmailSettings,type InstallationMailer } from "../email/email-settings.service";

import { env } from "../../config/env";
import { createReporterTrackingUrl } from "../reporter/reporter.bridge";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { assertOrgWritable } from "../organizations/access";
import { feedbackAuditService } from "./feedback-audit.service";

const REPORT_SPIKE_WINDOW_MS = 60 * 60 * 1000;
const REPORT_SPIKE_COUNT = 5;
const REGRESSION_ALERT_STATUSES = new Set<FeedbackStatus>([
  FeedbackStatus.NEW,
  FeedbackStatus.TRIAGED,
  FeedbackStatus.BLOCKED,
  FeedbackStatus.IN_PROGRESS,
  FeedbackStatus.BACKLOG,
]);
const replayableNotificationStatuses = new Set<NotificationStatus>([
  NotificationStatus.FAILED,
]);

type FeedbackNotificationContext = {
  feedbackItemId: string;
  integrationClientId?: string | null;
  dedupeKey: string;
  requestId?: string | null;
  idempotencyKey?: string | null;
  retryFailedDelivery?: boolean;
};

type TriageNotificationInput = FeedbackNotificationContext & {
  safeSummary: string;
  nextAction?: string | null;
};

type StatusNotificationInput = FeedbackNotificationContext & {
  status: FeedbackStatus;
  publicSummary?: string | null;
};

type ReopenNotificationInput = FeedbackNotificationContext & {
  publicSummary?: string | null;
};

type NewIssueNotificationInput = FeedbackNotificationContext & {
  recipientEmails: string[];
};

const statusLabels: Record<FeedbackStatus, string> = {
  NEW: "Open",
  TRIAGED: "Triaged",
  BLOCKED: "Blocked",
  DUPLICATE: "Duplicate",
  BACKLOG: "Backlog",
  IN_PROGRESS: "In Progress",
  FIXED: "Resolved",
  CLOSED: "Closed",
};

const MAX_NOTIFICATION_ATTEMPTS = 5;
const BASE_NOTIFICATION_RETRY_MS = 60_000;
const MAX_NOTIFICATION_RETRY_MS = 60 * 60_000;
const OUTBOX_LOCK_STALE_MS = 5 * 60_000;

type NotificationRecipient = {
  feedbackRecipientId?: string | null;
  email: string | null;
  name?: string | null;
  recipientType: FeedbackRecipientType;
  isEnabled: boolean;
  skipReason: string | null;
  shouldReceiveForEvent: boolean;
};

export function isSubscriberEnabledForStatusChange(
  subscriberNotifyOnStatusChange: boolean,
  reporterEmail: string | null | undefined,
) {
  return subscriberNotifyOnStatusChange || !reporterEmail;
}

type RequesterEmailIdentity = {
  brandName: string;
  productName: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  emailFooterText?: string | null;
  fromName: string;
  fromEmail: string;
  replyToEmail: string;
};

type ReleaseRegressionAlert = {
  fixedTicketNumber: number;
  fixedTitle: string;
  fixedAppVersion: string;
  fixedBuildNumber?: string | null;
  fixedReleaseChannel?: string | null;
  fixedAt: Date;
};

function buildRequesterTriageSubject(productName: string, ticketNumber: number) {
  return `${productName}: update on your ticket #${ticketNumber}`;
}

function buildRequesterStatusSubject(productName: string, ticketNumber: number) {
  return `${productName}: update on your ticket #${ticketNumber}`;
}

function requesterStatusEventType(status: FeedbackStatus) {
  return status === FeedbackStatus.FIXED || status === FeedbackStatus.CLOSED
    ? NotificationEventType.FIXED_REQUESTER
    : NotificationEventType.STATUS_CHANGE_REQUESTER;
}

function buildRequesterResolutionSubject(productName: string, ticketNumber: number, status: FeedbackStatus) {
  if (status === FeedbackStatus.FIXED) {
    return `${productName}: ticket #${ticketNumber} is fixed`;
  }
  if (status === FeedbackStatus.CLOSED) {
    return `${productName}: ticket #${ticketNumber} is closed`;
  }
  return buildRequesterStatusSubject(productName, ticketNumber);
}

function releaseLabel(feedback: { appVersion: string; buildNumber?: string | null; releaseChannel?: string | null }) {
  return [
    `version ${feedback.appVersion}`,
    feedback.buildNumber ? `build ${feedback.buildNumber}` : null,
    feedback.releaseChannel ? `${feedback.releaseChannel} channel` : null,
  ].filter(Boolean).join(", ");
}

function buildStatusNextSteps(status: FeedbackStatus, feedback?: { appVersion: string; buildNumber?: string | null; releaseChannel?: string | null }) {
  switch (status) {
    case FeedbackStatus.TRIAGED:
      return "Our team has completed initial triage and will continue investigating the issue.";
    case FeedbackStatus.IN_PROGRESS:
      return "Our team is actively working on this issue and will share another update when progress is made.";
    case FeedbackStatus.BLOCKED:
      return "We are currently blocked and will share another update as soon as the blocker is cleared.";
    case FeedbackStatus.FIXED:
      if (feedback?.appVersion) {
        return `The fix is available in ${releaseLabel(feedback)}. We will follow up if any additional action is needed.`;
      }
      return "A fix has been identified or applied, and we will follow up if any additional action is needed.";
    case FeedbackStatus.CLOSED:
      return "This ticket is now closed. If the issue persists, please submit a new report.";
    case FeedbackStatus.BACKLOG:
      return "This issue has been added to our backlog and we will share another update when prioritization changes.";
    case FeedbackStatus.DUPLICATE:
      return "This ticket has been linked to an existing issue and we will continue tracking it through that work.";
    case FeedbackStatus.NEW:
    default:
      return "Our team will continue reviewing the issue and share another update when the status changes.";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function hasHighValueCustomerImpact(extraContext: unknown) {
  const result = feedbackCustomerImpactSchema.safeParse(asRecord(extraContext)?.customerImpact);
  return result.success && Boolean(
    result.data.revenueAtRisk || result.data.churnRisk === "high" || result.data.churnRisk === "critical",
  );
}

async function hasRecentReportSpike(feedback: NonNullable<LoadedFeedback>) {
  const windowStart = new Date(feedback.createdAt.getTime() - REPORT_SPIKE_WINDOW_MS);
  // ponytail: fixed route-burst heuristic; replace with configurable alert rules when that model exists.
  const count = await prisma.feedbackItem.count({
    where: {
      projectId: feedback.projectId,
      currentUrl: feedback.currentUrl,
      createdAt: {
        gte: windowStart,
        lte: feedback.createdAt,
      },
    },
  });
  return count >= REPORT_SPIKE_COUNT;
}

function fixedAtForRegressionSource(source: { createdAt: Date; statusHistory: Array<{ createdAt: Date }> }) {
  return source.statusHistory[0]?.createdAt ?? source.createdAt;
}

async function findReleaseRegressionAlert(feedback: NonNullable<LoadedFeedback>): Promise<ReleaseRegressionAlert | null> {
  if (!feedback.duplicateFingerprint || !REGRESSION_ALERT_STATUSES.has(feedback.status)) {
    return null;
  }

  const fixedReports = await prisma.feedbackItem.findMany({
    where: {
      id: { not: feedback.id },
      projectId: feedback.projectId,
      duplicateFingerprint: feedback.duplicateFingerprint,
      createdAt: { lt: feedback.createdAt },
      OR: [
        { status: FeedbackStatus.FIXED },
        { statusHistory: { some: { toStatus: FeedbackStatus.FIXED } } },
      ],
    },
    select: {
      ticketNumber: true,
      title: true,
      appVersion: true,
      buildNumber: true,
      releaseChannel: true,
      createdAt: true,
      statusHistory: {
        where: { toStatus: FeedbackStatus.FIXED },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  const fixedReport = fixedReports
    .filter((report) => fixedAtForRegressionSource(report) < feedback.createdAt)
    .sort((left, right) => fixedAtForRegressionSource(right).getTime() - fixedAtForRegressionSource(left).getTime())[0];

  if (!fixedReport) {
    return null;
  }

  return {
    fixedTicketNumber: fixedReport.ticketNumber,
    fixedTitle: fixedReport.title,
    fixedAppVersion: fixedReport.appVersion,
    fixedBuildNumber: fixedReport.buildNumber,
    fixedReleaseChannel: fixedReport.releaseChannel,
    fixedAt: fixedAtForRegressionSource(fixedReport),
  };
}

function buildRecipientScopedIdempotencyKey(
  idempotencyKey: string | null | undefined,
  recipient: NotificationRecipient,
) {
  if (!idempotencyKey) {
    return null;
  }

  return `${idempotencyKey}:${recipient.recipientType.toLowerCase()}:${recipient.email ?? "missing-email"}`;
}

type LoadedFeedback = Awaited<ReturnType<FeedbackNotificationService["loadNotificationFeedback"]>>;

type DeliveryAuditOptions = {
  requestId?: string | null;
  idempotencyKey?: string | null;
  sentAuditEventType?: string;
  failedAuditEventType?: string;
};

type NotificationOutboxBatchOptions = {
  limit?: number;
  workerId?: string;
  now?: Date;
};

type NotificationOutboxBatchResult = {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
};

function buildNextNotificationAttemptAt(attemptCount: number, now = new Date()) {
  if (attemptCount >= MAX_NOTIFICATION_ATTEMPTS) {
    return null;
  }

  const retryMs = Math.min(
    BASE_NOTIFICATION_RETRY_MS * Math.pow(2, Math.max(0, attemptCount - 1)),
    MAX_NOTIFICATION_RETRY_MS,
  );

  return new Date(now.getTime() + retryMs);
}

function buildErrorJson(error: unknown) {
  return {
    message: error instanceof Error ? error.message : "Unknown email send failure",
  };
}

function buildDeliveryAuditTypes(eventType: NotificationEventType) {
  switch (eventType) {
    case NotificationEventType.NEW_ISSUE_ADMIN:
      return {
        sentAuditEventType: "NEW_ISSUE_NOTIFICATION_SENT",
        failedAuditEventType: "NEW_ISSUE_NOTIFICATION_FAILED",
      };
    case NotificationEventType.REQUESTER_CONFIRMATION:
      return {
        sentAuditEventType: "REQUESTER_CONFIRMATION_SENT",
        failedAuditEventType: "REQUESTER_CONFIRMATION_FAILED",
      };
    case NotificationEventType.TRIAGE_REQUESTER:
    case NotificationEventType.STATUS_CHANGE_REQUESTER:
    default:
      return {
        sentAuditEventType: "REQUESTER_NOTIFICATION_SENT",
        failedAuditEventType: "REQUESTER_NOTIFICATION_FAILED",
      };
  }
}

export class FeedbackNotificationService {
  constructor(private readonly mailer: InstallationMailer = installationMailer) {}

  private async loadNotificationFeedback(feedbackItemId: string) {
    const feedback = await prisma.feedbackItem.findUnique({
      where: { id: feedbackItemId },
      include: {
        project: true,
        subscribers: {
          where: {
            isActive: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!feedback) {
      return null;
    }

    return feedback;
  }

  private async createSkippedNotification(
    feedback: NonNullable<LoadedFeedback>,
    input: FeedbackNotificationContext,
    eventType: NotificationEventType,
    recipient: NotificationRecipient,
    skipReason: string,
    identity: RequesterEmailIdentity,
    triggerStatus?: FeedbackStatus,
  ) {
    const notification = await prisma.feedbackNotification.create({
      data: {
        feedbackItemId: feedback.id,
        feedbackRecipientId: recipient.feedbackRecipientId ?? null,
        integrationClientId: input.integrationClientId ?? null,
        eventType,
        recipientEmail: recipient.email,
        recipientName: recipient.name ?? null,
        recipientType: recipient.recipientType,
        dedupeKey: `${input.dedupeKey}:${recipient.recipientType.toLowerCase()}:${recipient.email ?? "missing-email"}`,
        triggerStatus,
        fromName: identity.fromName,
        fromEmail: identity.fromEmail,
        replyToEmail: identity.replyToEmail,
        productNameSnapshot: identity.productName,
        status: NotificationStatus.SKIPPED,
        provider: NotificationProvider.NONE,
        skipReason,
      },
    });

    await feedbackAuditService.createEvent({
      feedbackItemId: feedback.id,
      projectId: feedback.projectId,
      actorType: "SYSTEM",
      integrationClientId: input.integrationClientId ?? null,
      eventType: "REQUESTER_NOTIFICATION_SKIPPED",
      afterJson: {
        notificationId: notification.id,
        dedupeKey: notification.dedupeKey,
        skipReason,
        eventType: notification.eventType,
      },
      requestId: input.requestId ?? null,
      idempotencyKey: buildRecipientScopedIdempotencyKey(input.idempotencyKey, recipient),
    });

    return notification;
  }

  private async markNotificationSkipped(
    notificationId: string,
    skipReason: string,
    auditOptions: DeliveryAuditOptions = {},
  ) {
    const notification = await prisma.feedbackNotification.findUnique({
      where: { id: notificationId },
      include: {
        feedbackItem: {
          select: {
            id: true,
            projectId: true,
          },
        },
      },
    });

    if (!notification) {
      return null;
    }

    const skipped = await prisma.feedbackNotification.update({
      where: { id: notification.id },
      data: {
        status: NotificationStatus.SKIPPED,
        skipReason,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: null,
      },
    });

    await feedbackAuditService.createEvent({
      feedbackItemId: notification.feedbackItem.id,
      projectId: notification.feedbackItem.projectId,
      actorType: "SYSTEM",
      integrationClientId: notification.integrationClientId ?? null,
      eventType: "REQUESTER_NOTIFICATION_SKIPPED",
      afterJson: {
        notificationId: skipped.id,
        dedupeKey: skipped.dedupeKey,
        skipReason,
        eventType: skipped.eventType,
      },
      requestId: auditOptions.requestId ?? null,
      idempotencyKey: auditOptions.idempotencyKey ?? null,
    });

    return skipped;
  }

  private async deliverNotification(notificationId: string, auditOptions: DeliveryAuditOptions = {}) {
    const notification = await prisma.feedbackNotification.findUnique({
      where: { id: notificationId },
      include: {
        feedbackItem: {
          select: {
            id: true,
            projectId: true,
          },
        },
      },
    });

    if (!notification) {
      return null;
    }

    if (!notification.recipientEmail || !notification.subjectSnapshot || !notification.bodySnapshot) {
      return this.markNotificationSkipped(notification.id, "missing_email_delivery_snapshot", auditOptions);
    }

    const from = notification.fromName && notification.fromEmail
      ? `${notification.fromName} <${notification.fromEmail}>`
      : notification.fromEmail ?? undefined;

    try {
      await this.mailer.send({
        to: notification.recipientEmail,
        from,
        replyTo: notification.replyToEmail ?? undefined,
        subject: notification.subjectSnapshot,
        html: notification.bodySnapshot,
      });

      const sent = await prisma.feedbackNotification.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.SENT,
          sentAt: new Date(),
          attemptCount: { increment: 1 },
          nextAttemptAt: null,
          lockedAt: null,
          lockedBy: null,
          errorJson: Prisma.DbNull,
        },
      });

      await feedbackAuditService.createEvent({
        feedbackItemId: notification.feedbackItem.id,
        projectId: notification.feedbackItem.projectId,
        actorType: "SYSTEM",
        integrationClientId: notification.integrationClientId ?? null,
        eventType: auditOptions.sentAuditEventType ?? buildDeliveryAuditTypes(notification.eventType).sentAuditEventType,
        afterJson: {
          notificationId: sent.id,
          dedupeKey: sent.dedupeKey,
          eventType: sent.eventType,
          recipientEmail: sent.recipientEmail,
          recipientType: sent.recipientType,
          attemptCount: notification.attemptCount + 1,
      },
      requestId: auditOptions.requestId ?? null,
        idempotencyKey: auditOptions.idempotencyKey ?? null,
      });

      return sent;
    } catch (error) {
      logger.error(
        { error, feedbackItemId: notification.feedbackItemId, recipientEmail: notification.recipientEmail },
        "[notifications] Failed to send email",
      );

      const attemptCount = notification.attemptCount + 1;
      const failed = await prisma.feedbackNotification.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.FAILED,
          attemptCount: { increment: 1 },
          nextAttemptAt: buildNextNotificationAttemptAt(attemptCount),
          lockedAt: null,
          lockedBy: null,
          errorJson: buildErrorJson(error),
        },
      });

      await feedbackAuditService.createEvent({
        feedbackItemId: notification.feedbackItem.id,
        projectId: notification.feedbackItem.projectId,
        actorType: "SYSTEM",
        integrationClientId: notification.integrationClientId ?? null,
        eventType: auditOptions.failedAuditEventType ?? buildDeliveryAuditTypes(notification.eventType).failedAuditEventType,
        afterJson: {
          notificationId: failed.id,
          dedupeKey: failed.dedupeKey,
          eventType: failed.eventType,
          recipientEmail: failed.recipientEmail,
          recipientType: failed.recipientType,
          attemptCount,
          nextAttemptAt: failed.nextAttemptAt?.toISOString() ?? null,
      },
      requestId: auditOptions.requestId ?? null,
        idempotencyKey: auditOptions.idempotencyKey ?? null,
      });

      return failed;
    }
  }

  private async buildRequesterEmailIdentity(feedback: NonNullable<LoadedFeedback>): Promise<RequesterEmailIdentity> {
    const { sender } = await resolveEmailSettings();
    const widgetConfig = widgetProjectConfigSchema.parse(feedback.project.widgetConfig ?? {});
    const branding = widgetConfig.notificationBranding;
    const productName = feedback.project.requesterEmailProductName?.trim() || feedback.project.name;

    return {
      brandName: branding.brandName?.trim() || productName,
      productName,
      logoUrl: branding.logoUrl || null,
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      emailFooterText: branding.emailFooterText || null,
      fromName: sender.fromName,
      fromEmail: sender.fromEmail,
      replyToEmail: sender.replyTo,
    };
  }

  private async sendSingleNotification(
    feedback: NonNullable<LoadedFeedback>,
    input: FeedbackNotificationContext,
    eventType: NotificationEventType,
    recipient: NotificationRecipient,
    identity: RequesterEmailIdentity,
    subject: string,
    html: string,
    options: {
      disabledSkipReason?: string;
      triggerStatus?: FeedbackStatus;
      sentAuditEventType?: string;
      failedAuditEventType?: string;
    } = {},
  ) {
    const dedupeKey = `${input.dedupeKey}:${recipient.recipientType.toLowerCase()}:${recipient.email ?? "missing-email"}`;
    const existing = await prisma.feedbackNotification.findUnique({
      where: { dedupeKey },
    });

    if (existing) {
      return existing;
    }

    if (!recipient.email) {
      return this.createSkippedNotification(
        feedback,
        input,
        eventType,
        recipient,
        recipient.skipReason ?? "missing_recipient_email",
        identity,
        options.triggerStatus,
      );
    }

    if (!recipient.isEnabled) {
      return this.createSkippedNotification(
        feedback,
        input,
        eventType,
        recipient,
        options.disabledSkipReason ?? recipient.skipReason ?? "recipient_notifications_disabled",
        identity,
        options.triggerStatus,
      );
    }

    if (!(await this.mailer.isConfigured())) {
      return this.createSkippedNotification(
        feedback,
        input,
        eventType,
        recipient,
        "email_service_not_configured",
        identity,
        options.triggerStatus,
      );
    }

    const created = await prisma.feedbackNotification.create({
      data: {
        feedbackItemId: feedback.id,
        feedbackRecipientId: recipient.feedbackRecipientId ?? null,
        integrationClientId: input.integrationClientId ?? null,
        eventType,
        recipientEmail: recipient.email,
        recipientName: recipient.name ?? null,
        recipientType: recipient.recipientType,
        dedupeKey,
        triggerStatus: options.triggerStatus,
        fromName: identity.fromName,
        fromEmail: identity.fromEmail,
        replyToEmail: identity.replyToEmail,
        productNameSnapshot: identity.productName,
        subjectSnapshot: subject,
        bodySnapshot: html,
        status: NotificationStatus.PENDING,
        provider: NotificationProvider.SMTP,
      },
    });

    return this.deliverNotification(created.id, {
      requestId: input.requestId ?? null,
      idempotencyKey: buildRecipientScopedIdempotencyKey(input.idempotencyKey, recipient),
      sentAuditEventType: options.sentAuditEventType,
      failedAuditEventType: options.failedAuditEventType,
    });
  }

  private buildRecipients(
    feedback: NonNullable<LoadedFeedback>,
    eventType: NotificationEventType,
  ): NotificationRecipient[] {
    const recipients: NotificationRecipient[] = [
      {
        feedbackRecipientId: null,
        email: feedback.reporterEmail,
        name: feedback.reporterName,
        recipientType: FeedbackRecipientType.REQUESTER,
        isEnabled: feedback.requesterNotificationsEnabled,
        skipReason: feedback.reporterEmail ? "requester_notifications_disabled" : "missing_requester_email",
        shouldReceiveForEvent: true,
      },
    ];

    for (const subscriber of feedback.subscribers) {
      recipients.push({
        feedbackRecipientId: subscriber.id,
        email: subscriber.email,
        name: subscriber.name,
        recipientType: subscriber.recipientType,
        isEnabled:
          eventType === NotificationEventType.TRIAGE_REQUESTER
            ? subscriber.notifyOnTriage
            : isSubscriberEnabledForStatusChange(subscriber.notifyOnStatusChange, feedback.reporterEmail),
        skipReason: eventType === NotificationEventType.TRIAGE_REQUESTER
          ? "subscriber_triage_notifications_disabled"
          : "subscriber_status_notifications_disabled",
        shouldReceiveForEvent: true,
      });
    }

    return recipients;
  }

  async processOutboxBatch(options: NotificationOutboxBatchOptions = {}): Promise<NotificationOutboxBatchResult> {
    const result: NotificationOutboxBatchResult = {
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    };

    if (!(await this.mailer.isConfigured())) {
      return result;
    }

    const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
    const workerId = options.workerId ?? `notification-outbox-${process.pid}`;
    const now = options.now ?? new Date();
    const staleBefore = new Date(now.getTime() - OUTBOX_LOCK_STALE_MS);
    const dueAndAvailable: Prisma.FeedbackNotificationWhereInput[] = [
      {
        OR: [
          { nextAttemptAt: null },
          { nextAttemptAt: { lte: now } },
        ],
      },
      {
        OR: [
          { lockedAt: null },
          { lockedAt: { lte: staleBefore } },
        ],
      },
    ];

    const candidates = await prisma.feedbackNotification.findMany({
      where: {
        status: { in: [NotificationStatus.PENDING, NotificationStatus.FAILED] },
        provider: NotificationProvider.SMTP,
        recipientEmail: { not: null },
        subjectSnapshot: { not: null },
        bodySnapshot: { not: null },
        attemptCount: { lt: MAX_NOTIFICATION_ATTEMPTS },
        AND: dueAndAvailable,
      },
      select: {
        id: true,
        status: true,
      },
      orderBy: [
        { nextAttemptAt: "asc" },
        { createdAt: "asc" },
      ],
      take: limit,
    });

    for (const candidate of candidates) {
      const claimed = await prisma.feedbackNotification.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          attemptCount: { lt: MAX_NOTIFICATION_ATTEMPTS },
          AND: dueAndAvailable,
        },
        data: {
          lockedAt: now,
          lockedBy: workerId,
        },
      });

      if (claimed.count !== 1) {
        continue;
      }

      const delivered = await this.deliverNotification(candidate.id);
      if (!delivered) {
        continue;
      }

      result.processed += 1;
      if (delivered.status === NotificationStatus.SENT) {
        result.sent += 1;
      } else if (delivered.status === NotificationStatus.SKIPPED) {
        result.skipped += 1;
      } else if (delivered.status === NotificationStatus.FAILED) {
        result.failed += 1;
      }
    }

    return result;
  }

  async replayNotification(notificationId: string, projectIds?: string[], actorId?: string, requestId?: string | null) {
    const notification = await prisma.feedbackNotification.findUnique({
      where: { id: notificationId },
      include: {
        feedbackItem: {
          select: {
            id: true,
            projectId: true,
            organizationId: true,
          },
        },
      },
    });

    if (!notification) {
      throw new AppError(404, "notifications.not_found", "Notification was not found.");
    }
    if (projectIds && !projectIds.includes(notification.feedbackItem.projectId)) {
      throw new AppError(403, "notifications.access_denied", "You do not have access to this notification.");
    }
    await assertOrgWritable(notification.feedbackItem.organizationId);
    if (!replayableNotificationStatuses.has(notification.status)) {
      throw new AppError(409, "notifications.not_replayable", "Only failed notifications can be retried.");
    }
    if (
      notification.provider !== NotificationProvider.SMTP ||
      !notification.recipientEmail ||
      !notification.subjectSnapshot ||
      !notification.bodySnapshot
    ) {
      throw new AppError(409, "notifications.missing_delivery_snapshot", "Notification is missing a retryable email snapshot.");
    }

    const replayClaim = await prisma.feedbackNotification.updateMany({
      where: {
        id: notification.id,
        status: notification.status,
      },
      data: {
        status: NotificationStatus.PENDING,
        skipReason: null,
        errorJson: Prisma.DbNull,
        attemptCount: 0,
        nextAttemptAt: null,
        lockedAt: null,
        lockedBy: null,
        sentAt: null,
      },
    });
    if (replayClaim.count !== 1) {
      throw new AppError(409, "notifications.not_replayable", "Only failed notifications can be retried.");
    }
    const replayed = await prisma.feedbackNotification.findUniqueOrThrow({
      where: { id: notification.id },
    });

    await feedbackAuditService.createEvent({
      feedbackItemId: notification.feedbackItem.id,
      projectId: notification.feedbackItem.projectId,
      actorType: AuditActorType.ADMIN_USER,
      adminUserId: actorId ?? null,
      eventType: "REQUESTER_NOTIFICATION_REPLAYED",
      beforeJson: {
        notificationId: notification.id,
        dedupeKey: notification.dedupeKey,
        status: notification.status,
        attemptCount: notification.attemptCount,
      },
      afterJson: {
        notificationId: replayed.id,
        dedupeKey: replayed.dedupeKey,
        status: replayed.status,
      },
      requestId: requestId ?? null,
    });

    return replayed;
  }

  private async sendNotification(
    feedback: NonNullable<LoadedFeedback>,
    input: FeedbackNotificationContext,
    eventType: NotificationEventType,
    identity: RequesterEmailIdentity,
    subject: string,
    html: string,
    triggerStatus?: FeedbackStatus,
  ) {
    const recipients = this.buildRecipients(feedback, eventType);
    const results = [];

    for (const recipient of recipients) {
      const dedupeKey = `${input.dedupeKey}:${recipient.recipientType.toLowerCase()}:${recipient.email ?? "missing-email"}`;
      const existing = await prisma.feedbackNotification.findUnique({
        where: { dedupeKey },
      });

      if (existing) {
        results.push(
          input.retryFailedDelivery && existing.status === NotificationStatus.FAILED
            ? await this.deliverNotification(existing.id, {
                requestId: input.requestId ?? null,
                idempotencyKey: buildRecipientScopedIdempotencyKey(input.idempotencyKey, recipient),
              })
            : existing,
        );
        continue;
      }

      if (!recipient.shouldReceiveForEvent) {
        continue;
      }

      if (!recipient.email) {
        results.push(await this.createSkippedNotification(feedback, input, eventType, recipient, "missing_requester_email", identity, triggerStatus));
        continue;
      }

      if (!recipient.isEnabled) {
        results.push(await this.createSkippedNotification(feedback, input, eventType, recipient, recipient.skipReason ?? "recipient_notifications_disabled", identity, triggerStatus));
        continue;
      }

      if (!(await this.mailer.isConfigured())) {
        results.push(await this.createSkippedNotification(feedback, input, eventType, recipient, "email_service_not_configured", identity, triggerStatus));
        continue;
      }

      const created = await prisma.feedbackNotification.create({
        data: {
          feedbackItemId: feedback.id,
          feedbackRecipientId: recipient.feedbackRecipientId ?? null,
          integrationClientId: input.integrationClientId ?? null,
          eventType,
          recipientEmail: recipient.email,
          recipientName: recipient.name ?? null,
          recipientType: recipient.recipientType,
          dedupeKey,
          triggerStatus,
          fromName: identity.fromName,
          fromEmail: identity.fromEmail,
          replyToEmail: identity.replyToEmail,
          productNameSnapshot: identity.productName,
          subjectSnapshot: subject,
          bodySnapshot: html,
          status: NotificationStatus.PENDING,
          provider: NotificationProvider.SMTP,
        },
      });

      results.push(await this.deliverNotification(created.id, {
        requestId: input.requestId ?? null,
        idempotencyKey: buildRecipientScopedIdempotencyKey(input.idempotencyKey, recipient),
      }));
    }

    return results;
  }

  async sendTriageNotification(input: TriageNotificationInput) {
    const feedback = await this.loadNotificationFeedback(input.feedbackItemId);
    if (!feedback) {
      return null;
    }

    const identity = await this.buildRequesterEmailIdentity(feedback);

    if (!env.EMAIL_NOTIFY_REQUESTER_ON_TRIAGE) {
      return this.createSkippedNotification(
        feedback,
        input,
        NotificationEventType.TRIAGE_REQUESTER,
        {
          feedbackRecipientId: null,
          email: feedback.reporterEmail,
          name: feedback.reporterName,
          recipientType: FeedbackRecipientType.REQUESTER,
          isEnabled: feedback.requesterNotificationsEnabled,
          skipReason: "triage_requester_notifications_disabled",
          shouldReceiveForEvent: true,
        },
        "triage_requester_notifications_disabled",
        identity,
      );
    }

    const subject = buildRequesterTriageSubject(identity.productName, feedback.ticketNumber);
    const html = renderRequesterTriageEmail({
      brandName: identity.brandName,
      productName: identity.productName,
      logoUrl: identity.logoUrl,
      primaryColor: identity.primaryColor,
      accentColor: identity.accentColor,
      emailFooterText: identity.emailFooterText,
      ticketNumber: feedback.ticketNumber,
      title: feedback.title,
      statusLabel: statusLabels[FeedbackStatus.TRIAGED],
      safeSummary: input.safeSummary,
      nextSteps: input.nextAction ?? null,
    });

    return this.sendNotification(feedback, input, NotificationEventType.TRIAGE_REQUESTER, identity, subject, html);
  }

  async sendStatusNotification(input: StatusNotificationInput) {
    const feedback = await this.loadNotificationFeedback(input.feedbackItemId);
    if (!feedback) {
      return null;
    }

    const identity = await this.buildRequesterEmailIdentity(feedback);
    const eventType = requesterStatusEventType(input.status);

    if (!env.EMAIL_NOTIFY_REQUESTER_ON_STATUS) {
      return this.createSkippedNotification(
        feedback,
        input,
        eventType,
        {
          feedbackRecipientId: null,
          email: feedback.reporterEmail,
          name: feedback.reporterName,
          recipientType: FeedbackRecipientType.REQUESTER,
          isEnabled: feedback.requesterNotificationsEnabled,
          skipReason: "status_requester_notifications_disabled",
          shouldReceiveForEvent: true,
        },
        "status_requester_notifications_disabled",
        identity,
        input.status,
      );
    }

    const subject = buildRequesterResolutionSubject(identity.productName, feedback.ticketNumber, input.status);
    const html = renderRequesterStatusEmail({
      brandName: identity.brandName,
      productName: identity.productName,
      logoUrl: identity.logoUrl,
      primaryColor: identity.primaryColor,
      accentColor: identity.accentColor,
      emailFooterText: identity.emailFooterText,
      ticketNumber: feedback.ticketNumber,
      title: feedback.title,
      statusLabel: statusLabels[input.status],
      publicSummary: input.publicSummary ?? null,
      nextSteps: buildStatusNextSteps(input.status, feedback),
    });

    return this.sendNotification(
      feedback,
      input,
      eventType,
      identity,
      subject,
      html,
      input.status,
    );
  }

  async sendReopenNotification(input: ReopenNotificationInput) {
    const feedback = await this.loadNotificationFeedback(input.feedbackItemId);
    if (!feedback) {
      return null;
    }

    const identity = await this.buildRequesterEmailIdentity(feedback);

    if (!env.EMAIL_NOTIFY_REQUESTER_ON_STATUS) {
      return this.createSkippedNotification(
        feedback,
        input,
        NotificationEventType.REOPEN_REQUESTER,
        {
          feedbackRecipientId: null,
          email: feedback.reporterEmail,
          name: feedback.reporterName,
          recipientType: FeedbackRecipientType.REQUESTER,
          isEnabled: feedback.requesterNotificationsEnabled,
          skipReason: "status_requester_notifications_disabled",
          shouldReceiveForEvent: true,
        },
        "status_requester_notifications_disabled",
        identity,
        FeedbackStatus.IN_PROGRESS,
      );
    }

    const subject = `${identity.productName}: ticket #${feedback.ticketNumber} was reopened`;
    const html = renderRequesterStatusEmail({
      brandName: identity.brandName,
      productName: identity.productName,
      logoUrl: identity.logoUrl,
      primaryColor: identity.primaryColor,
      accentColor: identity.accentColor,
      emailFooterText: identity.emailFooterText,
      ticketNumber: feedback.ticketNumber,
      title: feedback.title,
      statusLabel: statusLabels[FeedbackStatus.IN_PROGRESS],
      publicSummary: input.publicSummary ?? "This report was marked as still happening.",
      nextSteps: "The ticket is back with our team for another look.",
    });

    return this.sendNotification(
      feedback,
      input,
      NotificationEventType.REOPEN_REQUESTER,
      identity,
      subject,
      html,
      FeedbackStatus.IN_PROGRESS,
    );
  }

  async sendNewIssueNotifications(input: NewIssueNotificationInput) {
    const feedback = await this.loadNotificationFeedback(input.feedbackItemId);
    if (!feedback) {
      return null;
    }

    const identity = await this.buildRequesterEmailIdentity(feedback);
    const uniqueEmails = Array.from(new Set(input.recipientEmails.map((email) => email.trim().toLowerCase()).filter(Boolean)));
    const hasSpike = await hasRecentReportSpike(feedback);
    const releaseRegression = await findReleaseRegressionAlert(feedback);
    const html = renderNewIssueEmail({
      ticketNumber: feedback.ticketNumber,
      title: feedback.title,
      description: feedback.description,
      severity: feedback.severity.toLowerCase(),
      issueType: feedback.issueType.toLowerCase(),
      reporterName: feedback.reporterName,
      reporterEmail: feedback.reporterEmail,
      currentUrl: feedback.currentUrl,
      projectName: feedback.project.name,
      projectKey: feedback.project.key,
      adminConsoleUrl: env.ADMIN_APP_URL,
      feedbackId: feedback.id,
      releaseRegression,
    });
    const subjectTags = [
      "TraceGenie",
      feedback.severity === "CRITICAL" ? "CRITICAL" : null,
      feedback.isOverageLocked ? "CAPACITY" : null,
      hasHighValueCustomerImpact(feedback.extraContext) ? "HIGH VALUE" : null,
      hasSpike ? "SPIKE" : null,
      releaseRegression ? "REGRESSION" : null,
    ].filter(Boolean);
    const subject = `${subjectTags.map((tag) => `[${tag}]`).join("")} #${feedback.ticketNumber} - ${feedback.title}`;

    if (uniqueEmails.length === 0) {
      return [
        await this.createSkippedNotification(
          feedback,
          input,
          NotificationEventType.NEW_ISSUE_ADMIN,
          {
            email: null,
            recipientType: FeedbackRecipientType.INTERNAL_SUBSCRIBER,
            isEnabled: false,
            skipReason: "missing_admin_notification_recipients",
            shouldReceiveForEvent: true,
          },
          "missing_admin_notification_recipients",
          identity,
        ),
      ];
    }

    const results = [];
    for (const email of uniqueEmails) {
      results.push(await this.sendSingleNotification(
        feedback,
        input,
        NotificationEventType.NEW_ISSUE_ADMIN,
        {
          email,
          recipientType: FeedbackRecipientType.INTERNAL_SUBSCRIBER,
          isEnabled: env.EMAIL_NOTIFY_ON_NEW_ISSUE,
          skipReason: "new_issue_notifications_disabled",
          shouldReceiveForEvent: true,
        },
        identity,
        subject,
        html,
        {
          disabledSkipReason: "new_issue_notifications_disabled",
          sentAuditEventType: "NEW_ISSUE_NOTIFICATION_SENT",
          failedAuditEventType: "NEW_ISSUE_NOTIFICATION_FAILED",
        },
      ));
    }

    return results;
  }

  async sendRequesterConfirmation(input: FeedbackNotificationContext) {
    const feedback = await this.loadNotificationFeedback(input.feedbackItemId);
    if (!feedback) {
      return null;
    }

    const identity = await this.buildRequesterEmailIdentity(feedback);
    const html = renderRequesterConfirmationEmail({
      ticketNumber: feedback.ticketNumber,
      title: feedback.title,
      productName: feedback.project.requesterEmailProductName ?? feedback.project.name,
      ticketUrl: createReporterTrackingUrl({
        feedbackId: feedback.id,
        organizationId: feedback.organizationId,
        projectId: feedback.projectId,
      }),
      myTicketsUrl: new URL("/reporter?view=all", env.ADMIN_APP_URL).toString(),
    });
    const subject = `[TraceGenie] Report #${feedback.ticketNumber} was received`;

    return this.sendSingleNotification(
      feedback,
      input,
      NotificationEventType.REQUESTER_CONFIRMATION,
      {
        email: feedback.reporterEmail,
        name: feedback.reporterName,
        recipientType: FeedbackRecipientType.REQUESTER,
        isEnabled: Boolean(feedback.reporterEmail),
        skipReason: "missing_requester_email",
        shouldReceiveForEvent: true,
      },
      identity,
      subject,
      html,
      {
        sentAuditEventType: "REQUESTER_CONFIRMATION_SENT",
        failedAuditEventType: "REQUESTER_CONFIRMATION_FAILED",
      },
    );
  }
}

export const feedbackNotificationService = new FeedbackNotificationService();
