import test from "node:test";
import assert from "node:assert/strict";

import {
  FeedbackStatus,
  FeedbackRecipientType,
  NotificationEventType,
  NotificationProvider,
  NotificationStatus,
  Prisma,
} from "@prisma/client";
import type { EmailService } from "@vertaware/email";

import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { readReporterBridgeToken } from "../reporter/reporter.bridge";
import { FeedbackNotificationService, isSubscriberEnabledForStatusChange } from "./feedback-notification.service";

env.EMAIL_NOTIFY_ON_NEW_ISSUE = true;
env.EMAIL_NOTIFY_REQUESTER_ON_STATUS = true;

function testSlug(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createFakeMailer(send: EmailService["send"]): EmailService {
  return {
    isConfigured: () => true,
    send,
  };
}

async function createNotificationFixture(input: {
  status?: NotificationStatus;
  attemptCount?: number;
  nextAttemptAt?: Date | null;
} = {}) {
  const organization = await prisma.organization.create({
    data: {
      name: "Notification outbox test",
      slug: testSlug("notification-outbox"),
    },
  });
  const project = await prisma.project.create({
    data: {
      organizationId: organization.id,
      key: testSlug("notification-outbox-project"),
      name: "Notification outbox project",
      defaultEnvironment: "test",
      allowedOrigins: ["https://notification-outbox.example.test"],
    },
  });
  const feedback = await prisma.feedbackItem.create({
    data: {
      organizationId: organization.id,
      projectId: project.id,
      issueType: "BUG",
      severity: "LOW",
      title: "Notification outbox issue",
      description: "Retry this message.",
      currentUrl: "https://notification-outbox.example.test/issue",
      appName: "TraceGenie notification outbox",
      appEnvironment: "test",
      appVersion: "1.0.0",
      browserUserAgent: "node:test",
      viewportWidth: 1280,
      viewportHeight: 720,
      clientTimestamp: new Date(),
    },
  });
  const notification = await prisma.feedbackNotification.create({
    data: {
      feedbackItemId: feedback.id,
      eventType: NotificationEventType.REQUESTER_CONFIRMATION,
      recipientEmail: "reporter@example.test",
      recipientType: FeedbackRecipientType.REQUESTER,
      dedupeKey: testSlug("notification-outbox-dedupe"),
      fromName: "TraceGenie",
      fromEmail: "support@traceitgenie.com",
      replyToEmail: "support@traceitgenie.com",
      productNameSnapshot: "Notification outbox project",
      subjectSnapshot: "Your report was received",
      bodySnapshot: "<p>Thanks for the report.</p>",
      status: input.status ?? NotificationStatus.FAILED,
      provider: NotificationProvider.SENDGRID,
      attemptCount: input.attemptCount ?? 1,
      nextAttemptAt: input.nextAttemptAt === undefined ? new Date(Date.now() - 1_000) : input.nextAttemptAt,
    },
  });

  return {
    organization,
    project,
    feedback,
    notification,
  };
}

async function cleanupNotificationFixture(fixture: Awaited<ReturnType<typeof createNotificationFixture>>) {
  await prisma.organization.delete({ where: { id: fixture.organization.id } }).catch(() => undefined);
}

async function createNewIssueNotificationFeedback(input: {
  severity?: "LOW" | "CRITICAL";
  isOverageLocked?: boolean;
  extraContext?: Prisma.InputJsonObject;
  title?: string;
  duplicateFingerprint?: string;
  appVersion?: string;
  buildNumber?: string;
  releaseChannel?: string;
}) {
  const organization = await prisma.organization.create({
    data: {
      name: "New issue notification test",
      slug: testSlug("new-issue-notification"),
    },
  });
  const project = await prisma.project.create({
    data: {
      organizationId: organization.id,
      key: testSlug("new-issue-notification-project"),
      name: "New issue notification project",
      defaultEnvironment: "test",
    },
  });
  const feedback = await prisma.feedbackItem.create({
    data: {
      organizationId: organization.id,
      projectId: project.id,
      issueType: "BUG",
      severity: input.severity ?? "LOW",
      title: input.title ?? "Checkout is down",
      description: "Admin notification subject coverage.",
      currentUrl: "https://new-issue-notification.example.test/checkout",
      appName: "TraceGenie notification test",
      appEnvironment: "test",
      appVersion: input.appVersion ?? "1.0.0",
      buildNumber: input.buildNumber,
      releaseChannel: input.releaseChannel,
      browserUserAgent: "node:test",
      viewportWidth: 1280,
      viewportHeight: 720,
      clientTimestamp: new Date(),
      extraContext: input.extraContext,
      isOverageLocked: input.isOverageLocked ?? false,
      duplicateFingerprint: input.duplicateFingerprint,
    },
  });

  return {
    organization,
    project,
    feedback,
  };
}

test("submission confirmation includes scoped ticket and all-ticket links and sends only once", async () => {
  const { organization, project, feedback } = await createNewIssueNotificationFeedback({
    title: 'Checkout <issue> & "receipt"',
  });
  const messages: Parameters<EmailService["send"]>[0][] = [];
  const service = new FeedbackNotificationService(createFakeMailer(async (message) => {
    messages.push(message);
  }));
  const input = { feedbackItemId: feedback.id, dedupeKey: `requester-confirmation:${feedback.id}` };

  try {
    await prisma.feedbackItem.update({
      where: { id: feedback.id },
      data: { reporterEmail: "reporter@example.test" },
    });
    await service.sendRequesterConfirmation(input);
    await service.sendRequesterConfirmation(input);

    assert.equal(messages.length, 1);
    const html = messages[0]!.html;
    const ticketHref = html.match(/href="([^"]+)"[^>]*>\s*View ticket\s*<\/a>/)?.[1];
    const allTicketsHref = html.match(/href="([^"]+)"[^>]*>\s*View all my tickets\s*<\/a>/)?.[1];
    assert.ok(ticketHref);
    assert.ok(allTicketsHref);
    const ticketUrl = new URL(ticketHref);
    assert.equal(ticketUrl.origin, new URL(env.ADMIN_APP_URL).origin);
    assert.equal(ticketUrl.pathname, "/reporter");
    assert.equal(ticketUrl.search, "");
    const bridgeToken = new URLSearchParams(ticketUrl.hash.slice(1)).get("bridge");
    assert.ok(bridgeToken);
    const bridge = readReporterBridgeToken(bridgeToken);
    assert.equal(bridge.feedbackId, feedback.id);
    assert.equal(bridge.organizationId, organization.id);
    assert.equal(bridge.projectId, project.id);
    assert.equal(allTicketsHref, new URL("/reporter?view=all", env.ADMIN_APP_URL).toString());
    assert.match(html, /Checkout &lt;issue&gt; &amp; &quot;receipt&quot;/);

    const saved = await prisma.feedbackNotification.findMany({
      where: { feedbackItemId: feedback.id, eventType: NotificationEventType.REQUESTER_CONFIRMATION },
    });
    assert.equal(saved.length, 1);
    assert.equal(saved[0]!.bodySnapshot, html);
    assert.equal(saved[0]!.status, NotificationStatus.SENT);
  } finally {
    await prisma.organization.delete({ where: { id: organization.id } });
  }
});

test("submission confirmation is skipped when no customer email is present", async () => {
  const { organization, feedback } = await createNewIssueNotificationFeedback({});
  const messages: Parameters<EmailService["send"]>[0][] = [];
  const service = new FeedbackNotificationService(createFakeMailer(async (message) => {
    messages.push(message);
  }));
  try {
    await service.sendRequesterConfirmation({
      feedbackItemId: feedback.id,
      dedupeKey: `requester-confirmation:${feedback.id}`,
    });
    assert.equal(messages.length, 0);
    const saved = await prisma.feedbackNotification.findFirstOrThrow({
      where: { feedbackItemId: feedback.id, eventType: NotificationEventType.REQUESTER_CONFIRMATION },
    });
    assert.equal(saved.status, NotificationStatus.SKIPPED);
    assert.equal(saved.skipReason, "missing_requester_email");
  } finally {
    await prisma.organization.delete({ where: { id: organization.id } });
  }
});

test("status-change subscribers stay eligible when requester email is missing", () => {
  assert.equal(isSubscriberEnabledForStatusChange(false, null), true);
  assert.equal(isSubscriberEnabledForStatusChange(false, ""), true);
});

test("status-change subscribers still respect their toggle when requester email exists", () => {
  assert.equal(isSubscriberEnabledForStatusChange(false, "reporter@example.com"), false);
  assert.equal(isSubscriberEnabledForStatusChange(true, "reporter@example.com"), true);
});

test("fixed status requester notifications use the fixed requester event type", async () => {
  const { organization, feedback } = await createNewIssueNotificationFeedback({
    title: "Checkout fix shipped",
    appVersion: "2.4.0",
    buildNumber: "240",
    releaseChannel: "stable",
  });
  await prisma.feedbackItem.update({
    where: { id: feedback.id },
    data: {
      reporterEmail: "reporter@example.test",
      requesterNotificationsEnabled: true,
    },
  });
  const sentMessages: unknown[] = [];
  const service = new FeedbackNotificationService(createFakeMailer(async (message) => {
    sentMessages.push(message);
  }));

  try {
    const result = await service.sendStatusNotification({
      feedbackItemId: feedback.id,
      status: FeedbackStatus.FIXED,
      publicSummary: "The fix is available now.",
      dedupeKey: testSlug("fixed-requester-notification"),
    });

    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
    assert.equal(sentMessages.length, 1);
    assert.match((sentMessages[0] as { subject?: string }).subject ?? "", /is fixed$/);
    assert.match((sentMessages[0] as { html?: string }).html ?? "", /version 2\.4\.0, build 240, stable channel/);

    const persisted = await prisma.feedbackNotification.findFirstOrThrow({
      where: {
        feedbackItemId: feedback.id,
        eventType: NotificationEventType.FIXED_REQUESTER,
      },
    });
    assert.equal(persisted.triggerStatus, FeedbackStatus.FIXED);
    assert.match(persisted.bodySnapshot ?? "", /version 2\.4\.0, build 240, stable channel/);
  } finally {
    await prisma.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
  }
});

test("an idempotent requester retry redelivers the existing failed notification", async () => {
  const { organization, feedback } = await createNewIssueNotificationFeedback({
    title: "Requester retry delivery",
  });
  await prisma.feedbackItem.update({
    where: { id: feedback.id },
    data: {
      reporterEmail: "reporter@example.test",
      requesterNotificationsEnabled: true,
    },
  });
  let sendCount = 0;
  const service = new FeedbackNotificationService(createFakeMailer(async () => {
    sendCount += 1;
    if (sendCount === 1) throw new Error("SendGrid temporarily unavailable");
  }));
  const dedupeKey = testSlug("requester-retry-delivery");
  const input = {
    feedbackItemId: feedback.id,
    status: FeedbackStatus.TRIAGED,
    publicSummary: "We are investigating this report.",
    dedupeKey,
  };

  try {
    const failed = await service.sendStatusNotification(input);
    assert.ok(Array.isArray(failed));
    assert.equal(failed[0]?.status, NotificationStatus.FAILED);

    const duplicate = await service.sendStatusNotification(input);
    assert.ok(Array.isArray(duplicate));
    assert.equal(duplicate[0]?.status, NotificationStatus.FAILED);
    assert.equal(sendCount, 1);

    const retried = await service.sendStatusNotification({ ...input, retryFailedDelivery: true });
    assert.ok(Array.isArray(retried));
    assert.equal(retried[0]?.status, NotificationStatus.SENT);
    assert.equal(sendCount, 2);
    assert.equal(await prisma.feedbackNotification.count({ where: { feedbackItemId: feedback.id } }), 1);
  } finally {
    await prisma.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
  }
});

test("new critical issue notifications mark the admin email subject", async () => {
  const { organization, feedback } = await createNewIssueNotificationFeedback({ severity: "CRITICAL" });
  const sentMessages: unknown[] = [];
  const service = new FeedbackNotificationService(createFakeMailer(async (message) => {
    sentMessages.push(message);
  }));

  try {
    const result = await service.sendNewIssueNotifications({
      feedbackItemId: feedback.id,
      recipientEmails: ["alerts@example.test"],
      dedupeKey: testSlug("critical-notification"),
    });

    assert.equal(result?.length, 1);
    assert.equal(sentMessages.length, 1);
    assert.match((sentMessages[0] as { subject?: string }).subject ?? "", /^\[TraceGenie\]\[CRITICAL\]/);

    const persisted = await prisma.feedbackNotification.findFirstOrThrow({
      where: {
        feedbackItemId: feedback.id,
        eventType: NotificationEventType.NEW_ISSUE_ADMIN,
      },
    });
    assert.match(persisted.subjectSnapshot ?? "", /^\[TraceGenie\]\[CRITICAL\]/);
  } finally {
    await prisma.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
  }
});

test("capacity-locked issue notifications mark the admin email subject", async () => {
  const { organization, feedback } = await createNewIssueNotificationFeedback({
    isOverageLocked: true,
    title: "Capacity locked report",
  });
  const sentMessages: unknown[] = [];
  const service = new FeedbackNotificationService(createFakeMailer(async (message) => {
    sentMessages.push(message);
  }));

  try {
    const result = await service.sendNewIssueNotifications({
      feedbackItemId: feedback.id,
      recipientEmails: ["alerts@example.test"],
      dedupeKey: testSlug("capacity-notification"),
    });

    assert.equal(result?.length, 1);
    assert.equal(sentMessages.length, 1);
    assert.match((sentMessages[0] as { subject?: string }).subject ?? "", /^\[TraceGenie\]\[CAPACITY\]/);

    const persisted = await prisma.feedbackNotification.findFirstOrThrow({
      where: {
        feedbackItemId: feedback.id,
        eventType: NotificationEventType.NEW_ISSUE_ADMIN,
      },
    });
    assert.match(persisted.subjectSnapshot ?? "", /^\[TraceGenie\]\[CAPACITY\]/);
  } finally {
    await prisma.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
  }
});

test("high-value customer impact notifications mark the admin email subject", async () => {
  const { organization, feedback } = await createNewIssueNotificationFeedback({
    title: "Enterprise account blocked",
    extraContext: {
      customerImpact: {
        revenueAtRisk: {
          amount: 25000,
          currency: "USD",
        },
      },
    },
  });
  const sentMessages: unknown[] = [];
  const service = new FeedbackNotificationService(createFakeMailer(async (message) => {
    sentMessages.push(message);
  }));

  try {
    const result = await service.sendNewIssueNotifications({
      feedbackItemId: feedback.id,
      recipientEmails: ["alerts@example.test"],
      dedupeKey: testSlug("high-value-notification"),
    });

    assert.equal(result?.length, 1);
    assert.equal(sentMessages.length, 1);
    assert.match((sentMessages[0] as { subject?: string }).subject ?? "", /^\[TraceGenie\]\[HIGH VALUE\]/);
  } finally {
    await prisma.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
  }
});

test("low churn customer impact does not mark the admin email as high value", async () => {
  const { organization, feedback } = await createNewIssueNotificationFeedback({
    title: "Low churn report",
    extraContext: {
      customerImpact: {
        churnRisk: "low",
      },
    },
  });
  const sentMessages: unknown[] = [];
  const service = new FeedbackNotificationService(createFakeMailer(async (message) => {
    sentMessages.push(message);
  }));

  try {
    const result = await service.sendNewIssueNotifications({
      feedbackItemId: feedback.id,
      recipientEmails: ["alerts@example.test"],
      dedupeKey: testSlug("low-churn-notification"),
    });

    assert.equal(result?.length, 1);
    assert.equal(sentMessages.length, 1);
    assert.match((sentMessages[0] as { subject?: string }).subject ?? "", /^\[TraceGenie\]/);
    assert.doesNotMatch((sentMessages[0] as { subject?: string }).subject ?? "", /HIGH VALUE/);
  } finally {
    await prisma.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
  }
});

test("route report spikes mark the admin email subject", async () => {
  const { organization, project, feedback } = await createNewIssueNotificationFeedback({
    title: "Checkout spike report",
  });
  const previousCreatedAt = new Date(feedback.createdAt.getTime() - 5 * 60 * 1000);
  await prisma.feedbackItem.createMany({
    data: Array.from({ length: 4 }, (_, index) => ({
      organizationId: organization.id,
      projectId: project.id,
      issueType: "BUG" as const,
      severity: "LOW" as const,
      title: `Earlier checkout report ${index + 1}`,
      description: "Earlier report for the same route.",
      currentUrl: feedback.currentUrl,
      appName: "TraceGenie notification test",
      appEnvironment: "test",
      appVersion: "1.0.0",
      browserUserAgent: "node:test",
      viewportWidth: 1280,
      viewportHeight: 720,
      clientTimestamp: previousCreatedAt,
      createdAt: previousCreatedAt,
    })),
  });
  const sentMessages: unknown[] = [];
  const service = new FeedbackNotificationService(createFakeMailer(async (message) => {
    sentMessages.push(message);
  }));

  try {
    const result = await service.sendNewIssueNotifications({
      feedbackItemId: feedback.id,
      recipientEmails: ["alerts@example.test"],
      dedupeKey: testSlug("spike-notification"),
    });

    assert.equal(result?.length, 1);
    assert.equal(sentMessages.length, 1);
    assert.match((sentMessages[0] as { subject?: string }).subject ?? "", /^\[TraceGenie\]\[SPIKE\]/);
  } finally {
    await prisma.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
  }
});

test("release regressions mark the admin email subject", async () => {
  const duplicateFingerprint = testSlug("regression-fingerprint");
  const { organization, project, feedback } = await createNewIssueNotificationFeedback({
    title: "Checkout regressed after fix",
    duplicateFingerprint,
    appVersion: "1.3.0",
    buildNumber: "130",
    releaseChannel: "stable",
  });
  const fixedAt = new Date(feedback.createdAt.getTime() - 24 * 60 * 60 * 1000);
  const fixedReport = await prisma.feedbackItem.create({
    data: {
      organizationId: organization.id,
      projectId: project.id,
      status: "FIXED",
      issueType: "BUG",
      severity: "LOW",
      title: "Checkout fixed earlier",
      description: "Earlier fixed issue with the same fingerprint.",
      currentUrl: feedback.currentUrl,
      appName: "TraceGenie notification test",
      appEnvironment: "test",
      appVersion: "1.2.0",
      buildNumber: "120",
      releaseChannel: "stable",
      browserUserAgent: "node:test",
      viewportWidth: 1280,
      viewportHeight: 720,
      clientTimestamp: fixedAt,
      createdAt: fixedAt,
      duplicateFingerprint,
    },
  });
  const sentMessages: unknown[] = [];
  const service = new FeedbackNotificationService(createFakeMailer(async (message) => {
    sentMessages.push(message);
  }));

  try {
    const result = await service.sendNewIssueNotifications({
      feedbackItemId: feedback.id,
      recipientEmails: ["alerts@example.test"],
      dedupeKey: testSlug("regression-notification"),
    });

    assert.equal(result?.length, 1);
    assert.equal(sentMessages.length, 1);
    assert.match((sentMessages[0] as { subject?: string }).subject ?? "", /^\[TraceGenie\]\[REGRESSION\]/);
    assert.match((sentMessages[0] as { html?: string }).html ?? "", /Release regression detected/);
    assert.match((sentMessages[0] as { html?: string }).html ?? "", new RegExp(`ticket #${fixedReport.ticketNumber}`));
    assert.match((sentMessages[0] as { html?: string }).html ?? "", /1\.2\.0 \/ build 120 \/ stable/);
    assert.match((sentMessages[0] as { html?: string }).html ?? "", new RegExp(fixedAt.toISOString().slice(0, 10)));

    const persisted = await prisma.feedbackNotification.findFirstOrThrow({
      where: {
        feedbackItemId: feedback.id,
        eventType: NotificationEventType.NEW_ISSUE_ADMIN,
      },
    });
    assert.match(persisted.bodySnapshot ?? "", /Release regression detected/);
    assert.match(persisted.bodySnapshot ?? "", new RegExp(`ticket #${fixedReport.ticketNumber}`));
  } finally {
    await prisma.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
  }
});

test("notification outbox retries a failed message and marks it sent", async () => {
  const fixture = await createNotificationFixture();
  const sentMessages: unknown[] = [];
  const service = new FeedbackNotificationService(createFakeMailer(async (message) => {
    sentMessages.push(message);
  }));

  try {
    const result = await service.processOutboxBatch({ limit: 5 });
    assert.deepEqual(result, {
      processed: 1,
      sent: 1,
      failed: 0,
      skipped: 0,
    });
    assert.equal(sentMessages.length, 1);

    const persisted = await prisma.feedbackNotification.findUniqueOrThrow({
      where: { id: fixture.notification.id },
    });
    assert.equal(persisted.status, NotificationStatus.SENT);
    assert.equal(persisted.attemptCount, 2);
    assert.equal(persisted.nextAttemptAt, null);
    assert.equal(persisted.lockedAt, null);
    assert.ok(persisted.sentAt);
  } finally {
    await cleanupNotificationFixture(fixture);
  }
});

test("notification outbox schedules another attempt when delivery fails", async () => {
  const fixture = await createNotificationFixture();
  const beforeRetry = Date.now();
  const service = new FeedbackNotificationService(createFakeMailer(async () => {
    throw new Error("SendGrid temporarily unavailable");
  }));

  try {
    const result = await service.processOutboxBatch({ limit: 5 });
    assert.deepEqual(result, {
      processed: 1,
      sent: 0,
      failed: 1,
      skipped: 0,
    });

    const persisted = await prisma.feedbackNotification.findUniqueOrThrow({
      where: { id: fixture.notification.id },
    });
    assert.equal(persisted.status, NotificationStatus.FAILED);
    assert.equal(persisted.attemptCount, 2);
    assert.equal(persisted.lockedAt, null);
    assert.ok(persisted.nextAttemptAt);
    assert.ok(persisted.nextAttemptAt.getTime() > beforeRetry);
    assert.match(JSON.stringify(persisted.errorJson), /SendGrid temporarily unavailable/);

    const auditEvent = await prisma.feedbackAuditEvent.findFirstOrThrow({
      where: {
        feedbackItemId: fixture.feedback.id,
        eventType: "REQUESTER_CONFIRMATION_FAILED",
      },
    });
    assert.equal((auditEvent.afterJson as { eventType?: string }).eventType, NotificationEventType.REQUESTER_CONFIRMATION);
  } finally {
    await cleanupNotificationFixture(fixture);
  }
});

test("notification outbox ignores messages after the final retry attempt", async () => {
  const fixture = await createNotificationFixture({
    attemptCount: 5,
    status: NotificationStatus.FAILED,
  });
  let sendCount = 0;
  const service = new FeedbackNotificationService(createFakeMailer(async () => {
    sendCount += 1;
  }));

  try {
    const result = await service.processOutboxBatch({ limit: 5 });
    assert.deepEqual(result, {
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    });
    assert.equal(sendCount, 0);

    const persisted = await prisma.feedbackNotification.findUniqueOrThrow({
      where: { id: fixture.notification.id },
    });
    assert.equal(persisted.status, NotificationStatus.FAILED);
    assert.equal(persisted.attemptCount, 5);
  } finally {
    await cleanupNotificationFixture(fixture);
  }
});

test("failed notifications can be replayed through the outbox", async () => {
  const fixture = await createNotificationFixture({
    attemptCount: 5,
    status: NotificationStatus.FAILED,
    nextAttemptAt: new Date(Date.now() + 60_000),
  });
  const service = new FeedbackNotificationService(createFakeMailer(async () => undefined));

  try {
    await prisma.feedbackNotification.update({
      where: { id: fixture.notification.id },
      data: {
        lockedAt: new Date(),
        lockedBy: "stale-worker",
        errorJson: { message: "SendGrid unavailable" },
      },
    });

    const replayed = await service.replayNotification(
      fixture.notification.id,
      [fixture.project.id],
      undefined,
      "req-notification-replay",
    );

    assert.equal(replayed.status, NotificationStatus.PENDING);
    assert.equal(replayed.attemptCount, 0);
    assert.equal(replayed.nextAttemptAt, null);
    assert.equal(replayed.lockedAt, null);
    assert.equal(replayed.lockedBy, null);
    assert.equal(replayed.errorJson, null);

    const auditEvent = await prisma.feedbackAuditEvent.findFirstOrThrow({
      where: {
        feedbackItemId: fixture.feedback.id,
        eventType: "REQUESTER_NOTIFICATION_REPLAYED",
      },
    });
    assert.equal(auditEvent.actorType, "ADMIN_USER");
    assert.equal(auditEvent.requestId, "req-notification-replay");
    assert.equal((auditEvent.beforeJson as { attemptCount?: number }).attemptCount, 5);
    assert.equal((auditEvent.afterJson as { status?: string }).status, NotificationStatus.PENDING);

    const batchResult = await service.processOutboxBatch({ limit: 5 });
    const sent = await prisma.feedbackNotification.findUniqueOrThrow({
      where: { id: fixture.notification.id },
    });

    assert.deepEqual(batchResult, {
      processed: 1,
      sent: 1,
      failed: 0,
      skipped: 0,
    });
    assert.equal(sent.status, NotificationStatus.SENT);
    assert.equal(sent.attemptCount, 1);
  } finally {
    await cleanupNotificationFixture(fixture);
  }
});

test("concurrent failed-notification replays are claimed once", async () => {
  const fixture = await createNotificationFixture({
    attemptCount: 5,
    status: NotificationStatus.FAILED,
  });
  const service = new FeedbackNotificationService(createFakeMailer(async () => undefined));

  try {
    const results = await Promise.allSettled([
      service.replayNotification(fixture.notification.id, [fixture.project.id], undefined, "replay-one"),
      service.replayNotification(fixture.notification.id, [fixture.project.id], undefined, "replay-two"),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(rejected?.status, "rejected");
    if (rejected?.status === "rejected") {
      assert.equal(rejected.reason instanceof AppError, true);
      assert.equal((rejected.reason as AppError).code, "notifications.not_replayable");
    }
    assert.equal(await prisma.feedbackAuditEvent.count({
      where: {
        feedbackItemId: fixture.feedback.id,
        eventType: "REQUESTER_NOTIFICATION_REPLAYED",
      },
    }), 1);
  } finally {
    await cleanupNotificationFixture(fixture);
  }
});
