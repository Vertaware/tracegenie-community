import type { EmailSettingsInput,EmailSettingsView } from "@tracegenie/shared";
import type {
AdminSession,
AnalyticsSummary,
FeedbackActivityResponse,
FeedbackConversationResponse,
FeedbackAiCodingTaskResponse,
FeedbackDetailResponse,
FeedbackListResponse,
ProjectAutoFixPolicy,
ProjectEngineeringContextResponse,
ProjectRequesterNotificationPolicy,
ProjectReviewerPolicy,
ProjectInstallDiagnosticsResponse,
ProjectInstallTestReportResponse,
ProjectSettingsDestination,
ProjectSummary,
SavedIssueViewFilters,
SavedIssueViewSummary,
SavedIssueViewsResponse,
SurveyCampaignInput,
} from "@tracegenie/shared";

import { getApiBaseUrl } from "./env";

const API_BASE_URL = getApiBaseUrl();
let activeOrganizationId: string | null = null;

export type AccessCapabilities = {
  canManageProject: boolean;
  canWriteProject: boolean;
  canTriageProject: boolean;
  canViewProject: boolean;
  canManageOrganization: boolean;
  canManageTeam: boolean;
  canInviteMembers: boolean;
  canManageOwners: boolean;
  canManagePlatform: boolean;
};

export type SurveyCampaignSummary = SurveyCampaignInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  responseCount: number;
};

export type SurveyCampaignResults = {
  campaign: SurveyCampaignInput & { id: string; createdAt: string; updatedAt: string };
  result: {
    responseCount: number;
    averageScore: number | null;
    scoreDistribution: Record<string, number>;
    optionDistribution: Record<string, number>;
    textCount: number;
    consentCount: number;
    missingContextCount: number;
    retentionDays: number;
    latestResponses: Array<{
      id: string;
      response: { score?: number; option?: string; answer?: string };
      provenance: { source: "host" | "missing"; missing: string[] };
      consented: boolean;
      expiresAt: string;
      createdAt: string;
    }>;
  };
};

export type AdminUserSummary = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "TRIAGER";
  platformRole: "USER" | "GLOBAL_ADMIN";
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  organizationRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  organizationMembershipStatus: "ACTIVE" | "DISABLED" | null;
  orgMemberships: Array<{
    organizationId: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    status: "ACTIVE" | "DISABLED";
  }>;
  projectMemberships: Array<{
    project: { id: string; key: string; name: string };
    role: "PROJECT_ADMIN" | "TRIAGER" | "VIEWER";
    status: "ACTIVE" | "DISABLED";
    capabilities: Pick<AccessCapabilities, "canManageProject" | "canWriteProject" | "canTriageProject" | "canViewProject">;
  }>;
  effectiveAccess: {
    scope: "NONE" | "PLATFORM" | "MULTI_ORGANIZATION" | "ALL_PROJECTS" | "SELECTED_PROJECTS" | "NO_PROJECTS";
    allProjects: boolean;
    assignedProjectCount: number;
    capabilities: AccessCapabilities;
  };
};

export type AdminUsersResponse = {
  data: AdminUserSummary[];
  actor: {
    id: string;
    platformRole: "USER" | "GLOBAL_ADMIN";
    isGlobalAdmin: boolean;
    organizationId: string | null;
    organizationRole: "OWNER" | "ADMIN" | "MEMBER" | null;
    organizationMembershipStatus: "ACTIVE" | "DISABLED" | null;
    capabilities: AccessCapabilities;
  };
};

export type SelfProfileResponse = {
  data: AdminUserSummary;
};

export type PlatformLedgerQuery = {
  query?: string;
  status?: "ALL" | "ACTIVE" | "READ_ONLY" | "SUSPENDED";
  attention?: "all" | "exceptions" | "locked" | "access" | "billing";
  page?: number;
  pageSize?: number;
};

export type PlatformLedgerResponse = {
  organizations: any[];
  pagination: {
    page: number;
    pageSize: number;
    pageCount: number;
    total: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
  summary: {
    organizations: number;
    activeOrganizations: number;
    exceptionOrganizations: number;
    totalProjects: number;
    totalIssues: number;
    totalLockedIssues: number;
  };
  filters: Required<Pick<PlatformLedgerQuery, "query" | "status" | "attention">>;
};

export type PlatformActivityAction = "all" | "access" | "billing" | "data" | "integrations" | "operations" | "products" | "security";
export type PlatformActivityResult = "all" | "completed" | "denied" | "failed";
export type PlatformActivityQuery = {
  actor?: string;
  action?: PlatformActivityAction;
  tenant?: string;
  result?: PlatformActivityResult;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};
export type PlatformActivityEvent = {
  id: string;
  eventType: string;
  summary: string;
  category: Exclude<PlatformActivityAction, "all">;
  result: Exclude<PlatformActivityResult, "all">;
  reason: string | null;
  organization: { id: string; name: string; slug: string } | null;
  product: { key: string; name: string } | null;
  actor: { id: string; email: string; name: string } | null;
  source: string | null;
  ipAddress: string | null;
  createdAt: string;
  before: unknown;
  after: unknown;
};
export type PlatformActivityResponse = {
  events: PlatformActivityEvent[];
  pagination: PlatformLedgerResponse["pagination"];
  filters: Required<Pick<PlatformActivityQuery, "actor" | "action" | "tenant" | "result" | "from" | "to">>;
};

export type InviteTrustContext = {
  organization: { name: string; displayName: string };
  inviter: { displayName: string };
  organizationRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  products: Array<{
    name: string;
    productRole: "PROJECT_ADMIN" | "TRIAGER" | "VIEWER";
  }>;
  effectiveAccess: {
    productScope: "ALL" | "SCOPED" | "NONE";
    summary: string;
  };
  status: "PENDING";
  expiresAt: string;
};

export type IntegrationClientSummary = {
  id: string;
  name: string;
  description?: string | null;
  organizationId: string;
  owner?: Pick<AdminUserSummary, "id" | "name" | "email"> | null;
  allowedActions: string[];
  isActive: boolean;
  rotatedAt?: string | Date | null;
  lastUsedAt?: string | Date | null;
  createdAt: string | Date;
  revokedAt?: string | Date | null;
  rotation: {
    windowDays: number;
    ageDays: number;
    dueAt: string | Date;
    isDue: boolean;
  };
  projects: Array<{
    id: string;
    key: string;
    name: string;
  }>;
  observability: {
    successfulWriteCount: number;
    deniedCount: number;
    staleWriteCount: number;
    latestDeniedAt?: string | Date | null;
    latestStaleWriteAt?: string | Date | null;
    capacityLockedCount: number;
    latestCapacityLockedAt?: string | Date | null;
    externalIssueFailureCount: number;
    latestExternalIssueFailureAt?: string | Date | null;
    mcpSuccessRate: number | null;
    averageLatencyMs: number | null;
    latestAuditAt?: string | Date | null;
    sensitiveReadCount: number;
    rawEvidenceReadCount: number;
    attachmentReadCount: number;
    latestSensitiveReadAt?: string | Date | null;
    mcpStatusWriteTicketCount: number;
    humanStatusOverrideTicketCount: number;
    humanStatusOverrideRate: number | null;
    requesterNotificationAttemptCount: number;
    requesterNotificationSentCount: number;
    requesterNotificationFailedCount: number;
    requesterNotificationSkippedCount: number;
    requesterNotificationSuccessRate: number | null;
  };
};

type WebhookDeliverySummary = {
  id: string;
  eventId: string;
  eventType: string;
  status: string;
  httpStatus?: number | null;
  errorMessage?: string | null;
  attemptCount: number;
  nextAttemptAt?: string | Date | null;
  sentAt?: string | Date | null;
  createdAt: string | Date;
};

export type WebhookEndpointSummary = {
  id: string;
  organizationId: string;
  owner?: Pick<AdminUserSummary, "id" | "name" | "email"> | null;
  name: string;
  url: string;
  eventTypes: string[];
  projectKeys: string[];
  severityFilters: string[];
  issueTypeFilters: string[];
  deliveryFormat: string;
  slackTarget?: {
    workspaceName?: string | null;
    channelName?: string | null;
  } | null;
  isActive: boolean;
  signingSecretRotatedAt: string | Date;
  lastDeliveredAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  revokedAt?: string | Date | null;
  revocationReason?: "manual" | "policy_retry_exhausted" | null;
  rotation: {
    windowDays: number;
    ageDays: number;
    dueAt: string | Date;
    isDue: boolean;
  };
  recentDeliveries: WebhookDeliverySummary[];
  deliveryStats?: {
    windowDays: number;
    total: number;
    pending: number;
    sent: number;
    failed: number;
    skipped: number;
    retryable: number;
    exhausted: number;
    latestFailedAt?: string | Date | null;
    latestRetryableAt?: string | Date | null;
    successRate: number | null;
    averageDeliveryMs: number | null;
  };
};

export type AlertRuleType =
  | "critical_report"
  | "report_spike"
  | "release_regression"
  | "high_value_account"
  | "requester_update_due"
  | "quota_threshold";

export type AlertRuleInput = {
  organizationId: string;
  projectId?: string | null;
  webhookEndpointId: string;
  name: string;
  type: Uppercase<AlertRuleType>;
  threshold: number;
  windowMinutes: number;
  cooldownMinutes: number;
};

export type AlertRuleSummary = {
  id: string;
  organizationId: string;
  name: string;
  type: AlertRuleType;
  threshold: number;
  windowMinutes: number;
  cooldownMinutes: number;
  isEnabled: boolean;
  mutedAt?: string | Date | null;
  mutedReason?: string | null;
  lastMatchedAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  consequence: string;
  evaluationMode: "event_driven";
  project?: { id: string; key: string; name: string } | null;
  target: {
    id: string;
    name: string;
    channel: "slack" | "webhook";
    isActive: boolean;
    slackTarget?: { workspaceName?: string | null; channelName?: string | null } | null;
  };
  activities: Array<{
    id: string;
    type: string;
    summary: string;
    details?: unknown;
    actor?: { id: string; name: string } | null;
    createdAt: string | Date;
    delivery?: {
      id: string;
      status: string;
      httpStatus?: number | null;
      attemptCount: number;
      nextAttemptAt?: string | Date | null;
      sentAt?: string | Date | null;
      failedAt?: string | Date | null;
      createdAt: string | Date;
      failureSummary?: string | null;
      canRetry: boolean;
    } | null;
  }>;
};

export type ProviderConnectionSummary = {
  id: string;
  organizationId: string;
  owner?: Pick<AdminUserSummary, "id" | "name" | "email"> | null;
  provider: string;
  name: string;
  accountLabel?: string | null;
  providerConfig?: Record<string, unknown> | null;
  hasAuthorization: boolean;
  isActive: boolean;
  revokedAt?: string | Date | null;
  lastUsedAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  testHealth: {
    totalCount: number;
    latestStatus?: "sent" | "healthy" | "failed" | null;
    latestErrorCode?: string | null;
    latestHttpStatus?: number | null;
    latestTestedAt?: string | Date | null;
  };
  project?: {
    id: string;
    key: string;
    name: string;
  } | null;
};

export type ProviderImportTicketInput = {
  projectKey: string;
  provider: "sentry" | "posthog";
  label: string;
  url: string;
  externalId?: string;
  status?: "open" | "triaged" | "in_progress" | "fixed" | "closed";
  observedAt?: string;
  title: string;
  description: string;
  issueType: "bug" | "feature_request" | "improvement" | "question" | "other";
  severity: "low" | "medium" | "high" | "critical";
  stepsToReproduce?: string;
  expectedResult?: string;
  actualResult?: string;
  labels: string[];
  route: { url: string };
  release: { appName: string; appEnvironment: string; appVersion: string };
  browser: { userAgent: string; viewportWidth: number; viewportHeight: number };
  clientTimestamp: string;
  attachmentTokens: string[];
  idempotencyKey: string;
};

export type ProviderImportPreview = {
  summary: {
    provider: "sentry" | "posthog";
    providerLabel: string;
    projectKey: string;
    title: string;
    mappedStatus: string;
    issueType: string;
    severity: string;
    externalReference: { label: string; url: string; externalId?: string | null };
  };
  duplicateCandidates: Array<{
    feedbackId: string;
    ticketNumber: number;
    title: string;
    status: string;
    score: number;
    match: "external_reference" | "fingerprint" | "similarity";
    expectedUpdatedAt: string;
  }>;
  idempotentReplay: boolean;
  requiresDuplicateResolution: boolean;
  previewFingerprint: string;
  connection: {
    id: string;
    name: string;
    projectKeys: string[];
    isActive: boolean;
    lastUsedAt?: string | Date | null;
  };
};

type RequestOptions = {
  method?: string;
  body?: BodyInit | Record<string, unknown>;
  headers?: HeadersInit;
  signal?: AbortSignal;
  notifyOnUnauthorized?: boolean;
};

type ProjectEngineeringContextInput = {
  repositoryUrl?: string | null;
  defaultBranch?: string | null;
  worktreePath?: string | null;
  installCommand?: string | null;
  testCommand?: string | null;
  buildCommand?: string | null;
  autoFixPolicy: ProjectAutoFixPolicy;
  reviewerPolicy: ProjectReviewerPolicy;
  requesterNotificationPolicy: ProjectRequesterNotificationPolicy;
  notes?: string | null;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const ADMIN_SESSION_EXPIRED_EVENT = "tracegenie:admin-session-expired";
let adminSessionGeneration = 0;

function notifyAdminSessionExpired(status: number, options: RequestOptions, requestGeneration: number) {
  if (
    status === 401
    && options.notifyOnUnauthorized !== false
    && requestGeneration === adminSessionGeneration
    && typeof window !== "undefined"
  ) {
    adminSessionGeneration += 1;
    window.dispatchEvent(new Event(ADMIN_SESSION_EXPIRED_EVENT));
  }
}

/** Session auth rides on the http-only cookie; no bearer tokens client-side. */
async function request<T>(path: string, options: RequestOptions = {}) {
  const requestGeneration = adminSessionGeneration;
  const headers = new Headers(options.headers);

  let body = options.body as BodyInit | undefined;
  if (options.body && !(options.body instanceof FormData) && !(options.body instanceof URLSearchParams) && typeof options.body !== "string") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    body,
    headers,
    credentials: "include",
    signal: options.signal,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    notifyAdminSessionExpired(response.status, options, requestGeneration);
    throw new ApiError(
      response.status,
      payload?.error?.message ?? "Request failed.",
      payload?.error?.code,
      payload?.error?.details,
    );
  }

  return payload as T;
}

function withActiveOrganization(
  search?: URLSearchParams,
  organizationId: string | null = activeOrganizationId,
) {
  const scopedSearch = new URLSearchParams(search);
  if (organizationId && !scopedSearch.has("organizationId")) {
    scopedSearch.set("organizationId", organizationId);
  }
  const query = scopedSearch.toString();
  return query ? `?${query}` : "";
}

export const api = {
  getEmailSettings() {
    return request<{ settings: EmailSettingsView }>("/api/admin/settings/email");
  },
  saveEmailSettings(body: EmailSettingsInput) {
    return request<{ settings: EmailSettingsView }>("/api/admin/settings/email", { method: "PUT", body });
  },
  testEmailSettings(revision: string | null) {
    return request<{ sent: true; recipient: string; settings: EmailSettingsView }>("/api/admin/settings/email/test", { method: "POST", body: { revision } });
  },
  resetEmailSettings(revision: string) {
    return request<{ settings: EmailSettingsView }>("/api/admin/settings/email", { method: "DELETE", body: { revision } });
  },
  markAdminSessionAuthenticated() {
    adminSessionGeneration += 1;
  },
  invalidateAdminSession() {
    adminSessionGeneration += 1;
  },
  setActiveOrganizationId(organizationId: string | null) {
    activeOrganizationId = organizationId;
  },
  
  login(email: string, password: string, signal?: AbortSignal) {
    return request<AdminSession>("/api/auth/login", {
      method: "POST",
      body: { email, password },
      signal,
      notifyOnUnauthorized: false,
    });
  },
  requestPasswordReset(email: string) {
    return request<{ ok: boolean }>("/api/auth/password-reset/request", {
      method: "POST",
      body: { email },
      notifyOnUnauthorized: false,
    });
  },
  confirmPasswordReset(token: string, password: string) {
    return request<AdminSession>("/api/auth/password-reset/confirm", {
      method: "POST",
      body: { token, password },
      notifyOnUnauthorized: false,
    });
  },
  getMe() {
    return request<{ user: AdminSession["user"] }>("/api/auth/me", { notifyOnUnauthorized: false });
  },
  logout() {
    return request<void>("/api/auth/logout", {
      method: "POST",
      notifyOnUnauthorized: false,
    });
  },
  getFeedbackList(search: URLSearchParams) {
    return request<FeedbackListResponse>(`/api/admin/feedback${withActiveOrganization(search)}`);
  },
  
  
  
  
  
  
  
  getSavedIssueViews(organizationId: string) {
    return request<SavedIssueViewsResponse>(`/api/admin/feedback/saved-views?organizationId=${encodeURIComponent(organizationId)}`);
  },
  createSavedIssueView(body: { organizationId: string; name: string; filters: SavedIssueViewFilters }) {
    return request<{ view: SavedIssueViewSummary }>("/api/admin/feedback/saved-views", {
      method: "POST",
      body,
    });
  },
  deleteSavedIssueView(viewId: string) {
    return request<{ ok: true }>(`/api/admin/feedback/saved-views/${encodeURIComponent(viewId)}`, {
      method: "DELETE",
    });
  },
  getFeedbackDetail(feedbackId: string) {
    return request<FeedbackDetailResponse>(`/api/admin/feedback/${feedbackId}`);
  },
  getFeedbackActivity(feedbackId: string, page = 1, signal?: AbortSignal) {
    const search = new URLSearchParams({ page: String(page), pageSize: "30" });
    return request<FeedbackActivityResponse>(
      `/api/admin/feedback/${encodeURIComponent(feedbackId)}/activity${withActiveOrganization(search)}`,
      { signal },
    );
  },
  getFeedbackConversation(feedbackId: string, cursor: string | null = null, signal?: AbortSignal) {
    const search = new URLSearchParams({ pageSize: "20" });
    if (cursor) search.set("cursor", cursor);
    return request<FeedbackConversationResponse>(
      `/api/admin/feedback/${encodeURIComponent(feedbackId)}/conversation${withActiveOrganization(search)}`,
      { signal },
    );
  },
  createAiCodingTask(feedbackId: string) {
    return request<FeedbackAiCodingTaskResponse>(`/api/admin/feedback/${feedbackId}/ai-coding-task`);
  },
  updateFeedback(feedbackId: string, body: Record<string, unknown>) {
    return request<FeedbackDetailResponse>(`/api/admin/feedback/${feedbackId}`, {
      method: "PATCH",
      body,
    });
  },
  overrideFeedbackEvidenceGate(feedbackId: string, body: { reason: string; expectedUpdatedAt: string }) {
    return request<FeedbackDetailResponse>(`/api/admin/feedback/${feedbackId}/evidence-gate/override`, {
      method: "POST",
      body,
    });
  },
  
  bulkUpdateFeedback(body: {
    items: Array<{
      feedbackId: string;
      expectedUpdatedAt: string;
      mutation: { status: string; statusNote: { body: string; visibility: "internal"; clientRequestId: string } } | { ownerId: string | null } | { labels: string[] };
    }>;
  }) {
    return request<{
      succeeded: Array<{
        feedbackId: string;
        updatedAt: string;
        before: { status: string; ownerId: string | null; labels: string[] };
      }>;
      failed: Array<{ feedbackId: string; code: string; message: string }>;
    }>("/api/admin/feedback/bulk", {
      method: "PATCH",
      body,
    });
  },
  addComment(feedbackId: string, body: {
    body: string;
    visibility: "internal" | "public";
    notifyRequester?: boolean;
    publicSummary?: string | null;
    deliveryTarget?: "requester_and_subscribers";
    clientRequestId?: string;
  }) {
    return request<{ comment: unknown }>(`/api/admin/feedback/${feedbackId}/comments`, {
      method: "POST",
      body,
    });
  },
  replayNotification(notificationId: string) {
    return request<{ notification: { id: string; status: string } }>(`/api/admin/feedback/notifications/${encodeURIComponent(notificationId)}/replay`, {
      method: "POST",
    });
  },
  addFeedbackSubscriber(feedbackId: string, body: Record<string, unknown>) {
    return request<FeedbackDetailResponse>(`/api/admin/feedback/${feedbackId}/subscribers`, {
      method: "POST",
      body,
    });
  },
  updateFeedbackSubscriber(feedbackId: string, subscriberId: string, body: Record<string, unknown>) {
    return request<FeedbackDetailResponse>(`/api/admin/feedback/${feedbackId}/subscribers/${subscriberId}`, {
      method: "PATCH",
      body,
    });
  },
  removeFeedbackSubscriber(feedbackId: string, subscriberId: string) {
    return request<FeedbackDetailResponse>(`/api/admin/feedback/${feedbackId}/subscribers/${subscriberId}`, {
      method: "DELETE",
    });
  },
  getAnalytics(days?: number, organizationId: string | null = activeOrganizationId) {
    const search = new URLSearchParams();
    if (days) {
      search.set("days", String(days));
    }
    return request<AnalyticsSummary>(`/api/admin/analytics/summary${withActiveOrganization(search, organizationId)}`);
  },
  
  
  
  
  getProjects(organizationId: string | null = activeOrganizationId) {
    return request<{ projects: ProjectSummary[] }>(`/api/projects/admin${withActiveOrganization(undefined, organizationId)}`);
  },
  
  
  
  
  updateProject(projectKey: string, body: Record<string, unknown>) {
    return request<{ project: ProjectSummary }>(`/api/projects/admin/${projectKey}`, {
      method: "PUT",
      body: activeOrganizationId && !body.organizationId ? { ...body, organizationId: activeOrganizationId } : body,
    });
  },
  patchProjectSettings(
    projectKey: string,
    destination: ProjectSettingsDestination,
    body: Record<string, unknown>,
    organizationId: string | null = activeOrganizationId,
  ) {
    return request<{ project: ProjectSummary }>(
      `/api/projects/admin/${encodeURIComponent(projectKey)}/settings/${destination}${withActiveOrganization(undefined, organizationId)}`,
      { method: "PATCH", body },
    );
  },
  deleteProject(projectKey: string, organizationId: string | null = activeOrganizationId) {
    return request<{ deleted: { key: string; name: string } }>(
      `/api/projects/admin/${encodeURIComponent(projectKey)}${withActiveOrganization(undefined, organizationId)}`,
      {
        method: "DELETE",
        body: { confirmProjectKey: projectKey },
      },
    );
  },
  getProjectInstallDiagnostics(projectKey: string, origin?: string | null, organizationId: string | null = activeOrganizationId) {
    const params = new URLSearchParams();
    if (origin?.trim()) params.set("origin", origin.trim());
    const search = withActiveOrganization(params, organizationId);
    return request<ProjectInstallDiagnosticsResponse>(`/api/projects/admin/${encodeURIComponent(projectKey)}/install-diagnostics${search}`);
  },
  submitProjectInstallTestReport(projectKey: string, origin: string, organizationId: string | null = activeOrganizationId) {
    return request<ProjectInstallTestReportResponse>(`/api/projects/admin/${encodeURIComponent(projectKey)}/install-test-report${withActiveOrganization(undefined, organizationId)}`, {
      method: "POST",
      body: { origin },
    });
  },
  
  getProjectEngineeringContext(projectKey: string, organizationId: string | null = activeOrganizationId) {
    return request<ProjectEngineeringContextResponse>(`/api/projects/admin/${encodeURIComponent(projectKey)}/engineering-context${withActiveOrganization(undefined, organizationId)}`);
  },
  
  
  
  
  updateProjectEngineeringContext(
    projectKey: string,
    body: ProjectEngineeringContextInput,
    organizationId: string | null = activeOrganizationId,
  ) {
    return request<ProjectEngineeringContextResponse>(`/api/projects/admin/${encodeURIComponent(projectKey)}/engineering-context${withActiveOrganization(undefined, organizationId)}`, {
      method: "PUT",
      body,
    });
  },
  rotateProjectWidgetSecret(projectKey: string) {
    return request<{ project: Pick<ProjectSummary, "key" | "name" | "widgetSecretRotatedAt">; widgetClientSecret: string }>(
      `/api/projects/admin/${projectKey}/widget-secret/rotate`,
      {
        method: "POST",
      },
    );
  },
  getUsers(organizationId: string | null = activeOrganizationId) {
    const search = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
    return request<AdminUsersResponse>(`/api/admin/users${search}`);
  },
  getSelfProfile(organizationId: string | null = activeOrganizationId) {
    const search = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
    return request<SelfProfileResponse>(`/api/admin/users/me${search}`);
  },
  updateSelfProfile(body: { organizationId?: string; name?: string; password?: string }) {
    return request<{ data: Pick<AdminUserSummary, "id" | "email" | "name" | "isActive"> }>(
      "/api/admin/users/me",
      {
        method: "PATCH",
        body: activeOrganizationId && !body.organizationId ? { ...body, organizationId: activeOrganizationId } : body,
      },
    );
  },
  
  updateUser(id: string, body: Record<string, unknown>) {
    return request<{ data: any }>(`/api/admin/users/${id}`, {
      method: "PATCH",
      body: activeOrganizationId && !body.organizationId ? { ...body, organizationId: activeOrganizationId } : body,
    });
  },
  getOrganizations() {
    return request<{ organizations: any[] }>("/api/orgs");
  },
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  createInvite(organizationId: string, body: Record<string, unknown>) {
    return request<{ invite: any }>(`/api/orgs/${organizationId}/invites`, {
      method: "POST",
      body,
    });
  },
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  acceptInvite(body: { token: string; name: string; password: string }) {
    return request<AdminSession>("/api/orgs/invites/accept", {
      method: "POST",
      body,
      notifyOnUnauthorized: false,
    });
  },
  getInviteContext(token: string) {
    return request<{ context: InviteTrustContext }>("/api/orgs/invites/context", {
      method: "POST",
      body: { token },
      notifyOnUnauthorized: false,
    });
  },
  
  
  
  
  
  
  
  
  getReporterBridge(bridgeToken: string, signal?: AbortSignal) {
    return request<{ bridge: { ticketNumber: number; organizationName: string; projectName: string } }>(
      "/api/reporter/bridge/resolve",
      { method: "POST", body: { bridgeToken }, notifyOnUnauthorized: false, signal },
    );
  },
  requestReporterOtp(email: string, bridgeToken?: string) {
    return request<{ ok: true }>("/api/reporter/otp/request", {
      method: "POST",
      body: { email, bridgeToken },
      notifyOnUnauthorized: false,
    });
  },
  verifyReporterOtp(email: string, code: string, scope?: { organizationId?: string; projectId?: string; scopeToken?: string; bridgeToken?: string }) {
    return request<{ token: string }>("/api/reporter/otp/verify", {
      method: "POST",
      body: { email, code: scope?.scopeToken ? undefined : code, ...scope },
      notifyOnUnauthorized: false,
    });
  },
  getReporterTickets(token: string, page = 1, pageSize = 20) {
    return request<{
      tickets: any[];
      pagination: { page: number; pageSize: number; pageCount: number; total: number; hasNextPage: boolean };
    }>(`/api/reporter/tickets?page=${page}&pageSize=${pageSize}`, {
      headers: { Authorization: `Bearer ${token}` },
      notifyOnUnauthorized: false,
    });
  },
  getReporterTicket(token: string, feedbackId: string) {
    return request<{ ticket: any }>(`/api/reporter/tickets/${encodeURIComponent(feedbackId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      notifyOnUnauthorized: false,
    });
  },
  
  
  
  
  
  markReporterStillHappening(token: string, feedbackId: string, body: string | undefined, clientRequestId: string) {
    return request<{ ticket: any }>(`/api/reporter/tickets/${feedbackId}/still-happening`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: { body, clientRequestId },
      notifyOnUnauthorized: false,
    });
  },
  confirmReporterFixed(token: string, feedbackId: string, body: string | undefined, clientRequestId: string) {
    return request<{ ticket: any }>(`/api/reporter/tickets/${feedbackId}/confirm-fixed`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: { body, clientRequestId },
      notifyOnUnauthorized: false,
    });
  },
};
