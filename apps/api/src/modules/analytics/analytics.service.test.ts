import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma";
import { feedbackService } from "../feedback/feedback.service";
import { analyticsService } from "./analytics.service";

function testSlug(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function createAnalyticsProject(prefix: string) {
  const organization = await prisma.organization.create({
    data: {
      name: `${prefix} analytics test`,
      slug: testSlug(prefix),
    },
  });
  const project = await prisma.project.create({
    data: {
      organizationId: organization.id,
      key: testSlug(`${prefix}-project`),
      name: `${prefix} project`,
      defaultEnvironment: "test",
    },
  });

  return { organization, project };
}

test("analytics summary aggregates scoped project data beyond one feedback page", async () => {
  const primary = await createAnalyticsProject("primary-analytics");
  const outsideScope = await createAnalyticsProject("outside-analytics");

  try {
    const now = new Date();
    await prisma.feedbackItem.createMany({
      data: Array.from({ length: 55 }, (_, index) => ({
        projectId: primary.project.id,
        organizationId: primary.organization.id,
        issueType: "BUG",
        severity: index < 3 ? "CRITICAL" : "LOW",
        status: index % 10 === 0 ? "FIXED" : "NEW",
        title: `Primary feedback ${index}`,
        description: "Feedback used to verify full analytics aggregation.",
        currentUrl: "https://example.test/analytics",
        appName: "TraceGenie test",
        appEnvironment: "test",
        appVersion: "1.0.0",
        browserUserAgent: "node:test",
        viewportWidth: 1280,
        viewportHeight: 720,
        clientTimestamp: now,
        createdAt: new Date(now.getTime() - (54 - index) * 60_000),
      })),
    });
    await prisma.feedbackItem.createMany({
      data: Array.from({ length: 4 }, (_, index) => ({
        projectId: outsideScope.project.id,
        organizationId: outsideScope.organization.id,
        issueType: "BUG",
        severity: "HIGH",
        status: "NEW",
        title: `Outside feedback ${index}`,
        description: "Feedback outside the requested project scope.",
        currentUrl: "https://example.test/outside",
        appName: "TraceGenie test",
        appEnvironment: "test",
        appVersion: "1.0.0",
        browserUserAgent: "node:test",
        viewportWidth: 1280,
        viewportHeight: 720,
        clientTimestamp: now,
      })),
    });

    const summary = await analyticsService.getSummary([primary.project.id], { days: 7 });
    const projectRow = summary.byProject.find((row) => row.projectId === primary.project.id);
    const severityRow = summary.projectSeverity.find((row) => row.projectId === primary.project.id);

    assert.equal(projectRow?.count, 55);
    assert.deepEqual(projectRow?.latestReportAt, now);
    assert.equal(severityRow?.total, 55);
    assert.equal(severityRow?.counts.critical, 3);
    assert.equal(severityRow?.counts.low, 52);
    assert.equal(summary.byProject.some((row) => row.projectId === outsideScope.project.id), false);
    assert.equal(summary.projectSeverity.some((row) => row.projectId === outsideScope.project.id), false);
    assert.equal(summary.openClosed.at(-1)?.open, 49);
    assert.equal(summary.openClosed.at(-1)?.closed, 6);
  } finally {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [primary.organization.id, outsideScope.organization.id],
        },
      },
    });
  }
});

test("release detail keeps risk, provider shipping, retries, and notification evidence tenant scoped", async () => {
  const primary = await createAnalyticsProject("release-detail");
  const outside = await createAnalyticsProject("release-detail-outside");
  try {
    const release = await prisma.release.create({
      data: {
        releaseKey: testSlug("release-detail"), projectId: primary.project.id, appName: "Storefront",
        appEnvironment: "production", appVersion: "2.1.0", buildNumber: "210",
      },
    });
    const issue = await prisma.feedbackItem.create({
      data: {
        organizationId: primary.organization.id, projectId: primary.project.id, releaseId: release.id,
        issueType: "BUG", severity: "CRITICAL", status: "FIXED", title: "Checkout failure",
        description: "Release detail evidence.", currentUrl: "https://example.test/checkout",
        appName: "Storefront", appEnvironment: "production", appVersion: "2.1.0", buildNumber: "210",
        browserUserAgent: "node:test", viewportWidth: 1280, viewportHeight: 720,
        clientTimestamp: new Date("2026-07-15T10:00:00.000Z"),
        extraContext: { engineeringLifecycle: { branchName: null, branchUrl: null, pullRequestUrl: null, deployUrl: "https://github.com/acme/store/deployments/210", verificationState: "verified", closingOutcome: "Requester confirmed" } },
      },
    });
    await prisma.feedbackLifecycleTransition.createMany({ data: [
      { organizationId: primary.organization.id, projectId: primary.project.id, feedbackItemId: issue.id, provider: "github", providerEventId: testSlug("deploy-failed"), eventFingerprint: testSlug("fingerprint"), source: "provider", stage: "deploy", state: "failure", observedAt: new Date("2026-07-15T08:00:00.000Z") },
      { organizationId: primary.organization.id, projectId: primary.project.id, feedbackItemId: issue.id, provider: "github", providerEventId: testSlug("deploy-success"), eventFingerprint: testSlug("fingerprint"), source: "provider", stage: "deploy", state: "success", observedAt: new Date("2026-07-15T09:00:00.000Z") },
      { organizationId: primary.organization.id, projectId: primary.project.id, feedbackItemId: issue.id, provider: "manual", providerEventId: testSlug("manual-record"), eventFingerprint: testSlug("fingerprint"), source: "manual", stage: "manual", state: "recorded", safeDetails: { action: "recorded", verificationState: "verified" }, observedAt: new Date("2026-07-15T09:15:00.000Z") },
    ] });
    await prisma.feedbackNotification.create({ data: {
      feedbackItemId: issue.id, eventType: "FIXED_REQUESTER", dedupeKey: testSlug("release-notification"),
      status: "SENT", provider: "SENDGRID", attemptCount: 2, sentAt: new Date("2026-07-15T09:30:00.000Z"),
    } });

    const detail = await analyticsService.getReleaseDetail(release.id, [primary.project.id]);
    assert.equal(detail.release.issueCount, 1);
    assert.equal(detail.release.fixedIssueCount, 1);
    assert.equal(detail.release.highRiskIssueCount, 1);
    assert.equal(detail.issues[0]?.lifecycle?.verificationState, "verified");
    assert.deepEqual(detail.lifecycle.map((event) => event.state), ["recorded", "success", "failure"]);
    assert.equal(detail.lifecycle[0]?.source, "manual");
    assert.equal(detail.notifications[0]?.attemptCount, 2);
    assert.equal("recipientEmail" in detail.notifications[0]!, false);
    assert.equal(JSON.stringify(detail).includes("rawPayload"), false);
    await assert.rejects(() => analyticsService.getReleaseDetail(release.id, [outside.project.id]));
  } finally {
    await prisma.organization.deleteMany({ where: { id: { in: [primary.organization.id, outside.organization.id] } } });
  }
});

test("analytics summary reports scoped capacity-locked issue impact", async () => {
  const primary = await createAnalyticsProject("primary-capacity-lock");
  const outsideScope = await createAnalyticsProject("outside-capacity-lock");

  try {
    const now = new Date();
    await prisma.feedbackItem.createMany({
      data: [
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          issueType: "BUG",
          severity: "CRITICAL",
          status: "NEW",
          title: "Locked checkout outage",
          description: "Locked report should count as open and high risk.",
          currentUrl: "https://example.test/locked-checkout",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
          isOverageLocked: true,
        },
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          issueType: "BUG",
          severity: "LOW",
          status: "CLOSED",
          title: "Locked closed typo",
          description: "Closed locked report should not count as open or high risk.",
          currentUrl: "https://example.test/locked-closed",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
          isOverageLocked: true,
        },
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          issueType: "BUG",
          severity: "HIGH",
          status: "NEW",
          title: "Unlocked high risk issue",
          description: "Unlocked report should not affect capacity lock impact.",
          currentUrl: "https://example.test/unlocked",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
          isOverageLocked: false,
        },
        {
          projectId: outsideScope.project.id,
          organizationId: outsideScope.organization.id,
          issueType: "BUG",
          severity: "CRITICAL",
          status: "NEW",
          title: "Outside locked issue",
          description: "Out-of-scope lock should not affect scoped analytics.",
          currentUrl: "https://example.test/outside-locked",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
          isOverageLocked: true,
        },
      ],
    });

    const summary = await analyticsService.getSummary([primary.project.id], { days: 7 });
    const projectRow = summary.capacityLockImpact.byProject[0];

    assert.equal(summary.capacityLockImpact.lockedIssueCount, 2);
    assert.equal(summary.capacityLockImpact.openLockedIssueCount, 1);
    assert.equal(summary.capacityLockImpact.highRiskLockedIssueCount, 1);
    assert.equal(projectRow?.projectId, primary.project.id);
    assert.equal(projectRow?.count, 2);
    assert.equal(projectRow?.openCount, 1);
    assert.equal(projectRow?.highRiskCount, 1);
    assert.equal(summary.capacityLockImpact.byProject.some((row) => row.projectId === outsideScope.project.id), false);
  } finally {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [primary.organization.id, outsideScope.organization.id],
        },
      },
    });
  }
});

test("analytics summary aggregates product context impact from scoped feedback", async () => {
  const primary = await createAnalyticsProject("primary-context");
  const outsideScope = await createAnalyticsProject("outside-context");

  try {
    const now = new Date();
    await prisma.feedbackItem.createMany({
      data: [
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          issueType: "BUG",
          severity: "CRITICAL",
          status: "NEW",
          title: "Checkout context failure",
          description: "Checkout report with account and flag context.",
          currentUrl: "https://example.test/checkout",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
          extraContext: {
            productContext: {
              account: { id: "acct-acme", name: "Acme Corp" },
              customer: { id: "user-acme-admin", role: "admin", segment: "enterprise", cohort: "2026-q3-beta" },
              plan: { name: "Enterprise", tier: "tier-3" },
              revenue: { mrr: 12000, arr: 144000, currency: "USD" },
              feature: { area: "Checkout", key: "payment" },
              funnelStep: "Checkout payment",
              featureFlags: { checkoutV2: true },
              experiments: { checkoutCopy: "variant-b" },
            },
          },
        },
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          issueType: "BUG",
          severity: "LOW",
          status: "FIXED",
          title: "Resolved checkout context report",
          description: "Closed report with the same account and flag context.",
          currentUrl: "https://example.test/checkout",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
          extraContext: {
            productContext: {
              account: { id: "acct-acme", name: "Acme Corp" },
              customer: { id: "user-acme-admin", role: "admin", segment: "enterprise", cohort: "2026-q3-beta" },
              plan: { name: "Enterprise", tier: "tier-3" },
              revenue: { mrr: 12000, arr: 144000, currency: "USD" },
              feature: { area: "Checkout", key: "payment" },
              funnelStep: "Checkout payment",
              featureFlags: { checkoutV2: true },
              experiments: { checkoutCopy: "variant-b" },
            },
          },
        },
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          issueType: "UX",
          severity: "HIGH",
          status: "NEW",
          title: "Search flag context report",
          description: "Different account and flag variant.",
          currentUrl: "https://example.test/search",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
          extraContext: {
            productContext: {
              account: { id: "acct-beta", name: "Beta Co" },
              customer: { id: "user-beta-owner", role: "owner", segment: "self-serve", cohort: "2026-q2-onboarding" },
              plan: { name: "Pro", tier: "tier-2" },
              revenue: { mrr: 299, currency: "USD" },
              feature: { area: "Search", key: "results" },
              funnelStep: "Search results",
              featureFlags: { checkoutV2: false },
              experiments: { checkoutCopy: "control" },
            },
          },
        },
        {
          projectId: outsideScope.project.id,
          organizationId: outsideScope.organization.id,
          issueType: "BUG",
          severity: "CRITICAL",
          status: "NEW",
          title: "Outside checkout context report",
          description: "Should not affect scoped context impact.",
          currentUrl: "https://example.test/outside-checkout",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
          extraContext: {
            productContext: {
              account: { id: "acct-acme", name: "Acme Corp" },
              customer: { id: "user-outside-admin", role: "admin", segment: "enterprise", cohort: "outside-cohort" },
              plan: { name: "Enterprise", tier: "tier-3" },
              revenue: { mrr: 12000, arr: 144000, currency: "USD" },
              feature: { area: "Checkout", key: "payment" },
              funnelStep: "Checkout payment",
              featureFlags: { checkoutV2: true },
              experiments: { checkoutCopy: "variant-b" },
            },
          },
        },
      ],
    });

    const summary = await analyticsService.getSummary([primary.project.id], { days: 7 });
    const account = summary.contextImpact.topAccounts.find((row) => row.id === "acct-acme");
    const plan = summary.contextImpact.topPlans.find((row) => row.name === "Enterprise");
    const segment = summary.contextImpact.topCustomerSegments.find((row) => row.segment === "enterprise");
    const cohort = summary.contextImpact.topCustomerCohorts.find((row) => row.cohort === "2026-q3-beta");
    const productArea = summary.contextImpact.topProductAreas.find((row) => row.area === "Checkout");
    const funnelStep = summary.contextImpact.topFunnelSteps.find((row) => row.step === "Checkout payment");
    const enabledFlag = summary.contextImpact.topFeatureFlags.find((row) => row.flag === "checkoutV2" && row.value === "true");
    const experiment = summary.contextImpact.topExperiments.find((row) => row.experiment === "checkoutCopy" && row.variant === "variant-b");

    assert.equal(account?.count, 2);
    assert.equal(account?.openCount, 1);
    assert.equal(account?.highRiskCount, 1);
    assert.equal(plan?.count, 2);
    assert.equal(segment?.count, 2);
    assert.equal(segment?.openCount, 1);
    assert.equal(segment?.highRiskCount, 1);
    assert.equal(cohort?.count, 2);
    assert.equal(cohort?.openCount, 1);
    assert.equal(cohort?.highRiskCount, 1);
    assert.equal(productArea?.count, 2);
    assert.equal(productArea?.openCount, 1);
    assert.equal(productArea?.highRiskCount, 1);
    assert.equal(funnelStep?.count, 2);
    assert.equal(funnelStep?.openCount, 1);
    assert.equal(funnelStep?.highRiskCount, 1);
    assert.equal(enabledFlag?.count, 2);
    assert.equal(enabledFlag?.openCount, 1);
    assert.equal(experiment?.count, 2);
    assert.equal(experiment?.openCount, 1);
    assert.equal(experiment?.highRiskCount, 1);
    assert.equal(summary.contextImpact.topAccounts.some((row) => row.label.includes("outside")), false);
    assert.equal(summary.contextImpact.topCustomerSegments.some((row) => row.label.includes("outside")), false);
    assert.equal(summary.contextImpact.topCustomerCohorts.some((row) => row.label.includes("outside")), false);
    assert.equal(summary.contextImpact.topProductAreas.some((row) => row.label.includes("outside")), false);
    assert.equal(summary.contextImpact.topFunnelSteps.some((row) => row.label.includes("outside")), false);
    assert.equal(summary.contextImpact.topExperiments.some((row) => row.label.includes("outside")), false);
  } finally {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [primary.organization.id, outsideScope.organization.id],
        },
      },
    });
  }
});

test("analytics summary aggregates scoped tracked event impact", async () => {
  const primary = await createAnalyticsProject("primary-events");
  const outsideScope = await createAnalyticsProject("outside-events");

  try {
    const now = new Date();
    await prisma.feedbackItem.createMany({
      data: [
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          issueType: "BUG",
          severity: "HIGH",
          status: "NEW",
          title: "Checkout event report",
          description: "Report with repeated checkout events.",
          currentUrl: "https://example.test/checkout",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
          extraContext: {
            eventTrail: [
              { name: "checkout_submit", timestamp: now.toISOString(), url: "https://example.test/checkout?token=secret" },
              { name: "checkout_submit", timestamp: now.toISOString(), url: "https://example.test/checkout" },
              { name: "payment_failed", timestamp: now.toISOString(), url: "https://example.test/checkout" },
            ],
          },
        },
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          issueType: "BUG",
          severity: "LOW",
          status: "FIXED",
          title: "Resolved checkout event report",
          description: "Closed report with checkout event context.",
          currentUrl: "https://example.test/checkout",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
          extraContext: {
            eventTrail: [
              { name: "checkout_submit", timestamp: now.toISOString(), url: "https://example.test/checkout" },
              { name: "payment_failed", timestamp: now.toISOString(), url: "https://example.test/checkout" },
            ],
          },
        },
        {
          projectId: outsideScope.project.id,
          organizationId: outsideScope.organization.id,
          issueType: "BUG",
          severity: "CRITICAL",
          status: "NEW",
          title: "Outside checkout event report",
          description: "Should not affect scoped event analytics.",
          currentUrl: "https://example.test/outside",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
          extraContext: {
            eventTrail: [
              { name: "checkout_submit", timestamp: now.toISOString(), url: "https://example.test/outside" },
            ],
          },
        },
      ],
    });

    const summary = await analyticsService.getSummary([primary.project.id], { days: 7 });
    const checkoutSubmit = summary.eventTrailImpact.topTrackedEvents.find((row) => row.eventName === "checkout_submit");
    const paymentFailed = summary.eventTrailImpact.topTrackedEvents.find((row) => row.eventName === "payment_failed");
    const checkoutToPayment = summary.eventTrailImpact.topFrictionFlows.find((row) => (
      row.fromEventName === "checkout_submit" && row.toEventName === "payment_failed"
    ));
    const checkoutRepeat = summary.eventTrailImpact.topFrictionFlows.find((row) => (
      row.fromEventName === "checkout_submit" && row.toEventName === "checkout_submit"
    ));

    assert.equal(checkoutSubmit?.count, 2);
    assert.equal(checkoutSubmit?.occurrenceCount, 3);
    assert.equal(checkoutSubmit?.openCount, 1);
    assert.equal(checkoutSubmit?.highRiskCount, 1);
    assert.equal(paymentFailed?.count, 2);
    assert.equal(paymentFailed?.occurrenceCount, 2);
    assert.equal(paymentFailed?.openCount, 1);
    assert.equal(paymentFailed?.highRiskCount, 1);
    assert.equal(checkoutToPayment?.count, 2);
    assert.equal(checkoutToPayment?.occurrenceCount, 2);
    assert.equal(checkoutToPayment?.openCount, 1);
    assert.equal(checkoutToPayment?.highRiskCount, 1);
    assert.equal(checkoutRepeat?.count, 1);
    assert.equal(checkoutRepeat?.occurrenceCount, 1);
  } finally {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [primary.organization.id, outsideScope.organization.id],
        },
      },
    });
  }
});

test("analytics summary aggregates scoped survey response impact", async () => {
  const primary = await createAnalyticsProject("primary-survey");
  const outsideScope = await createAnalyticsProject("outside-survey");

  try {
    const now = new Date();
    await prisma.feedbackItem.createMany({
      data: [
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          issueType: "BUG",
          severity: "HIGH",
          status: "NEW",
          title: "NPS checkout report",
          description: "Survey report with a scored NPS response.",
          currentUrl: "https://example.test/checkout",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
          extraContext: {
            surveyResponse: {
              type: "nps",
              question: "How likely are you to recommend us?",
              score: 9,
              submittedAt: now.toISOString(),
            },
          },
        },
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          issueType: "BUG",
          severity: "LOW",
          status: "FIXED",
          title: "Fixed NPS checkout report",
          description: "Closed survey report with a scored NPS response.",
          currentUrl: "https://example.test/checkout",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
          extraContext: {
            surveyResponse: {
              type: "nps",
              score: 7,
            },
          },
        },
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          issueType: "UX",
          severity: "MEDIUM",
          status: "NEW",
          title: "Churn survey report",
          description: "Survey report with free-text churn feedback.",
          currentUrl: "https://example.test/cancel",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
          extraContext: {
            surveyResponse: {
              type: "churn_reason",
              answer: "Pricing changed during renewal.",
            },
          },
        },
        {
          projectId: outsideScope.project.id,
          organizationId: outsideScope.organization.id,
          issueType: "BUG",
          severity: "CRITICAL",
          status: "NEW",
          title: "Outside NPS report",
          description: "Outside project survey report.",
          currentUrl: "https://example.test/outside",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
          extraContext: {
            surveyResponse: {
              type: "nps",
              score: 0,
            },
          },
        },
      ],
    });

    const summary = await analyticsService.getSummary([primary.project.id], { days: 7 });
    const nps = summary.surveyImpact.byType.find((row) => row.type === "nps");
    const churn = summary.surveyImpact.byType.find((row) => row.type === "churn_reason");

    assert.equal(summary.surveyImpact.total, 3);
    assert.equal(summary.surveyImpact.scoredCount, 2);
    assert.equal(summary.surveyImpact.averageScore, 8);
    assert.equal(nps?.label, "NPS");
    assert.equal(nps?.count, 2);
    assert.equal(nps?.scoredCount, 2);
    assert.equal(nps?.averageScore, 8);
    assert.equal(nps?.openCount, 1);
    assert.equal(nps?.highRiskCount, 1);
    assert.equal(churn?.label, "Churn reason");
    assert.equal(churn?.count, 1);
    assert.equal(churn?.scoredCount, 0);
    assert.equal(churn?.averageScore, null);
    assert.equal(churn?.openCount, 1);
    assert.equal(churn?.highRiskCount, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(churn ?? {}, "answer"), false);
  } finally {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [primary.organization.id, outsideScope.organization.id],
        },
      },
    });
  }
});

test("analytics summary aggregates scoped duplicate group impact", async () => {
  const primary = await createAnalyticsProject("primary-duplicates");
  const outsideScope = await createAnalyticsProject("outside-duplicates");

  try {
    const now = new Date();
    const canonical = await prisma.feedbackItem.create({
      data: {
        projectId: primary.project.id,
        organizationId: primary.organization.id,
        issueType: "BUG",
        severity: "HIGH",
        status: "TRIAGED",
        title: "Checkout duplicate group",
        description: "Canonical checkout issue.",
        currentUrl: "https://example.test/checkout",
        appName: "TraceGenie test",
        appEnvironment: "test",
        appVersion: "1.0.0",
        browserUserAgent: "node:test",
        viewportWidth: 1280,
        viewportHeight: 720,
        clientTimestamp: now,
      },
    });
    const unrelated = await prisma.feedbackItem.create({
      data: {
        projectId: primary.project.id,
        organizationId: primary.organization.id,
        issueType: "BUG",
        severity: "LOW",
        status: "NEW",
        title: "Unrelated canonical issue",
        description: "No duplicate children.",
        currentUrl: "https://example.test/unrelated",
        appName: "TraceGenie test",
        appEnvironment: "test",
        appVersion: "1.0.0",
        browserUserAgent: "node:test",
        viewportWidth: 1280,
        viewportHeight: 720,
        clientTimestamp: now,
      },
    });
    const outsideCanonical = await prisma.feedbackItem.create({
      data: {
        projectId: outsideScope.project.id,
        organizationId: outsideScope.organization.id,
        issueType: "BUG",
        severity: "CRITICAL",
        status: "NEW",
        title: "Outside duplicate group",
        description: "Outside canonical issue.",
        currentUrl: "https://example.test/outside",
        appName: "TraceGenie test",
        appEnvironment: "test",
        appVersion: "1.0.0",
        browserUserAgent: "node:test",
        viewportWidth: 1280,
        viewportHeight: 720,
        clientTimestamp: now,
      },
    });

    await prisma.feedbackItem.createMany({
      data: [
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          duplicateOfId: canonical.id,
          issueType: "BUG",
          severity: "CRITICAL",
          status: "DUPLICATE",
          title: "Checkout duplicate 1",
          description: "Duplicate checkout issue.",
          currentUrl: "https://example.test/checkout",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
        },
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          duplicateOfId: canonical.id,
          issueType: "BUG",
          severity: "LOW",
          status: "NEW",
          title: "Checkout duplicate 2",
          description: "Duplicate checkout issue still open.",
          currentUrl: "https://example.test/checkout",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
        },
        {
          projectId: outsideScope.project.id,
          organizationId: outsideScope.organization.id,
          duplicateOfId: outsideCanonical.id,
          issueType: "BUG",
          severity: "CRITICAL",
          status: "DUPLICATE",
          title: "Outside duplicate",
          description: "Outside duplicate child.",
          currentUrl: "https://example.test/outside",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
        },
      ],
    });

    const summary = await analyticsService.getSummary([primary.project.id], { days: 7 });
    const group = summary.topDuplicateGroups.find((row) => row.id === canonical.id);

    assert.equal(group?.ticketNumber, canonical.ticketNumber);
    assert.equal(group?.title, "Checkout duplicate group");
    assert.equal(group?.status, "triaged");
    assert.equal(group?.severity, "high");
    assert.equal(group?.duplicateCount, 2);
    assert.equal(group?.reportCount, 3);
    assert.equal(group?.openCount, 2);
    assert.equal(group?.highRiskCount, 2);
    assert.equal(summary.topDuplicateGroups.some((row) => row.id === unrelated.id), false);
    assert.equal(summary.topDuplicateGroups.some((row) => row.id === outsideCanonical.id), false);
  } finally {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [primary.organization.id, outsideScope.organization.id],
        },
      },
    });
  }
});

test("internal digest summarizes scoped operational buckets", async () => {
  const primary = await createAnalyticsProject("primary-digest");
  const outsideScope = await createAnalyticsProject("outside-digest");

  try {
    const now = new Date();
    const staleAt = new Date(now);
    staleAt.setUTCDate(staleAt.getUTCDate() - 21);

    const criticalOpen = await prisma.feedbackItem.create({
      data: {
        projectId: primary.project.id,
        organizationId: primary.organization.id,
        issueType: "BUG",
        severity: "CRITICAL",
        status: "NEW",
        title: "Critical checkout bug",
        description: "Critical open bug should lead the digest.",
        currentUrl: "https://example.test/critical-checkout",
        appName: "TraceGenie test",
        appEnvironment: "test",
        appVersion: "1.0.0",
        browserUserAgent: "node:test",
        viewportWidth: 1280,
        viewportHeight: 720,
        clientTimestamp: now,
      },
    });
    const staleTicket = await prisma.feedbackItem.create({
      data: {
        projectId: primary.project.id,
        organizationId: primary.organization.id,
        issueType: "UX",
        severity: "MEDIUM",
        status: "BLOCKED",
        title: "Stale settings question",
        description: "Stale ticket should appear in the digest.",
        currentUrl: "https://example.test/settings",
        appName: "TraceGenie test",
        appEnvironment: "test",
        appVersion: "1.0.0",
        browserUserAgent: "node:test",
        viewportWidth: 1280,
        viewportHeight: 720,
        clientTimestamp: staleAt,
        createdAt: staleAt,
        updatedAt: staleAt,
      },
    });
    const waitingTicket = await prisma.feedbackItem.create({
      data: {
        projectId: primary.project.id,
        organizationId: primary.organization.id,
        issueType: "OTHER",
        severity: "LOW",
        status: "TRIAGED",
        labels: ["waiting-on-customer"],
        title: "Waiting for reporter detail",
        description: "Waiting-on-customer label should appear in the digest.",
        currentUrl: "https://example.test/waiting",
        appName: "TraceGenie test",
        appEnvironment: "test",
        appVersion: "1.0.0",
        browserUserAgent: "node:test",
        viewportWidth: 1280,
        viewportHeight: 720,
        clientTimestamp: now,
      },
    });
    const highEvidenceOpen = await prisma.feedbackItem.create({
      data: {
        projectId: primary.project.id,
        organizationId: primary.organization.id,
        issueType: "OTHER",
        severity: "LOW",
        status: "NEW",
        title: "Complete evidence report",
        description: "Open report with enough evidence should not appear in weak evidence.",
        currentUrl: "https://example.test/complete-evidence",
        appName: "TraceGenie test",
        appEnvironment: "test",
        appVersion: "1.0.0",
        browserUserAgent: "node:test",
        viewportWidth: 1280,
        viewportHeight: 720,
        clientTimestamp: now,
        reporterEmail: "qa@example.test",
        reporterName: "QA Reporter",
        stepsToReproduce: "Open checkout, apply coupon, submit payment.",
        expectedResult: "Payment succeeds.",
        actualResult: "Payment failed.",
        consoleEntries: [{ level: "error", message: "Payment failed" }],
        extraContext: {
          productContext: {
            account: {
              id: "acct-complete",
              name: "Complete Evidence Co",
            },
          },
        },
      },
    });
    const blockedLifecycleTicket = await prisma.feedbackItem.create({
      data: {
        projectId: primary.project.id,
        organizationId: primary.organization.id,
        issueType: "UX",
        severity: "MEDIUM",
        status: "TRIAGED",
        title: "Blocked checkout branch",
        description: "Blocked engineering lifecycle should appear in the digest.",
        currentUrl: "https://example.test/blocked-lifecycle",
        appName: "TraceGenie test",
        appEnvironment: "test",
        appVersion: "1.0.0",
        browserUserAgent: "node:test",
        viewportWidth: 1280,
        viewportHeight: 720,
        clientTimestamp: now,
        reporterEmail: "qa@example.test",
        reporterName: "QA Reporter",
        stepsToReproduce: "Open checkout, create the fix branch, and mark verification blocked.",
        expectedResult: "Lifecycle keeps moving to verified.",
        actualResult: "Lifecycle is blocked on the fix branch.",
        consoleEntries: [{ level: "error", message: "Verification blocked" }],
        extraContext: {
          engineeringLifecycle: {
            branchName: "codex/stuck-checkout",
            verificationState: "blocked",
          },
          productContext: {
            account: {
              id: "acct-lifecycle",
              name: "Lifecycle Co",
            },
          },
        },
      },
    });
    const fixedTicket = await prisma.feedbackItem.create({
      data: {
        projectId: primary.project.id,
        organizationId: primary.organization.id,
        issueType: "BUG",
        severity: "HIGH",
        status: "FIXED",
        title: "Fixed payment bug",
        description: "Fixed ticket should appear in the digest.",
        currentUrl: "https://example.test/fixed-payment",
        appName: "TraceGenie test",
        appEnvironment: "test",
        appVersion: "1.0.0",
        browserUserAgent: "node:test",
        viewportWidth: 1280,
        viewportHeight: 720,
        clientTimestamp: now,
      },
    });
    const repeatCanonical = await prisma.feedbackItem.create({
      data: {
        projectId: primary.project.id,
        organizationId: primary.organization.id,
        issueType: "BUG",
        severity: "HIGH",
        status: "TRIAGED",
        title: "Repeated billing failure",
        description: "Canonical duplicate group should appear in repeats.",
        currentUrl: "https://example.test/billing",
        appName: "TraceGenie test",
        appEnvironment: "test",
        appVersion: "1.0.0",
        browserUserAgent: "node:test",
        viewportWidth: 1280,
        viewportHeight: 720,
        clientTimestamp: now,
      },
    });
    await prisma.feedbackItem.createMany({
      data: [
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          duplicateOfId: repeatCanonical.id,
          issueType: "BUG",
          severity: "HIGH",
          status: "DUPLICATE",
          title: "Repeated billing duplicate",
          description: "Duplicate child should count toward reports.",
          currentUrl: "https://example.test/billing",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
        },
        {
          projectId: outsideScope.project.id,
          organizationId: outsideScope.organization.id,
          issueType: "BUG",
          severity: "CRITICAL",
          status: "NEW",
          title: "Outside digest bug",
          description: "Out-of-scope bug must not appear in the digest.",
          currentUrl: "https://example.test/outside",
          appName: "TraceGenie test",
          appEnvironment: "test",
          appVersion: "1.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: now,
        },
      ],
    });

    const digest = await analyticsService.getInternalDigest([primary.project.id], { days: 7 });
    const highImpactRepeat = digest.highImpactRepeats.find((row) => row.id === repeatCanonical.id);

    assert.equal(digest.period.label, "weekly");
    assert.equal(digest.totals.openBugs, 2);
    assert.equal(digest.totals.staleTickets, 1);
    assert.equal(digest.totals.fixedInPeriod, 1);
    assert.equal(digest.totals.waitingOnCustomer, 1);
    assert.equal(digest.totals.highImpactRepeats, 1);
    assert.equal(digest.totals.weakEvidence, 4);
    assert.equal(digest.totals.stuckLifecycle, 1);
    assert.equal(digest.topOpenBugs[0]?.id, criticalOpen.id);
    assert.equal(digest.staleTickets[0]?.id, staleTicket.id);
    assert.equal(digest.fixedInPeriod[0]?.id, fixedTicket.id);
    assert.equal(digest.waitingOnCustomer[0]?.id, waitingTicket.id);
    assert.equal(digest.weakEvidence[0]?.id, criticalOpen.id);
    assert.equal(digest.weakEvidence[0]?.evidenceScore, 25);
    assert.deepEqual(digest.weakEvidence[0]?.missingEvidence.slice(0, 2), ["Screenshot", "Console/error"]);
    assert.equal(digest.weakEvidence.some((row) => row.id === highEvidenceOpen.id), false);
    assert.equal(digest.stuckLifecycle[0]?.id, blockedLifecycleTicket.id);
    assert.equal(digest.stuckLifecycle[0]?.lifecycleState, "blocked");
    assert.equal(digest.stuckLifecycle[0]?.stuckReason, "Blocked");
    assert.equal(digest.stuckLifecycle.some((row) => row.id === highEvidenceOpen.id), false);
    assert.equal(highImpactRepeat?.duplicateCount, 1);
    assert.equal(highImpactRepeat?.reportCount, 2);
    assert.equal(digest.topOpenBugs.some((row) => row.title === "Outside digest bug"), false);
    assert.deepEqual(digest.home.metrics, {
      allTimeReports: 8,
      untriaged: 2,
      critical: 1,
      inProgress: 0,
      fixedInPeriod: 1,
    });
    assert.equal(digest.home.priorityQueue[0]?.id, criticalOpen.id);
    assert.equal(new Set(digest.home.priorityQueue.map((row) => row.id)).size, digest.home.priorityQueue.length);
    assert.equal(digest.home.priorityQueue.some((row) => row.title === "Outside digest bug"), false);
    assert.deepEqual(digest.home.signals.map((signal) => [signal.id, signal.count]), [
      ["waiting_on_customer", 1],
      ["weak_evidence", 4],
      ["high_impact_repeats", 1],
      ["stale", 1],
      ["stuck_lifecycle", 1],
    ]);
    for (const signal of digest.home.signals) {
      const filtered = await feedbackService.listFeedback({
        attention: signal.id,
        page: 1,
        pageSize: 100,
      }, [primary.project.id]);
      assert.equal(filtered.pagination.total, signal.count, `${signal.id} filter must match its Home signal total`);
      assert.equal(filtered.items.some((row) => row.title === "Outside digest bug"), false);
    }
  } finally {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [primary.organization.id, outsideScope.organization.id],
        },
      },
    });
  }
});

test("internal digest returns scoped Home trend and open workload by product", async () => {
  const primary = await createAnalyticsProject("primary-home-dashboard");
  const outsideScope = await createAnalyticsProject("outside-home-dashboard");
  const secondaryProject = await prisma.project.create({
    data: {
      organizationId: primary.organization.id,
      key: testSlug("secondary-home-project"),
      name: "Secondary product",
      defaultEnvironment: "test",
    },
  });

  try {
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setUTCDate(fiveDaysAgo.getUTCDate() - 5);
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const feedbackData = (projectId: string, organizationId: string, title: string, createdAt: Date) => ({
      projectId,
      organizationId,
      issueType: "BUG" as const,
      severity: "HIGH" as const,
      status: "NEW" as const,
      title,
      description: "Home dashboard aggregation fixture.",
      currentUrl: "https://example.test/home-dashboard",
      appName: "TraceGenie test",
      appEnvironment: "test",
      appVersion: "1.0.0",
      browserUserAgent: "node:test",
      viewportWidth: 1280,
      viewportHeight: 720,
      clientTimestamp: createdAt,
      createdAt,
      updatedAt: createdAt,
    });

    await prisma.feedbackItem.createMany({
      data: [
        feedbackData(primary.project.id, primary.organization.id, "Primary open issue", twoDaysAgo),
        feedbackData(secondaryProject.id, primary.organization.id, "Secondary open issue", yesterday),
        feedbackData(outsideScope.project.id, outsideScope.organization.id, "Outside open issue", yesterday),
      ],
    });
    const resolved = await prisma.feedbackItem.create({
      data: {
        ...feedbackData(primary.project.id, primary.organization.id, "Resolved issue", fiveDaysAgo),
        status: "FIXED",
        updatedAt: yesterday,
      },
    });
    await prisma.feedbackStatusHistory.create({
      data: {
        feedbackItemId: resolved.id,
        fromStatus: "IN_PROGRESS",
        toStatus: "FIXED",
        createdAt: yesterday,
      },
    });

    const digest = await analyticsService.getInternalDigest(
      [primary.project.id, secondaryProject.id],
      { days: 7 },
    );

    assert.equal(digest.home.trend.reduce((total, row) => total + row.received, 0), 3);
    assert.equal(digest.home.trend.reduce((total, row) => total + row.resolved, 0), 1);
    assert.deepEqual(
      digest.home.openByProject.map((row) => [row.projectName, row.count]),
      [
        [primary.project.name, 1],
        [secondaryProject.name, 1],
      ],
    );
    assert.equal(digest.home.openByProject.some((row) => row.projectId === outsideScope.project.id), false);
  } finally {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [primary.organization.id, outsideScope.organization.id],
        },
      },
    });
  }
});

test("release summaries aggregate scoped issue counts and seen windows", async () => {
  const primary = await createAnalyticsProject("primary-release");
  const outsideScope = await createAnalyticsProject("outside-release");

  try {
    const firstSeen = new Date("2026-07-01T12:00:00.000Z");
    const fixedSourceSeen = new Date("2026-07-02T12:00:00.000Z");
    const regressionSeen = new Date("2026-07-02T18:00:00.000Z");
    const lastSeen = new Date("2026-07-03T12:00:00.000Z");
    const regressionFingerprint = testSlug("release-regression");
    const primaryRelease = await prisma.release.create({
      data: {
        projectId: primary.project.id,
        releaseKey: testSlug("primary-release-key"),
        appName: "TraceGenie test",
        appEnvironment: "production",
        appVersion: "2.0.0",
        buildNumber: "200",
        releaseChannel: "stable",
      },
    });
    const regressionRelease = await prisma.release.create({
      data: {
        projectId: primary.project.id,
        releaseKey: testSlug("regression-release-key"),
        appName: "TraceGenie test",
        appEnvironment: "production",
        appVersion: "2.1.0",
        buildNumber: "210",
        releaseChannel: "stable",
      },
    });
    const outsideRelease = await prisma.release.create({
      data: {
        projectId: outsideScope.project.id,
        releaseKey: testSlug("outside-release-key"),
        appName: "TraceGenie test",
        appEnvironment: "production",
        appVersion: "9.0.0",
      },
    });

    await prisma.feedbackItem.createMany({
      data: [
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          releaseId: primaryRelease.id,
          issueType: "BUG",
          severity: "CRITICAL",
          status: "NEW",
          title: "Critical release feedback",
          description: "Release issue.",
          currentUrl: "https://example.test/release",
          appName: "TraceGenie test",
          appEnvironment: "production",
          appVersion: "2.0.0",
          buildNumber: "200",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: firstSeen,
          createdAt: firstSeen,
        },
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          releaseId: primaryRelease.id,
          issueType: "BUG",
          severity: "LOW",
          status: "FIXED",
          title: "Fixed release feedback",
          description: "Release issue.",
          currentUrl: "https://example.test/release",
          appName: "TraceGenie test",
          appEnvironment: "production",
          appVersion: "2.0.0",
          buildNumber: "200",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: lastSeen,
          createdAt: lastSeen,
        },
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          issueType: "BUG",
          severity: "LOW",
          status: "FIXED",
          title: "Earlier fixed checkout issue",
          description: "Fixed source for release regression.",
          currentUrl: "https://example.test/release-regression",
          appName: "TraceGenie test",
          appEnvironment: "production",
          appVersion: "2.0.0",
          buildNumber: "200",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: fixedSourceSeen,
          createdAt: fixedSourceSeen,
          duplicateFingerprint: regressionFingerprint,
        },
        {
          projectId: primary.project.id,
          organizationId: primary.organization.id,
          releaseId: regressionRelease.id,
          issueType: "BUG",
          severity: "LOW",
          status: "NEW",
          title: "Regression release feedback",
          description: "Release regression issue.",
          currentUrl: "https://example.test/release-regression",
          appName: "TraceGenie test",
          appEnvironment: "production",
          appVersion: "2.1.0",
          buildNumber: "210",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: regressionSeen,
          createdAt: regressionSeen,
          duplicateFingerprint: regressionFingerprint,
        },
        {
          projectId: outsideScope.project.id,
          organizationId: outsideScope.organization.id,
          releaseId: outsideRelease.id,
          issueType: "BUG",
          severity: "HIGH",
          status: "NEW",
          title: "Outside release feedback",
          description: "Outside release issue.",
          currentUrl: "https://example.test/outside-release",
          appName: "TraceGenie test",
          appEnvironment: "production",
          appVersion: "9.0.0",
          browserUserAgent: "node:test",
          viewportWidth: 1280,
          viewportHeight: 720,
          clientTimestamp: lastSeen,
          createdAt: lastSeen,
        },
      ],
    });

    const result = await analyticsService.getReleases([primary.project.id]);
    const primarySummary = result.releases.find((release) => release.id === primaryRelease.id);
    const regressionSummary = result.releases.find((release) => release.id === regressionRelease.id);

    assert.equal(result.releases.length, 2);
    assert.equal(primarySummary?.projectKey, primary.project.key);
    assert.equal(primarySummary?.issueCount, 2);
    assert.equal(primarySummary?.openIssueCount, 1);
    assert.equal(primarySummary?.fixedIssueCount, 1);
    assert.equal(primarySummary?.highRiskIssueCount, 1);
    assert.equal(primarySummary?.regressionIssueCount, 0);
    assert.equal(primarySummary?.healthStatus, "attention");
    assert.equal(primarySummary?.firstSeenAt?.toISOString(), firstSeen.toISOString());
    assert.equal(primarySummary?.lastSeenAt?.toISOString(), lastSeen.toISOString());
    assert.equal(regressionSummary?.issueCount, 1);
    assert.equal(regressionSummary?.openIssueCount, 1);
    assert.equal(regressionSummary?.fixedIssueCount, 0);
    assert.equal(regressionSummary?.highRiskIssueCount, 0);
    assert.equal(regressionSummary?.regressionIssueCount, 1);
    assert.equal(regressionSummary?.healthStatus, "attention");
  } finally {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [primary.organization.id, outsideScope.organization.id],
        },
      },
    });
  }
});
