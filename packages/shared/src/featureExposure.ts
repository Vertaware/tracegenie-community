export const FEATURE_EXPOSURE_CLASSES = [
  "CORE_REPAIR",
  "KEEP_POLISH",
  "QUARANTINE",
  "KILL_SWITCHED",
] as const;

export const FEATURE_EXPOSURE_EVENT_TYPES = [
  "feature.hidden_route_requested",
  "feature.hidden_surface_observed",
  "feature.kill_switch_rejected",
] as const;

export const FEATURE_ROLLOUT_STAGES = ["OFF", "INTERNAL", "CANARY", "GENERAL"] as const;

export type FeatureExposureClass = (typeof FEATURE_EXPOSURE_CLASSES)[number];
export type FeatureExposureEventType = (typeof FEATURE_EXPOSURE_EVENT_TYPES)[number];
export type FeatureRolloutStage = (typeof FEATURE_ROLLOUT_STAGES)[number];
export type FeatureSurface = "route" | "section" | "action";
export type FeatureRole = "PUBLIC" | "REPORTER" | "TRIAGER" | "ADMIN" | "GLOBAL_ADMIN";
export type FeaturePlan = "FREE" | "TIER_1" | "TIER_2" | "TIER_3";

export type FeatureExposureDefinition = {
  surface: FeatureSurface;
  owner: string;
  rollbackOwner: string;
  exposure: FeatureExposureClass;
  allowedRoles: readonly FeatureRole[];
  allowedPlans: readonly FeaturePlan[];
  serverCapability: string;
  dependencies: readonly string[];
  rolloutFlag: string;
  defaultRolloutStage: FeatureRolloutStage;
  killSwitch: {
    environmentVariable: "FEATURE_KILL_SWITCHES";
    clientEnvironmentVariable: "VITE_FEATURE_KILL_SWITCHES";
    defaultDisabled: boolean;
  };
  readinessProof: string;
};

type FeatureExposureSource = Omit<FeatureExposureDefinition, "rolloutFlag" | "defaultRolloutStage" | "killSwitch">;

const allPlans = ["FREE", "TIER_1", "TIER_2", "TIER_3"] as const;
const signedInRoles = ["TRIAGER", "ADMIN", "GLOBAL_ADMIN"] as const;
const adminRoles = ["ADMIN", "GLOBAL_ADMIN"] as const;
const reporterRoles = ["PUBLIC", "REPORTER"] as const;

function feature(
  surface: FeatureSurface,
  owner: string,
  exposure: FeatureExposureClass,
  allowedRoles: readonly FeatureRole[],
  serverCapability: string,
  readinessProof: string,
  dependencies: readonly string[] = [],
): FeatureExposureSource {
  return {
    surface,
    owner,
    rollbackOwner: owner,
    exposure,
    allowedRoles,
    allowedPlans: allPlans,
    serverCapability,
    dependencies,
    readinessProof,
  };
}

const featureExposureSource = {
  "route.login": feature("route", "Identity", "CORE_REPAIR", ["PUBLIC"], "auth.login", "TG-UX-063"),
  "route.signup": feature("route", "Identity", "CORE_REPAIR", ["PUBLIC"], "auth.signup", "TG-UX-063"),
  "route.accept_invite": feature("route", "Identity", "CORE_REPAIR", ["PUBLIC", ...signedInRoles], "org.invite.accept", "TG-UX-062"),
  "route.forgot_password": feature("route", "Identity", "CORE_REPAIR", ["PUBLIC"], "auth.password.request", "TG-UX-063"),
  "route.reset_password": feature("route", "Identity", "CORE_REPAIR", ["PUBLIC"], "auth.password.reset", "TG-UX-063"),
  "route.reporter": feature("route", "Reporter", "CORE_REPAIR", ["PUBLIC", ...signedInRoles], "reporter.portal", "TG-UX-064"),
  "route.analytics": feature("route", "Insights", "KEEP_POLISH", signedInRoles, "analytics.read", "TG-UX-047"),
  "route.organization_create": feature("route", "Identity", "CORE_REPAIR", signedInRoles, "org.create", "TG-UX-076"),
  "route.issues": feature("route", "Triage", "CORE_REPAIR", signedInRoles, "feedback.list", "TG-UX-037"),
  "route.issue_detail": feature("route", "Triage", "CORE_REPAIR", signedInRoles, "feedback.read", "TG-UX-039"),
  "route.ideas": feature("route", "Voice of customer", "KEEP_POLISH", signedInRoles, "ideas.read", "TG-UX-049"),
  "route.customers": feature("route", "Voice of customer", "KEEP_POLISH", signedInRoles, "customers.read", "TG-UX-050"),
  "route.releases": feature("route", "Engineering", "KEEP_POLISH", signedInRoles, "releases.read", "TG-UX-052"),
  "route.projects": feature("route", "Product", "CORE_REPAIR", adminRoles, "projects.list", "TG-UX-058"),
  "route.project_create": feature("route", "Product", "CORE_REPAIR", adminRoles, "projects.create", "TG-UX-055"),
  "route.project_detail": feature("route", "Product", "CORE_REPAIR", adminRoles, "projects.read", "TG-UX-055"),
  "route.integrations": feature("route", "Integrations", "CORE_REPAIR", adminRoles, "integrations.admin", "TG-UX-059"),
  "route.users": feature("route", "Identity", "CORE_REPAIR", adminRoles, "users.list", "TG-UX-062"),
  "route.user_invite": feature("route", "Identity", "CORE_REPAIR", adminRoles, "org.invite.create", "TG-UX-062"),
  "route.user_detail": feature("route", "Identity", "CORE_REPAIR", signedInRoles, "users.self_or_admin_read", "TG-UX-062"),
  "route.settings": feature("route", "Billing and trust", "CORE_REPAIR", adminRoles, "org.settings", "TG-UX-065"),
  "route.platform": feature("route", "Platform", "CORE_REPAIR", ["GLOBAL_ADMIN"], "platform.read", "TG-UX-077"),
  "route.platform_org_detail": feature("route", "Platform", "CORE_REPAIR", ["GLOBAL_ADMIN"], "platform.org.read", "TG-UX-077"),

  "section.customers.accounts": feature("section", "Voice of customer", "CORE_REPAIR", signedInRoles, "customers.accounts", "TG-UX-050"),
  "section.customers.segments": feature("section", "Voice of customer", "QUARANTINE", signedInRoles, "customers.segments", "TG-UX-050"),
  "section.customers.cohorts": feature("section", "Voice of customer", "QUARANTINE", signedInRoles, "customers.cohorts", "TG-UX-050"),
  "section.alert_rules": feature("section", "Notifications", "CORE_REPAIR", adminRoles, "alerts.rules", "TG-UX-080"),
  "section.surveys.advanced": feature("section", "Insights", "QUARANTINE", adminRoles, "surveys.advanced", "TG-UX-081"),
  "section.ideas.ai_synthesis": feature("section", "Voice of customer", "CORE_REPAIR", signedInRoles, "ideas.ai_synthesis", "TG-UX-083"),
  "section.integrations.provider_import": feature("section", "Integrations", "CORE_REPAIR", adminRoles, "integrations.provider_import", "TG-UX-082"),
  "section.releases.provider_lifecycle": feature("section", "Engineering", "QUARANTINE", signedInRoles, "releases.provider_lifecycle", "TG-UX-052"),
  "section.admin.dogfood_widget": feature("section", "Product", "CORE_REPAIR", signedInRoles, "feedback.dogfood_widget", "TG-UX-075"),

  "action.auth.login": feature("action", "Identity", "CORE_REPAIR", ["PUBLIC"], "auth.login", "TG-UX-063"),
  "action.auth.signup": feature("action", "Identity", "CORE_REPAIR", ["PUBLIC"], "auth.signup", "TG-UX-063"),
  "action.password_reset.request": feature("action", "Identity", "CORE_REPAIR", ["PUBLIC"], "auth.password.request", "TG-UX-063"),
  "action.password_reset.confirm": feature("action", "Identity", "CORE_REPAIR", ["PUBLIC"], "auth.password.reset", "TG-UX-063"),
  "action.invite.accept": feature("action", "Identity", "CORE_REPAIR", ["PUBLIC", ...signedInRoles], "org.invite.accept", "TG-UX-062"),
  "action.organization.create": feature("action", "Identity", "CORE_REPAIR", signedInRoles, "org.create", "TG-UX-076"),
  "action.auth.logout": feature("action", "Identity", "CORE_REPAIR", signedInRoles, "auth.logout", "TG-UX-063"),

  "action.invite.create": feature("action", "Identity", "CORE_REPAIR", adminRoles, "org.invite.create", "TG-UX-062"),
  "action.user.create": feature("action", "Identity", "CORE_REPAIR", adminRoles, "users.create", "TG-UX-062"),
  "action.user.update": feature("action", "Identity", "CORE_REPAIR", adminRoles, "users.update", "TG-UX-013"),
  "action.user.deactivate": feature("action", "Identity", "CORE_REPAIR", adminRoles, "users.deactivate", "TG-UX-013"),

  "action.billing_portal.open": feature("action", "Billing and trust", "CORE_REPAIR", adminRoles, "billing.portal.create", "TG-UX-065"),
  "action.project_addon_checkout.create": feature("action", "Billing and trust", "CORE_REPAIR", adminRoles, "billing.project_addon.checkout", "TG-UX-065"),
  "action.issue_addon_checkout.create": feature("action", "Billing and trust", "CORE_REPAIR", adminRoles, "billing.issue_addon.checkout", "TG-UX-065"),
  "action.auto_issue_blocks.update": feature("action", "Billing and trust", "CORE_REPAIR", adminRoles, "billing.auto_issue_blocks.update", "TG-UX-065"),
  "action.plan_checkout.create": feature("action", "Billing and trust", "CORE_REPAIR", adminRoles, "billing.subscription.checkout", "TG-UX-065"),
  "action.audit_export.download": feature("action", "Billing and trust", "CORE_REPAIR", adminRoles, "compliance.audit.export", "TG-UX-066"),
  "action.dsar_export.download": feature("action", "Billing and trust", "CORE_REPAIR", adminRoles, "compliance.dsar.export", "TG-UX-066"),
  "action.dsar_export.queue": feature("action", "Billing and trust", "CORE_REPAIR", adminRoles, "compliance.dsar_export_request.create", "TG-UX-066"),
  "action.dsar_export_artifact.download": feature("action", "Billing and trust", "CORE_REPAIR", adminRoles, "compliance.dsar_export_request.download", "TG-UX-066"),
  "action.dsar_deletion.request": feature("action", "Billing and trust", "CORE_REPAIR", adminRoles, "compliance.dsar_deletion.create", "TG-UX-066"),
  "action.dsar_deletion.approve": feature("action", "Billing and trust", "CORE_REPAIR", adminRoles, "compliance.dsar_deletion.approve", "TG-UX-066"),
  "action.dsar_deletion.reject": feature("action", "Billing and trust", "CORE_REPAIR", adminRoles, "compliance.dsar_deletion.reject", "TG-UX-066"),

  "action.platform_entitlements.update": feature("action", "Platform", "CORE_REPAIR", ["GLOBAL_ADMIN"], "platform.entitlements.update", "TG-UX-077"),
  "action.platform_organization_status.update": feature("action", "Platform", "CORE_REPAIR", ["GLOBAL_ADMIN"], "platform.org_status.update", "TG-UX-077"),
  "action.platform_widget_access.revoke": feature("action", "Platform", "CORE_REPAIR", ["GLOBAL_ADMIN"], "platform.widget.revoke", "TG-UX-077"),
  "action.platform_widget_access.restore": feature("action", "Platform", "CORE_REPAIR", ["GLOBAL_ADMIN"], "platform.widget.restore", "TG-UX-077"),

  "action.integration_client.create": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "integrations.client.create", "TG-UX-059"),
  "action.integration_client_token.copy": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "client.clipboard", "TG-UX-060"),
  "action.integration_client.rotate": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "integrations.client.rotate", "TG-UX-011"),
  "action.integration_client.revoke": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "integrations.client.revoke", "TG-UX-060"),
  "action.integration_client.update_scope": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "integrations.client.scope_update", "TG-UX-060"),
  "action.provider_connection.create": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "integrations.provider.create", "TG-UX-059"),
  "action.provider_connection.test": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "integrations.provider.test", "TG-UX-061"),
  "action.provider_connection.rotate": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "integrations.provider.rotate", "TG-UX-082"),
  "action.provider_connection.revoke": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "integrations.provider.revoke", "TG-UX-060"),
  "action.provider_import.preview": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "integrations.provider_import.preview", "TG-UX-082"),
  "action.provider_import.apply": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "integrations.provider_import.apply", "TG-UX-082"),
  "action.webhook_secret.create": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "webhooks.endpoint.create", "TG-UX-059"),
  "action.webhook_secret.copy": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "client.clipboard", "TG-UX-060"),
  "action.webhook_secret.rotate": feature("action", "Integrations", "KILL_SWITCHED", adminRoles, "webhooks.endpoint.rotate", "TG-UX-060"),
  "action.webhook_delivery.replay": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "webhooks.delivery.replay", "TG-UX-061"),
  "action.webhook_endpoint.test": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "webhooks.endpoint.test", "TG-UX-061"),
  "action.webhook_endpoint.revoke": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "webhooks.endpoint.revoke", "TG-UX-060"),
  "action.alert_rule.manage": feature("action", "Notifications", "CORE_REPAIR", adminRoles, "alerts.rules.manage", "TG-UX-080"),
  "action.feedback.submit": feature("action", "Product", "CORE_REPAIR", reporterRoles, "feedback.submit", "TG-UX-075"),
  "action.feedback.dogfood_submit": feature("action", "Product", "CORE_REPAIR", reporterRoles, "feedback.dogfood_submit", "TG-UX-074"),
  "action.issue_resolution.update": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "feedback.issue_resolution.update", "TG-UX-078"),
  "action.idea_source.ingest": feature("action", "Voice of customer", "CORE_REPAIR", signedInRoles, "ideas.source.ingest", "TG-UX-083"),
  "action.idea_synthesis.run": feature("action", "Voice of customer", "CORE_REPAIR", signedInRoles, "ideas.synthesis.run", "TG-UX-083"),
  "action.idea_suggestion.review": feature("action", "Voice of customer", "CORE_REPAIR", signedInRoles, "ideas.suggestion.review", "TG-UX-083"),
  "action.provider_sync.run": feature("action", "Integrations", "CORE_REPAIR", adminRoles, "integrations.provider_sync.run", "TG-UX-082"),
  "action.survey.manage": feature("action", "Insights", "CORE_REPAIR", adminRoles, "surveys.manage", "TG-UX-081"),
  "action.survey.respond": feature("action", "Insights", "CORE_REPAIR", reporterRoles, "surveys.respond", "TG-UX-081"),

  "action.project.create": feature("action", "Product", "CORE_REPAIR", adminRoles, "projects.create", "TG-UX-055"),
  "action.project.update": feature("action", "Product", "CORE_REPAIR", adminRoles, "projects.update", "TG-UX-055"),
  "action.project_widget_secret.generate": feature("action", "Product", "CORE_REPAIR", adminRoles, "projects.widget_secret.generate", "TG-UX-056"),
  "action.project_widget_secret.rotate": feature("action", "Product", "CORE_REPAIR", adminRoles, "projects.widget_secret.rotate", "TG-UX-012"),
  "action.project_engineering_context.update": feature("action", "Product", "CORE_REPAIR", adminRoles, "projects.engineering_context.update", "TG-UX-079"),
  "action.project_install_test.submit": feature("action", "Product", "CORE_REPAIR", adminRoles, "projects.install_test.run", "TG-UX-056"),

  "action.saved_issue_view.create": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "feedback.saved_view.create", "TG-UX-007"),
  "action.saved_issue_view.delete": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "feedback.saved_view.delete", "TG-UX-007"),
  "action.issue_export.download": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "client.csv.download", "TG-UX-038"),
  "action.issue_bulk_status.update": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "feedback.bulk_status.update", "TG-UX-038"),
  "action.ai_coding_task.create": feature("action", "Engineering", "KEEP_POLISH", signedInRoles, "feedback.ai_coding_task.generate", "TG-UX-042"),
  "action.issue_summary.copy": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "client.clipboard", "TG-UX-039"),
  "action.feedback_attachment.download": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "feedback.attachment.download", "TG-UX-039"),
  "action.issue_duplicate.clear": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "feedback.duplicate.clear", "TG-UX-045"),
  "action.issue_duplicate.mark": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "feedback.duplicate.mark", "TG-UX-045"),
  "action.issue_severity.update": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "feedback.severity.update", "TG-UX-039"),
  "action.issue_owner.update": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "feedback.owner.update", "TG-UX-039"),
  "action.issue_labels.update": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "feedback.labels.update", "TG-UX-039"),
  "action.issue_external_ticket.update": feature("action", "Engineering", "CORE_REPAIR", signedInRoles, "feedback.external_ticket.update", "TG-UX-044"),
  "action.issue_external_refs.update": feature("action", "Engineering", "CORE_REPAIR", signedInRoles, "feedback.external_refs.update", "TG-UX-044"),
  "action.issue_engineering_lifecycle.update": feature("action", "Engineering", "CORE_REPAIR", signedInRoles, "feedback.lifecycle.update", "TG-UX-043"),
  "action.issue_engineering_lifecycle.clear": feature("action", "Engineering", "CORE_REPAIR", signedInRoles, "feedback.lifecycle.clear", "TG-UX-043"),
  "action.feedback_subscriber.create": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "feedback.subscriber.create", "TG-UX-041"),
  "action.feedback_subscriber.update": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "feedback.subscriber.update", "TG-UX-041"),
  "action.feedback_subscriber.disable": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "feedback.subscriber.disable", "TG-UX-041"),
  "action.issue_note_status.save": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "feedback.comment_or_status.save", "TG-UX-041"),
  "action.notification.replay": feature("action", "Triage", "CORE_REPAIR", signedInRoles, "feedback.notification.replay", "TG-UX-045"),

  "action.reporter_otp.request": feature("action", "Reporter", "CORE_REPAIR", reporterRoles, "reporter.session.request", "TG-UX-064"),
  "action.reporter_otp.verify": feature("action", "Reporter", "CORE_REPAIR", reporterRoles, "reporter.session.verify", "TG-UX-064"),
  "action.reporter_dsar.request_deletion": feature("action", "Reporter", "CORE_REPAIR", ["REPORTER"], "reporter.dsar.deletion_request", "TG-UX-066"),
  "action.reporter_dsar.download": feature("action", "Reporter", "CORE_REPAIR", ["REPORTER"], "reporter.dsar.export", "TG-UX-066"),
  "action.reporter_notifications.update": feature("action", "Reporter", "CORE_REPAIR", ["REPORTER"], "reporter.notifications.update", "TG-UX-046"),
  "action.reporter_attachment.upload": feature("action", "Reporter", "CORE_REPAIR", ["REPORTER"], "reporter.attachment.upload", "TG-UX-046"),
  "action.reporter_resolution.confirm_fixed": feature("action", "Reporter", "CORE_REPAIR", ["REPORTER"], "reporter.resolution.confirm_fixed", "TG-UX-046"),
  "action.reporter_resolution.reopen": feature("action", "Reporter", "CORE_REPAIR", ["REPORTER"], "reporter.resolution.still_happening", "TG-UX-046"),
  "action.reporter_comment.create": feature("action", "Reporter", "CORE_REPAIR", ["REPORTER"], "reporter.comment.create", "TG-UX-046"),
} as const satisfies Record<string, FeatureExposureSource>;

export type FeatureId = keyof typeof featureExposureSource;

const stagedRolloutFeatureIds = new Set<FeatureId>([
  "route.organization_create",
  "route.project_create",
  "section.alert_rules",
  "section.admin.dogfood_widget",
  "section.ideas.ai_synthesis",
  "section.integrations.provider_import",
  "action.organization.create",
  "action.project.create",
  "action.alert_rule.manage",
  "action.feedback.submit",
  "action.feedback.dogfood_submit",
  "action.issue_resolution.update",
  "action.idea_source.ingest",
  "action.idea_synthesis.run",
  "action.idea_suggestion.review",
  "action.provider_import.preview",
  "action.provider_import.apply",
  "action.provider_sync.run",
  "action.survey.manage",
  "action.survey.respond",
  "action.reporter_resolution.confirm_fixed",
  "action.reporter_resolution.reopen",
]);

export const featureExposureRegistry = Object.fromEntries(
  Object.entries(featureExposureSource).map(([featureId, definition]) => [
    featureId,
    {
      ...definition,
      rolloutFlag: `tracegenie:${featureId}`,
      defaultRolloutStage: stagedRolloutFeatureIds.has(featureId as FeatureId) ? "INTERNAL" : "GENERAL",
      killSwitch: {
        environmentVariable: "FEATURE_KILL_SWITCHES",
        clientEnvironmentVariable: "VITE_FEATURE_KILL_SWITCHES",
        defaultDisabled: definition.exposure === "KILL_SWITCHED",
      },
    },
  ]),
) as { readonly [Id in FeatureId]: FeatureExposureDefinition };

export const adminRouteFeatureIds = {
  login: "route.login",
  signup: "route.signup",
  acceptInvite: "route.accept_invite",
  forgotPassword: "route.forgot_password",
  resetPassword: "route.reset_password",
  reporter: "route.reporter",
  analytics: "route.analytics",
  organizationCreate: "route.organization_create",
  issues: "route.issues",
  issueDetail: "route.issue_detail",
  ideas: "route.ideas",
  customers: "route.customers",
  releases: "route.releases",
  projects: "route.projects",
  projectCreate: "route.project_create",
  projectDetail: "route.project_detail",
  integrations: "route.integrations",
  users: "route.users",
  userInvite: "route.user_invite",
  userDetail: "route.user_detail",
  settings: "route.settings",
  platform: "route.platform",
  platformOrgDetail: "route.platform_org_detail",
} as const satisfies Record<string, FeatureId>;

export type FeatureAccessContext = {
  role: FeatureRole;
  plan?: FeaturePlan;
};

export function isFeatureDiscoverable(
  featureId: FeatureId,
  context: FeatureAccessContext,
  emergencyKillSwitches: ReadonlySet<FeatureId> = new Set(),
) {
  const definition = featureExposureRegistry[featureId];
  if (definition.exposure === "QUARANTINE" || definition.exposure === "KILL_SWITCHED") {
    return false;
  }
  if (emergencyKillSwitches.has(featureId) || !definition.allowedRoles.includes(context.role)) {
    return false;
  }
  return !context.plan || definition.allowedPlans.includes(context.plan);
}

export function isFeatureMutationEnabled(
  featureId: FeatureId,
  emergencyKillSwitches: ReadonlySet<FeatureId> = new Set(),
) {
  const definition = featureExposureRegistry[featureId];
  return definition.surface === "action"
    && definition.exposure !== "QUARANTINE"
    && definition.exposure !== "KILL_SWITCHED"
    && !emergencyKillSwitches.has(featureId);
}

export function parseFeatureIdList(value: string | undefined): FeatureId[] {
  if (!value?.trim()) {
    return [];
  }

  const result: FeatureId[] = [];
  for (const candidate of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    if (!(candidate in featureExposureRegistry)) {
      throw new Error(`Unknown TraceGenie feature ID: ${candidate}`);
    }
    const featureId = candidate as FeatureId;
    if (!result.includes(featureId)) {
      result.push(featureId);
    }
  }
  return result;
}

export type FeatureRolloutStageMap = Readonly<Partial<Record<FeatureId, FeatureRolloutStage>>>;

export type FeatureRolloutContext = {
  organizationId?: string;
  internal?: boolean;
  canaryPercent?: number;
};

export function parseFeatureRolloutStages(value: string | undefined): Partial<Record<FeatureId, FeatureRolloutStage>> {
  if (!value?.trim()) return {};

  const result: Partial<Record<FeatureId, FeatureRolloutStage>> = {};
  for (const entry of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    const separator = entry.lastIndexOf("=");
    const candidate = separator >= 0 ? entry.slice(0, separator).trim() : "";
    const stage = separator >= 0 ? entry.slice(separator + 1).trim().toUpperCase() : "";
    if (!(candidate in featureExposureRegistry)) {
      throw new Error(`Unknown TraceGenie feature ID: ${candidate || entry}`);
    }
    if (!FEATURE_ROLLOUT_STAGES.includes(stage as FeatureRolloutStage)) {
      throw new Error(`Unknown TraceGenie rollout stage for ${candidate}: ${stage || "missing"}`);
    }
    result[candidate as FeatureId] = stage as FeatureRolloutStage;
  }
  return result;
}

export function getFeatureRolloutStage(
  featureId: FeatureId,
  stages: FeatureRolloutStageMap = {},
  fallbackStage?: FeatureRolloutStage,
) {
  return stages[featureId] ?? fallbackStage ?? featureExposureRegistry[featureId].defaultRolloutStage;
}

export function stableRolloutBucket(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

export function isFeatureRolloutEnabled(
  featureId: FeatureId,
  stages: FeatureRolloutStageMap = {},
  context: FeatureRolloutContext = {},
  fallbackStage?: FeatureRolloutStage,
) {
  const stage = getFeatureRolloutStage(featureId, stages, fallbackStage);
  if (stage === "GENERAL") return true;
  if (stage === "OFF") return false;
  if (stage === "INTERNAL") return context.internal === true;
  if (!context.organizationId) return false;
  const canaryPercent = Math.max(0, Math.min(100, context.canaryPercent ?? 0));
  return stableRolloutBucket(context.organizationId) < canaryPercent;
}
