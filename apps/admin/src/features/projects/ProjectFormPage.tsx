import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import {
feedbackSurveyTypeSchema,
getProductionPrivacyReadiness,widgetProjectConfigSchema,
type ProjectAutoFixPolicy,
type ProjectEngineeringContextResponse,
type ProjectRequesterNotificationPolicy,
type ProjectReviewerPolicy,
type ProjectSettingsDestination,
type ProjectSummary,
type WidgetProjectConfig
} from "@tracegenie/shared";
import {
AlertTriangle,
Bug,
Check,
Clipboard,
Inbox,
MessageSquare,
Pause,
Pencil,
Play,
RefreshCw,
ShieldCheck
} from "lucide-react";
import { useEffect,useMemo,useRef,useState,type CSSProperties,type ReactNode,type Ref } from "react";
import { useForm } from "react-hook-form";
import { Navigate,useLocation,useNavigate,useParams,useSearchParams } from "react-router-dom";
import { z } from "zod";
import { productCaptureReadiness } from "../onboarding/productActivation";

import { useAdminFormExitGuard } from "../../components/guards/AdminFormExitGuard";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { CommitBar } from "../../components/ui/CommitBar";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Input,Textarea } from "../../components/ui/Input";
import { MutationRecovery,mutationRecoveryEntry } from "../../components/ui/MutationRecovery";
import { PageBackLink,PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { api } from "../../lib/api";
import { copy } from "../../lib/copy";
import { getDemoAppUrl } from "../../lib/env";
import { isAdminFeatureDiscoverable,recordHiddenFeatureExposure } from "../../lib/featureExposure";
import { ProductActivationRunway } from "../onboarding/ProductActivationRunway";
import { ProductSettingsHeader,ProductWorkspaceHeader } from "./ProductWorkspaceHeader";
import {
getCanonicalProductSectionLocation,
isProjectSectionId,
withLegacyProjectSection,
type ProjectSectionId,
} from "./projectSectionRoutes";
import { WidgetSnippet } from "./WidgetSnippet";

const DEMO_APP_URL = getDemoAppUrl();

const PROJECT_SECTIONS = [
  { id: "overview", label: "General", description: "Identity and environment" },
  { id: "install", label: "Installation", description: "Origins, secret, and snippet" },
  { id: "capture", label: "Widget and evidence", description: "Experience and capture fields" },
  ...[],
  ...[],
  { id: "notifications", label: "Notifications", description: "Recipients and branding" },
  { id: "privacy", label: "Privacy", description: "Retention and redaction" },
] as const;

const emailListSchema = z
  .string()
  .refine(
    (value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean).length > 0,
    "At least one notification email is required.",
  )
  .refine(
    (value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .every((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)),
    "Every entry must be a valid email address.",
  );

function optionalDaysSchema(min: number, max: number, label: string) {
  return z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d+$/.test(value), `${label} must be a whole number.`)
    .refine((value) => value === "" || Number(value) >= min, `${label} must be at least ${min} days.`)
    .refine((value) => value === "" || Number(value) <= max, `${label} must be ${max} days or less.`);
}

function customRedactionTermsFromText(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function customRedactionTermsToText(value: string[]) {
  return value.join("\n");
}

function customRedactionTermsSummary(value: string) {
  const count = customRedactionTermsFromText(value).length;
  return count === 0 ? "None" : `${count} term${count === 1 ? "" : "s"}`;
}

const projectFormSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,63}$/, "Lowercase slug (letters, numbers, hyphens). Example: my-saas-app"),
  name: z.string().min(2, "Name must be at least 2 characters."),
  requesterEmailProductName: z
    .string()
    .trim()
    .refine((value) => value.length === 0 || value.length >= 2, "Product name must be at least 2 characters."),
  description: z.string().optional(),
  defaultEnvironment: z.string().min(2),
  allowedOrigins: z.string().default(""),
  notificationEmails: emailListSchema,
  isActive: z.boolean(),
  allowScreenshot: z.boolean(),
  autoCaptureScreenshot: z.boolean(),
  allowFileAttachments: z.boolean(),
  allowPointSelection: z.boolean(),
  allowConsoleCapture: z.boolean(),
  allowClientErrorContext: z.boolean(),
  allowNetworkSummary: z.boolean(),
  launcherPresentation: z.enum(["icon", "icon-text", "text"]),
  launcherIcon: z.enum(["bug", "message"]),
  launcherLabel: z.string().min(2),
  launcherPosition: z.enum(["bottom-right", "bottom-left"]),
  launcherOffsetX: z.coerce.number().int().min(0).max(160),
  launcherOffsetY: z.coerce.number().int().min(0).max(160),
  modalTitle: z.string().min(2).max(120),
  keyboardShortcut: z.string().optional(),
  brandName: z.string().trim().max(120).optional(),
  logoUrl: z.string().trim().url("Enter a valid logo URL.").or(z.literal("")).optional(),
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color."),
  accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color."),
  emailFooterText: z.string().trim().max(500).optional(),
  privacyUrl: z.string().trim().url("Enter a valid privacy URL.").or(z.literal("")).optional(),
  privacyOwnerEmail: z.string().trim().email("Enter a valid privacy owner email.").or(z.literal("")),
  retentionDays: optionalDaysSchema(30, 3650, "Issue retention"),
  attachmentRetentionDays: optionalDaysSchema(1, 3650, "Attachment retention"),
  redactionMode: z.enum(["standard", "technical_metadata", "strict"]),
  mcpEvidenceSharing: z.enum(["raw_allowed", "metadata_only"]),
  suppressSelectedText: z.boolean(),
  customRedactionTerms: z
    .string()
    .refine((value) => customRedactionTermsFromText(value).length <= 20, "Use 20 custom terms or fewer.")
    .refine((value) => customRedactionTermsFromText(value).every((item) => item.length <= 80), "Each custom term must be 80 characters or fewer."),
  enableSurveyPrompt: z.boolean(),
  surveyPromptType: feedbackSurveyTypeSchema,
  surveyPromptQuestion: z.string().trim().min(1).max(160),
  enableSteps: z.boolean(),
  enableExpected: z.boolean(),
  enableActual: z.boolean(),
});
type ProjectFormInput = z.input<typeof projectFormSchema>;
type ProjectFormValues = z.output<typeof projectFormSchema>;

const PROJECT_SETTINGS_FORM_SCHEMAS: Record<ProjectSettingsDestination, z.ZodTypeAny> = {
  general: projectFormSchema.pick({
    name: true,
    description: true,
    defaultEnvironment: true,
    isActive: true,
  }),
  installation: projectFormSchema.pick({ allowedOrigins: true }),
  widget: projectFormSchema.pick({
    launcherPresentation: true,
    launcherIcon: true,
    launcherLabel: true,
    launcherPosition: true,
    launcherOffsetX: true,
    launcherOffsetY: true,
    modalTitle: true,
    keyboardShortcut: true,
    primaryColor: true,
    accentColor: true,
  }),
  evidence: projectFormSchema.pick({
    allowScreenshot: true,
    autoCaptureScreenshot: true,
    allowFileAttachments: true,
    allowPointSelection: true,
    allowConsoleCapture: true,
    allowClientErrorContext: true,
    allowNetworkSummary: true,
    enableSurveyPrompt: true,
    surveyPromptType: true,
    surveyPromptQuestion: true,
    enableSteps: true,
    enableExpected: true,
    enableActual: true,
  }),
  notifications: projectFormSchema.pick({
    name: true,
    requesterEmailProductName: true,
    notificationEmails: true,
    brandName: true,
    logoUrl: true,
    primaryColor: true,
    accentColor: true,
    emailFooterText: true,
  }),
  privacy: projectFormSchema.pick({
    privacyUrl: true,
    privacyOwnerEmail: true,
    retentionDays: true,
    attachmentRetentionDays: true,
    redactionMode: true,
    mcpEvidenceSharing: true,
    suppressSelectedText: true,
    customRedactionTerms: true,
  }),
};

const PROJECT_FIELD_SECTIONS: Partial<Record<keyof ProjectFormInput, ProjectSectionId>> = {
  allowedOrigins: "install",
  notificationEmails: "notifications",
  brandName: "notifications",
  logoUrl: "notifications",
  primaryColor: "notifications",
  accentColor: "notifications",
  emailFooterText: "notifications",
  allowScreenshot: "capture",
  autoCaptureScreenshot: "capture",
  allowFileAttachments: "capture",
  allowPointSelection: "capture",
  allowConsoleCapture: "capture",
  allowClientErrorContext: "capture",
  allowNetworkSummary: "capture",
  launcherPresentation: "capture",
  launcherIcon: "capture",
  launcherLabel: "capture",
  launcherPosition: "capture",
  launcherOffsetX: "capture",
  launcherOffsetY: "capture",
  modalTitle: "capture",
  keyboardShortcut: "capture",
  enableSurveyPrompt: "capture",
  surveyPromptType: "capture",
  surveyPromptQuestion: "capture",
  enableSteps: "capture",
  enableExpected: "capture",
  enableActual: "capture",
  privacyUrl: "privacy",
  privacyOwnerEmail: "privacy",
  retentionDays: "privacy",
  attachmentRetentionDays: "privacy",
  redactionMode: "privacy",
  mcpEvidenceSharing: "privacy",
  suppressSelectedText: "privacy",
  customRedactionTerms: "privacy",
};
type ProjectSecretOperation = "generate" | "rotate";

type ProjectMutationIdentity = {
  actionId: number;
  routeProjectKey: string | null;
  organizationId?: string | null;
  projectKey: string;
  projectName: string;
};
type PendingProjectSecretRotation = Omit<ProjectMutationIdentity, "actionId">;
type PendingProductAction = {
  kind: "pause" | "delete";
  projectKey: string;
  projectName: string;
};

type ProjectSaveVariables = ProjectMutationIdentity & {
  isCreateMode: boolean;
  settingsDestination?: ProjectSettingsDestination;
  values: ProjectFormValues;
  payload: Record<string, unknown>;
};
type ProjectStatusVariables = ProjectMutationIdentity & {
  nextIsActive: boolean;
  expectedUpdatedAt: string;
};
type ProjectDeleteVariables = ProjectMutationIdentity;
type ProjectSavePayload = {
  organizationId?: string;
  name: string;
  requesterEmailProductName: string;
  description: string | undefined;
  defaultEnvironment: string;
  allowedOrigins: string[];
  notificationEmails: string[];
  isActive: boolean;
  widgetConfig: WidgetProjectConfig;
};

type NotificationBrandingPreview = Pick<
  ProjectFormInput,
  "brandName" | "logoUrl" | "primaryColor" | "accentColor" | "emailFooterText"
>;

const REDACTION_MODE_LABELS = {
  standard: "Standard",
  technical_metadata: "Technical metadata",
  strict: "Strict",
} as const;

type EngineeringContextFormValues = {
  repositoryUrl: string;
  defaultBranch: string;
  worktreePath: string;
  installCommand: string;
  testCommand: string;
  buildCommand: string;
  autoFixPolicy: ProjectAutoFixPolicy;
  reviewerPolicy: ProjectReviewerPolicy;
  requesterNotificationPolicy: ProjectRequesterNotificationPolicy;
  notes: string;
};

const EMPTY_ENGINEERING_CONTEXT: EngineeringContextFormValues = {
  repositoryUrl: "",
  defaultBranch: "",
  worktreePath: "",
  installCommand: "",
  testCommand: "",
  buildCommand: "",
  autoFixPolicy: "SUGGEST_ONLY",
  reviewerPolicy: "NONE",
  requesterNotificationPolicy: "EXPLICIT_ONLY",
  notes: "",
};

const CAPTURE_FIELDS: Array<[keyof ProjectFormInput & string, string, string]> = [
  ["allowScreenshot", "Allow screenshots", "Let reporters capture, review, and remove a screenshot."],
  ["autoCaptureScreenshot", "Automatically capture a screenshot", "Capture when the report opens and include it when the reporter sends. They can review or remove it first. Requires Allow screenshots."],
  ["allowFileAttachments", "Allow multiple file attachments", "Reporters can add images, PDFs, and text or log files. Up to 5 attachments per report, including the screenshot; 5 MB per file."],
  ["allowPointSelection", "Point-to-issue selector", "Let desktop reporters point to an element or page location before submitting."],
  ["allowConsoleCapture", "Console log capture", "Attach recent browser console entries. Reporters can review and remove them."],
  ["allowClientErrorContext", "Client error context", "Include uncaught runtime error context when available."],
  ["allowNetworkSummary", "Network summary", "Attach recent request metadata without request or response bodies."],
  ["enableSteps", "Steps to reproduce field", "Show the optional reproduction-steps field."],
  ["enableExpected", "Expected result field", "Collect expected behavior for comparison."],
  ["enableActual", "Actual result field", "Capture what actually happened."],
];

function projectToFormValues(project: ProjectSummary): ProjectFormInput {
  const widgetConfig = widgetProjectConfigSchema.parse(project.widgetConfig ?? {});
  const notificationBranding = widgetConfig.notificationBranding;
  const privacy = widgetConfig.privacy;
  return {
    key: project.key,
    name: project.name,
    requesterEmailProductName: project.requesterEmailProductName ?? project.name,
    description: project.description ?? "",
    defaultEnvironment: project.defaultEnvironment,
    allowedOrigins: project.allowedOrigins.join(", "),
    notificationEmails: ((project as ProjectSummary & { notificationEmails?: string[] }).notificationEmails ?? []).join(", "),
    isActive: project.isActive,
    allowScreenshot: widgetConfig.allowScreenshot,
    autoCaptureScreenshot: widgetConfig.autoCaptureScreenshot,
    allowFileAttachments: widgetConfig.allowFileAttachments,
    allowPointSelection: widgetConfig.allowPointSelection,
    allowConsoleCapture: widgetConfig.allowConsoleCapture,
    allowClientErrorContext: widgetConfig.allowClientErrorContext,
    allowNetworkSummary: widgetConfig.allowNetworkSummary,
    launcherPresentation: widgetConfig.appearance.launcherPresentation,
    launcherIcon: widgetConfig.appearance.launcherIcon,
    launcherLabel: widgetConfig.appearance.launcherLabel,
    launcherPosition: widgetConfig.appearance.launcherPosition,
    launcherOffsetX: widgetConfig.appearance.launcherOffsetX,
    launcherOffsetY: widgetConfig.appearance.launcherOffsetY,
    modalTitle: widgetConfig.appearance.modalTitle,
    keyboardShortcut: widgetConfig.appearance.keyboardShortcut ?? "",
    brandName: notificationBranding.brandName ?? project.requesterEmailProductName ?? project.name,
    logoUrl: notificationBranding.logoUrl ?? "",
    primaryColor: notificationBranding.primaryColor,
    accentColor: notificationBranding.accentColor,
    emailFooterText: notificationBranding.emailFooterText ?? "",
    privacyUrl: privacy.privacyUrl,
    privacyOwnerEmail: privacy.privacyOwnerEmail,
    retentionDays: privacy.retentionDays === null ? "" : String(privacy.retentionDays),
    attachmentRetentionDays: privacy.attachmentRetentionDays === null ? "" : String(privacy.attachmentRetentionDays),
    redactionMode: privacy.redactionMode,
    mcpEvidenceSharing: privacy.mcpEvidenceSharing,
    suppressSelectedText: privacy.suppressSelectedText,
    customRedactionTerms: customRedactionTermsToText(privacy.customRedactionTerms),
    enableSurveyPrompt: widgetConfig.surveyPrompt.enabled,
    surveyPromptType: widgetConfig.surveyPrompt.type,
    surveyPromptQuestion: widgetConfig.surveyPrompt.question,
    enableSteps: widgetConfig.fields.stepsToReproduce.enabled,
    enableExpected: widgetConfig.fields.expectedResult.enabled,
    enableActual: widgetConfig.fields.actualResult.enabled,
  };
}

function engineeringContextToFormValues(response: ProjectEngineeringContextResponse | null | undefined): EngineeringContextFormValues {
  const context = response?.engineeringContext;
  return {
    repositoryUrl: context?.repositoryUrl ?? "",
    defaultBranch: context?.defaultBranch ?? "",
    worktreePath: context?.worktreePath ?? "",
    installCommand: context?.installCommand ?? "",
    testCommand: context?.testCommand ?? "",
    buildCommand: context?.buildCommand ?? "",
    autoFixPolicy: context?.autoFixPolicy ?? "SUGGEST_ONLY",
    reviewerPolicy: context?.reviewerPolicy ?? "NONE",
    requesterNotificationPolicy: context?.requesterNotificationPolicy ?? "EXPLICIT_ONLY",
    notes: context?.notes ?? "",
  };
}

function projectFormValuesToPayload(values: ProjectFormValues, widgetConfig: WidgetProjectConfig): ProjectSavePayload {
  return {
    name: values.name,
    requesterEmailProductName: values.requesterEmailProductName || values.name,
    description: values.description,
    defaultEnvironment: values.defaultEnvironment,
    allowedOrigins: values.allowedOrigins
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    notificationEmails: values.notificationEmails
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    isActive: values.isActive,
    widgetConfig: {
      ...widgetConfig,
      allowScreenshot: values.allowScreenshot,
      autoCaptureScreenshot: values.autoCaptureScreenshot,
      allowFileAttachments: values.allowFileAttachments,
      allowPointSelection: values.allowPointSelection,
      allowConsoleCapture: values.allowConsoleCapture,
      allowClientErrorContext: values.allowClientErrorContext,
      allowNetworkSummary: values.allowNetworkSummary,
      appearance: {
        ...widgetConfig.appearance,
        launcherPresentation: values.launcherPresentation,
        launcherIcon: values.launcherIcon,
        launcherLabel: values.launcherLabel,
        launcherPosition: values.launcherPosition,
        launcherOffsetX: values.launcherOffsetX,
        launcherOffsetY: values.launcherOffsetY,
        modalTitle: values.modalTitle,
        keyboardShortcut: values.keyboardShortcut,
      },
      notificationBranding: {
        ...widgetConfig.notificationBranding,
        brandName: values.brandName?.trim() || values.requesterEmailProductName || values.name,
        logoUrl: values.logoUrl?.trim() || "",
        primaryColor: values.primaryColor,
        accentColor: values.accentColor,
        emailFooterText: values.emailFooterText?.trim() || "",
      },
      privacy: {
        ...widgetConfig.privacy,
        privacyOwnerEmail: values.privacyOwnerEmail.trim(),
        privacyUrl: values.privacyUrl?.trim() || "",
        retentionDays: daysToNumberOrNull(values.retentionDays),
        attachmentRetentionDays: daysToNumberOrNull(values.attachmentRetentionDays),
        redactionMode: values.redactionMode,
        mcpEvidenceSharing: values.mcpEvidenceSharing,
        suppressSelectedText: values.suppressSelectedText,
        customRedactionTerms: customRedactionTermsFromText(values.customRedactionTerms),
      },
      surveyPrompt: {
        ...widgetConfig.surveyPrompt,
        enabled: values.enableSurveyPrompt,
        type: values.surveyPromptType,
        question: values.surveyPromptQuestion,
      },
      fields: {
        ...widgetConfig.fields,
        stepsToReproduce: { ...widgetConfig.fields.stepsToReproduce, enabled: values.enableSteps },
        expectedResult: { ...widgetConfig.fields.expectedResult, enabled: values.enableExpected },
        actualResult: { ...widgetConfig.fields.actualResult, enabled: values.enableActual },
      },
    },
  };
}

function projectFormValuesToSettingsPatch(
  destination: ProjectSettingsDestination,
  values: ProjectFormValues,
  widgetConfig: WidgetProjectConfig,
  expectedUpdatedAt: string | Date,
): Record<string, unknown> {
  const expected = new Date(expectedUpdatedAt).toISOString();
  if (destination === "general") {
    return {
      expectedUpdatedAt: expected,
      name: values.name,
      description: values.description?.trim() || null,
      defaultEnvironment: values.defaultEnvironment,
      isActive: values.isActive,
    };
  }
  if (destination === "installation") {
    return {
      expectedUpdatedAt: expected,
      allowedOrigins: splitCommaList(values.allowedOrigins),
    };
  }
  if (destination === "widget") {
    return {
      expectedUpdatedAt: expected,
      notificationBranding: {
        primaryColor: values.primaryColor,
        accentColor: values.accentColor,
      },
      appearance: {
        launcherPresentation: values.launcherPresentation,
        launcherIcon: values.launcherIcon,
        launcherLabel: values.launcherLabel,
        launcherPosition: values.launcherPosition,
        launcherOffsetX: values.launcherOffsetX,
        launcherOffsetY: values.launcherOffsetY,
        modalTitle: values.modalTitle,
        keyboardShortcut: values.keyboardShortcut,
      },
    };
  }
  if (destination === "evidence") {
    return {
      expectedUpdatedAt: expected,
      allowScreenshot: values.allowScreenshot,
      autoCaptureScreenshot: values.autoCaptureScreenshot,
      allowFileAttachments: values.allowFileAttachments,
      allowPointSelection: values.allowPointSelection,
      allowConsoleCapture: values.allowConsoleCapture,
      allowClientErrorContext: values.allowClientErrorContext,
      allowNetworkSummary: values.allowNetworkSummary,
      surveyPrompt: {
        enabled: values.enableSurveyPrompt,
        type: values.surveyPromptType,
        question: values.surveyPromptQuestion,
      },
      fields: {
        stepsToReproduce: { ...widgetConfig.fields.stepsToReproduce, enabled: values.enableSteps },
        expectedResult: { ...widgetConfig.fields.expectedResult, enabled: values.enableExpected },
        actualResult: { ...widgetConfig.fields.actualResult, enabled: values.enableActual },
      },
    };
  }
  if (destination === "notifications") {
    return {
      expectedUpdatedAt: expected,
      notificationEmails: splitCommaList(values.notificationEmails),
      requesterEmailProductName: values.requesterEmailProductName || values.name,
      notificationBranding: {
        brandName: values.brandName?.trim() || values.requesterEmailProductName || values.name,
        logoUrl: values.logoUrl?.trim() || "",
        primaryColor: values.primaryColor,
        accentColor: values.accentColor,
        emailFooterText: values.emailFooterText?.trim() || "",
      },
    };
  }
  return {
    expectedUpdatedAt: expected,
    privacy: {
      ...widgetConfig.privacy,
      privacyOwnerEmail: values.privacyOwnerEmail.trim(),
      privacyUrl: values.privacyUrl?.trim() || "",
      retentionDays: daysToNumberOrNull(values.retentionDays),
      attachmentRetentionDays: daysToNumberOrNull(values.attachmentRetentionDays),
      redactionMode: values.redactionMode,
      mcpEvidenceSharing: values.mcpEvidenceSharing,
      suppressSelectedText: values.suppressSelectedText,
      customRedactionTerms: customRedactionTermsFromText(values.customRedactionTerms),
    },
  };
}

function emptyToNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function daysToNumberOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

function formatRetentionDays(value: string) {
  const trimmed = value.trim();
  return trimmed ? `${trimmed} days` : "No automatic expiry";
}

function engineeringContextToPayload(values: EngineeringContextFormValues) {
  return {
    repositoryUrl: emptyToNull(values.repositoryUrl),
    defaultBranch: emptyToNull(values.defaultBranch),
    worktreePath: emptyToNull(values.worktreePath),
    installCommand: emptyToNull(values.installCommand),
    testCommand: emptyToNull(values.testCommand),
    buildCommand: emptyToNull(values.buildCommand),
    autoFixPolicy: values.autoFixPolicy,
    reviewerPolicy: values.reviewerPolicy,
    requesterNotificationPolicy: values.requesterNotificationPolicy,
    notes: emptyToNull(values.notes),
  };
}

type ProjectFormPageProps = {
  organizationId?: string | null;
  canonicalSection?: ProjectSectionId;
  settingsDestination?: ProjectSettingsDestination;
};

export function ProjectFormPage({ organizationId, canonicalSection, settingsDestination }: ProjectFormPageProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { projectKey } = useParams<{ projectKey: string }>();
  const isCreateMode = !projectKey;
  const productBasePath = projectKey ? `/projects/${encodeURIComponent(projectKey)}` : "/projects/new";
  const isProductOverviewRoute = !isCreateMode
    && canonicalSection === "overview"
    && !location.pathname.endsWith("/settings/general");
  const requestedSection = searchParams.get("section");
  const activeSection: ProjectSectionId = isCreateMode
    ? "overview"
    : isProjectSectionId(canonicalSection)
      ? canonicalSection
      : isProjectSectionId(requestedSection) ? requestedSection : "overview";
  const activeSectionDefinition = settingsDestination === "widget"
    ? { id: "capture", label: "Widget", description: "Launcher appearance and behavior" }
    : settingsDestination === "evidence"
      ? { id: "capture", label: "Evidence", description: "Capture fields and report prompt" }
      : PROJECT_SECTIONS.find((section) => section.id === activeSection) ?? PROJECT_SECTIONS[0];
  const usesDedicatedEditor = activeSection === "engineering" || activeSection === "surveys";
  const canGenerateWidgetSecret = isAdminFeatureDiscoverable("action.project_widget_secret.generate");
  const canRotateWidgetSecret = isAdminFeatureDiscoverable("action.project_widget_secret.rotate");
  const [widgetClientSecret, setWidgetClientSecret] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(isCreateMode);
  const [isEngineeringContextEditing, setIsEngineeringContextEditing] = useState(false);
  const [engineeringContextValues, setEngineeringContextValues] = useState<EngineeringContextFormValues>(EMPTY_ENGINEERING_CONTEXT);
  const activeTargetRef = useRef({ projectKey: projectKey ?? null, organizationId });
  const commitAndExitRef = useRef<(proceed: () => void) => void>((proceed) => proceed());
  const focusPrivacyReadinessRef = useRef(false);
  const actionMutexRef = useRef<number | null>(null);
  const nextActionIdRef = useRef(0);
  const [pendingSecretRotation, setPendingSecretRotation] = useState<PendingProjectSecretRotation | null>(null);
  const [pendingProductAction, setPendingProductAction] = useState<PendingProductAction | null>(null);
  const secretRouteTransferRef = useRef<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  activeTargetRef.current = { projectKey: projectKey ?? null, organizationId };

  useEffect(() => {
    if (canonicalSection !== undefined || requestedSection === null || isProjectSectionId(requestedSection)) return;
    const canonicalParams = new URLSearchParams(searchParams);
    canonicalParams.set("section", "overview");
    navigate({
      pathname: location.pathname,
      search: `?${canonicalParams.toString()}`,
      hash: location.hash,
    }, { replace: true });
  }, [canonicalSection, location.hash, location.pathname, navigate, requestedSection, searchParams]);

  const navigateToProjectSection = (section: ProjectSectionId, replace = false) => {
    if (canonicalSection !== undefined && projectKey) {
      navigate(getCanonicalProductSectionLocation(projectKey, section, {
        search: searchParams,
        hash: location.hash,
      }), { replace });
      return;
    }
    const nextSearch = withLegacyProjectSection(searchParams, section);
    navigate({
      pathname: location.pathname,
      search: `?${nextSearch.toString()}`,
      hash: location.hash,
    }, { replace });
  };

  useEffect(() => {
    if (!canGenerateWidgetSecret) {
      recordHiddenFeatureExposure("feature.hidden_surface_observed", "action.project_widget_secret.generate");
    }
    if (!canRotateWidgetSecret) {
      recordHiddenFeatureExposure("feature.hidden_surface_observed", "action.project_widget_secret.rotate");
    }
  }, [canGenerateWidgetSecret, canRotateWidgetSecret]);

  const projectQuery = useQuery({
    queryKey: ["project-detail", organizationId, projectKey],
    queryFn: async () => {
      const result = await api.getProjects(organizationId);
      return result.projects.find((project) => project.key === projectKey) ?? null;
    },
    enabled: !isCreateMode && Boolean(organizationId),
  });

  const analyticsQuery = useQuery({
    queryKey: ["analytics-summary", "project-activation", organizationId, projectKey],
    queryFn: () => api.getAnalytics(undefined, organizationId),
    enabled: !isCreateMode && Boolean(organizationId),
  });

  const activationQuery = useQuery({
    queryKey: ["project-activation-proof", organizationId, projectKey],
    queryFn: () => api.getProjectInstallDiagnostics(projectKey ?? "", null, organizationId),
    enabled: !isCreateMode && Boolean(projectKey) && Boolean(organizationId),
    retry: false,
  });

  const activationActorQuery = useQuery({
    queryKey: ["self-profile", "product-activation", organizationId],
    queryFn: () => api.getSelfProfile(organizationId ?? null),
    enabled: isProductOverviewRoute && Boolean(organizationId),
    retry: false,
  });

  const teamQuery = useQuery({
    queryKey: ["organization-members", "product-activation", organizationId],
    queryFn: () => api.getUsers(organizationId ?? null),
    enabled: isProductOverviewRoute
      && Boolean(organizationId)
      && Boolean(activationActorQuery.data?.data.effectiveAccess.capabilities.canInviteMembers),
    retry: false,
  });

  const engineeringContextQuery = useQuery({
    queryKey: ["project-engineering-context", organizationId, projectKey],
    queryFn: () => api.getProjectEngineeringContext(projectKey ?? "", organizationId),
    enabled: false,
  });

  const existingProject = projectQuery.data;
  const widgetConfig = existingProject
    ? widgetProjectConfigSchema.parse(existingProject.widgetConfig ?? {})
    : widgetProjectConfigSchema.parse({});

  const form = useForm<ProjectFormInput, undefined, ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      key: "",
      name: "",
      requesterEmailProductName: "",
      description: "",
      defaultEnvironment: "development",
      allowedOrigins: "",
      notificationEmails: "",
      isActive: true,
      allowScreenshot: true,
      autoCaptureScreenshot: true,
      allowFileAttachments: true,
      allowPointSelection: false,
      allowConsoleCapture: false,
      allowClientErrorContext: false,
      allowNetworkSummary: false,
      launcherPresentation: "icon",
      launcherIcon: "bug",
      launcherLabel: "Report a bug",
      launcherPosition: "bottom-right",
      launcherOffsetX: 24,
      launcherOffsetY: 24,
      modalTitle: "Report a product issue",
      keyboardShortcut: "",
      brandName: "",
      logoUrl: "",
      primaryColor: "#2563eb",
      accentColor: "#344760",
      emailFooterText: "",
      privacyUrl: "",
      privacyOwnerEmail: "",
      retentionDays: "365",
      attachmentRetentionDays: "30",
      redactionMode: "technical_metadata",
      mcpEvidenceSharing: "metadata_only",
      suppressSelectedText: true,
      customRedactionTerms: "",
      enableSurveyPrompt: false,
      surveyPromptType: "csat",
      surveyPromptQuestion: "How was this experience?",
      enableSteps: true,
      enableExpected: true,
      enableActual: true,
    },
  });

  useEffect(() => {
    if (existingProject) {
      form.reset(projectToFormValues(existingProject));
    }
  }, [existingProject, form]);

  useEffect(() => {
    if (engineeringContextQuery.data && !isEngineeringContextEditing) {
      setEngineeringContextValues(engineeringContextToFormValues(engineeringContextQuery.data));
    }
  }, [engineeringContextQuery.data, isEngineeringContextEditing]);

  const mutation = useMutation({
    mutationFn: (variables: ProjectSaveVariables) => variables.settingsDestination
      ? api.patchProjectSettings(variables.projectKey, variables.settingsDestination, variables.payload, variables.organizationId ?? null)
      : api.updateProject(variables.projectKey, variables.payload),
    onSuccess: (data, variables) => {
      refreshProjectQueries(variables.projectKey, variables.organizationId);
      if (activeTargetRef.current.projectKey !== variables.routeProjectKey
        || activeTargetRef.current.organizationId !== variables.organizationId) {
        return;
      }
      if (data.project.widgetClientSecret) {
        setWidgetClientSecret(data.project.widgetClientSecret);
      }
      form.reset(projectToFormValues(data.project));
      setIsEditing(false);
      if (variables.isCreateMode) {
        if (data.project.widgetClientSecret) {
          secretRouteTransferRef.current = variables.projectKey;
        }
        commitAndExitRef.current(() => navigate(`/projects/${variables.projectKey}`, { replace: true }));
      }
    },
    onSettled: (_data, _error, variables) => {
      releaseProjectAction(variables?.actionId);
    },
  });

  const statusMutation = useMutation({
    mutationFn: (variables: ProjectStatusVariables) => api.patchProjectSettings(
      variables.projectKey,
      "general",
      {
        expectedUpdatedAt: variables.expectedUpdatedAt,
        isActive: variables.nextIsActive,
      },
      variables.organizationId ?? null,
    ),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(["project-detail", variables.organizationId, variables.projectKey], data.project);
      refreshProjectQueries(variables.projectKey, variables.organizationId);
      if (activeTargetRef.current.projectKey !== variables.routeProjectKey
        || activeTargetRef.current.organizationId !== variables.organizationId) {
        return;
      }
      form.reset(projectToFormValues(data.project));
      setPendingProductAction(null);
    },
    onError: () => setPendingProductAction(null),
    onSettled: (_data, _error, variables) => {
      releaseProjectAction(variables?.actionId);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (variables: ProjectDeleteVariables) => api.deleteProject(
      variables.projectKey,
      variables.organizationId ?? null,
    ),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.removeQueries({ queryKey: ["project-detail", variables.organizationId, variables.projectKey] });
      if (activeTargetRef.current.projectKey !== variables.routeProjectKey
        || activeTargetRef.current.organizationId !== variables.organizationId) {
        return;
      }
      setPendingProductAction(null);
      form.reset();
      commitAndExitRef.current(() => navigate("/projects", { replace: true }));
    },
    onError: () => setPendingProductAction(null),
    onSettled: (_data, _error, variables) => {
      releaseProjectAction(variables?.actionId);
    },
  });

  const rotateSecretMutation = useMutation({
    mutationFn: (variables: ProjectMutationIdentity & { operation: ProjectSecretOperation }) =>
      api.rotateProjectWidgetSecret(variables.projectKey),
    onMutate: (variables) => {
      if (activeTargetRef.current.projectKey === variables.routeProjectKey
        && activeTargetRef.current.organizationId === variables.organizationId) {
        setWidgetClientSecret(null);
      }
    },
    onSuccess: (data, variables) => {
      refreshProjectQueries(variables.projectKey, variables.organizationId);
      if (activeTargetRef.current.projectKey !== variables.routeProjectKey
        || activeTargetRef.current.organizationId !== variables.organizationId) {
        return;
      }
      setSecretCopied(false);
      setWidgetClientSecret(data.widgetClientSecret);
    },
    onSettled: (_data, _error, variables) => {
      releaseProjectAction(variables?.actionId);
    },
  });

  const engineeringContextMutation = useMutation({
    mutationFn: (variables: ProjectMutationIdentity & { values: EngineeringContextFormValues }) =>
      api.updateProjectEngineeringContext(
        variables.projectKey,
        engineeringContextToPayload(variables.values),
        variables.organizationId ?? null,
      ),
    onSuccess: (data, variables) => {
      refreshEngineeringContext(variables.projectKey, variables.organizationId);
      if (activeTargetRef.current.projectKey !== variables.routeProjectKey
        || activeTargetRef.current.organizationId !== variables.organizationId) {
        return;
      }
      setEngineeringContextValues(engineeringContextToFormValues(data));
      setIsEngineeringContextEditing(false);
    },
    onSettled: (_data, _error, variables) => {
      releaseProjectAction(variables?.actionId);
    },
  });

  useEffect(() => {
    actionMutexRef.current = null;
    mutation.reset();
    rotateSecretMutation.reset();
    engineeringContextMutation.reset();
    if (secretRouteTransferRef.current === projectKey) {
      secretRouteTransferRef.current = null;
    } else {
      setWidgetClientSecret(null);
    }
    setPendingSecretRotation(null);
    setPendingProductAction(null);
    setSecretCopied(false);
    if (isCreateMode || !existingProject) {
      form.reset();
    }
    setIsEditing(isCreateMode);
    setEngineeringContextValues(engineeringContextToFormValues(engineeringContextQuery.data));
    setIsEngineeringContextEditing(false);
  }, [projectKey, organizationId]);

  useEffect(() => {
    if (!widgetClientSecret) {
      return;
    }
    document.getElementById("project-widget-secret-handoff")?.focus();
  }, [widgetClientSecret]);

  const fieldId = (name: string) => `project-${projectKey ?? "new"}-${name}`;
  const currentKey = form.watch("key");
  const currentName = form.watch("name");
  const isActive = form.watch("isActive");
  const defaultEnvironment = form.watch("defaultEnvironment");
  const privacyReadinessValues = form.watch([
    "allowScreenshot",
    "allowPointSelection",
    "allowConsoleCapture",
    "allowClientErrorContext",
    "allowNetworkSummary",
    "privacyUrl",
    "privacyOwnerEmail",
    "retentionDays",
    "attachmentRetentionDays",
    "redactionMode",
    "mcpEvidenceSharing",
    "suppressSelectedText",
  ]);
  const allowedOriginsValue = form.watch("allowedOrigins");
  const hostedFeedbackUrl = !isCreateMode && currentKey
    ? `${DEMO_APP_URL}/?${new URLSearchParams({
        mode: "feedback",
        projectKey: currentKey,
        appName: currentName || existingProject?.name || currentKey,
      }).toString()}`
    : null;
  const clientSecretConfigured = Boolean(existingProject?.clientSecretConfigured) || Boolean(widgetClientSecret);
  const canManageWidgetSecret = clientSecretConfigured ? canRotateWidgetSecret : canGenerateWidgetSecret;
  const projectIssueCount = useMemo(
    () => analyticsQuery.data?.byProject.find((item) => item.projectKey === currentKey)?.count ?? 0,
    [analyticsQuery.data, currentKey],
  );
  
  const isDirty = form.formState.isDirty;
  const notificationBranding: NotificationBrandingPreview = {
    brandName: form.watch("brandName") || form.watch("requesterEmailProductName") || currentName || "TraceGenie",
    logoUrl: form.watch("logoUrl") || "",
    primaryColor: form.watch("primaryColor") || "#2563eb",
    accentColor: form.watch("accentColor") || "#344760",
    emailFooterText: form.watch("emailFooterText") || "",
  };
  const privacyReadinessConfig = widgetProjectConfigSchema.safeParse({
    ...widgetConfig,
    allowScreenshot: privacyReadinessValues[0],
    allowFileAttachments: form.watch("allowFileAttachments"),
    allowPointSelection: privacyReadinessValues[1],
    allowConsoleCapture: privacyReadinessValues[2],
    allowClientErrorContext: privacyReadinessValues[3],
    allowNetworkSummary: privacyReadinessValues[4],
    privacy: {
      ...widgetConfig.privacy,
      privacyUrl: privacyReadinessValues[5],
      privacyOwnerEmail: privacyReadinessValues[6],
      retentionDays: daysToNumberOrNull(privacyReadinessValues[7]),
      attachmentRetentionDays: daysToNumberOrNull(privacyReadinessValues[8]),
      redactionMode: privacyReadinessValues[9],
      mcpEvidenceSharing: privacyReadinessValues[10],
      suppressSelectedText: privacyReadinessValues[11],
    },
  });
  const privacyReadinessBlockers = privacyReadinessConfig.success
    ? getProductionPrivacyReadiness(privacyReadinessConfig.data)
    : [];
  const isProductionTarget = defaultEnvironment.trim().toLowerCase() === "production";
  const requiresPrivacyReadiness = !isCreateMode
    && isActive
    && isProductionTarget
    && (!existingProject?.isActive || existingProject.defaultEnvironment.trim().toLowerCase() !== "production");
  const activationBlocked = requiresPrivacyReadiness && privacyReadinessBlockers.length > 0;

  useEffect(() => {
    if (activeSection !== "privacy" || !focusPrivacyReadinessRef.current) return;
    focusPrivacyReadinessRef.current = false;
    document.getElementById("project-privacy-readiness")?.focus();
  }, [activeSection, projectQuery.isLoading]);

  useEffect(() => {
    const currentSection = document.getElementById(`project-section-${activeSection}`);
    const navigationTrack = currentSection?.parentElement;
    if (!currentSection || !navigationTrack || typeof navigationTrack.scrollTo !== "function") return;
    const frame = window.requestAnimationFrame(() => {
      navigationTrack.scrollTo({
        left: currentSection.offsetLeft - navigationTrack.offsetLeft - ((navigationTrack.clientWidth - currentSection.clientWidth) / 2),
        behavior: "auto",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, projectQuery.isLoading]);

  const resetEngineeringContext = () => {
    setEngineeringContextValues(engineeringContextToFormValues(engineeringContextQuery.data));
    setIsEngineeringContextEditing(false);
  };

  function beginProjectAction() {
    if (actionMutexRef.current !== null) {
      return null;
    }
    const actionId = ++nextActionIdRef.current;
    actionMutexRef.current = actionId;
    return actionId;
  }

  function releaseProjectAction(actionId: number | undefined) {
    if (actionId !== undefined && actionMutexRef.current === actionId) {
      actionMutexRef.current = null;
    }
  }

  function retryProjectAction<TVariables extends ProjectMutationIdentity>(
    mutate: (variables: TVariables) => void,
    variables: TVariables,
  ) {
    if (activeTargetRef.current.projectKey !== variables.routeProjectKey
      || activeTargetRef.current.organizationId !== variables.organizationId) {
      return;
    }
    const actionId = beginProjectAction();
    if (actionId !== null) {
      mutate({ ...variables, actionId });
    }
  }

  function refreshProjectQueries(key: string, targetOrganizationId?: string | null) {
    void Promise.allSettled([
      Promise.resolve().then(() => queryClient.invalidateQueries({ queryKey: ["projects"] })),
      Promise.resolve().then(() => queryClient.invalidateQueries({ queryKey: ["project-detail", targetOrganizationId, key] })),
      Promise.resolve().then(() => queryClient.invalidateQueries({ queryKey: ["project-activation-proof", targetOrganizationId, key] })),
    ]);
  }

  function refreshEngineeringContext(key: string, targetOrganizationId?: string | null) {
    void Promise.allSettled([
      Promise.resolve().then(() => queryClient.invalidateQueries({ queryKey: ["project-engineering-context", targetOrganizationId, key] })),
    ]);
  }

  const queueProjectSave = (values: ProjectFormValues) => {
    if (activationBlocked) {
      if (activeSection === "privacy") {
        document.getElementById("project-privacy-readiness")?.focus();
      } else {
        focusPrivacyReadinessRef.current = true;
        navigateToProjectSection("privacy", true);
      }
      return;
    }
    const actionId = beginProjectAction();
    if (actionId !== null) {
      mutation.mutate({
        actionId,
        routeProjectKey: projectKey ?? null,
        organizationId,
        projectKey: values.key,
        projectName: values.name,
        isCreateMode,
        settingsDestination: !isCreateMode ? settingsDestination : undefined,
        values,
        payload: !isCreateMode && settingsDestination && existingProject
          ? projectFormValuesToSettingsPatch(settingsDestination, values, widgetConfig, existingProject.updatedAt)
          : {
              ...projectFormValuesToPayload(values, widgetConfig),
              ...(organizationId ? { organizationId } : {}),
        },
      });
    }
  };

  const submitCreate = form.handleSubmit(queueProjectSave, (errors) => {
    const firstInvalidField = Object.keys(errors)[0] as keyof ProjectFormInput | undefined;
    const targetSection = firstInvalidField ? PROJECT_FIELD_SECTIONS[firstInvalidField] ?? "overview" : "overview";
    navigateToProjectSection(targetSection, true);
  });

  const submit = () => {
    if (isCreateMode || !settingsDestination) {
      void submitCreate();
      return;
    }

    const parsed = PROJECT_SETTINGS_FORM_SCHEMAS[settingsDestination].safeParse(form.getValues());
    if (!parsed.success) {
      form.clearErrors();
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string") {
          form.setError(field as keyof ProjectFormInput, { message: issue.message });
        }
      }
      const firstField = parsed.error.issues[0]?.path[0];
      if (typeof firstField === "string") {
        form.setFocus(firstField as keyof ProjectFormInput);
      }
      return;
    }

    queueProjectSave({
      ...form.getValues(),
      ...(parsed.data as Partial<ProjectFormValues>),
    } as ProjectFormValues);
  };

  const updateProductStatus = (nextIsActive: boolean) => {
    if (!projectKey || !currentKey || !existingProject || isDirty) return;
    const actionId = beginProjectAction();
    if (actionId === null) return;
    statusMutation.mutate({
      actionId,
      routeProjectKey: projectKey,
      organizationId,
      projectKey: currentKey,
      projectName: currentName || existingProject.name || currentKey,
      nextIsActive,
      expectedUpdatedAt: new Date(existingProject.updatedAt).toISOString(),
    });
  };

  const confirmProductAction = () => {
    if (!pendingProductAction || !projectKey || !existingProject || isDirty) return;
    if (pendingProductAction.kind === "pause") {
      setPendingProductAction(null);
      updateProductStatus(false);
      return;
    }
    const actionId = beginProjectAction();
    if (actionId === null) return;
    deleteMutation.mutate({
      actionId,
      routeProjectKey: projectKey,
      organizationId,
      projectKey: pendingProductAction.projectKey,
      projectName: pendingProductAction.projectName,
    });
  };

  const rotateProjectSecret = () => {
    if (!projectKey || !currentKey) {
      return;
    }
    const projectName = currentName || existingProject?.name || currentKey;
    if (clientSecretConfigured) {
      setPendingSecretRotation({
        routeProjectKey: projectKey,
        organizationId,
        projectKey: currentKey,
        projectName,
      });
      return;
    }
    const actionId = beginProjectAction();
    if (actionId !== null) {
      rotateSecretMutation.mutate({
        actionId,
        routeProjectKey: projectKey,
        organizationId,
        projectKey: currentKey,
        projectName,
        operation: clientSecretConfigured ? "rotate" : "generate",
      });
    }
  };

  const confirmProjectSecretRotation = () => {
    if (!pendingSecretRotation) {
      return;
    }
    const actionId = beginProjectAction();
    if (actionId === null) {
      return;
    }
    const submitted = pendingSecretRotation;
    setPendingSecretRotation(null);
    rotateSecretMutation.mutate({
      ...submitted,
      actionId,
      operation: "rotate",
    });
  };

  const copyWidgetSecret = async () => {
    if (!widgetClientSecret) {
      return;
    }
    try {
      await navigator.clipboard.writeText(widgetClientSecret);
      setSecretCopied(true);
    } catch {
      // Clipboard access may be unavailable outside a secure browser context.
    }
  };

  const acknowledgeWidgetSecret = () => {
    setWidgetClientSecret(null);
    setSecretCopied(false);
    window.setTimeout(() => {
      document.getElementById("project-widget-secret-button")?.focus();
    }, 0);
  };

  const projectMutationBusy = mutation.isPending
    || statusMutation.isPending
    || deleteMutation.isPending
    || rotateSecretMutation.isPending
    || engineeringContextMutation.isPending;
  const resetProjectForm = () => {
    if (existingProject) {
      form.reset(projectToFormValues(existingProject));
    } else {
      form.reset();
    }
    setIsEditing(isCreateMode);
  };
  const savedEngineeringContext = engineeringContextToFormValues(engineeringContextQuery.data);
  const isEngineeringContextDirty = isEngineeringContextEditing
    && Object.keys(EMPTY_ENGINEERING_CONTEXT).some((key) => (
      engineeringContextValues[key as keyof EngineeringContextFormValues]
      !== savedEngineeringContext[key as keyof EngineeringContextFormValues]
    ));
  const { requestExit, commitAndExit } = useAdminFormExitGuard({
    id: `project-form-${projectKey ?? "new"}-${organizationId ?? "none"}`,
    isDirty: isDirty || isEngineeringContextDirty,
    isMutationPending: projectMutationBusy,
    onDiscard: () => {
      resetProjectForm();
      resetEngineeringContext();
    },
  });
  commitAndExitRef.current = commitAndExit;

  const mutationRecoveryEntries = [
    mutationRecoveryEntry(mutation, {
      id: "project-save",
      message: (variables) => `Couldn't ${variables?.isCreateMode ? "create" : "save"} ${variables?.projectName ?? currentName ?? "the product"}.`,
      successMessage: (_data, variables) => variables?.isCreateMode
        ? `${variables.projectName} created.`
        : `${variables?.projectName ?? currentName ?? "Product"} saved.`,
      retryLabel: mutation.variables?.isCreateMode ? "Retry creating product" : "Retry saving product",
      retry: (variables) => retryProjectAction(mutation.mutate, variables),
    }),
    mutationRecoveryEntry(statusMutation, {
      id: "project-status",
      message: (variables) => `Couldn't ${variables?.nextIsActive ? "resume" : "pause"} reports for ${variables?.projectName ?? currentName ?? "this product"}.`,
      successMessage: (_data, variables) => `Reports ${variables?.nextIsActive ? "resumed" : "paused"} for ${variables?.projectName ?? currentName ?? "this product"}.`,
      retryLabel: statusMutation.variables?.nextIsActive ? "Retry resume" : "Retry pause",
      retry: (variables) => retryProjectAction(statusMutation.mutate, variables),
    }),
    mutationRecoveryEntry(deleteMutation, {
      id: "project-delete",
      message: (variables) => `Couldn't delete ${variables?.projectName ?? currentName ?? "this product"}.`,
      successMessage: (_data, variables) => `${variables?.projectName ?? currentName ?? "Product"} deleted.`,
      retryLabel: "Retry deletion",
      retry: (variables) => retryProjectAction(deleteMutation.mutate, variables),
    }),
    mutationRecoveryEntry(rotateSecretMutation, {
      id: "project-widget-secret",
      message: (variables) => `Couldn't ${variables?.operation ?? "change"} the widget secret for ${variables?.projectName || currentName || currentKey || "this product"}.`,
      successMessage: (_data, variables) => `Widget secret ${variables?.operation === "rotate" ? "rotated" : "generated"} for ${variables?.projectName || currentName || currentKey || "this product"}.`,
      retryLabel: rotateSecretMutation.variables?.operation === "rotate" ? "Retry secret rotation" : "Retry secret generation",
      retry: (variables) => retryProjectAction(rotateSecretMutation.mutate, variables),
    }),
    mutationRecoveryEntry(engineeringContextMutation, {
      id: "project-engineering-context",
      message: (variables) => `Couldn't save engineering context for ${variables?.projectName || currentName || currentKey || "this product"}.`,
      successMessage: (_data, variables) => `Engineering context saved for ${variables?.projectName || currentName || currentKey || "this product"}.`,
      retryLabel: "Retry saving engineering context",
      retry: (variables) => retryProjectAction(engineeringContextMutation.mutate, variables),
    }),
  ];

  if (!isCreateMode && projectQuery.isLoading) {
    return <ProjectRouteState kind="loading" projectPath={productBasePath} activeSection={isProductOverviewRoute ? "overview" : "settings"} settingsPage={isProductOverviewRoute ? undefined : activeSectionDefinition} />;
  }

  if (!isCreateMode && projectQuery.isError) {
    return (
      <ProjectRouteState
        kind="error"
        projectPath={productBasePath}
        activeSection={isProductOverviewRoute ? "overview" : "settings"}
        settingsPage={isProductOverviewRoute ? undefined : activeSectionDefinition}
        onRetry={() => void projectQuery.refetch()}
      />
    );
  }

  if (!isCreateMode && projectQuery.isSuccess && !existingProject) {
    return <ProjectRouteState kind="empty" projectPath={productBasePath} activeSection={isProductOverviewRoute ? "overview" : "settings"} settingsPage={isProductOverviewRoute ? undefined : activeSectionDefinition} />;
  }

  if (isProductOverviewRoute && existingProject && activationQuery.isSuccess && !activationQuery.isFetching && productCaptureReadiness(activationQuery.data).captured) {
    const issueSearch = new URLSearchParams(searchParams);
    issueSearch.delete("section");
    issueSearch.set("projectKey", existingProject.key);
    return <Navigate to={{ pathname: "/issues", search: `?${issueSearch.toString()}` }} replace state={location.state} />;
  }

  const settingsEditAction = !isCreateMode && !usesDedicatedEditor ? (
    !isEditing ? (
      <Button id="project-edit-settings-button" type="button" tone="ghost" className="min-h-11 gap-1.5 px-2.5 text-caption" onClick={() => setIsEditing(true)}>
        <Pencil className="size-4" aria-hidden="true" />
        Edit {activeSectionDefinition.label.toLowerCase()}
      </Button>
    ) : (
      <Button id="project-cancel-edit-settings-button" type="button" tone="ghost" className="min-h-11 px-2.5 text-caption" onClick={() => requestExit("cancel", resetProjectForm, resetProjectForm)}>
        Cancel edit
      </Button>
    )
  ) : null;

  return (
    <form
      id="project-form-page"
      className={`space-y-4 ${!isCreateMode && (isDirty || isEngineeringContextDirty) ? "pb-40 md:pb-24" : "pb-4"}`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (isCreateMode) void submit();
      }}
    >
      {isProductOverviewRoute ? (
        <ProductWorkspaceHeader
          id="project-form-header"
          backLinkId="project-back-to-products"
          projectPath={productBasePath}
          projectName={currentName || existingProject?.name || "Product"}
          activeSection="overview"
        />
      ) : !isCreateMode ? (
        <ProductSettingsHeader
          projectPath={productBasePath}
          projectName={currentName || existingProject?.name || "Product"}
          label={activeSectionDefinition.label}
          description={activeSectionDefinition.description}
        />
      ) : (
        <PageHeader back={<PageBackLink id="project-back-to-products" to="/projects">Back to products</PageBackLink>}>
          <section id="project-form-header" className="px-1">
            <h1 className="text-display text-foreground">New product</h1>
            <p className="mt-0.5 max-w-2xl text-body text-muted">
              Create the application record first. Installation and advanced defaults follow after saving.
            </p>
          </section>
        </PageHeader>
      )}

      <MutationRecovery id="project-form-mutation-recovery" entries={mutationRecoveryEntries} />

      {activeSection === "overview" && (isCreateMode || isProductOverviewRoute) ? (
        <ProductActivationRunway
          project={isCreateMode ? null : existingProject ?? null}
          diagnostics={activationQuery.data ?? null}
          team={teamQuery.data ?? null}
          actor={activationActorQuery.data?.data ?? null}
          isLoading={activationQuery.isLoading}
          isError={activationQuery.isError}
          isTeamLoading={activationActorQuery.isLoading || teamQuery.isLoading}
          isTeamError={activationActorQuery.isError || teamQuery.isError}
          onRetry={() => {
            void activationQuery.refetch();
            void activationActorQuery.refetch();
            void teamQuery.refetch();
          }}
          issueCount={projectIssueCount}
        />
      ) : null}

      {activeSection === "privacy" && isProductionTarget ? (
        <section
          id="project-privacy-readiness"
          className={`rounded-xl border px-4 py-4 ${privacyReadinessBlockers.length > 0 ? "border-warning-700/35 bg-warning-50" : "border-success-700/35 bg-success-50"}`}
          tabIndex={-1}
          role={activationBlocked ? "alert" : "status"}
          aria-labelledby="project-privacy-readiness-title"
        >
          <div className="flex items-start gap-3">
            {privacyReadinessBlockers.length > 0 ? (
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning-700" aria-hidden="true" />
            ) : (
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success-700" aria-hidden="true" />
            )}
            <div className="min-w-0">
              <h2 id="project-privacy-readiness-title" className="text-label font-semibold text-foreground">
                {privacyReadinessBlockers.length > 0
                  ? activationBlocked ? "Production activation blocked" : "Production privacy needs attention"
                  : "Production privacy ready"}
              </h2>
              {privacyReadinessBlockers.length > 0 ? (
                <ul className="mt-2 grid gap-1.5 text-caption text-foreground md:grid-cols-2">
                  {privacyReadinessBlockers.map((blocker) => (
                    <li key={blocker.id} className="min-w-0">
                      <strong>{blocker.label}:</strong> {blocker.detail}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-caption text-success-700">Privacy disclosure, retention, redaction, and enabled evidence collectors meet the activation baseline.</p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {!isProductOverviewRoute ? (
      <section id="project-settings-panel" className="relative min-w-0">
        <h2 className="sr-only">{activeSectionDefinition.label} settings</h2>

        {activeSection === "overview" ? (
        <ProjectSettingsSection
          id="project-identity-section"
          action={settingsEditAction}
          title={isCreateMode ? "Product details" : "Identity"}
          body={isCreateMode
            ? "Only the fields needed to create a usable product. Configure installation, evidence, and privacy next."
            : "Product key, display name, environment, and public-facing description."}
        >
          {!isEditing ? (
            <div id="project-identity-readonly" className="mt-3 grid gap-x-10 gap-y-0 lg:grid-cols-2">
              <ReadOnlyItem label="Product key">{projectKey}</ReadOnlyItem>
              <ReadOnlyItem label="Name">{currentName || existingProject?.name || "None"}</ReadOnlyItem>
              <ReadOnlyItem label="Default environment">{form.getValues("defaultEnvironment")}</ReadOnlyItem>
              <ReadOnlyItem label="Description">{form.getValues("description") || "None"}</ReadOnlyItem>
            </div>
          ) : (
            <div id="project-identity-edit-fields" className={isCreateMode ? "mt-4 max-w-2xl space-y-4" : "mt-4 grid gap-4 lg:grid-cols-2"}>
              <div>
                <label htmlFor={fieldId("name")} className="mb-1.5 block text-label font-medium text-foreground">
                  Name
                </label>
                <Input id={fieldId("name")} {...form.register("name")} placeholder="My SaaS app" />
                {form.formState.errors.name ? (
                  <p className="mt-1 text-caption text-danger-700">{form.formState.errors.name.message}</p>
                ) : null}
              </div>
              <div>
                <label htmlFor={fieldId("key")} className="mb-1.5 block text-label font-medium text-foreground">
                  Product key
                </label>
                {isCreateMode ? (
                  <div id="project-key-create-fields">
                    <Input id={fieldId("key")} {...form.register("key")} placeholder="my-saas-app" />
                    {form.formState.errors.key ? (
                      <p className="mt-1 text-caption text-danger-700">{form.formState.errors.key.message}</p>
                    ) : (
                      <p className="mt-1 text-caption text-muted">Lowercase slug. Becomes the widget&apos;s projectKey and cannot change later.</p>
                    )}
                  </div>
                ) : (
                  <p className="flex h-9 items-center font-mono text-label text-foreground">{projectKey}</p>
                )}
              </div>
              {isCreateMode ? (
              <div>
                <label htmlFor={fieldId("emails")} className="mb-1.5 block text-label font-medium text-foreground">
                  Notification emails
                </label>
                <Textarea
                  id={fieldId("emails")}
                  {...form.register("notificationEmails")}
                  className="min-h-20"
                  placeholder="alerts@company.com, oncall@company.com"
                />
                {form.formState.errors.notificationEmails ? (
                  <p className="mt-1 text-caption text-danger-700">{form.formState.errors.notificationEmails.message}</p>
                ) : (
                  <p className="mt-1 text-caption text-muted">The first internal recipients for new feedback. Separate addresses with commas.</p>
                )}
              </div>
              ) : (
                <div id="project-identity-advanced-fields" className="contents">
                  <div>
                    <label htmlFor={fieldId("env")} className="mb-1.5 block text-label font-medium text-foreground">
                      Default environment
                    </label>
                    <Input id={fieldId("env")} {...form.register("defaultEnvironment")} />
                  </div>
                  <div>
                    <label htmlFor={fieldId("desc")} className="mb-1.5 block text-label font-medium text-foreground">
                      Description
                    </label>
                    <Textarea id={fieldId("desc")} {...form.register("description")} className="min-h-20" placeholder="What does this application do?" />
                  </div>
                </div>
              )}
            </div>
          )}
        </ProjectSettingsSection>
        ) : null}

        {activeSection === "overview" && !isCreateMode && existingProject ? (
          <ProjectSettingsSection
            id="project-status-section"
            compact
            title="Product status"
            body="Pause or resume new reports. Existing reports and settings stay intact."
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <Badge tone={isActive ? "primary" : "neutral"}>
                  {isActive ? "Accepting reports" : "Reports paused"}
                </Badge>
                <p className="mt-2 text-caption text-muted">
                  {isActive
                    ? "The widget and hosted report page can accept new submissions."
                    : "New submissions are blocked until reports are resumed."}
                </p>
              </div>
              {isActive ? (
                <Button
                  tone="secondary"
                  className="min-h-11 gap-2"
                  disabled={projectMutationBusy || isDirty}
                  onClick={() => setPendingProductAction({ kind: "pause", projectKey: existingProject.key, projectName: existingProject.name })}
                >
                  <Pause className="size-4" aria-hidden="true" />
                  Pause new reports
                </Button>
              ) : (
                <Button
                  className="min-h-11 gap-2"
                  disabled={projectMutationBusy || isDirty}
                  onClick={() => updateProductStatus(true)}
                >
                  <Play className="size-4" aria-hidden="true" />
                  Resume reports
                </Button>
              )}
            </div>
          </ProjectSettingsSection>
        ) : null}

        {activeSection === "overview" && !isCreateMode && existingProject ? (
          null
        ) : null}

        {activeSection === "install" ? (
          <ProjectSettingsSection
            id="project-allowed-origins-section"
            action={settingsEditAction}
            title="Trusted origins"
            body="Only these application origins can create authenticated widget sessions."
          >
            {!isEditing ? (
              <div id="project-allowed-origins-readonly" className="mt-3">
                <ReadOnlyItem label="Allowed origins">{form.getValues("allowedOrigins") || "None configured"}</ReadOnlyItem>
              </div>
            ) : (
              <div id="project-allowed-origins-edit-fields" className="mt-4">
                <label htmlFor={fieldId("origins")} className="mb-1.5 block text-label font-medium text-foreground">
                  Allowed origins
                </label>
                <Textarea
                  id={fieldId("origins")}
                  {...form.register("allowedOrigins")}
                  className="min-h-24"
                  placeholder="https://app.example.com, https://staging.example.com"
                />
                <p className="mt-1 text-caption text-muted">Comma-separated. Requests from every other origin are rejected.</p>
              </div>
            )}
          </ProjectSettingsSection>
        ) : null}

        {/* ── Widget secret ── */}
        {activeSection === "install" && !isCreateMode && currentKey ? (
          <ProjectSettingsSection
            id="project-widget-secret-card"
            title="Widget secret"
            body="Backend-only credential for authenticated reporter sessions."
          >
            <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
              <div className="min-w-0">
                <dl id="project-widget-secret-status" className="mt-3 grid gap-x-10 gap-y-0 lg:grid-cols-2">
                  <ReadOnlyItem label="Status">{clientSecretConfigured ? "Configured" : "Not generated"}</ReadOnlyItem>
                  <ReadOnlyItem label="Visibility">{widgetClientSecret ? "Shown once below" : "Hidden after generation"}</ReadOnlyItem>
                  <ReadOnlyItem label="Last generated">{formatDateTime(existingProject?.widgetSecretRotatedAt)}</ReadOnlyItem>
                </dl>
              </div>
              {canManageWidgetSecret ? (
                <Button
                  id="project-widget-secret-button"
                  tone="secondary"
                  onClick={rotateProjectSecret}
                  disabled={projectMutationBusy || Boolean(widgetClientSecret)}
                >
                  {rotateSecretMutation.isPending
                    ? clientSecretConfigured ? "Rotating..." : "Generating..."
                    : clientSecretConfigured ? "Rotate secret" : "Generate secret"}
                </Button>
              ) : null}
            </div>

            {widgetClientSecret ? (
              <div
                id="project-widget-secret-handoff"
                tabIndex={-1}
                className="mt-4 rounded-xl border border-border/35 bg-surface-muted/35 p-4"
              >
                <label htmlFor={fieldId("widget-secret")} className="mb-1.5 block text-label font-medium text-foreground">
                  New secret
                </label>
                <Input id={fieldId("widget-secret")} value={widgetClientSecret} readOnly className="font-mono" />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button tone="secondary" onClick={() => void copyWidgetSecret()}>
                    {secretCopied ? <Check className="size-4" aria-hidden="true" /> : <Clipboard className="size-4" aria-hidden="true" />}
                    {secretCopied ? "Copied" : "Copy"}
                  </Button>
                  <Button onClick={acknowledgeWidgetSecret}>
                    <Check className="size-4" aria-hidden="true" />
                    I've stored this secret
                  </Button>
                </div>
                <p className="mt-2 text-caption text-muted">
                  Store this server-only secret before leaving this page. It is shown only once and will be hidden after acknowledgement.
                </p>
              </div>
            ) : (
              <p className="mt-4 text-body text-muted">
                {clientSecretConfigured
                  ? canRotateWidgetSecret
                    ? "Rotate when you need a fresh server-side secret. The current value is never shown after generation."
                    : "The current value remains hidden after generation."
                  : canGenerateWidgetSecret
                    ? "Generate a secret before wiring authenticated reports into production."
                    : "Secret generation is temporarily unavailable."}
              </p>
            )}
          </ProjectSettingsSection>
        ) : null}

        {activeSection === "engineering" && !isCreateMode && currentKey ? (
          null
        ) : null}

        {activeSection === "engineering" && isCreateMode ? (
          null
        ) : null}

        {/* ── Widget appearance ── */}
        {activeSection === "capture" && settingsDestination !== "evidence" ? (
        <ProjectSettingsSection
          id="project-widget-appearance-section"
          title="Widget appearance"
          body="Launcher text, icon, title, placement, and keyboard access."
          action={settingsEditAction}
        >
          {!isEditing ? (
            <div id="project-widget-appearance-readonly" className="mt-3 grid gap-x-10 gap-y-0 lg:grid-cols-2 xl:grid-cols-3">
              <ReadOnlyItem label="Launcher display">{appearanceLabel(form.getValues("launcherPresentation"))}</ReadOnlyItem>
              <ReadOnlyItem label="Launcher icon">{iconLabel(form.getValues("launcherIcon"))}</ReadOnlyItem>
              <ReadOnlyItem label="Launcher label">{form.getValues("launcherLabel")}</ReadOnlyItem>
              <ReadOnlyItem label="Modal title">{form.getValues("modalTitle")}</ReadOnlyItem>
              <ReadOnlyItem label="Position">{positionLabel(form.getValues("launcherPosition"))}</ReadOnlyItem>
              <ReadOnlyItem label="Offset">{`${form.getValues("launcherOffsetX")}px horizontal, ${form.getValues("launcherOffsetY")}px vertical`}</ReadOnlyItem>
              <ReadOnlyItem label="Keyboard shortcut">{form.getValues("keyboardShortcut") || "None"}</ReadOnlyItem>
            </div>
          ) : (
            <div id="project-widget-appearance-edit-fields" className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <div>
              <label htmlFor={fieldId("presentation")} className="mb-1.5 block text-label font-medium text-foreground">
                Launcher display
              </label>
              <Select id={fieldId("presentation")} {...form.register("launcherPresentation")}>
                <option value="icon">Icon only</option>
                <option value="icon-text">Icon and label</option>
                <option value="text">Label only</option>
              </Select>
            </div>
            <div>
              <label htmlFor={fieldId("icon")} className="mb-1.5 block text-label font-medium text-foreground">
                Launcher icon
              </label>
              <Select id={fieldId("icon")} {...form.register("launcherIcon")}>
                <option value="bug">Bug</option>
                <option value="message">Message</option>
              </Select>
            </div>
            <div>
              <label htmlFor={fieldId("label")} className="mb-1.5 block text-label font-medium text-foreground">
                Launcher label
              </label>
              <Input id={fieldId("label")} {...form.register("launcherLabel")} />
            </div>
            <div>
              <label htmlFor={fieldId("modal-title")} className="mb-1.5 block text-label font-medium text-foreground">
                Widget title
              </label>
              <Input id={fieldId("modal-title")} {...form.register("modalTitle")} />
            </div>
            <div>
              <label htmlFor={fieldId("position")} className="mb-1.5 block text-label font-medium text-foreground">
                Position
              </label>
              <Select id={fieldId("position")} {...form.register("launcherPosition")}>
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-left">Bottom left</option>
              </Select>
            </div>
            <div>
              <label htmlFor={fieldId("offset-x")} className="mb-1.5 block text-label font-medium text-foreground">
                Horizontal offset
              </label>
              <Input id={fieldId("offset-x")} type="number" min={0} max={160} {...form.register("launcherOffsetX")} />
            </div>
            <div>
              <label htmlFor={fieldId("offset-y")} className="mb-1.5 block text-label font-medium text-foreground">
                Vertical offset
              </label>
              <Input id={fieldId("offset-y")} type="number" min={0} max={160} {...form.register("launcherOffsetY")} />
            </div>
            <div>
              <label htmlFor={fieldId("shortcut")} className="mb-1.5 block text-label font-medium text-foreground">
                Keyboard shortcut
              </label>
              <Input id={fieldId("shortcut")} {...form.register("keyboardShortcut")} placeholder="mod+shift+b" />
            </div>
          </div>
          )}
        </ProjectSettingsSection>
        ) : null}

        {activeSection === "capture" && settingsDestination !== "evidence" ? (
          <ProjectSettingsSection
            id="project-widget-colors-section"
            title="Brand colors"
            body="These colors are shared by the widget and product emails."
          >
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
                {(["primaryColor", "accentColor"] as const).map((field) => {
                  const label = field === "primaryColor" ? "Primary color" : "Accent color";
                  const value = form.watch(field);
                  return isEditing ? (
                    <ColorField
                      key={field}
                      id={fieldId(field === "primaryColor" ? "primary-color" : "accent-color")}
                      label={label}
                      value={value}
                      inputRef={form.register(field).ref}
                      error={form.formState.errors[field]?.message}
                      onChange={(color) => form.setValue(field, color, { shouldDirty: true, shouldValidate: true })}
                    />
                  ) : (
                    <div key={field}>
                      <p className="text-caption text-muted">{label}</p>
                      <div className="mt-2 flex items-center gap-3">
                        <span aria-hidden="true" className="size-8 shrink-0 rounded-lg border border-border/30 bg-[var(--brand-swatch)]" style={{ "--brand-swatch": value } as CSSProperties} />
                        <span className="font-mono text-label text-foreground">{value}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <WidgetColorPreview
                primaryColor={form.watch("primaryColor")}
                accentColor={form.watch("accentColor")}
                presentation={form.watch("launcherPresentation")}
                icon={form.watch("launcherIcon")}
                label={form.watch("launcherLabel")}
              />
            </div>
          </ProjectSettingsSection>
        ) : null}

        {activeSection === "notifications" ? (
          <ProjectSettingsSection
            id="project-notification-recipients-section"
            action={settingsEditAction}
            title="Alert recipients"
            body="Team addresses that receive a notification when a new issue arrives."
          >
            {!isEditing ? (
              <div id="project-notification-recipients-readonly" className="mt-3 grid gap-x-10 lg:grid-cols-2">
                <ReadOnlyItem label="Notification emails">{form.getValues("notificationEmails") || "None configured"}</ReadOnlyItem>
                <ReadOnlyItem label="Reporter email product name">
                  {form.getValues("requesterEmailProductName") || currentName || existingProject?.name || "None"}
                </ReadOnlyItem>
              </div>
            ) : (
              <div id="project-notification-recipients-edit-fields" className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <label htmlFor={fieldId("emails")} className="mb-1.5 block text-label font-medium text-foreground">
                    Notification emails
                  </label>
                  <Textarea
                    id={fieldId("emails")}
                    {...form.register("notificationEmails")}
                    className="min-h-24"
                    placeholder="alerts@company.com, oncall@company.com"
                  />
                  {form.formState.errors.notificationEmails ? (
                    <p className="mt-1 text-caption text-danger-700">{form.formState.errors.notificationEmails.message}</p>
                  ) : (
                    <p className="mt-1 text-caption text-muted">Comma-separated. Existing delivery behavior is unchanged.</p>
                  )}
                </div>
                <div>
                  <label htmlFor={fieldId("requester-product-name")} className="mb-1.5 block text-label font-medium text-foreground">
                    Reporter email product name
                  </label>
                  <Input
                    id={fieldId("requester-product-name")}
                    {...form.register("requesterEmailProductName")}
                    placeholder="My SaaS app"
                  />
                  <p className="mt-1 text-caption text-muted">Shown in reporter email updates and ticket notifications.</p>
                </div>
              </div>
            )}
          </ProjectSettingsSection>
        ) : null}

        {activeSection === "notifications" ? (
        <ProjectSettingsSection
          id="project-notification-branding-section"
          title="Branding"
          body="Widget colors and branding reporters see in product emails."
        >
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            {!isEditing ? (
              <div id="project-notification-branding-readonly" className="grid gap-x-10 gap-y-0 lg:grid-cols-2">
                <ReadOnlyItem label="Brand name">
                  {form.getValues("brandName") || form.getValues("requesterEmailProductName") || currentName || "TraceGenie"}
                </ReadOnlyItem>
                <ReadOnlyItem label="Logo URL">{form.getValues("logoUrl") || "None"}</ReadOnlyItem>
                <ReadOnlyItem label="Primary color">{form.getValues("primaryColor")}</ReadOnlyItem>
                <ReadOnlyItem label="Accent color">{form.getValues("accentColor")}</ReadOnlyItem>
                <ReadOnlyItem label="Email footer">{form.getValues("emailFooterText") || "Default TraceGenie footer"}</ReadOnlyItem>
              </div>
            ) : (
              <div id="project-notification-branding-edit-fields" className="grid gap-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <label htmlFor={fieldId("brand-name")} className="mb-1.5 block text-label font-medium text-foreground">
                      Brand name
                    </label>
                    <Input id={fieldId("brand-name")} {...form.register("brandName")} placeholder="Acme Support" />
                    {form.formState.errors.brandName ? (
                      <p className="mt-1 text-caption text-danger-700">{form.formState.errors.brandName.message}</p>
                    ) : null}
                  </div>
                  <div>
                    <label htmlFor={fieldId("logo-url")} className="mb-1.5 block text-label font-medium text-foreground">
                      Logo URL
                    </label>
                    <Input id={fieldId("logo-url")} {...form.register("logoUrl")} placeholder="https://example.com/logo.png" />
                    {form.formState.errors.logoUrl ? (
                      <p className="mt-1 text-caption text-danger-700">{form.formState.errors.logoUrl.message}</p>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <ColorField
                    id={fieldId("primary-color")}
                    label="Primary color"
                    value={form.watch("primaryColor")}
                    inputRef={form.register("primaryColor").ref}
                    error={form.formState.errors.primaryColor?.message}
                    onChange={(value) => form.setValue("primaryColor", value, { shouldDirty: true, shouldValidate: true })}
                  />
                  <ColorField
                    id={fieldId("accent-color")}
                    label="Accent color"
                    value={form.watch("accentColor")}
                    inputRef={form.register("accentColor").ref}
                    error={form.formState.errors.accentColor?.message}
                    onChange={(value) => form.setValue("accentColor", value, { shouldDirty: true, shouldValidate: true })}
                  />
                </div>
                <div>
                  <label htmlFor={fieldId("email-footer")} className="mb-1.5 block text-label font-medium text-foreground">
                    Email footer
                  </label>
                  <Textarea id={fieldId("email-footer")} {...form.register("emailFooterText")} className="min-h-24" />
                  {form.formState.errors.emailFooterText ? (
                    <p className="mt-1 text-caption text-danger-700">{form.formState.errors.emailFooterText.message}</p>
                  ) : null}
                </div>
              </div>
            )}
            <BrandPreview branding={notificationBranding} />
          </div>
        </ProjectSettingsSection>
        ) : null}

        {activeSection === "surveys" ? (
          projectKey ? null : <div id="product-surveys-create-required" className="rounded-lg border border-border/45 bg-surface px-4 py-5 text-body text-muted">Create the product before adding survey campaigns.</div>
        ) : null}

        {/* ── Capture settings ── */}
        {activeSection === "capture" && settingsDestination !== "widget" ? (
        <ProjectSettingsSection
          id="project-capture-settings-section"
          action={settingsDestination === "evidence" ? settingsEditAction : null}
          title="Capture settings"
          body="Control which evidence reporters can attach to each issue."
        >
          {!isEditing ? (
            <div id="project-capture-settings-readonly" className="mt-3 grid gap-x-10 gap-y-0 lg:grid-cols-2">
              {CAPTURE_FIELDS.map(([field, label]) => (
                <ReadOnlyItem key={field} label={label}>{field === "autoCaptureScreenshot" && !form.getValues("allowScreenshot") ? "Off — screenshots disabled" : form.getValues(field) ? "Enabled" : "Disabled"}</ReadOnlyItem>
              ))}
            </div>
          ) : (
          <div id="project-capture-settings-edit-fields" className="mt-4 space-y-2">
            {CAPTURE_FIELDS.map(([field, label, description]) => (
              <label
                key={field}
                htmlFor={fieldId(field)}
                className="flex cursor-pointer items-center justify-between gap-4 rounded-xl bg-surface-muted/40 px-4 py-3 transition-colors hover:bg-surface-muted/70"
              >
                <span className="min-w-0">
                  <span className="block text-label font-medium text-foreground">{label}</span>
                  <span className="mt-0.5 block text-caption leading-relaxed text-muted">{description}</span>
                </span>
                <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                  <input id={fieldId(field)} type="checkbox" className="peer sr-only" disabled={field === "autoCaptureScreenshot" && !privacyReadinessValues[0]} {...form.register(field)} />
                  <span className="absolute inset-0 rounded-full bg-border transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary" />
                  <span className="relative ml-0.5 size-5 rounded-full bg-surface shadow-panel transition-transform peer-checked:translate-x-5" />
                </span>
              </label>
            ))}
          </div>
          )}
        </ProjectSettingsSection>
        ) : null}

        {activeSection === "privacy" ? (
        <ProjectSettingsSection
          id="project-privacy-controls-section"
          action={settingsEditAction}
          title="Privacy controls"
          body="Set evidence retention, disclosure, and redaction."
        >
          {!isEditing ? (
            <div id="project-privacy-controls-readonly" className="mt-3 grid gap-x-10 gap-y-0 lg:grid-cols-2 xl:grid-cols-3">
              <ReadOnlyItem label="Privacy owner">{form.getValues("privacyOwnerEmail") || "None"}</ReadOnlyItem>
              <ReadOnlyItem label="Privacy link">{form.getValues("privacyUrl") || "None"}</ReadOnlyItem>
              <ReadOnlyItem label="Issue retention">{formatRetentionDays(form.getValues("retentionDays"))}</ReadOnlyItem>
              <ReadOnlyItem label="Attachment retention">{formatRetentionDays(form.getValues("attachmentRetentionDays"))}</ReadOnlyItem>
              <ReadOnlyItem label="Redaction policy">{REDACTION_MODE_LABELS[form.getValues("redactionMode")]}</ReadOnlyItem>
              
              <ReadOnlyItem label="Selected text">{form.getValues("suppressSelectedText") ? "Suppressed" : "Allowed"}</ReadOnlyItem>
              <ReadOnlyItem label="Custom redaction">{customRedactionTermsSummary(form.getValues("customRedactionTerms"))}</ReadOnlyItem>
            </div>
          ) : (
            <div id="project-privacy-controls-edit-fields" className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="lg:col-span-2">
                <label htmlFor={fieldId("privacy-owner-email")} className="mb-1.5 block text-label font-medium text-foreground">
                  Privacy owner email
                </label>
                <Input
                  id={fieldId("privacy-owner-email")}
                  type="email"
                  autoComplete="email"
                  {...form.register("privacyOwnerEmail")}
                  placeholder="privacy@example.com"
                />
                {form.formState.errors.privacyOwnerEmail ? (
                  <p className="mt-1 text-caption text-danger-700">{form.formState.errors.privacyOwnerEmail.message}</p>
                ) : (
                  <p className="mt-1 text-caption text-muted">Internal owner for evidence policy and deletion decisions. Never exposed to reporters.</p>
                )}
              </div>
              <div className="lg:col-span-2">
                <label htmlFor={fieldId("privacy-url")} className="mb-1.5 block text-label font-medium text-foreground">
                  Privacy link
                </label>
                <Input
                  id={fieldId("privacy-url")}
                  {...form.register("privacyUrl")}
                  placeholder="https://example.com/privacy"
                />
                {form.formState.errors.privacyUrl ? (
                  <p className="mt-1 text-caption text-danger-700">{form.formState.errors.privacyUrl.message}</p>
                ) : (
                  <p className="mt-1 text-caption text-muted">Shown as a compact link in the widget footer.</p>
                )}
              </div>
              <div>
                <label htmlFor={fieldId("retention-days")} className="mb-1.5 block text-label font-medium text-foreground">
                  Issue retention days
                </label>
                <Input
                  id={fieldId("retention-days")}
                  {...form.register("retentionDays")}
                  inputMode="numeric"
                  placeholder="Leave blank for no automatic expiry"
                />
                {form.formState.errors.retentionDays ? (
                  <p className="mt-1 text-caption text-danger-700">{form.formState.errors.retentionDays.message}</p>
                ) : null}
              </div>
              <div>
                <label htmlFor={fieldId("attachment-retention-days")} className="mb-1.5 block text-label font-medium text-foreground">
                  Attachment retention days
                </label>
                <Input
                  id={fieldId("attachment-retention-days")}
                  {...form.register("attachmentRetentionDays")}
                  inputMode="numeric"
                  placeholder="Leave blank for no automatic expiry"
                />
                {form.formState.errors.attachmentRetentionDays ? (
                  <p className="mt-1 text-caption text-danger-700">{form.formState.errors.attachmentRetentionDays.message}</p>
                ) : null}
              </div>
              <div>
                <label htmlFor={fieldId("redaction-mode")} className="mb-1.5 block text-label font-medium text-foreground">
                  Redaction policy
                </label>
                <Select id={fieldId("redaction-mode")} {...form.register("redactionMode")}>
                  <option value="standard">Standard</option>
                  <option value="technical_metadata">Technical metadata</option>
                  <option value="strict">Strict</option>
                </Select>
              </div>
              
              <label id="project-suppress-selected-text-field" className="flex items-start gap-3 rounded-xl border border-border/35 bg-surface-muted/25 px-4 py-3">
                <input
                  id={fieldId("suppress-selected-text")}
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  {...form.register("suppressSelectedText")}
                />
                <span>
                  <span className="block text-label font-medium text-foreground">Suppress selected text</span>
                  <span className="mt-0.5 block text-caption text-muted">Drop user-selected text suggestions from widget submissions and server-side intake.</span>
                </span>
              </label>
              <div className="lg:col-span-2">
                <label htmlFor={fieldId("custom-redaction-terms")} className="mb-1.5 block text-label font-medium text-foreground">
                  Custom redaction terms
                </label>
                <Textarea
                  id={fieldId("custom-redaction-terms")}
                  {...form.register("customRedactionTerms")}
                  className="min-h-24"
                  placeholder="One exact term per line"
                />
                {form.formState.errors.customRedactionTerms ? (
                  <p className="mt-1 text-caption text-danger-700">{form.formState.errors.customRedactionTerms.message}</p>
                ) : (
                  <p className="mt-1 text-caption text-muted">Server-side intake redacts these terms before storing reports; they are not sent to the public widget config.</p>
                )}
              </div>
            </div>
          )}
        </ProjectSettingsSection>
        ) : null}
      </section>
      ) : null}

      {/* ── Embed snippet ── */}
      {activeSection === "install" && !isCreateMode && currentKey ? (
        <WidgetSnippet
          projectKey={currentKey}
          appName={currentName || existingProject?.name || ""}
          allowedOrigins={splitCommaList(allowedOriginsValue)}
          hostedFeedbackUrl={hostedFeedbackUrl}
          organizationId={organizationId}
          onDiagnosticsChange={(diagnostics) => {
            queryClient.setQueryData(["project-activation-proof", organizationId, currentKey], diagnostics);
          }}
        />
      ) : null}

      {isCreateMode ? (
        <section id="project-create-actions" className="flex flex-col gap-3 border-t border-border/30 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-label text-muted">Create the product, then continue with installation.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="min-h-11" tone="secondary" onClick={() => navigate("/projects")} disabled={projectMutationBusy}>
              {copy.common.cancel}
            </Button>
            <Button className="min-h-11" type="submit" disabled={projectMutationBusy}>
              {projectMutationBusy ? "Saving..." : "Create product"}
            </Button>
          </div>
        </section>
      ) : null}

      <CommitBar
        id="project-form-commit-bar"
        isVisible={!isCreateMode && isDirty}
        isPending={projectMutationBusy}
        status="Unsaved changes"
        discardLabel="Discard"
        onDiscard={resetProjectForm}
        onSave={() => void submit()}
        saveLabel="Save changes"
        savingLabel="Saving..."
      />

      <ConfirmDialog
        isOpen={pendingProductAction?.kind === "pause"}
        title={`Pause reports for ${pendingProductAction?.projectName ?? "this product"}?`}
        description="The widget and hosted report page will stop accepting new submissions. Existing reports, settings, and integrations stay intact."
        confirmText="Pause reports"
        confirmTone="danger"
        isPending={projectMutationBusy}
        onCancel={() => setPendingProductAction(null)}
        onConfirm={confirmProductAction}
      />

      <ConfirmDialog
        isOpen={pendingProductAction?.kind === "delete"}
        title={`Delete ${pendingProductAction?.projectName ?? "this product"}?`}
        description="This permanently removes the unused product, its setup, access assignments, and integration scopes. It cannot be undone."
        confirmText="Delete product"
        confirmTone="danger"
        isPending={projectMutationBusy}
        onCancel={() => setPendingProductAction(null)}
        onConfirm={confirmProductAction}
      />

      <ConfirmDialog
        isOpen={pendingSecretRotation !== null}
        title={`Rotate widget secret for ${pendingSecretRotation?.projectName ?? "this product"}?`}
        description={`${existingProject?.organization?.name ?? "Current organization"} / ${pendingSecretRotation?.projectName ?? "this product"}. The old secret stops working immediately. Update your server-side secret with the new value after rotation.`}
        confirmText="Rotate secret"
        confirmTone="danger"
        isPending={projectMutationBusy}
        onCancel={() => setPendingSecretRotation(null)}
        onConfirm={confirmProjectSecretRotation}
      />

    </form>
  );
}

function ProjectRouteState({
  kind,
  projectPath,
  activeSection,
  settingsPage,
  onRetry,
}: {
  kind: "loading" | "error" | "empty";
  projectPath: string;
  activeSection: "overview" | "settings";
  settingsPage?: { label: string; description: string };
  onRetry?: () => void;
}) {
  const header = settingsPage ? (
    <ProductSettingsHeader projectPath={projectPath} {...settingsPage} />
  ) : (
    <ProductWorkspaceHeader projectPath={projectPath} activeSection={activeSection} loading={kind === "loading"} />
  );
  if (kind === "loading") {
    return (
      <div id="project-detail-loading" className="space-y-4" role="status" aria-label="Loading product settings">
        {header}
        <div className="h-20 animate-pulse rounded-xl bg-surface-muted/45" />
        <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="h-36 animate-pulse bg-surface-muted/45" />
          <div className="h-72 animate-pulse rounded-xl bg-surface-muted/45" />
        </div>
        <span className="sr-only">Loading product settings</span>
      </div>
    );
  }

  const isError = kind === "error";
  const StateHeading = settingsPage ? "h2" : "h1";
  return (
    <div id={`project-detail-${kind}`} className="space-y-5">
      {header}
      <section
        className="tg-settings-section flex min-h-72 flex-col items-center justify-center px-5 py-12 text-center"
        role={isError ? "alert" : "status"}
      >
        <Inbox className="size-8 text-muted" aria-hidden="true" />
        <StateHeading className="mt-4 text-title text-foreground">{isError ? "Couldn't load this product" : "Product not found"}</StateHeading>
        <p className="mt-2 max-w-md text-body text-muted">
          {isError
            ? "The saved configuration is still intact. Retry the request or return to the product list."
            : "This product may have been removed or may not belong to the current organization."}
        </p>
        {isError && onRetry ? (
          <Button className="mt-5" onClick={onRetry}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry
          </Button>
        ) : null}
      </section>
    </div>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
  inputRef,
  error,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  error?: string;
}) {
  return (
    <div id={`${id}-field`}>
      <label htmlFor={id} className="mb-1.5 block text-label font-medium text-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          aria-label={`Choose ${label.toLowerCase()}`}
          type="color"
          value={validPreviewColor(value, "#2563eb")}
          onChange={(event) => onChange(event.target.value)}
          className="size-11 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
        <input
          id={id}
          ref={inputRef}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          autoComplete="off"
          spellCheck={false}
          className="tg-soft-input min-h-11 min-w-0 w-full rounded-lg border px-3 font-mono text-body text-foreground outline-none focus:border-primary focus:ring-3 focus:ring-primary/15"
        />
      </div>
      {error ? <p id={`${id}-error`} className="mt-1 text-caption text-danger-700">{error}</p> : null}
    </div>
  );
}

function validPreviewColor(value: string | undefined, fallback: string) {
  return value && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : fallback;
}

function WidgetColorPreview({ primaryColor, accentColor, presentation, icon, label }: {
  primaryColor: string;
  accentColor: string;
  presentation: ProjectFormValues["launcherPresentation"];
  icon: ProjectFormValues["launcherIcon"];
  label: string;
}) {
  const primary = validPreviewColor(primaryColor, "#2563eb");
  const accent = validPreviewColor(accentColor, "#344760");
  // Match the widget's black/white foreground selection for custom launcher colors.
  const luminance = [1, 3, 5]
    .map((offset) => parseInt(primary.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
  const foreground = 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? "#ffffff" : "#000000";
  const LauncherIcon = icon === "message" ? MessageSquare : Bug;

  return (
    <aside
      aria-label="Widget color preview"
      className="min-w-0 rounded-xl bg-surface-muted/60 p-4"
      style={{ "--brand-primary": primary, "--brand-accent": accent, "--brand-foreground": foreground } as CSSProperties}
    >
      <p className="text-caption font-medium text-muted">Color preview</p>
      <div className="mt-4 rounded-lg border-2 border-dashed border-[var(--brand-accent)] bg-surface p-4">
        <p className="text-label font-medium text-foreground">Evidence highlight</p>
        <p className="mt-1 text-caption text-muted">Your accent color marks a selection.</p>
      </div>
      <div className="mt-5 flex justify-end">
        <span
          role="img"
          aria-label="Launcher color preview"
          className="tg-widget-color-launcher inline-flex min-h-11 max-w-full items-center gap-2 rounded-full px-4 py-3 text-label font-semibold shadow-panel"
        >
          {presentation !== "text" ? <LauncherIcon aria-hidden="true" className="size-5 shrink-0" /> : null}
          {presentation !== "icon" ? <span className="break-words [overflow-wrap:anywhere]">{label || "Report a Bug"}</span> : null}
        </span>
      </div>
    </aside>
  );
}

function BrandPreview({ branding }: { branding: NotificationBrandingPreview }) {
  const brandName = branding.brandName || "TraceGenie";
  const primaryColor = branding.primaryColor || "#2563eb";
  const accentColor = branding.accentColor || "#344760";

  return (
    <aside id="project-notification-branding-preview" className="tg-mobile-card rounded-2xl border border-border/35 bg-surface p-4">
      <p className="text-caption font-medium text-muted">Preview</p>
      <div className="mt-3 overflow-hidden rounded-2xl border border-border/35 bg-surface">
        <div className="h-1.5 transition-colors duration-200" style={{ backgroundColor: primaryColor }} />
        <div className="p-4">
          <div className="flex items-center gap-3">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="" className="size-9 rounded-lg object-contain" />
            ) : (
              <div
                className="flex size-9 shrink-0 items-center justify-center rounded-xl text-label font-semibold text-white"
                style={{ backgroundColor: primaryColor }}
              >
                {brandName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-label font-semibold text-foreground">{brandName}</p>
              <p className="text-caption text-muted">Issue received</p>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-border/35 bg-surface-muted/35 p-3">
            <p className="text-label font-semibold text-foreground">Thanks for the report.</p>
            <p className="mt-1 text-caption text-muted">Your request has been shared with the support team.</p>
          </div>
          <div className="mt-4 inline-flex rounded-full px-3 py-2 text-label font-semibold text-white transition-colors duration-200" style={{ backgroundColor: accentColor }}>
            View request
          </div>
          <p className="mt-4 border-t border-border/30 pt-3 text-caption text-muted">
            {branding.emailFooterText || "Default TraceGenie footer"}
          </p>
        </div>
      </div>
    </aside>
  );
}

function splitCommaList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "Not tracked yet";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not tracked yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ProjectSettingsSection({
  id,
  title,
  body,
  children,
  action,
  compact = false,
}: {
  id: string;
  title: string;
  body: string;
  children: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      id={id}
      className={`tg-settings-section grid gap-4 px-5 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8 ${compact ? "py-4 lg:items-center" : "py-5"}`}
    >
      <div className="max-w-sm">
        <h3 className="text-title text-foreground">{title}</h3>
        <p className="mt-1 text-caption leading-relaxed text-muted">{body}</p>
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ReadOnlyItem({ label, children }: { label: string; children: string | number | null | undefined }) {
  return (
    <div className="min-w-0 py-3">
      <p className="text-caption text-muted">{label}</p>
      <p className="mt-1 min-w-0 break-words text-label font-medium text-foreground">{children || "None"}</p>
    </div>
  );
}

function appearanceLabel(value: string) {
  if (value === "icon-text") return "Icon and label";
  if (value === "text") return "Label only";
  return "Icon only";
}

function iconLabel(value: string) {
  return value === "message" ? "Message" : "Bug";
}

function positionLabel(value: string) {
  return value === "bottom-left" ? "Bottom left" : "Bottom right";
}






