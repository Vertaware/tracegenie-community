import { FeedbackStatus,IssueType,Severity,type Prisma } from "@prisma/client";
import {
feedbackEngineeringLifecycleSchema,
feedbackEventTrailSchema,
feedbackSurveyResponseSchema,
productContextSchema,
type FeedbackEngineeringLifecycle,
type FeedbackEventTrail,
type FeedbackSurveyResponse,
type ProductContext,
} from "@tracegenie/shared";

import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";

const CLOSED_STATUSES = new Set<FeedbackStatus>([
  FeedbackStatus.FIXED,
  FeedbackStatus.CLOSED,
  FeedbackStatus.DUPLICATE,
]);
const REGRESSION_SOURCE_STATUSES = new Set<FeedbackStatus>([
  FeedbackStatus.NEW,
  FeedbackStatus.TRIAGED,
  FeedbackStatus.BLOCKED,
  FeedbackStatus.IN_PROGRESS,
  FeedbackStatus.BACKLOG,
]);

const ANALYTICS_RANGE_DAYS = [7, 15, 30, 60, 90, 180] as const;
type AnalyticsRangeDays = (typeof ANALYTICS_RANGE_DAYS)[number];
const WAITING_ON_CUSTOMER_LABEL = "waiting-on-customer";
const STALE_TICKET_DAYS = 14;
const WEAK_EVIDENCE_PAGE_SIZE = 250;

const SEVERITY_RANK: Record<Severity, number> = {
  [Severity.LOW]: 1,
  [Severity.MEDIUM]: 2,
  [Severity.HIGH]: 3,
  [Severity.CRITICAL]: 4,
};

const weakEvidenceTicketSelect = {
  id: true,
  ticketNumber: true,
  title: true,
  status: true,
  severity: true,
  issueType: true,
  currentUrl: true,
  createdAt: true,
  updatedAt: true,
  stepsToReproduce: true,
  expectedResult: true,
  actualResult: true,
  appVersion: true,
  buildNumber: true,
  releaseChannel: true,
  reporterEmail: true,
  reporterName: true,
  consoleEntries: true,
  clientErrorContext: true,
  extraContext: true,
  project: {
    select: {
      key: true,
      name: true,
    },
  },
  _count: {
    select: {
      attachments: true,
    },
  },
} satisfies Prisma.FeedbackItemSelect;

const homePriorityTicketSelect = {
  ...weakEvidenceTicketSelect,
  labels: true,
  _count: {
    select: {
      attachments: true,
      duplicates: true,
    },
  },
} satisfies Prisma.FeedbackItemSelect;

type WeakEvidenceTicket = Prisma.FeedbackItemGetPayload<{ select: typeof weakEvidenceTicketSelect }>;
type WeakEvidenceRow = {
  item: WeakEvidenceTicket;
  quality: {
    score: number;
    missing: string[];
  };
};
type StuckLifecycleRow = {
  item: WeakEvidenceTicket;
  lifecycleState: NonNullable<FeedbackEngineeringLifecycle["verificationState"]>;
  stuckReason: string;
};
type HomePriorityTicketRow = Prisma.FeedbackItemGetPayload<{ select: typeof homePriorityTicketSelect }>;
type HomePriorityRow = {
  item: HomePriorityTicketRow;
  quality: ReturnType<typeof digestEvidenceQuality>;
  reasons: Array<"critical" | "waiting_on_customer" | "weak_evidence" | "high_impact_repeats" | "stale" | "stuck_lifecycle">;
};

type AnalyticsSummaryOptions = {
  days?: number;
};

type ContextImpactRow = {
  label: string;
  count: number;
  openCount: number;
  highRiskCount: number;
};

type AccountImpactRow = ContextImpactRow & {
  id: string | null;
  name: string | null;
};

type PlanImpactRow = ContextImpactRow & {
  name: string | null;
  tier: string | null;
};

type CustomerSegmentImpactRow = ContextImpactRow & {
  segment: string;
};

type CustomerCohortImpactRow = ContextImpactRow & {
  cohort: string;
};

type ProductAreaImpactRow = ContextImpactRow & {
  area: string;
};

type FunnelStepImpactRow = ContextImpactRow & {
  step: string;
};

type FeatureFlagImpactRow = ContextImpactRow & {
  flag: string;
  value: string;
};

type ExperimentImpactRow = ContextImpactRow & {
  experiment: string;
  variant: string;
};

type SurveyImpactRow = ContextImpactRow & {
  type: FeedbackSurveyResponse["type"];
  scoredCount: number;
  scoreTotal: number;
};

type TrackedEventImpactRow = ContextImpactRow & {
  eventName: string;
  occurrenceCount: number;
};

type FrictionFlowImpactRow = ContextImpactRow & {
  fromEventName: string;
  toEventName: string;
  occurrenceCount: number;
};

type CapacityLockProjectImpactRow = ContextImpactRow & {
  projectId: string;
  projectKey: string;
  projectName: string;
};

function normalizeRangeDays(days?: number): AnalyticsRangeDays {
  return ANALYTICS_RANGE_DAYS.includes(days as AnalyticsRangeDays) ? days as AnalyticsRangeDays : 7;
}

function formatDateLabel(date: Date) {
  return date.toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" });
}

function formatWeekLabel(date: Date, index: number) {
  return `W${index + 1} ${formatDateLabel(date)}`;
}

function dayBucketKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildOpenClosedRows(
  items: Array<{ createdAt: Date; updatedAt: Date; status: FeedbackStatus }>,
  days: AnalyticsRangeDays,
) {
  const bucketSize = days <= 15 ? 1 : 7;
  const bucketCount = days <= 15 ? days : Math.ceil(days / bucketSize);

  return Array.from({ length: bucketCount }, (_, index) => {
    const daysBeforeEnd = (bucketCount - 1 - index) * bucketSize;
    const bucketEnd = new Date();
    bucketEnd.setUTCHours(23, 59, 59, 999);
    bucketEnd.setUTCDate(bucketEnd.getUTCDate() - daysBeforeEnd);

    const bucketStart = new Date(bucketEnd);
    bucketStart.setUTCHours(0, 0, 0, 0);
    bucketStart.setUTCDate(bucketStart.getUTCDate() - (bucketSize - 1));

    const bucketKeys = Array.from({ length: bucketSize }, (_, dayIndex) => {
      const date = new Date(bucketStart);
      date.setUTCDate(date.getUTCDate() + dayIndex);
      return dayBucketKey(date);
    });

    const open = items.filter((item) => {
      const closed = CLOSED_STATUSES.has(item.status);
      return item.createdAt <= bucketEnd && (!closed || item.updatedAt > bucketEnd);
    }).length;

    const closed = items.filter((item) => (
      CLOSED_STATUSES.has(item.status) && bucketKeys.includes(dayBucketKey(item.updatedAt))
    )).length;

    return {
      label: days <= 15 ? formatDateLabel(bucketEnd) : formatWeekLabel(bucketStart, index),
      open,
      closed,
    };
  });
}

function fixedAtForRegressionSource(source: { createdAt: Date; statusHistory: Array<{ createdAt: Date }> }) {
  return source.statusHistory[0]?.createdAt ?? source.createdAt;
}

function releaseHealth(issueCount: number, openIssueCount: number, highRiskIssueCount: number, regressionIssueCount = 0) {
  if (highRiskIssueCount > 0 || regressionIssueCount > 0) return "attention";
  if (openIssueCount > 0) return "monitor";
  if (issueCount > 0) return "stable";
  return "quiet";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readProductContext(extraContext: unknown): ProductContext | null {
  const result = productContextSchema.safeParse(asRecord(extraContext)?.productContext);
  return result.success ? result.data : null;
}

function readSurveyResponse(extraContext: unknown): FeedbackSurveyResponse | null {
  const result = feedbackSurveyResponseSchema.safeParse(asRecord(extraContext)?.surveyResponse);
  return result.success ? result.data : null;
}

function readEventTrail(extraContext: unknown): FeedbackEventTrail {
  const result = feedbackEventTrailSchema.safeParse(asRecord(extraContext)?.eventTrail);
  return result.success ? result.data : [];
}

function readEngineeringLifecycle(extraContext: unknown): FeedbackEngineeringLifecycle | null {
  const result = feedbackEngineeringLifecycleSchema.safeParse(asRecord(extraContext)?.engineeringLifecycle);
  return result.success ? result.data : null;
}

function contextLabel(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" / ");
}

function surveyTypeLabel(type: FeedbackSurveyResponse["type"]) {
  const labels: Record<FeedbackSurveyResponse["type"], string> = {
    nps: "NPS",
    csat: "CSAT",
    ces: "CES",
    feature_satisfaction: "Feature satisfaction",
    beta_feedback: "Beta feedback",
    churn_reason: "Churn reason",
    abandonment: "Abandonment",
  };
  return labels[type];
}

function averageScore(scoreTotal: number, scoredCount: number) {
  return scoredCount > 0 ? Math.round((scoreTotal / scoredCount) * 10) / 10 : null;
}

function bumpContextImpact<T extends ContextImpactRow>(
  rows: Map<string, T>,
  key: string,
  row: T,
  status: FeedbackStatus,
  severity: Severity,
) {
  const existing = rows.get(key) ?? row;
  existing.count += 1;
  if (!CLOSED_STATUSES.has(status)) existing.openCount += 1;
  if (severity === Severity.HIGH || severity === Severity.CRITICAL) existing.highRiskCount += 1;
  rows.set(key, existing);
}

function sortContextImpact<T extends ContextImpactRow>(rows: Map<string, T>) {
  return [...rows.values()]
    .sort((a, b) => b.count - a.count || b.highRiskCount - a.highRiskCount || a.label.localeCompare(b.label))
    .slice(0, 10);
}

function isHighRiskSeverity(severity: Severity) {
  return severity === Severity.HIGH || severity === Severity.CRITICAL;
}

function digestPeriod(days: AnalyticsRangeDays) {
  const to = new Date();
  to.setUTCHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return {
    label: days === 7 ? "weekly" : `${days}-day`,
    days,
    from,
    to,
  };
}

function buildHomeTrendRows(
  receivedItems: Array<{ createdAt: Date }>,
  resolvedTransitions: Array<{ feedbackItemId: string; createdAt: Date }>,
  period: ReturnType<typeof digestPeriod>,
) {
  const bucketSize = period.days <= 15 ? 1 : period.days <= 60 ? 5 : period.days <= 90 ? 15 : 30;
  const bucketCount = Math.ceil(period.days / bucketSize);

  return Array.from({ length: bucketCount }, (_, index) => {
    const from = new Date(period.from);
    from.setUTCDate(from.getUTCDate() + index * bucketSize);

    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + bucketSize - 1);
    to.setUTCHours(23, 59, 59, 999);
    if (to > period.to) to.setTime(period.to.getTime());

    const resolvedIds = new Set(
      resolvedTransitions
        .filter((transition) => transition.createdAt >= from && transition.createdAt <= to)
        .map((transition) => transition.feedbackItemId),
    );

    return {
      label: bucketSize === 1
        ? formatDateLabel(from)
        : `${formatDateLabel(from)} - ${formatDateLabel(to)}`,
      received: receivedItems.filter((item) => item.createdAt >= from && item.createdAt <= to).length,
      resolved: resolvedIds.size,
    };
  });
}

function digestTicket(item: {
  id: string;
  ticketNumber: number;
  title: string;
  status: FeedbackStatus;
  severity: Severity;
  issueType: string;
  currentUrl: string;
  createdAt: Date;
  updatedAt: Date;
  project: {
    key: string;
    name: string;
  };
}) {
  return {
    id: item.id,
    ticketNumber: item.ticketNumber,
    title: item.title,
    status: item.status.toLowerCase(),
    severity: item.severity.toLowerCase(),
    issueType: item.issueType.toLowerCase(),
    projectKey: item.project.key,
    projectName: item.project.name,
    currentUrl: item.currentUrl,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function jsonArrayCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function digestEvidenceQuality(item: {
  stepsToReproduce: string | null;
  expectedResult: string | null;
  actualResult: string | null;
  currentUrl: string;
  appVersion: string;
  buildNumber: string | null;
  releaseChannel: string | null;
  reporterEmail: string | null;
  reporterName: string | null;
  consoleEntries: unknown;
  clientErrorContext: unknown;
  extraContext: unknown;
  _count: {
    attachments: number;
  };
}) {
  const productContext = readProductContext(item.extraContext);
  const hasConsoleOrError = jsonArrayCount(item.consoleEntries) > 0 || Boolean(item.clientErrorContext);
  const hasSteps = Boolean(item.stepsToReproduce?.trim());
  const hasOutcome = Boolean(item.expectedResult?.trim() || item.actualResult?.trim());
  const metrics = [
    { label: "Screenshot", present: item._count.attachments > 0 },
    { label: "URL", present: Boolean(item.currentUrl) },
    { label: "Console/error", present: hasConsoleOrError },
    { label: "Steps", present: hasSteps },
    { label: "Release", present: Boolean(item.appVersion || item.buildNumber || item.releaseChannel) },
    { label: "Account", present: Boolean(productContext?.account?.id || productContext?.account?.name || productContext?.customer?.id) },
    { label: "Reporter", present: Boolean(item.reporterEmail || item.reporterName) },
    { label: "Repro confidence", present: hasSteps && (hasConsoleOrError || item._count.attachments > 0 || hasOutcome) },
  ];
  const missing = metrics.filter((metric) => !metric.present).map((metric) => metric.label);

  return {
    score: Math.round(((metrics.length - missing.length) / metrics.length) * 100),
    missing,
  };
}

const compareWeakEvidence = (left: WeakEvidenceRow, right: WeakEvidenceRow) => (
    left.quality.score - right.quality.score ||
    SEVERITY_RANK[right.item.severity] - SEVERITY_RANK[left.item.severity] ||
    right.item.updatedAt.getTime() - left.item.updatedAt.getTime()
  );
const compareStuckLifecycle = (left: StuckLifecycleRow, right: StuckLifecycleRow) => (
    SEVERITY_RANK[right.item.severity] - SEVERITY_RANK[left.item.severity] ||
    left.item.updatedAt.getTime() - right.item.updatedAt.getTime()
  );

function lifecycleStuckReason(item: Pick<HomePriorityTicketRow, "extraContext" | "updatedAt">, staleBefore: Date) {
  const lifecycle = readEngineeringLifecycle(item.extraContext);
  const lifecycleState = lifecycle?.verificationState ?? "not_started";
  const hasLifecycleLink = Boolean(lifecycle?.branchName || lifecycle?.branchUrl || lifecycle?.pullRequestUrl || lifecycle?.deployUrl);
  if (lifecycleState === "blocked") return "Blocked";
  if (lifecycleState === "deployed") return "Deployed, not verified";
  if (lifecycleState === "in_progress" && item.updatedAt < staleBefore) return "In progress stale";
  if (hasLifecycleLink && lifecycleState === "not_started" && item.updatedAt < staleBefore) return "Lifecycle stale";
  return null;
}

const compareHomePriority = (left: HomePriorityRow, right: HomePriorityRow) => (
  Number(right.reasons.includes("critical")) - Number(left.reasons.includes("critical")) ||
  Number(right.reasons.includes("high_impact_repeats")) - Number(left.reasons.includes("high_impact_repeats")) ||
  Number(right.reasons.includes("weak_evidence")) - Number(left.reasons.includes("weak_evidence")) ||
  Number(right.reasons.includes("waiting_on_customer")) - Number(left.reasons.includes("waiting_on_customer")) ||
  Number(right.reasons.includes("stale")) - Number(left.reasons.includes("stale")) ||
  Number(right.reasons.includes("stuck_lifecycle")) - Number(left.reasons.includes("stuck_lifecycle")) ||
  SEVERITY_RANK[right.item.severity] - SEVERITY_RANK[left.item.severity] ||
  left.item.updatedAt.getTime() - right.item.updatedAt.getTime() ||
  left.item.id.localeCompare(right.item.id)
);

async function scanHomeDerivedTickets(where: Prisma.FeedbackItemWhereInput, staleBefore: Date) {
  const weakEvidence: WeakEvidenceRow[] = [];
  const stuckLifecycle: StuckLifecycleRow[] = [];
  const priorityQueue: HomePriorityRow[] = [];
  let weakEvidenceCount = 0;
  let stuckLifecycleCount = 0;
  let priorityTotal = 0;
  let cursor: Prisma.FeedbackItemWhereUniqueInput | undefined;

  while (true) {
    const rows = await prisma.feedbackItem.findMany({
      where,
      select: homePriorityTicketSelect,
      orderBy: { id: "asc" },
      take: WEAK_EVIDENCE_PAGE_SIZE,
      ...(cursor ? { cursor, skip: 1 } : {}),
    });
    for (const item of rows) {
      const quality = digestEvidenceQuality(item);
      const stuckReason = lifecycleStuckReason(item, staleBefore);
      if (quality.score < 50) {
        weakEvidenceCount += 1;
        weakEvidence.push({ item, quality });
        weakEvidence.sort(compareWeakEvidence);
        weakEvidence.length = Math.min(weakEvidence.length, 10);
      }
      if (stuckReason) {
        stuckLifecycleCount += 1;
        const lifecycleState = readEngineeringLifecycle(item.extraContext)?.verificationState ?? "not_started";
        stuckLifecycle.push({ item, lifecycleState, stuckReason });
        stuckLifecycle.sort(compareStuckLifecycle);
        stuckLifecycle.length = Math.min(stuckLifecycle.length, 10);
      }
      const reasons: HomePriorityRow["reasons"] = [];
      if (item.severity === Severity.CRITICAL) reasons.push("critical");
      if (item._count.duplicates > 0) reasons.push("high_impact_repeats");
      if (quality.score < 50) reasons.push("weak_evidence");
      if (item.labels.includes(WAITING_ON_CUSTOMER_LABEL)) reasons.push("waiting_on_customer");
      if (item.updatedAt < staleBefore) reasons.push("stale");
      if (stuckReason) reasons.push("stuck_lifecycle");
      if (reasons.length > 0) {
        priorityTotal += 1;
        priorityQueue.push({ item, quality, reasons });
        priorityQueue.sort(compareHomePriority);
        priorityQueue.length = Math.min(priorityQueue.length, 5);
      }
    }
    const lastItem = rows[rows.length - 1];
    if (!lastItem || rows.length < WEAK_EVIDENCE_PAGE_SIZE) break;
    cursor = { id: lastItem.id };
  }

  return { weakEvidence, weakEvidenceCount, stuckLifecycle, stuckLifecycleCount, priorityQueue, priorityTotal };
}

export class AnalyticsService {
  async getReleases(projectIds?: string[]) {
    const releaseWhere = projectIds ? { projectId: { in: projectIds } } : undefined;
    const feedbackWhere = {
      releaseId: { not: null },
      ...(projectIds ? { projectId: { in: projectIds } } : {}),
    };

    const [releases, releaseIssueRows, statusRows, severityRows] = await Promise.all([
      prisma.release.findMany({
        where: releaseWhere,
        include: {
          project: {
            select: {
              key: true,
              name: true,
            },
          },
        },
        orderBy: [
          { updatedAt: "desc" },
          { createdAt: "desc" },
        ],
        take: 100,
      }),
      prisma.feedbackItem.groupBy({
        by: ["releaseId"],
        where: feedbackWhere,
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      prisma.feedbackItem.groupBy({
        by: ["releaseId", "status"],
        where: feedbackWhere,
        _count: { _all: true },
      }),
      prisma.feedbackItem.groupBy({
        by: ["releaseId", "severity"],
        where: feedbackWhere,
        _count: { _all: true },
      }),
    ]);

    const issueStats = new Map(releaseIssueRows.map((row) => [row.releaseId, row]));
    const openCounts = new Map<string | null, number>();
    const fixedCounts = new Map<string | null, number>();
    const highRiskCounts = new Map<string | null, number>();
    const releaseIds = releases.map((release) => release.id);
    const regressionCandidates = releaseIds.length > 0
      ? await prisma.feedbackItem.findMany({
        where: {
          ...feedbackWhere,
          releaseId: { in: releaseIds },
          duplicateFingerprint: { not: null },
          status: { in: Array.from(REGRESSION_SOURCE_STATUSES) },
        },
        select: {
          id: true,
          projectId: true,
          releaseId: true,
          duplicateFingerprint: true,
          createdAt: true,
        },
      })
      : [];
    const fixedRegressionSources = regressionCandidates.length > 0
      ? await prisma.feedbackItem.findMany({
        where: {
          projectId: { in: Array.from(new Set(regressionCandidates.map((item) => item.projectId))) },
          duplicateFingerprint: { in: Array.from(new Set(regressionCandidates.map((item) => item.duplicateFingerprint!))) },
          OR: [
            { status: FeedbackStatus.FIXED },
            { statusHistory: { some: { toStatus: FeedbackStatus.FIXED } } },
          ],
        },
        select: {
          id: true,
          projectId: true,
          duplicateFingerprint: true,
          createdAt: true,
          statusHistory: {
            where: { toStatus: FeedbackStatus.FIXED },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
        },
      })
      : [];
    const regressionCounts = new Map<string, number>();

    // ponytail: release list is capped at 100; add an indexed read model if this scan gets hot.
    for (const item of regressionCandidates) {
      const hasFixedSource = fixedRegressionSources.some((source) => (
        source.id !== item.id &&
        source.projectId === item.projectId &&
        source.duplicateFingerprint === item.duplicateFingerprint &&
        fixedAtForRegressionSource(source) < item.createdAt
      ));
      if (hasFixedSource && item.releaseId) {
        regressionCounts.set(item.releaseId, (regressionCounts.get(item.releaseId) ?? 0) + 1);
      }
    }

    for (const row of statusRows) {
      if (!CLOSED_STATUSES.has(row.status)) {
        openCounts.set(row.releaseId, (openCounts.get(row.releaseId) ?? 0) + row._count._all);
      }
      if (row.status === FeedbackStatus.FIXED) {
        fixedCounts.set(row.releaseId, (fixedCounts.get(row.releaseId) ?? 0) + row._count._all);
      }
    }

    for (const row of severityRows) {
      if (row.severity === Severity.HIGH || row.severity === Severity.CRITICAL) {
        highRiskCounts.set(row.releaseId, (highRiskCounts.get(row.releaseId) ?? 0) + row._count._all);
      }
    }

    return {
      releases: releases
        .map((release) => {
          const stats = issueStats.get(release.id);
          const issueCount = stats?._count._all ?? 0;
          const openIssueCount = openCounts.get(release.id) ?? 0;
          const fixedIssueCount = fixedCounts.get(release.id) ?? 0;
          const highRiskIssueCount = highRiskCounts.get(release.id) ?? 0;
          const regressionIssueCount = regressionCounts.get(release.id) ?? 0;
          return {
            id: release.id,
            projectKey: release.project.key,
            projectName: release.project.name,
            appName: release.appName,
            appEnvironment: release.appEnvironment,
            appVersion: release.appVersion,
            buildNumber: release.buildNumber,
            releaseChannel: release.releaseChannel,
            issueCount,
            openIssueCount,
            fixedIssueCount,
            highRiskIssueCount,
            regressionIssueCount,
            healthStatus: releaseHealth(issueCount, openIssueCount, highRiskIssueCount, regressionIssueCount),
            firstSeenAt: stats?._min.createdAt ?? null,
            lastSeenAt: stats?._max.createdAt ?? null,
            createdAt: release.createdAt,
            updatedAt: release.updatedAt,
          };
        }),
    };
  }

  async getReleaseDetail(releaseId: string, projectIds?: string[]) {
    const release = await prisma.release.findFirst({
      where: {
        id: releaseId,
        ...(projectIds ? { projectId: { in: projectIds } } : {}),
      },
      include: {
        project: { select: { key: true, name: true } },
      },
    });
    if (!release) {
      throw new AppError(404, "release.not_found", "Release not found.");
    }

    const issueWhere = { releaseId: release.id, projectId: release.projectId };
    const [issueCount, issueRows, statusRows, severityRows, lifecycleCount, lifecycleRows, notificationCount, notificationRows, regressionCandidates] = await Promise.all([
      prisma.feedbackItem.count({ where: issueWhere }),
      prisma.feedbackItem.findMany({
        where: issueWhere,
        orderBy: [{ updatedAt: "desc" }, { ticketNumber: "desc" }],
        take: 101,
        select: {
          id: true,
          ticketNumber: true,
          title: true,
          status: true,
          severity: true,
          duplicateFingerprint: true,
          createdAt: true,
          updatedAt: true,
          extraContext: true,
          statusHistory: {
            where: { toStatus: FeedbackStatus.FIXED },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
        },
      }),
      prisma.feedbackItem.groupBy({
        by: ["status"],
        where: issueWhere,
        _count: { _all: true },
      }),
      prisma.feedbackItem.groupBy({
        by: ["severity"],
        where: issueWhere,
        _count: { _all: true },
      }),
      prisma.feedbackLifecycleTransition.count({ where: { feedbackItem: issueWhere } }),
      prisma.feedbackLifecycleTransition.findMany({
        where: { feedbackItem: issueWhere },
        orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
        take: 101,
        select: {
          id: true,
          feedbackItemId: true,
          provider: true,
          source: true,
          stage: true,
          state: true,
          externalUrl: true,
          label: true,
          safeDetails: true,
          observedAt: true,
          createdAt: true,
          feedbackItem: { select: { ticketNumber: true, title: true } },
        },
      }),
      prisma.feedbackNotification.count({ where: { feedbackItem: issueWhere } }),
      prisma.feedbackNotification.findMany({
        where: { feedbackItem: issueWhere },
        orderBy: [{ createdAt: "desc" }],
        take: 101,
        select: {
          id: true,
          feedbackItemId: true,
          eventType: true,
          status: true,
          provider: true,
          attemptCount: true,
          nextAttemptAt: true,
          sentAt: true,
          createdAt: true,
          feedbackItem: { select: { ticketNumber: true, title: true } },
        },
      }),
      prisma.feedbackItem.findMany({
        where: {
          ...issueWhere,
          duplicateFingerprint: { not: null },
          status: { in: Array.from(REGRESSION_SOURCE_STATUSES) },
        },
        select: { id: true, duplicateFingerprint: true, createdAt: true },
      }),
    ]);

    const shownIssues = issueRows.slice(0, 100);
    const fixedSources = regressionCandidates.length > 0
      ? await prisma.feedbackItem.findMany({
        where: {
          projectId: release.projectId,
          duplicateFingerprint: { in: Array.from(new Set(regressionCandidates.map((item) => item.duplicateFingerprint!))) },
          OR: [
            { status: FeedbackStatus.FIXED },
            { statusHistory: { some: { toStatus: FeedbackStatus.FIXED } } },
          ],
        },
        select: {
          id: true,
          ticketNumber: true,
          title: true,
          duplicateFingerprint: true,
          createdAt: true,
          statusHistory: {
            where: { toStatus: FeedbackStatus.FIXED },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
          release: { select: { id: true, appVersion: true, buildNumber: true } },
        },
      })
      : [];
    const regressionSource = new Map<string, (typeof fixedSources)[number]>();
    for (const candidate of regressionCandidates) {
      const source = fixedSources
        .filter((item) => item.id !== candidate.id && item.duplicateFingerprint === candidate.duplicateFingerprint)
        .filter((item) => fixedAtForRegressionSource(item) < candidate.createdAt)
        .sort((left, right) => fixedAtForRegressionSource(right).getTime() - fixedAtForRegressionSource(left).getTime())[0];
      if (source) regressionSource.set(candidate.id, source);
    }

    const openIssueCount = statusRows.reduce((sum, row) => CLOSED_STATUSES.has(row.status) ? sum : sum + row._count._all, 0);
    const fixedIssueCount = statusRows.find((row) => row.status === FeedbackStatus.FIXED)?._count._all ?? 0;
    const highRiskIssueCount = severityRows.reduce((sum, row) => (
      row.severity === Severity.HIGH || row.severity === Severity.CRITICAL ? sum + row._count._all : sum
    ), 0);
    const regressionIssueCount = regressionSource.size;

    return {
      release: {
        id: release.id,
        projectKey: release.project.key,
        projectName: release.project.name,
        appName: release.appName,
        appEnvironment: release.appEnvironment,
        appVersion: release.appVersion,
        buildNumber: release.buildNumber,
        releaseChannel: release.releaseChannel,
        issueCount,
        openIssueCount,
        fixedIssueCount,
        highRiskIssueCount,
        regressionIssueCount,
        healthStatus: releaseHealth(issueCount, openIssueCount, highRiskIssueCount, regressionIssueCount),
        createdAt: release.createdAt,
        updatedAt: release.updatedAt,
      },
      issues: shownIssues.map((item) => {
        const source = regressionSource.get(item.id);
        return {
          id: item.id,
          ticketNumber: item.ticketNumber,
          title: item.title,
          status: item.status,
          severity: item.severity,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          fixedAt: item.statusHistory[0]?.createdAt ?? null,
          lifecycle: readEngineeringLifecycle(item.extraContext),
          regression: source ? {
            fixedIssue: { id: source.id, ticketNumber: source.ticketNumber, title: source.title },
            fixedRelease: source.release,
            fixedAt: fixedAtForRegressionSource(source),
          } : null,
        };
      }),
      issuesOmittedCount: Math.max(0, issueCount - shownIssues.length),
      lifecycle: lifecycleRows.slice(0, 100).map((item) => ({
        id: item.id,
        feedbackItemId: item.feedbackItemId,
        ticketNumber: item.feedbackItem.ticketNumber,
        ticketTitle: item.feedbackItem.title,
        provider: item.provider,
        source: item.source,
        stage: item.stage,
        state: item.state,
        externalUrl: item.externalUrl,
        label: item.label,
        details: item.safeDetails,
        observedAt: item.observedAt,
        createdAt: item.createdAt,
      })),
      lifecycleOmittedCount: Math.max(0, lifecycleCount - 100),
      notifications: notificationRows.slice(0, 100).map((item) => ({
        id: item.id,
        feedbackItemId: item.feedbackItemId,
        ticketNumber: item.feedbackItem.ticketNumber,
        ticketTitle: item.feedbackItem.title,
        eventType: item.eventType,
        status: item.status,
        provider: item.provider,
        attemptCount: item.attemptCount,
        nextAttemptAt: item.nextAttemptAt,
        sentAt: item.sentAt,
        createdAt: item.createdAt,
      })),
      notificationsOmittedCount: Math.max(0, notificationCount - 100),
    };
  }

  async getSummary(projectIds?: string[], options: AnalyticsSummaryOptions = {}) {
    const days = normalizeRangeDays(options.days);
    const where = projectIds ? { projectId: { in: projectIds } } : undefined;
    const now = new Date();
    now.setUTCHours(23, 59, 59, 999);

    const [byProject, byProjectSeverity, bySeverity, byStatus, topScreens, openClosedItems, contextItems, duplicateGroupItems] = await Promise.all([
      prisma.feedbackItem.groupBy({
        by: ["projectId"],
        where,
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.feedbackItem.groupBy({
        by: ["projectId", "severity"],
        where,
        _count: { _all: true },
      }),
      prisma.feedbackItem.groupBy({
        by: ["severity"],
        where,
        _count: { _all: true },
      }),
      prisma.feedbackItem.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),
      prisma.feedbackItem.groupBy({
        by: ["currentUrl"],
        where,
        _count: { _all: true },
        orderBy: {
          _count: {
            currentUrl: "desc",
          },
        },
        take: 10,
      }),
      prisma.feedbackItem.findMany({
        where: {
          ...where,
          createdAt: {
            lte: now,
          },
        },
        select: {
          createdAt: true,
          updatedAt: true,
          status: true,
        },
      }),
      prisma.feedbackItem.findMany({
        where,
        select: {
          projectId: true,
          extraContext: true,
          status: true,
          severity: true,
          isOverageLocked: true,
        },
      }),
      prisma.feedbackItem.findMany({
        where: {
          ...where,
          duplicateOfId: null,
          duplicates: {
            some: {},
          },
        },
        select: {
          id: true,
          ticketNumber: true,
          title: true,
          status: true,
          severity: true,
          duplicates: {
            select: {
              status: true,
              severity: true,
            },
          },
          _count: {
            select: {
              duplicates: true,
            },
          },
        },
        orderBy: {
          duplicates: {
            _count: "desc",
          },
        },
        take: 10,
      }),
    ]);

    const projects = await prisma.project.findMany({
      where: projectIds ? { id: { in: projectIds } } : undefined,
      select: {
        id: true,
        key: true,
        name: true,
      },
    });

    const projectMap = new Map(projects.map((project) => [project.id, project]));
    const projectSeverityMap = new Map<string, {
      projectId: string;
      projectKey: string;
      projectName: string;
      total: number;
      counts: Record<"low" | "medium" | "high" | "critical", number>;
    }>();

    for (const item of byProjectSeverity) {
      const project = projectMap.get(item.projectId);
      const existing = projectSeverityMap.get(item.projectId) ?? {
        projectId: item.projectId,
        projectKey: project?.key ?? "unknown",
        projectName: project?.name ?? "Unknown",
        total: 0,
        counts: {
          low: 0,
          medium: 0,
          high: 0,
          critical: 0,
        },
      };
      const severity = item.severity.toLowerCase() as Lowercase<keyof typeof Severity>;
      existing.total += item._count._all;
      existing.counts[severity] = item._count._all;
      projectSeverityMap.set(item.projectId, existing);
    }

    const topAccounts = new Map<string, AccountImpactRow>();
    const topPlans = new Map<string, PlanImpactRow>();
    const topCustomerSegments = new Map<string, CustomerSegmentImpactRow>();
    const topCustomerCohorts = new Map<string, CustomerCohortImpactRow>();
    const topProductAreas = new Map<string, ProductAreaImpactRow>();
    const topFunnelSteps = new Map<string, FunnelStepImpactRow>();
    const topFeatureFlags = new Map<string, FeatureFlagImpactRow>();
    const topExperiments = new Map<string, ExperimentImpactRow>();
    const surveyImpactByType = new Map<FeedbackSurveyResponse["type"], SurveyImpactRow>();
    const topTrackedEvents = new Map<string, TrackedEventImpactRow>();
    const topFrictionFlows = new Map<string, FrictionFlowImpactRow>();
    const capacityLockProjects = new Map<string, CapacityLockProjectImpactRow>();
    let surveyResponseCount = 0;
    let surveyScoredCount = 0;
    let surveyScoreTotal = 0;
    let lockedIssueCount = 0;
    let openLockedIssueCount = 0;
    let highRiskLockedIssueCount = 0;

    for (const item of contextItems) {
      if (item.isOverageLocked) {
        const project = projectMap.get(item.projectId);
        const projectLabel = project?.name ?? "Unknown";
        lockedIssueCount += 1;
        if (!CLOSED_STATUSES.has(item.status)) openLockedIssueCount += 1;
        if (isHighRiskSeverity(item.severity)) highRiskLockedIssueCount += 1;
        bumpContextImpact(capacityLockProjects, item.projectId, {
          projectId: item.projectId,
          projectKey: project?.key ?? "unknown",
          projectName: projectLabel,
          label: projectLabel,
          count: 0,
          openCount: 0,
          highRiskCount: 0,
        }, item.status, item.severity);
      }

      const eventTrail = readEventTrail(item.extraContext);
      const eventNamesInReport = new Set<string>();
      const frictionFlowsInReport = new Set<string>();
      for (const event of eventTrail) {
        const existing = topTrackedEvents.get(event.name) ?? {
          eventName: event.name,
          label: event.name,
          count: 0,
          occurrenceCount: 0,
          openCount: 0,
          highRiskCount: 0,
        };
        existing.occurrenceCount += 1;
        topTrackedEvents.set(event.name, existing);
        eventNamesInReport.add(event.name);
      }
      for (let index = 0; index < eventTrail.length - 1; index += 1) {
        const fromEventName = eventTrail[index]!.name;
        const toEventName = eventTrail[index + 1]!.name;
        const flowKey = JSON.stringify([fromEventName, toEventName]);
        const existing = topFrictionFlows.get(flowKey) ?? {
          fromEventName,
          toEventName,
          label: `${fromEventName} -> ${toEventName}`,
          count: 0,
          occurrenceCount: 0,
          openCount: 0,
          highRiskCount: 0,
        };
        existing.occurrenceCount += 1;
        topFrictionFlows.set(flowKey, existing);
        frictionFlowsInReport.add(flowKey);
      }
      for (const eventName of eventNamesInReport) {
        const row = topTrackedEvents.get(eventName);
        if (row) {
          bumpContextImpact(topTrackedEvents, eventName, row, item.status, item.severity);
        }
      }
      for (const flowKey of frictionFlowsInReport) {
        const row = topFrictionFlows.get(flowKey);
        if (row) {
          bumpContextImpact(topFrictionFlows, flowKey, row, item.status, item.severity);
        }
      }

      const surveyResponse = readSurveyResponse(item.extraContext);
      if (surveyResponse) {
        surveyResponseCount += 1;
        const existing = surveyImpactByType.get(surveyResponse.type) ?? {
          type: surveyResponse.type,
          label: surveyTypeLabel(surveyResponse.type),
          count: 0,
          scoredCount: 0,
          scoreTotal: 0,
          openCount: 0,
          highRiskCount: 0,
        };
        existing.count += 1;
        if (surveyResponse.score !== undefined) {
          existing.scoredCount += 1;
          existing.scoreTotal += surveyResponse.score;
          surveyScoredCount += 1;
          surveyScoreTotal += surveyResponse.score;
        }
        if (!CLOSED_STATUSES.has(item.status)) existing.openCount += 1;
        if (isHighRiskSeverity(item.severity)) existing.highRiskCount += 1;
        surveyImpactByType.set(surveyResponse.type, existing);
      }

      const productContext = readProductContext(item.extraContext);
      if (!productContext) continue;

      if (productContext.account) {
        const label = contextLabel([productContext.account.name, productContext.account.id]);
        bumpContextImpact(topAccounts, label, {
          id: productContext.account.id ?? null,
          name: productContext.account.name ?? null,
          label,
          count: 0,
          openCount: 0,
          highRiskCount: 0,
        }, item.status, item.severity);
      }

      if (productContext.plan) {
        const label = contextLabel([productContext.plan.name, productContext.plan.tier]);
        bumpContextImpact(topPlans, label, {
          name: productContext.plan.name ?? null,
          tier: productContext.plan.tier ?? null,
          label,
          count: 0,
          openCount: 0,
          highRiskCount: 0,
        }, item.status, item.severity);
      }

      if (productContext.customer?.segment) {
        bumpContextImpact(topCustomerSegments, productContext.customer.segment, {
          segment: productContext.customer.segment,
          label: productContext.customer.segment,
          count: 0,
          openCount: 0,
          highRiskCount: 0,
        }, item.status, item.severity);
      }

      if (productContext.customer?.cohort) {
        bumpContextImpact(topCustomerCohorts, productContext.customer.cohort, {
          cohort: productContext.customer.cohort,
          label: productContext.customer.cohort,
          count: 0,
          openCount: 0,
          highRiskCount: 0,
        }, item.status, item.severity);
      }

      if (productContext.feature?.area) {
        bumpContextImpact(topProductAreas, productContext.feature.area, {
          area: productContext.feature.area,
          label: productContext.feature.area,
          count: 0,
          openCount: 0,
          highRiskCount: 0,
        }, item.status, item.severity);
      }

      if (productContext.funnelStep) {
        bumpContextImpact(topFunnelSteps, productContext.funnelStep, {
          step: productContext.funnelStep,
          label: productContext.funnelStep,
          count: 0,
          openCount: 0,
          highRiskCount: 0,
        }, item.status, item.severity);
      }

      for (const [flag, rawValue] of Object.entries(productContext.featureFlags ?? {})) {
        const value = String(rawValue);
        const label = `${flag}: ${value}`;
        bumpContextImpact(topFeatureFlags, label, {
          flag,
          value,
          label,
          count: 0,
          openCount: 0,
          highRiskCount: 0,
        }, item.status, item.severity);
      }

      for (const [experiment, variant] of Object.entries(productContext.experiments ?? {})) {
        const label = `${experiment}: ${variant}`;
        bumpContextImpact(topExperiments, label, {
          experiment,
          variant,
          label,
          count: 0,
          openCount: 0,
          highRiskCount: 0,
        }, item.status, item.severity);
      }
    }

    return {
      byProject: byProject.map((item) => ({
        projectId: item.projectId,
        projectKey: projectMap.get(item.projectId)?.key ?? "unknown",
        projectName: projectMap.get(item.projectId)?.name ?? "Unknown",
        count: item._count._all,
        latestReportAt: item._max.createdAt,
      })),
      projectSeverity: [...projectSeverityMap.values()].sort((a, b) => b.total - a.total),
      openClosed: buildOpenClosedRows(openClosedItems, days),
      bySeverity: bySeverity.map((item) => ({
        severity: item.severity.toLowerCase(),
        count: item._count._all,
      })),
      byStatus: byStatus.map((item) => ({
        status: item.status.toLowerCase(),
        count: item._count._all,
      })),
      topScreens: topScreens.map((item) => ({
        url: item.currentUrl,
        count: item._count._all,
      })),
      capacityLockImpact: {
        lockedIssueCount,
        openLockedIssueCount,
        highRiskLockedIssueCount,
        byProject: sortContextImpact(capacityLockProjects).map((row) => ({
          projectId: row.projectId,
          projectKey: row.projectKey,
          projectName: row.projectName,
          count: row.count,
          openCount: row.openCount,
          highRiskCount: row.highRiskCount,
        })),
      },
      topDuplicateGroups: duplicateGroupItems.map((item) => {
        const reports = [
          { status: item.status, severity: item.severity },
          ...item.duplicates,
        ];
        return {
          id: item.id,
          ticketNumber: item.ticketNumber,
          title: item.title,
          status: item.status.toLowerCase(),
          severity: item.severity.toLowerCase(),
          duplicateCount: item._count.duplicates,
          reportCount: item._count.duplicates + 1,
          openCount: reports.filter((report) => !CLOSED_STATUSES.has(report.status)).length,
          highRiskCount: reports.filter((report) => isHighRiskSeverity(report.severity)).length,
        };
      }),
      surveyImpact: {
        total: surveyResponseCount,
        scoredCount: surveyScoredCount,
        averageScore: averageScore(surveyScoreTotal, surveyScoredCount),
        byType: [...surveyImpactByType.values()]
          .sort((a, b) => b.count - a.count || b.highRiskCount - a.highRiskCount || a.label.localeCompare(b.label))
          .slice(0, 10)
          .map((row) => ({
            type: row.type,
            label: row.label,
            count: row.count,
            scoredCount: row.scoredCount,
            averageScore: averageScore(row.scoreTotal, row.scoredCount),
            openCount: row.openCount,
            highRiskCount: row.highRiskCount,
          })),
      },
      eventTrailImpact: {
        topTrackedEvents: [...topTrackedEvents.values()]
          .sort((a, b) => b.count - a.count || b.occurrenceCount - a.occurrenceCount || b.highRiskCount - a.highRiskCount || a.label.localeCompare(b.label))
          .slice(0, 10)
          .map((row) => ({
            eventName: row.eventName,
            label: row.label,
            count: row.count,
            occurrenceCount: row.occurrenceCount,
            openCount: row.openCount,
            highRiskCount: row.highRiskCount,
          })),
        topFrictionFlows: [...topFrictionFlows.values()]
          .sort((a, b) => b.count - a.count || b.occurrenceCount - a.occurrenceCount || b.highRiskCount - a.highRiskCount || a.label.localeCompare(b.label))
          .slice(0, 10)
          .map((row) => ({
            fromEventName: row.fromEventName,
            toEventName: row.toEventName,
            label: row.label,
            count: row.count,
            occurrenceCount: row.occurrenceCount,
            openCount: row.openCount,
            highRiskCount: row.highRiskCount,
          })),
      },
      contextImpact: {
        topAccounts: sortContextImpact(topAccounts),
        topPlans: sortContextImpact(topPlans),
        topCustomerSegments: sortContextImpact(topCustomerSegments),
        topCustomerCohorts: sortContextImpact(topCustomerCohorts),
        topProductAreas: sortContextImpact(topProductAreas),
        topFunnelSteps: sortContextImpact(topFunnelSteps),
        topFeatureFlags: sortContextImpact(topFeatureFlags),
        topExperiments: sortContextImpact(topExperiments),
      },
    };
  }

  async getInternalDigest(projectIds?: string[], options: AnalyticsSummaryOptions = {}) {
    const days = normalizeRangeDays(options.days);
    const period = digestPeriod(days);
    const scopedWhere: Prisma.FeedbackItemWhereInput = projectIds ? { projectId: { in: projectIds } } : {};
    const openStatusWhere: Prisma.FeedbackItemWhereInput = { status: { notIn: Array.from(CLOSED_STATUSES) } };
    const staleBefore = new Date(period.to);
    staleBefore.setUTCDate(staleBefore.getUTCDate() - STALE_TICKET_DAYS);

    const openBugWhere: Prisma.FeedbackItemWhereInput = {
      ...scopedWhere,
      ...openStatusWhere,
      issueType: IssueType.BUG,
    };
    const staleTicketWhere: Prisma.FeedbackItemWhereInput = {
      ...scopedWhere,
      ...openStatusWhere,
      updatedAt: {
        lt: staleBefore,
      },
    };
    const fixedInPeriodWhere: Prisma.FeedbackItemWhereInput = {
      ...scopedWhere,
      OR: [
        {
          status: FeedbackStatus.FIXED,
          updatedAt: {
            gte: period.from,
            lte: period.to,
          },
        },
        {
          statusHistory: {
            some: {
              toStatus: FeedbackStatus.FIXED,
              createdAt: {
                gte: period.from,
                lte: period.to,
              },
            },
          },
        },
      ],
    };
    const waitingOnCustomerWhere: Prisma.FeedbackItemWhereInput = {
      ...scopedWhere,
      ...openStatusWhere,
      labels: {
        has: WAITING_ON_CUSTOMER_LABEL,
      },
    };
    const highImpactRepeatsWhere: Prisma.FeedbackItemWhereInput = {
      ...scopedWhere,
      ...openStatusWhere,
      duplicateOfId: null,
      duplicates: {
        some: {},
      },
    };

    const [
      openBugCount,
      staleTicketCount,
      fixedInPeriodCount,
      waitingOnCustomerCount,
      highImpactRepeatCount,
      openBugs,
      staleTickets,
      fixedInPeriod,
      waitingOnCustomer,
      highImpactRepeats,
      derivedTickets,
      allTimeReports,
      untriagedCount,
      criticalOpenCount,
      inProgressCount,
      homeReceivedItems,
      homeResolvedTransitions,
      openByProjectRows,
      homeProjects,
    ] = await Promise.all([
      prisma.feedbackItem.count({ where: openBugWhere }),
      prisma.feedbackItem.count({ where: staleTicketWhere }),
      prisma.feedbackItem.count({ where: fixedInPeriodWhere }),
      prisma.feedbackItem.count({ where: waitingOnCustomerWhere }),
      prisma.feedbackItem.count({ where: highImpactRepeatsWhere }),
      prisma.feedbackItem.findMany({
        where: openBugWhere,
        include: {
          project: {
            select: {
              key: true,
              name: true,
            },
          },
          _count: {
            select: {
              duplicates: true,
            },
          },
        },
        orderBy: [
          { updatedAt: "desc" },
          { createdAt: "desc" },
        ],
        take: 25,
      }),
      prisma.feedbackItem.findMany({
        where: staleTicketWhere,
        include: {
          project: {
            select: {
              key: true,
              name: true,
            },
          },
        },
        orderBy: [
          { updatedAt: "asc" },
          { createdAt: "asc" },
        ],
        take: 10,
      }),
      prisma.feedbackItem.findMany({
        where: fixedInPeriodWhere,
        include: {
          project: {
            select: {
              key: true,
              name: true,
            },
          },
        },
        orderBy: [
          { updatedAt: "desc" },
          { createdAt: "desc" },
        ],
        take: 10,
      }),
      prisma.feedbackItem.findMany({
        where: waitingOnCustomerWhere,
        include: {
          project: {
            select: {
              key: true,
              name: true,
            },
          },
        },
        orderBy: [
          { updatedAt: "asc" },
          { createdAt: "asc" },
        ],
        take: 10,
      }),
      prisma.feedbackItem.findMany({
        where: highImpactRepeatsWhere,
        include: {
          project: {
            select: {
              key: true,
              name: true,
            },
          },
          duplicates: {
            select: {
              status: true,
              severity: true,
            },
          },
          _count: {
            select: {
              duplicates: true,
            },
          },
        },
        orderBy: {
          duplicates: {
            _count: "desc",
          },
        },
        take: 10,
      }),
      scanHomeDerivedTickets({ ...scopedWhere, ...openStatusWhere }, staleBefore),
      prisma.feedbackItem.count({ where: scopedWhere }),
      prisma.feedbackItem.count({ where: { ...scopedWhere, status: FeedbackStatus.NEW } }),
      prisma.feedbackItem.count({ where: { ...scopedWhere, ...openStatusWhere, severity: Severity.CRITICAL } }),
      prisma.feedbackItem.count({ where: { ...scopedWhere, status: FeedbackStatus.IN_PROGRESS } }),
      prisma.feedbackItem.findMany({
        where: {
          ...scopedWhere,
          createdAt: {
            gte: period.from,
            lte: period.to,
          },
        },
        select: {
          createdAt: true,
        },
      }),
      prisma.feedbackStatusHistory.findMany({
        where: {
          ...(projectIds ? { feedbackItem: { projectId: { in: projectIds } } } : {}),
          createdAt: {
            gte: period.from,
            lte: period.to,
          },
          toStatus: {
            in: Array.from(CLOSED_STATUSES),
          },
          OR: [
            { fromStatus: null },
            { fromStatus: { notIn: Array.from(CLOSED_STATUSES) } },
          ],
        },
        select: {
          feedbackItemId: true,
          createdAt: true,
        },
      }),
      prisma.feedbackItem.groupBy({
        by: ["projectId"],
        where: {
          ...scopedWhere,
          ...openStatusWhere,
        },
        _count: {
          _all: true,
        },
      }),
      prisma.project.findMany({
        where: projectIds ? { id: { in: projectIds } } : undefined,
        select: {
          id: true,
          key: true,
          name: true,
        },
      }),
    ]);
    const {
      weakEvidence,
      weakEvidenceCount,
      stuckLifecycle,
      stuckLifecycleCount,
      priorityQueue: homePriorityRows,
      priorityTotal,
    } = derivedTickets;
    const homeProjectMap = new Map(homeProjects.map((project) => [project.id, project]));

    const sortedOpenBugs = openBugs
      .sort((left, right) => (
        SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
        right._count.duplicates - left._count.duplicates ||
        right.updatedAt.getTime() - left.updatedAt.getTime()
      ))
      .slice(0, 10);
    return {
      period,
      totals: {
        openBugs: openBugCount,
        staleTickets: staleTicketCount,
        fixedInPeriod: fixedInPeriodCount,
        waitingOnCustomer: waitingOnCustomerCount,
        highImpactRepeats: highImpactRepeatCount,
        weakEvidence: weakEvidenceCount,
        stuckLifecycle: stuckLifecycleCount,
      },
      topOpenBugs: sortedOpenBugs.map(digestTicket),
      staleTickets: staleTickets.map(digestTicket),
      fixedInPeriod: fixedInPeriod.map(digestTicket),
      waitingOnCustomer: waitingOnCustomer.map(digestTicket),
      highImpactRepeats: highImpactRepeats.map((item) => {
        const reports = [
          { status: item.status, severity: item.severity },
          ...item.duplicates,
        ];
        return {
          ...digestTicket(item),
          duplicateCount: item._count.duplicates,
          reportCount: reports.length,
        };
      }),
      weakEvidence: weakEvidence.slice(0, 10).map(({ item, quality }) => ({
        ...digestTicket(item),
        evidenceScore: quality.score,
        missingEvidence: quality.missing,
      })),
      stuckLifecycle: stuckLifecycle.slice(0, 10).map(({ item, lifecycleState, stuckReason }) => ({
        ...digestTicket(item),
        lifecycleState,
        stuckReason,
      })),
      home: {
        metrics: {
          allTimeReports,
          untriaged: untriagedCount,
          critical: criticalOpenCount,
          inProgress: inProgressCount,
          fixedInPeriod: fixedInPeriodCount,
        },
        priorityTotal,
        priorityQueue: homePriorityRows.slice(0, 5).map(({ item, quality, reasons }) => ({
          ...digestTicket(item),
          reasons,
          evidenceScore: quality.score,
          reportCount: item._count.duplicates + 1,
        })),
        trend: buildHomeTrendRows(homeReceivedItems, homeResolvedTransitions, period),
        openByProject: openByProjectRows
          .map((item) => ({
            projectId: item.projectId,
            projectKey: homeProjectMap.get(item.projectId)?.key ?? "unknown",
            projectName: homeProjectMap.get(item.projectId)?.name ?? "Unknown",
            count: item._count._all,
          }))
          .sort((left, right) => right.count - left.count || left.projectName.localeCompare(right.projectName)),
        signals: [
          { id: "waiting_on_customer", label: "Waiting on reporter", count: waitingOnCustomerCount, href: "/issues?attention=waiting_on_customer" },
          { id: "weak_evidence", label: "Weak evidence", count: weakEvidenceCount, href: "/issues?attention=weak_evidence" },
          { id: "high_impact_repeats", label: "High-impact repeats", count: highImpactRepeatCount, href: "/issues?attention=high_impact_repeats" },
          { id: "stale", label: "Stale tickets", count: staleTicketCount, href: "/issues?attention=stale" },
          { id: "stuck_lifecycle", label: "Stuck lifecycle", count: stuckLifecycleCount, href: "/issues?attention=stuck_lifecycle" },
        ],
      },
    };
  }
}

export const analyticsService = new AnalyticsService();
