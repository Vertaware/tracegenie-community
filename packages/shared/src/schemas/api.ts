import { z } from "zod";

import {
  feedbackStatusSchema,
  issueTypeSchema,
  labelSchema,
  severitySchema,
} from "./common";
import {
  dateOnlySchema,
  entityIdSchema,
  feedbackIdSchema,
  type FeedbackEngineeringLifecycle,
  type FeedbackExternalRef,
  type FeedbackSurveyResponse,
  projectKeySchema,
} from "./widget";

export const feedbackLifecycleStageSchema = z.enum([
  "branch",
  "pull_request",
  "check",
  "review",
  "merge",
  "deploy",
  "manual",
]);

export const feedbackLifecycleSourceSchema = z.enum(["provider", "manual"]);

const providerLifecycleUrlSchema = z.string().trim().url().max(2048).superRefine((value, context) => {
  const parsed = new URL(value);
  const secretQueryKey = [...parsed.searchParams.keys()].find((key) => /token|secret|signature|authorization|credential|password|api[-_]?key|(^|[-_])key$/i.test(key));
  const secretFragment = /token|secret|signature|authorization|credential|password|api[-_]?key/i.test(parsed.hash);
  if (parsed.username || parsed.password || secretQueryKey || secretFragment) {
    context.addIssue({
      code: "custom",
      message: "Lifecycle URLs cannot contain credentials or secret-bearing query parameters.",
    });
  }
});

export const githubLifecycleTransitionSchema = z
  .object({
    organizationId: entityIdSchema,
    projectKey: projectKeySchema,
    feedbackId: feedbackIdSchema,
    provider: z.literal("github"),
    providerEventId: z.string().trim().min(8).max(255),
    stage: z.enum(["branch", "pull_request", "check", "review", "merge", "deploy"]),
    state: z.enum([
      "created",
      "deleted",
      "open",
      "closed",
      "pending",
      "success",
      "failure",
      "approved",
      "changes_requested",
      "dismissed",
      "merged",
    ]),
    externalId: z.string().trim().min(1).max(255),
    externalUrl: providerLifecycleUrlSchema.optional(),
    label: z.string().trim().min(1).max(160).optional(),
    observedAt: z.string().datetime(),
    details: z
      .object({
        repository: z.string().trim().min(1).max(255).optional(),
        branch: z.string().trim().min(1).max(255).optional(),
        commitSha: z.string().trim().regex(/^[a-f0-9]{7,64}$/i).optional(),
        checkName: z.string().trim().min(1).max(160).optional(),
        environment: z.string().trim().min(1).max(160).optional(),
        actorName: z.string().trim().min(1).max(160).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const allowed: Record<typeof value.stage, ReadonlySet<typeof value.state>> = {
      branch: new Set(["created", "deleted"]),
      pull_request: new Set(["open", "closed", "merged"]),
      check: new Set(["pending", "success", "failure"]),
      review: new Set(["pending", "approved", "changes_requested", "dismissed"]),
      merge: new Set(["merged"]),
      deploy: new Set(["pending", "success", "failure"]),
    };
    if (!allowed[value.stage].has(value.state)) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: `${value.state} is not valid for ${value.stage}.`,
      });
    }
  });

export type GithubLifecycleTransitionInput = z.infer<typeof githubLifecycleTransitionSchema>;

export type FeedbackLifecycleTransition = {
  id: string;
  provider: "github" | "manual";
  source: z.infer<typeof feedbackLifecycleSourceSchema>;
  stage: z.infer<typeof feedbackLifecycleStageSchema>;
  state: string;
  externalId: string | null;
  externalUrl: string | null;
  label: string | null;
  details: {
    repository?: string;
    branch?: string;
    commitSha?: string;
    checkName?: string;
    environment?: string;
    actorName?: string;
    action?: "recorded" | "cleared";
    hasBranch?: boolean;
    hasPullRequest?: boolean;
    hasDeployment?: boolean;
    verificationState?: FeedbackEngineeringLifecycle["verificationState"];
  } | null;
  observedAt: string | Date;
  createdAt: string | Date;
};

export type AdminSession = {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    platformRole?: string;
  };
};

export type FeedbackListItem = {
  id: string;
  ticketNumber: number;
  title: string;
  description: string;
  isOverageLocked?: boolean;
  project: {
    key: string;
    name: string;
  };
  status: string;
  severity: string;
  issueType: string;
  labels: string[];
  currentUrl: string;
  reporterName: string | null;
  reporterEmail: string | null;
  productContextSummary: {
    account: string | null;
    customer: string | null;
    plan: string | null;
    feature: string | null;
    funnelStep: string | null;
    revenue: string | null;
    flags: string[];
    experiments: string[];
  } | null;
  customerImpactSummary: {
    summary: string | null;
    affectedUsers: number | null;
    affectedAccounts: number | null;
    revenueAtRisk: string | null;
    churnRisk: "low" | "medium" | "high" | "critical" | null;
  } | null;
  duplicateOf: {
    id: string;
    ticketNumber: number;
    title: string;
    status: string;
  } | null;
  duplicateCount: number;
  voiceOfCustomer?: {
    voteCount: number;
    followerCount: number;
  };
  requesterLoop?: {
    canEmailRequester: boolean;
    lastRequesterUpdateAt: string | Date | null;
    updateDue: boolean;
    failedCount: number;
  };
  integrationActivity?: {
    clientName: string | null;
    eventType: string;
    mcpToolName: string | null;
    createdAt: string | Date;
  } | null;
  releaseSignal: {
    kind: "regression";
    fixedIssue: {
      id: string;
      ticketNumber: number;
      title: string;
    };
    fixedRelease: {
      appVersion: string;
      buildNumber?: string | null;
      releaseChannel?: string | null;
      fixedAt: string | Date;
    };
  } | null;
  owner: {
    id: string;
    name: string;
  } | null;
  convertedToBacklog: boolean;
  attachmentCount: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type FeedbackDetail = {
  id: string;
  ticketNumber: number;
  project: {
    id: string;
    key: string;
    name: string;
  };
  status: string;
  issueType: string;
  severity: string;
  title: string;
  description: string;
  isOverageLocked?: boolean;
  stepsToReproduce?: string | null;
  expectedResult?: string | null;
  actualResult?: string | null;
  labels: string[];
  route: {
    url: string;
    routeName?: string | null;
    pageTitle?: string | null;
    referrer?: string | null;
  };
  release: {
    id?: string;
    appName: string;
    appEnvironment: string;
    appVersion: string;
    buildNumber?: string | null;
    releaseChannel?: string | null;
  };
  releaseSignal: FeedbackListItem["releaseSignal"];
  browser: {
    userAgent: string;
    language?: string | null;
    platform?: string | null;
    browserName?: string | null;
    browserVersion?: string | null;
    osName?: string | null;
    osVersion?: string | null;
    viewportWidth: number;
    viewportHeight: number;
  };
  reporter: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
    role?: string | null;
  };
  subscribers: Array<{
    id: string;
    email: string;
    name?: string | null;
    recipientType: string;
    notifyOnTriage: boolean;
    notifyOnStatusChange: boolean;
    isActive: boolean;
    addedBy: {
      id: string;
      name: string;
      email: string;
    } | null;
    createdAt: string | Date;
    updatedAt: string | Date;
  }>;
  requesterNotificationsEnabled: boolean;
  clientTimestamp: string | Date;
  duplicateFingerprint?: string | null;
  duplicateCandidates?: unknown;
  duplicateOf?: {
    id: string;
    ticketNumber: number;
    title: string;
    status: string;
  } | null;
  duplicates: Array<{
    id: string;
    ticketNumber: number;
    title: string;
    status: string;
    commentCount: number;
    latestCommentAt?: string | Date | null;
    createdAt: string | Date;
  }>;
  duplicateCommentConsolidation: {
    totalCount: number;
    omittedCount: number;
    comments: Array<{
      id: string;
      body: string;
      visibility: string;
      createdAt: string | Date;
      updatedAt: string | Date;
      sourceTicket: {
        id: string;
        ticketNumber: number;
        title: string;
        status: string;
      };
      author: {
        id: string;
        name: string;
        email: string;
      } | null;
    }>;
  };
  duplicateGroup: {
    reportCount: number;
    firstSeenAt: string | Date;
    lastSeenAt: string | Date;
    affectedReleases: Array<{
      appName: string;
      appEnvironment: string;
      appVersion: string;
      buildNumber?: string | null;
      releaseChannel?: string | null;
      reportCount: number;
      firstSeenAt: string | Date;
      lastSeenAt: string | Date;
    }>;
  } | null;
  convertedToBacklog: boolean;
  externalTicketRef?: string | null;
  externalRefs: FeedbackExternalRef[];
  engineeringLifecycle: FeedbackEngineeringLifecycle | null;
  engineeringLifecycleHistory?: FeedbackLifecycleTransition[];
  engineeringLifecycleHistoryOmittedCount?: number;
  attachments: Array<{
    id: string;
    kind: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    width?: number | null;
    height?: number | null;
    downloadUrl: string;
    createdAt: string | Date;
  }>;
  /** The latest 20 comments, in chronological order. Use conversation for older messages. */
  commentsOmittedCount?: number;
  conversationCount?: number;
  comments: Array<{
    id: string;
    body: string;
    visibility: string;
    createdAt: string | Date;
    updatedAt: string | Date;
    author: {
      id: string;
      name: string;
      email: string;
    } | null;
  }>;
  owner: {
    id: string;
    name: string;
    email: string;
    role: string;
  } | null;
  consoleEntries?: unknown;
  clientErrorContext?: unknown;
  extraContext?: unknown;
  statusHistory: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note?: string | null;
    createdAt: string | Date;
    actor: {
      id: string;
      name: string;
      email: string;
    } | null;
  }>;
  triageHistory: Array<{
    id: string;
    actorType: string;
    triageVersion: string;
    suggestedSeverity?: string | null;
    suggestedIssueType?: string | null;
    suggestedCategory?: string | null;
    likelyRootCause?: string | null;
    affectedArea?: string | null;
    reproductionSteps: string[];
    nextAction?: string | null;
    confidence?: number | null;
    safeRequesterSummary?: string | null;
    rawPayload?: unknown;
    integrationClient: {
      id: string;
      name: string;
    } | null;
    createdAt: string | Date;
  }>;
  auditHistory: Array<{
    id: string;
    actorType: string;
    eventType: string;
    requestId?: string | null;
    idempotencyKey?: string | null;
    observability?: {
      mcpToolName?: string | null;
      mcpLatencyMs?: number | null;
      notifyRequester?: boolean | null;
    } | null;
    details?: {
      attachment?: {
        attachmentId?: string | null;
        resourceUri?: string | null;
        fileName?: string | null;
        mimeType?: string | null;
        byteSize?: number | null;
      } | null;
      rawEvidence?: {
        consoleEntries?: boolean | null;
        clientErrorContext?: boolean | null;
      } | null;
      externalEvent?: {
        resourceUri?: string | null;
        provider?: string | null;
        externalUrl?: string | null;
        externalLabel?: string | null;
        sourceTicketNumber?: number | null;
      } | null;
    } | null;
    adminUser: {
      id: string;
      name: string;
      email: string;
    } | null;
    integrationClient: {
      id: string;
      name: string;
    } | null;
    createdAt: string | Date;
  }>;
  notificationHistory: Array<{
    id: string;
    eventType: string;
    recipientEmail?: string | null;
    recipientType: string;
    recipientName?: string | null;
    fromName?: string | null;
    fromEmail?: string | null;
    replyToEmail?: string | null;
    productNameSnapshot?: string | null;
    status: string;
    triggerStatus?: string | null;
    subjectSnapshot?: string | null;
    bodySnapshot?: string | null;
    skipReason?: string | null;
    provider?: string | null;
    providerMessageId?: string | null;
    integrationClient: {
      id: string;
      name: string;
    } | null;
    createdAt: string | Date;
    sentAt?: string | Date | null;
    updatedAt: string | Date;
  }>;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type FeedbackListResponse = {
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
  };
  assignableUsers: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
  }>;
  items: FeedbackListItem[];
};

export type FeedbackDetailResponse = {
  feedback: FeedbackDetail;
  assignableUsers: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
  }>;
};

export type FeedbackActivityItem = {
  id: string;
  kind: "note" | "status" | "lifecycle" | "integration" | "notification" | "audit";
  occurredAt: string | Date;
  actor: {
    label: string;
    type: "admin" | "integration" | "provider" | "system";
  };
  provenance: string;
  title: string;
  summary?: string | null;
  outcome?: "neutral" | "success" | "failed" | "pending" | "skipped";
  visibility?: "internal" | "requester" | "system";
  safeDetails: string[];
  retry?: {
    notificationId: string;
    label: string;
  } | null;
};

export type FeedbackActivityResponse = {
  items: FeedbackActivityItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
    hasMore: boolean;
  };
};

export type FeedbackConversationResponse = {
  items: FeedbackDetail["comments"];
  pagination: {
    total: number;
    pageSize: number;
    nextCursor: string | null;
  };
};

export const customerAttributionRepairSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  account: z.object({
    id: z.string().trim().min(1).max(120).optional(),
    name: z.string().trim().min(1).max(160).optional(),
  }).strict().refine(
    (account) => account.id !== undefined || account.name !== undefined,
    "Provide an account ID or account name.",
  ),
}).strict();

export type CustomerAttributionRepair = z.infer<typeof customerAttributionRepairSchema>;

export type CustomerAttributionWorkspace = {
  totals: {
    reportCount: number;
    attributedReportCount: number;
    unattributedReportCount: number;
    accountCount: number;
  };
  accounts: Array<{
    key: string;
    id: string | null;
    name: string | null;
    label: string;
    reportCount: number;
    openCount: number;
    highRiskCount: number;
    latestReportAt: string | Date;
    evidence: Array<{
      id: string;
      ticketNumber: number;
      title: string;
      status: string;
      severity: string;
      createdAt: string | Date;
    }>;
  }>;
  unattributed: {
    total: number;
    shown: number;
    page: number;
    pageSize: number;
    pageCount: number;
    reports: Array<{
      id: string;
      ticketNumber: number;
      title: string;
      project: {
        key: string;
        name: string;
      };
      status: string;
      severity: string;
      reporterName: string | null;
      reporterEmail: string | null;
      currentUrl: string;
      createdAt: string | Date;
      updatedAt: string | Date;
    }>;
  };
};

export type CustomerAccountDetail = {
  account: {
    key: string;
    id: string | null;
    name: string | null;
    label: string;
    lastSeenAt: string | Date;
  };
  impact: {
    reportCount: number;
    openIssueCount: number;
    highRiskCount: number;
    ideaCount: number;
    requesterNotificationCount: number;
  };
  plans: string[];
  products: Array<{
    key: string;
    name: string;
    reportCount: number;
  }>;
  openIssues: Array<{
    id: string;
    ticketNumber: number;
    title: string;
    status: string;
    severity: string;
    project: { key: string; name: string };
    createdAt: string | Date;
  }>;
  ideas: Array<{
    id: string;
    ticketNumber: number;
    title: string;
    status: string;
    decision: "reviewing" | "backlog" | "resolved";
    project: { key: string; name: string };
    createdAt: string | Date;
  }>;
  requesterHistory: Array<{
    id: string;
    feedbackId: string;
    ticketNumber: number;
    ticketTitle: string;
    eventType: string;
    status: string;
    createdAt: string | Date;
    sentAt: string | Date | null;
  }>;
  reports: {
    pagination: {
      total: number;
      page: number;
      pageSize: number;
      pageCount: number;
    };
    items: Array<{
      id: string;
      ticketNumber: number;
      title: string;
      status: string;
      severity: string;
      issueType: string;
      reporterName: string | null;
      project: { key: string; name: string };
      createdAt: string | Date;
    }>;
  };
  limits: {
    openIssues: number;
    ideas: number;
    requesterHistory: number;
    contextSamples: number;
    contextTruncated: boolean;
  };
};

export type FeedbackAiCodingTaskResponse = {
  prompt: string;
  preview: {
    ticket: {
      number: number;
      title: string;
      severity: string;
      status: string;
      url: string | null;
      release: string | null;
    };
    repository: {
      url: string | null;
      worktreePath: string | null;
      defaultBranch: string | null;
    };
    filesToInspect: string[];
    commands: {
      test: string | null;
      build: string | null;
    };
    expectedOutcome: string[];
    evidenceGaps: string[];
    ownerHints: Array<{
      file: string;
      owners: string[];
      pattern: string;
    }>;
    reviewerPolicy: ProjectReviewerPolicy;
  };
};

export type ProjectSummary = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  defaultEnvironment: string;
  allowedOrigins: string[];
  notificationEmails: string[];
  requesterEmailProductName?: string | null;
  widgetConfig: unknown;
  clientSecretConfigured?: boolean;
  widgetClientSecret?: string | null;
  widgetSecretRotatedAt?: string | Date | null;
  onboardingVersion?: number | null;
  onboardingCompletedStep?: "product" | "customize" | "reports" | "team" | "connect" | null;
  onboardingCompletedAt?: string | Date | null;
  onboardingInstallMethod?: "embedded" | "hosted" | null;
  onboardingWebsite?: string | null;
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
  organization?: {
    id: string;
    name: string;
  };
};

export type ProductOnboardingCreateResponse = {
  project: ProjectSummary;
};

export type ProductOnboardingUpdateResponse = {
  project: ProjectSummary;
  verifiedReport?: {
    id: string;
    ticketNumber: number;
  } | null;
};

export type ProjectActivationProofStatus = "verified" | "configured" | "missing" | "failed" | "stale" | "manual";

export type ProjectActivationProofId =
  | "origin"
  | "session"
  | "first_report"
  | "attachment"
  | "notification"
  | "provider";

export type ProjectInstallDiagnosticsResponse = {
  projectKey: string;
  projectName: string;
  status: "ready" | "verification_needed" | "action_required";
  checkedAt: string;
  testOrigin: string | null;
  testedOrigin: string | null;
  lastWidgetLoadedAt: string | null;
  lastWidgetSessionIssuedAt: string | null;
  firstReportReceivedAt: string | null;
  firstReportId: string | null;
  firstReportTicketNumber: number | null;
  screenshotProofReceivedAt: string | null;
  notificationProofRecordedAt: string | null;
  privacyReadiness: {
    status: "ready" | "action_required";
    enforced: boolean;
    owner: string | null;
    policyUrl: string | null;
    issueRetentionDays: number | null;
    attachmentRetentionDays: number | null;
    collectorRedactionReady: boolean;
    selectedTextSuppressed: boolean;
    mcpEvidencePolicy: "raw_allowed" | "metadata_only";
    blockers: Array<{
      id: "privacy_owner" | "privacy_url" | "issue_retention" | "attachment_retention" | "collector_redaction" | "selected_text" | "mcp_evidence";
      label: string;
      detail: string;
    }>;
  };
  proofs: Array<{
    id: ProjectActivationProofId;
    label: string;
    detail: string;
    status: ProjectActivationProofStatus;
    evidenceAt: string | null;
    scheduledDeletionAt: string | null;
    action: {
      label: string;
      href: string;
    } | null;
  }>;
};

export type ProjectInstallTestReportResponse = {
  feedback: {
    id: string;
    ticketNumber: number;
    status: string;
    isOverageLocked: boolean;
    createdAt: string | Date;
  };
  installDiagnostics: ProjectInstallDiagnosticsResponse;
};

export const projectAutoFixPolicySchema = z.enum(["DISABLED", "SUGGEST_ONLY", "ALLOW_BRANCH"]);
export const projectReviewerPolicySchema = z.enum(["NONE", "HUMAN_REVIEW_REQUIRED"]);
export const projectRequesterNotificationPolicySchema = z.enum(["EXPLICIT_ONLY", "DISABLED"]);

const engineeringSingleLineSchema = (label: string, max: number) => z
  .string()
  .trim()
  .max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), `${label} must be a single line without control characters.`);

const engineeringRepositoryUrlSchema = engineeringSingleLineSchema("Repository URL", 500)
  .url("Enter a valid repository URL.")
  .superRefine((value, context) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return;
    }
    if (parsed.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "Repository URL must use HTTPS." });
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      context.addIssue({ code: "custom", message: "Repository URL cannot contain credentials, query parameters, or fragments." });
    }
  });

const engineeringBranchSchema = engineeringSingleLineSchema("Default branch", 120)
  .refine(
    (value) => value !== "@"
      && !value.startsWith("-")
      && !value.startsWith("/")
      && !value.endsWith("/")
      && !value.endsWith(".")
      && !value.split("/").some((segment) => segment.endsWith(".lock")),
    "Enter a valid Git branch name.",
  )
  .refine(
    (value) => !/[\s~^:?*[\\]/.test(value)
      && !value.includes("..")
      && !value.includes("@{")
      && !value.includes("//"),
    "Enter a valid Git branch name.",
  );

const engineeringWorktreeSchema = engineeringSingleLineSchema("Worktree path", 1000)
  .refine((value) => value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value), "Worktree path must be absolute.")
  .refine((value) => !value.split(/[\\/]+/).some((segment) => segment === "." || segment === ".."), "Worktree path cannot contain traversal segments.");

const engineeringNotesSchema = z
  .string()
  .trim()
  .max(4000)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Owner mapping cannot contain control characters.");

function optionalEngineeringField<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, z.literal(""), z.null()]).optional();
}

export const projectEngineeringContextUpsertSchema = z.object({
  repositoryUrl: optionalEngineeringField(engineeringRepositoryUrlSchema),
  defaultBranch: optionalEngineeringField(engineeringBranchSchema),
  worktreePath: optionalEngineeringField(engineeringWorktreeSchema),
  installCommand: optionalEngineeringField(engineeringSingleLineSchema("Install command", 1000)),
  testCommand: optionalEngineeringField(engineeringSingleLineSchema("Test command", 1000)),
  buildCommand: optionalEngineeringField(engineeringSingleLineSchema("Build command", 1000)),
  autoFixPolicy: projectAutoFixPolicySchema.default("SUGGEST_ONLY"),
  reviewerPolicy: projectReviewerPolicySchema.default("NONE"),
  requesterNotificationPolicy: projectRequesterNotificationPolicySchema.default("EXPLICIT_ONLY"),
  notes: optionalEngineeringField(engineeringNotesSchema),
}).strict();

export type ProjectAutoFixPolicy = z.infer<typeof projectAutoFixPolicySchema>;
export type ProjectReviewerPolicy = z.infer<typeof projectReviewerPolicySchema>;
export type ProjectRequesterNotificationPolicy = z.infer<typeof projectRequesterNotificationPolicySchema>;

export type ProjectEngineeringContext = {
  repositoryUrl: string | null;
  defaultBranch: string | null;
  worktreePath: string | null;
  installCommand: string | null;
  testCommand: string | null;
  buildCommand: string | null;
  autoFixPolicy: ProjectAutoFixPolicy;
  reviewerPolicy: ProjectReviewerPolicy;
  requesterNotificationPolicy: ProjectRequesterNotificationPolicy;
  notes: string | null;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
};

export type ProjectEngineeringContextResponse = {
  project: {
    id: string;
    key: string;
    name: string;
  };
  engineeringContext: ProjectEngineeringContext;
};

export const savedIssueViewFiltersSchema = z.object({
  query: z.string().trim().max(255).optional(),
  projectKey: projectKeySchema.optional(),
  releaseId: entityIdSchema.optional(),
  appEnvironment: z.string().trim().min(1).max(64).optional(),
  appVersion: z.string().trim().min(1).max(128).optional(),
  buildNumber: z.string().trim().min(1).max(128).optional(),
  releaseChannel: z.string().trim().min(1).max(64).optional(),
  status: feedbackStatusSchema.optional(),
  severity: severitySchema.optional(),
  issueType: issueTypeSchema.optional(),
  ownerId: entityIdSchema.optional(),
  requesterIdentity: z.enum(["identified", "anonymous"]).optional(),
  accountId: z.string().trim().min(1).max(120).optional(),
  accountName: z.string().trim().min(1).max(160).optional(),
  planName: z.string().trim().min(1).max(80).optional(),
  planTier: z.string().trim().min(1).max(80).optional(),
  customerSegment: z.string().trim().min(1).max(80).optional(),
  customerCohort: z.string().trim().min(1).max(80).optional(),
  trackedEventName: z.string().trim().min(1).max(120).optional(),
  attention: z.enum(["waiting_on_customer", "weak_evidence", "high_impact_repeats", "stale", "stuck_lifecycle"]).optional(),
  releaseRegression: z.boolean().optional(),
  labels: z.array(labelSchema).optional(),
  fromDate: dateOnlySchema.optional(),
  toDate: dateOnlySchema.optional(),
  sortBy: z.enum(["reported", "severity"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
}).strict();

export const savedIssueViewCreateSchema = z.object({
  organizationId: z.string().trim().min(1),
  name: z.string().trim().min(2).max(80),
  filters: savedIssueViewFiltersSchema,
});

export type SavedIssueViewFilters = z.infer<typeof savedIssueViewFiltersSchema>;

export type SavedIssueViewSummary = {
  id: string;
  organizationId: string;
  name: string;
  filters: SavedIssueViewFilters;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type SavedIssueViewsResponse = {
  views: SavedIssueViewSummary[];
};

export type AnalyticsSummary = {
  byProject: Array<{
    projectId: string;
    projectKey: string;
    projectName: string;
    count: number;
    latestReportAt: string | Date | null;
  }>;
  projectSeverity: Array<{
    projectId: string;
    projectKey: string;
    projectName: string;
    total: number;
    counts: {
      low: number;
      medium: number;
      high: number;
      critical: number;
    };
  }>;
  openClosed: Array<{
    label: string;
    open: number;
    closed: number;
  }>;
  bySeverity: Array<{
    severity: string;
    count: number;
  }>;
  byStatus: Array<{
    status: string;
    count: number;
  }>;
  topScreens: Array<{
    url: string;
    count: number;
  }>;
  capacityLockImpact: {
    lockedIssueCount: number;
    openLockedIssueCount: number;
    highRiskLockedIssueCount: number;
    byProject: Array<{
      projectId: string;
      projectKey: string;
      projectName: string;
      count: number;
      openCount: number;
      highRiskCount: number;
    }>;
  };
  topDuplicateGroups: Array<{
    id: string;
    ticketNumber: number;
    title: string;
    status: string;
    severity: string;
    duplicateCount: number;
    reportCount: number;
    openCount: number;
    highRiskCount: number;
  }>;
  surveyImpact: {
    total: number;
    scoredCount: number;
    averageScore: number | null;
    byType: Array<{
      type: FeedbackSurveyResponse["type"];
      label: string;
      count: number;
      scoredCount: number;
      averageScore: number | null;
      openCount: number;
      highRiskCount: number;
    }>;
  };
  eventTrailImpact: {
    topTrackedEvents: Array<{
      eventName: string;
      label: string;
      count: number;
      occurrenceCount: number;
      openCount: number;
      highRiskCount: number;
    }>;
    topFrictionFlows: Array<{
      fromEventName: string;
      toEventName: string;
      label: string;
      count: number;
      occurrenceCount: number;
      openCount: number;
      highRiskCount: number;
    }>;
  };
  contextImpact: {
    topAccounts: Array<{
      id: string | null;
      name: string | null;
      label: string;
      count: number;
      openCount: number;
      highRiskCount: number;
    }>;
    topPlans: Array<{
      name: string | null;
      tier: string | null;
      label: string;
      count: number;
      openCount: number;
      highRiskCount: number;
    }>;
    topCustomerSegments: Array<{
      segment: string;
      label: string;
      count: number;
      openCount: number;
      highRiskCount: number;
    }>;
    topCustomerCohorts: Array<{
      cohort: string;
      label: string;
      count: number;
      openCount: number;
      highRiskCount: number;
    }>;
    topProductAreas: Array<{
      area: string;
      label: string;
      count: number;
      openCount: number;
      highRiskCount: number;
    }>;
    topFunnelSteps: Array<{
      step: string;
      label: string;
      count: number;
      openCount: number;
      highRiskCount: number;
    }>;
    topFeatureFlags: Array<{
      flag: string;
      value: string;
      label: string;
      count: number;
      openCount: number;
      highRiskCount: number;
    }>;
    topExperiments: Array<{
      experiment: string;
      variant: string;
      label: string;
      count: number;
      openCount: number;
      highRiskCount: number;
    }>;
  };
};

export type InternalDigestTicket = {
  id: string;
  ticketNumber: number;
  title: string;
  status: string;
  severity: string;
  issueType: string;
  projectKey: string;
  projectName: string;
  currentUrl: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type HomeAttentionSignalId =
  | "waiting_on_customer"
  | "weak_evidence"
  | "high_impact_repeats"
  | "stale"
  | "stuck_lifecycle";

export type HomePriorityTicket = InternalDigestTicket & {
  reasons: Array<HomeAttentionSignalId | "critical">;
  evidenceScore: number;
  reportCount: number;
};

export type InternalDigest = {
  period: {
    label: string;
    days: number;
    from: string | Date;
    to: string | Date;
  };
  totals: {
    openBugs: number;
    staleTickets: number;
    fixedInPeriod: number;
    waitingOnCustomer: number;
    highImpactRepeats: number;
    weakEvidence: number;
    stuckLifecycle: number;
  };
  topOpenBugs: InternalDigestTicket[];
  staleTickets: InternalDigestTicket[];
  fixedInPeriod: InternalDigestTicket[];
  waitingOnCustomer: InternalDigestTicket[];
  highImpactRepeats: Array<InternalDigestTicket & {
    duplicateCount: number;
    reportCount: number;
  }>;
  weakEvidence: Array<InternalDigestTicket & {
    evidenceScore: number;
    missingEvidence: string[];
  }>;
  stuckLifecycle: Array<InternalDigestTicket & {
    lifecycleState: FeedbackEngineeringLifecycle["verificationState"];
    stuckReason: string;
  }>;
  home: {
    metrics: {
      allTimeReports: number;
      untriaged: number;
      critical: number;
      inProgress: number;
      fixedInPeriod: number;
    };
    priorityTotal: number;
    priorityQueue: HomePriorityTicket[];
    trend: Array<{
      label: string;
      received: number;
      resolved: number;
    }>;
    openByProject: Array<{
      projectId: string;
      projectKey: string;
      projectName: string;
      count: number;
    }>;
    signals: Array<{
      id: HomeAttentionSignalId;
      label: string;
      count: number;
      href: string;
    }>;
  };
};

export type ReleaseSummary = {
  id: string;
  projectKey: string;
  projectName: string;
  appName: string;
  appEnvironment: string;
  appVersion: string;
  buildNumber?: string | null;
  releaseChannel?: string | null;
  issueCount: number;
  openIssueCount: number;
  fixedIssueCount: number;
  highRiskIssueCount: number;
  regressionIssueCount: number;
  healthStatus: "quiet" | "stable" | "monitor" | "attention";
  firstSeenAt?: string | Date | null;
  lastSeenAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type ReleaseListResponse = {
  releases: ReleaseSummary[];
};

export type ProductIntegrationKind = "provider" | "mcp" | "webhook" | "alert";

export type ProductIntegrationScopeSource = "explicit" | "organization" | "available";

export type ProductIntegrationHealth = "healthy" | "degraded" | "failed" | "unknown";

export type ProductIntegrationCapabilities = {
  canAttach: boolean;
  canDetach: boolean;
  canConfigureMapping: boolean;
  canTest: boolean;
  scopeChangeRoute: string | null;
};

export type ProductIntegrationApplication = {
  connectionId: string;
  kind: ProductIntegrationKind;
  provider: string;
  name: string;
  scopeSource: ProductIntegrationScopeSource;
  productKey: string;
  health: ProductIntegrationHealth;
  attentionReasons: string[];
  lastSuccessAt: string | Date | null;
  mappingSummary: string | null;
  owner: string;
  canConfigureProduct: boolean;
  canManageConnection: boolean;
  capabilities: ProductIntegrationCapabilities;
};

export type ProductIntegrationsSummaryResponse = {
  product: {
    id: string;
    key: string;
    name: string;
    organizationId: string;
  };
  canManageConnections: boolean;
  applications: ProductIntegrationApplication[];
  attention: ProductIntegrationApplication[];
  attentionTotal: number;
  available: ProductIntegrationApplication[];
  pagination: {
    page: number;
    pageSize: number;
    pageCount: number;
    total: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
  availablePagination: {
    page: number;
    pageSize: number;
    pageCount: number;
    total: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
};
