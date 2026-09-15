import { z } from "zod";

import { MCP_EXTERNAL_FEEDBACK_STATUSES } from "../constants/mcp";
import {
  browserMetadataSchema,
  clientErrorContextSchema,
  consoleEntrySchema,
  feedbackRecipientTypeSchema,
  feedbackStatusSchema,
  issueTypeSchema,
  labelSchema,
  releaseMetadataSchema,
  routeMetadataSchema,
  severitySchema,
  userIdentitySchema,
} from "./common";
import { pointSelectionSchema } from "../utils/pointSelection";

export const projectKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{1,63}$/, "Project key must use lowercase slug format (letters, numbers, hyphens).");

export const entityIdSchema = z.string().trim().cuid();

// Feedback records created before CUID enforcement can use stable slug IDs.
// Keep this compatibility scoped to feedback references; every other entity
// continues to require a CUID.
export const feedbackIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const dateOnlySchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.");
export const feedbackSurveyTypeSchema = z.enum([
  "nps",
  "csat",
  "ces",
  "feature_satisfaction",
  "beta_feedback",
  "churn_reason",
  "abandonment",
]);

export const widgetFieldConfigSchema = z.object({
  enabled: z.boolean().default(true),
  required: z.boolean().default(false),
  label: z.string().trim().max(100).optional(),
  placeholder: z.string().trim().max(255).optional(),
});

export const launcherPresentationSchema = z.enum(["icon", "icon-text", "text"]);

export const widgetAppearanceSchema = z.object({
  launcherLabel: z.string().trim().max(40).default("Report a Bug"),
  /** How the floating launcher is shown: bug icon only, icon + label, or label only. */
  launcherPresentation: launcherPresentationSchema.default("icon-text"),
  launcherIcon: z.enum(["bug", "message"]).default("bug"),
  launcherPosition: z.enum(["bottom-right", "bottom-left"]).default("bottom-right"),
  launcherOffsetX: z.number().int().min(0).max(160).default(24),
  launcherOffsetY: z.number().int().min(0).max(160).default(24),
  modalTitle: z.string().trim().max(120).default("Report a product issue"),
  compactMode: z.boolean().default(false),
  accentMode: z.enum(["green", "neutral"]).default("green"),
  keyboardShortcut: z.string().trim().max(40).optional(),
});

export const widgetNotificationBrandingSchema = z.object({
  brandName: z.string().trim().max(120).optional(),
  logoUrl: z.string().trim().url().or(z.literal("")).optional(),
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).default("#2563eb"),
  accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).default("#344760"),
  emailFooterText: z.string().trim().max(500).optional(),
});

export const widgetSurveyPromptSchema = z.object({
  enabled: z.boolean().default(false),
  type: feedbackSurveyTypeSchema.default("csat"),
  question: z.string().trim().min(1).max(160).default("How was this experience?"),
});

export const widgetReporterIdentityConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    collectName: z.boolean().default(true),
    collectEmail: z.boolean().default(true),
    consentLabel: z.string().trim().min(1).max(240).default("I agree to share these contact details for updates about this report."),
    responseExpectation: z.string().trim().min(1).max(240).default("The team will follow up when there is an update."),
  })
  .refine((value) => !value.enabled || value.collectName || value.collectEmail, {
    message: "Enable at least one reporter identity field.",
  });

export const widgetPrivacyConfigSchema = z.object({
  // Omitted values may belong to legacy products; safer create defaults live in the Product form.
  privacyOwnerEmail: z.string().trim().email().or(z.literal("")).default(""),
  privacyUrl: z.string().trim().url().or(z.literal("")).default(""),
  retentionDays: z.number().int().min(30).max(3650).nullable().default(null),
  attachmentRetentionDays: z.number().int().min(1).max(3650).nullable().default(null),
  redactionMode: z.enum(["standard", "technical_metadata", "strict"]).default("standard"),
  mcpEvidenceSharing: z.enum(["raw_allowed", "metadata_only"]).default("raw_allowed"),
  suppressSelectedText: z.boolean().default(false),
  customRedactionTerms: z.array(z.string().trim().min(1).max(80).refine((value) => !/[\r\n]/.test(value))).max(20).default([]),
});

export const widgetProjectConfigSchema = z.object({
  allowScreenshot: z.boolean().default(true),
  autoCaptureScreenshot: z.boolean().default(true),
  allowFileAttachments: z.boolean().default(true),
  allowPointSelection: z.boolean().default(false),
  allowConsoleCapture: z.boolean().default(false),
  allowClientErrorContext: z.boolean().default(false),
  allowNetworkSummary: z.boolean().default(false),
  maxConsoleEntries: z.number().int().min(0).max(100).default(20),
  maxNetworkEntries: z.number().int().min(0).max(100).default(20),
  defaultLabels: z.array(labelSchema).default([]),
  appearance: widgetAppearanceSchema.default(() => widgetAppearanceSchema.parse({})),
  notificationBranding: widgetNotificationBrandingSchema.default(() => widgetNotificationBrandingSchema.parse({})),
  surveyPrompt: widgetSurveyPromptSchema.default(() => widgetSurveyPromptSchema.parse({})),
  reporterIdentity: widgetReporterIdentityConfigSchema.default(() => widgetReporterIdentityConfigSchema.parse({})),
  privacy: widgetPrivacyConfigSchema.default(() => widgetPrivacyConfigSchema.parse({})),
  fields: z
    .object({
      title: widgetFieldConfigSchema.default({ enabled: true, required: true }),
      description: widgetFieldConfigSchema.default({ enabled: true, required: true }),
      issueType: widgetFieldConfigSchema.default({ enabled: true, required: true }),
      severity: widgetFieldConfigSchema.default({ enabled: true, required: true }),
      stepsToReproduce: widgetFieldConfigSchema.default({ enabled: true, required: false }),
      expectedResult: widgetFieldConfigSchema.default({ enabled: true, required: false }),
      actualResult: widgetFieldConfigSchema.default({ enabled: true, required: false }),
    })
    .default(() => ({
      title: widgetFieldConfigSchema.parse({ enabled: true, required: true }),
      description: widgetFieldConfigSchema.parse({ enabled: true, required: true }),
      issueType: widgetFieldConfigSchema.parse({ enabled: true, required: true }),
      severity: widgetFieldConfigSchema.parse({ enabled: true, required: true }),
      stepsToReproduce: widgetFieldConfigSchema.parse({ enabled: true, required: false }),
      expectedResult: widgetFieldConfigSchema.parse({ enabled: true, required: false }),
      actualResult: widgetFieldConfigSchema.parse({ enabled: true, required: false }),
    })),
});

export type WidgetProjectConfig = z.infer<typeof widgetProjectConfigSchema>;
export type LauncherPresentation = z.infer<typeof launcherPresentationSchema>;

export type ProductionPrivacyReadinessBlocker = {
  id: "privacy_owner" | "privacy_url" | "issue_retention" | "attachment_retention" | "collector_redaction" | "selected_text" | "mcp_evidence";
  label: string;
  detail: string;
};

export function getProductionPrivacyReadiness(config: WidgetProjectConfig): ProductionPrivacyReadinessBlocker[] {
  const blockers: ProductionPrivacyReadinessBlocker[] = [];
  const enabledCollectors = [
    config.allowScreenshot ? "screenshots" : null,
    config.allowPointSelection ? "point selection" : null,
    config.allowConsoleCapture ? "console logs" : null,
    config.allowClientErrorContext ? "client errors" : null,
    config.allowNetworkSummary ? "network summaries" : null,
  ].filter((value): value is string => Boolean(value));

  if (!config.privacy.privacyOwnerEmail) {
    blockers.push({ id: "privacy_owner", label: "Privacy owner", detail: "Assign the email address responsible for this product's evidence policy." });
  }
  if (!config.privacy.privacyUrl) {
    blockers.push({ id: "privacy_url", label: "Privacy link", detail: "Add the public privacy policy reporters see before sending." });
  }
  if (config.privacy.retentionDays === null) {
    blockers.push({ id: "issue_retention", label: "Issue retention", detail: "Set an automatic issue-retention period." });
  }
  if ((config.allowScreenshot || config.allowFileAttachments) && config.privacy.attachmentRetentionDays === null) {
    blockers.push({ id: "attachment_retention", label: "Attachment retention", detail: "Set an automatic expiry for screenshots and attached files." });
  }
  if (enabledCollectors.length > 0 && config.privacy.redactionMode === "standard") {
    blockers.push({
      id: "collector_redaction",
      label: "Collector redaction",
      detail: `Use Technical metadata or Strict redaction for enabled ${enabledCollectors.join(", ")}.`,
    });
  }
  if (config.allowPointSelection && !config.privacy.suppressSelectedText) {
    blockers.push({ id: "selected_text", label: "Selected text", detail: "Suppress selected page text while point selection is enabled." });
  }
  if (enabledCollectors.length > 0 && config.privacy.mcpEvidenceSharing !== "metadata_only") {
    blockers.push({ id: "mcp_evidence", label: "MCP evidence", detail: "Default AI and MCP access to metadata only for captured evidence." });
  }

  return blockers;
}

const productContextIdSchema = z.string().trim().min(1).max(120);
const productContextTextSchema = z.string().trim().min(1).max(160);
const productContextShortTextSchema = z.string().trim().min(1).max(80);

function hasProductContextValue(value: Record<string, unknown>) {
  return Object.values(value).some((entry) => entry !== undefined);
}

const productContextAccountSchema = z
  .object({
    id: productContextIdSchema.optional(),
    name: productContextTextSchema.optional(),
  })
  .strict()
  .refine(hasProductContextValue, "Provide at least one account field.");

const productContextCustomerSchema = z
  .object({
    id: productContextIdSchema.optional(),
    role: productContextShortTextSchema.optional(),
    segment: productContextShortTextSchema.optional(),
    cohort: productContextShortTextSchema.optional(),
  })
  .strict()
  .refine(hasProductContextValue, "Provide at least one customer field.");

const productContextPlanSchema = z
  .object({
    name: productContextShortTextSchema.optional(),
    tier: productContextShortTextSchema.optional(),
  })
  .strict()
  .refine(hasProductContextValue, "Provide at least one plan field.");

const productContextFeatureSchema = z
  .object({
    key: productContextIdSchema.optional(),
    area: productContextTextSchema.optional(),
  })
  .strict()
  .refine(hasProductContextValue, "Provide at least one feature field.");

export const featureContextSchema = productContextFeatureSchema;
export type FeatureContext = z.infer<typeof featureContextSchema>;

export const selectedElementSchema = pointSelectionSchema
  .pick({
    tagName: true,
    role: true,
    label: true,
  })
  .strict()
  .refine(hasProductContextValue, "Selected element must include at least one field.");

export type SelectedElement = z.infer<typeof selectedElementSchema>;

const productContextReleaseSchema = z
  .object({
    channel: productContextShortTextSchema.optional(),
    version: productContextShortTextSchema.optional(),
    buildNumber: productContextShortTextSchema.optional(),
  })
  .strict()
  .refine(hasProductContextValue, "Provide at least one release field.");

const productContextRevenueSchema = z
  .object({
    mrr: z.number().finite().nonnegative().max(1_000_000_000).optional(),
    arr: z.number().finite().nonnegative().max(1_000_000_000).optional(),
    currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  })
  .strict()
  .refine((value) => value.mrr !== undefined || value.arr !== undefined, "Provide MRR or ARR.")
  .refine((value) => value.currency !== undefined, "Provide currency with revenue.");

const productContextFlagValueSchema = z.union([
  z.boolean(),
  z.number().finite(),
  z.string().trim().min(1).max(160),
]);

const productContextFeatureFlagsSchema = z
  .record(z.string().trim().min(1).max(80), productContextFlagValueSchema)
  .refine((flags) => {
    const flagCount = Object.keys(flags).length;
    return flagCount > 0 && flagCount <= 20;
  }, "Attach between 1 and 20 feature flags.");

const productContextExperimentVariantsSchema = z
  .record(z.string().trim().min(1).max(80), productContextShortTextSchema)
  .refine((experiments) => {
    const experimentCount = Object.keys(experiments).length;
    return experimentCount > 0 && experimentCount <= 20;
  }, "Attach between 1 and 20 experiment variants.");

export const productContextSchema = z
  .object({
    account: productContextAccountSchema.optional(),
    customer: productContextCustomerSchema.optional(),
    plan: productContextPlanSchema.optional(),
    feature: productContextFeatureSchema.optional(),
    featureFlags: productContextFeatureFlagsSchema.optional(),
    experiments: productContextExperimentVariantsSchema.optional(),
    funnelStep: productContextTextSchema.optional(),
    release: productContextReleaseSchema.optional(),
    revenue: productContextRevenueSchema.optional(),
  })
  .strict()
  .refine(hasProductContextValue, "Product context must include at least one field.");

export type ProductContext = z.infer<typeof productContextSchema>;

const feedbackEventPropertyValueSchema = z.union([
  z.string().trim().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string().trim().max(200), z.number().finite(), z.boolean(), z.null()])).max(20),
]);

const feedbackEventPropertiesSchema = z
  .record(z.string().min(1).max(80), feedbackEventPropertyValueSchema)
  .refine((value) => Object.keys(value).length <= 20, {
    message: "Keep event properties under 20 keys.",
  });

const eventTrailUrlSchema = z.string().trim().url().max(2048).transform((value) => {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.href;
});

export const feedbackEventTrailSchema = z
  .array(
    z
      .object({
        name: z.string().trim().min(1).max(120),
        timestamp: z.string().datetime(),
        url: eventTrailUrlSchema,
        properties: feedbackEventPropertiesSchema.optional(),
      })
      .strict(),
  )
  .max(20);

export type FeedbackEventTrail = z.infer<typeof feedbackEventTrailSchema>;

const evidenceTimelineUrlSchema = z.string().trim().url().max(2048).transform((value) => {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.href;
});

function sortEvidenceTimeline<T extends { timestamp: string }>(events: T[]) {
  return [...events].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

export const feedbackEvidenceTimelineSchema = z
  .array(
    z
      .object({
        type: z.enum([
          "route",
          "click",
          "key_action",
          "form_submit",
          "console_error",
          "client_exception",
          "network",
          "feature_flag",
          "release",
          "screenshot",
          "attachment",
          "custom",
        ]),
        label: z.string().trim().min(1).max(120),
        detail: z.string().trim().min(1).max(500),
        timestamp: z.string().datetime(),
        url: evidenceTimelineUrlSchema.optional(),
      })
      .strict(),
  )
  .max(50)
  .transform(sortEvidenceTimeline);

export type FeedbackEvidenceTimeline = z.infer<typeof feedbackEvidenceTimelineSchema>;

const networkUrlSchema = z.string().trim().url().max(2048).transform((value) => {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.href;
});

export const feedbackNetworkEntrySchema = z
  .object({
    method: z.string().trim().min(1).max(12),
    url: networkUrlSchema,
    statusCode: z.number().int().min(100).max(599).optional(),
    durationMs: z.number().finite().nonnegative().max(120_000),
    timestamp: z.string().datetime(),
    requestId: z.string().trim().min(1).max(200).optional(),
    error: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const feedbackNetworkEntriesSchema = z.array(feedbackNetworkEntrySchema).max(100);
export type FeedbackNetworkEntries = z.infer<typeof feedbackNetworkEntriesSchema>;

export const sessionReplayClipIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/, "Session replay clip ID must be an opaque ID, not a URL.");

export const feedbackSurveyResponseSchema = z
  .object({
    type: feedbackSurveyTypeSchema,
    question: z.string().trim().min(1).max(240).optional(),
    score: z.number().finite().min(0).max(10).optional(),
    choice: z.string().trim().min(1).max(120).optional(),
    answer: z.string().trim().min(1).max(1000).optional(),
    submittedAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((value) => value.score !== undefined || value.choice !== undefined || value.answer !== undefined, {
    message: "Provide at least one survey answer field.",
  });

export type FeedbackSurveyResponse = z.infer<typeof feedbackSurveyResponseSchema>;

export const feedbackSelectedTextSuggestionSchema = z
  .object({
    text: z.string().trim().min(1).max(1000),
    url: z.string().trim().url().max(2048).transform((value) => {
      const url = new URL(value);
      url.search = "";
      url.hash = "";
      return url.href;
    }).optional(),
    createdAt: z.string().datetime().optional(),
  })
  .strict();

export type FeedbackSelectedTextSuggestion = z.infer<typeof feedbackSelectedTextSuggestionSchema>;

export const feedbackCustomerImpactSchema = z
  .object({
    summary: z.string().trim().min(1).max(1000).optional(),
    affectedUsers: z.number().int().nonnegative().max(10_000_000).optional(),
    affectedAccounts: z.number().int().nonnegative().max(1_000_000).optional(),
    revenueAtRisk: z
      .object({
        amount: z.number().finite().nonnegative().max(1_000_000_000),
        currency: z.string().trim().regex(/^[A-Z]{3}$/),
      })
      .strict()
      .optional(),
    churnRisk: z.enum(["low", "medium", "high", "critical"]).optional(),
  })
  .strict()
  .refine(hasProductContextValue, "Customer impact must include at least one field.");

export type FeedbackCustomerImpact = z.infer<typeof feedbackCustomerImpactSchema>;

const feedbackConsentEvidenceSchema = z
  .object({
    allowed: z.boolean(),
    included: z.boolean(),
  })
  .strict()
  .refine((evidence) => evidence.allowed || !evidence.included, {
    message: "Evidence cannot be included when capture is disabled.",
    path: ["included"],
  });

export const feedbackConsentSnapshotSchema = z
  .object({
    capturedAt: z.string().datetime(),
    screenshot: feedbackConsentEvidenceSchema,
    pointSelection: feedbackConsentEvidenceSchema,
    console: feedbackConsentEvidenceSchema,
    clientError: feedbackConsentEvidenceSchema,
    network: feedbackConsentEvidenceSchema,
    selectedText: feedbackConsentEvidenceSchema,
    attachmentCount: z.number().int().nonnegative().max(5).default(0),
  })
  .strict();

export type FeedbackConsentSnapshot = z.infer<typeof feedbackConsentSnapshotSchema>;

export const feedbackExternalRefProviderSchema = z.enum([
  "github",
  "linear",
  "jira",
  "sentry",
  "posthog",
  "slack",
  "launchdarkly",
  "zendesk",
  "intercom",
  "other",
]);

export const feedbackExternalRefSchema = z
  .object({
    provider: feedbackExternalRefProviderSchema,
    label: z.string().trim().min(1).max(120),
    url: z.string().trim().url().max(2048),
    externalId: z.string().trim().min(1).max(255).optional(),
    status: z.enum(MCP_EXTERNAL_FEEDBACK_STATUSES).optional(),
    observedAt: z.string().datetime().optional(),
  })
  .strict();

export const feedbackExternalRefsSchema = z.array(feedbackExternalRefSchema).max(10);

export type FeedbackExternalRef = z.infer<typeof feedbackExternalRefSchema>;

export const feedbackEngineeringLifecycleSchema = z
  .object({
    branchName: z.string().trim().max(160).nullable().optional(),
    branchUrl: z.string().trim().url().max(2048).nullable().optional(),
    pullRequestUrl: z.string().trim().url().max(2048).nullable().optional(),
    deployUrl: z.string().trim().url().max(2048).nullable().optional(),
    verificationState: z.enum(["not_started", "in_progress", "deployed", "verified", "blocked"]).default("not_started"),
    closingOutcome: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export type FeedbackEngineeringLifecycle = z.infer<typeof feedbackEngineeringLifecycleSchema>;

export const feedbackExtraContextSchema = z.record(z.string(), z.unknown()).superRefine((extraContext, ctx) => {
  const productContext = extraContext.productContext;
  const eventTrail = extraContext.eventTrail;
  const evidenceTimeline = extraContext.evidenceTimeline;
  const networkEntries = extraContext.networkEntries;
  const surveyResponse = extraContext.surveyResponse;
  const selectedTextSuggestion = extraContext.selectedTextSuggestion;
  const customerImpact = extraContext.customerImpact;
  const consentSnapshot = extraContext.consentSnapshot;
  const featureContext = extraContext.featureContext;
  const sessionReplayClipId = extraContext.sessionReplayClipId;
  const selectedElement = extraContext.selectedElement;
  const externalRefs = extraContext.externalRefs;
  const engineeringLifecycle = extraContext.engineeringLifecycle;

  if (productContext !== undefined) {
    const result = productContextSchema.safeParse(productContext);

    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["productContext", ...(issue.path ?? [])],
        });
      }
    }
  }

  if (surveyResponse !== undefined) {
    const result = feedbackSurveyResponseSchema.safeParse(surveyResponse);

    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["surveyResponse", ...(issue.path ?? [])],
        });
      }
    }
  }

  if (externalRefs !== undefined) {
    const result = feedbackExternalRefsSchema.safeParse(externalRefs);

    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["externalRefs", ...(issue.path ?? [])],
        });
      }
    }
  }

  if (engineeringLifecycle !== undefined) {
    const result = feedbackEngineeringLifecycleSchema.safeParse(engineeringLifecycle);

    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["engineeringLifecycle", ...(issue.path ?? [])],
        });
      }
    }
  }

  if (selectedTextSuggestion !== undefined) {
    const result = feedbackSelectedTextSuggestionSchema.safeParse(selectedTextSuggestion);

    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["selectedTextSuggestion", ...(issue.path ?? [])],
        });
      }
    }
  }

  if (customerImpact !== undefined) {
    const result = feedbackCustomerImpactSchema.safeParse(customerImpact);

    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["customerImpact", ...(issue.path ?? [])],
        });
      }
    }
  }

  if (consentSnapshot !== undefined) {
    const result = feedbackConsentSnapshotSchema.safeParse(consentSnapshot);

    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["consentSnapshot", ...(issue.path ?? [])],
        });
      }
    }
  }

  if (featureContext !== undefined) {
    const result = featureContextSchema.safeParse(featureContext);

    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["featureContext", ...(issue.path ?? [])],
        });
      }
    }
  }

  if (sessionReplayClipId !== undefined) {
    const result = sessionReplayClipIdSchema.safeParse(sessionReplayClipId);

    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["sessionReplayClipId", ...(issue.path ?? [])],
        });
      }
    }
  }

  if (selectedElement !== undefined) {
    const result = selectedElementSchema.safeParse(selectedElement);

    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["selectedElement", ...(issue.path ?? [])],
        });
      }
    }
  }

  if (evidenceTimeline !== undefined) {
    const result = feedbackEvidenceTimelineSchema.safeParse(evidenceTimeline);

    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["evidenceTimeline", ...(issue.path ?? [])],
        });
      }
    }
  }

  if (eventTrail === undefined) {
    if (networkEntries === undefined) {
      return;
    }
  } else {
    const result = feedbackEventTrailSchema.safeParse(eventTrail);

    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["eventTrail", ...(issue.path ?? [])],
        });
      }
    }
  }

  if (networkEntries === undefined) {
    return;
  }

  const result = feedbackNetworkEntriesSchema.safeParse(networkEntries);

  if (result.success) {
    return;
  }

  for (const issue of result.error.issues) {
    ctx.addIssue({
      ...issue,
      path: ["networkEntries", ...(issue.path ?? [])],
    });
  }
});

export const feedbackSubmissionSchema = z.object({
  projectKey: projectKeySchema,
  clientSubmissionId: z.string().trim().min(12).max(191).optional(),
  title: z
    .string()
    .trim()
    .min(4, "Give the issue a short title (at least 4 characters).")
    .max(160, "Keep the title under 160 characters."),
  description: z
    .string()
    .trim()
    .min(10, "Add a bit more detail so engineering can reproduce the issue.")
    .max(4000, "Keep the description under 4000 characters."),
  issueType: issueTypeSchema,
  severity: severitySchema,
  stepsToReproduce: z.string().trim().max(4000, "Keep reproduction steps under 4000 characters.").optional(),
  expectedResult: z.string().trim().max(2000, "Keep expected result notes under 2000 characters.").optional(),
  actualResult: z.string().trim().max(2000, "Keep actual result notes under 2000 characters.").optional(),
  labels: z.array(labelSchema).max(12).default([]),
  route: routeMetadataSchema,
  release: releaseMetadataSchema,
  browser: browserMetadataSchema,
  currentUser: userIdentitySchema.optional(),
  reporterIdentityConsent: z
    .object({
      granted: z.literal(true),
      capturedAt: z.string().datetime(),
    })
    .strict()
    .optional(),
  clientTimestamp: z.string().datetime(),
  clientErrorContext: clientErrorContextSchema.optional(),
  consoleEntries: z.array(consoleEntrySchema).max(100).optional(),
  attachmentTokens: z.array(z.string().trim().min(12).max(255)).max(5).default([]),
  extraContext: feedbackExtraContextSchema.optional(),
});

export type FeedbackSubmission = z.infer<typeof feedbackSubmissionSchema>;

export const uploadMetadataSchema = z.object({
  projectKey: projectKeySchema,
  clientUploadId: z.string().trim().min(12).max(191).optional(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(3).max(120),
  byteSize: z.coerce.number().int().positive().max(20_000_000),
  width: z.coerce.number().int().positive().max(10_000).optional(),
  height: z.coerce.number().int().positive().max(10_000).optional(),
  kind: z.enum(["screenshot", "file"]).default("screenshot"),
});

const labelFilterSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => (typeof item === "string" ? item.split(",") : [item]))
    .map((item) => (typeof item === "string" ? item.trim() : item))
    .filter(Boolean);
}, z.array(labelSchema).optional());

const booleanFilterSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value[value.length - 1];
  if (typeof value !== "string") return value;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return value;
}, z.boolean().optional());

export const feedbackFilterSchema = z.object({
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
  duplicateOfId: feedbackIdSchema.optional(),
  accountId: productContextIdSchema.optional(),
  accountName: productContextTextSchema.optional(),
  planName: productContextShortTextSchema.optional(),
  planTier: productContextShortTextSchema.optional(),
  customerSegment: productContextShortTextSchema.optional(),
  customerCohort: productContextShortTextSchema.optional(),
  trackedEventName: z.string().trim().min(1).max(120).optional(),
  attention: z.enum(["waiting_on_customer", "weak_evidence", "high_impact_repeats", "stale", "stuck_lifecycle"]).optional(),
  ideaDecision: z.enum(["reviewing", "backlog", "resolved"]).optional(),
  releaseRegression: booleanFilterSchema,
  labels: labelFilterSchema,
  fromDate: dateOnlySchema.optional(),
  toDate: dateOnlySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const feedbackStatusNoteSchema = z.object({
  body: z.string().trim().min(1, "Add a note explaining the status change.").max(3000),
  visibility: z.enum(["internal", "public"]).default("internal"),
  clientRequestId: z.string().uuid().optional(),
});

export const feedbackMutationSchema = z.object({
  status: feedbackStatusSchema.optional(),
  severity: severitySchema.optional(),
  ownerId: entityIdSchema.nullable().optional(),
  labels: z.array(labelSchema).max(20).optional(),
  duplicateOfId: feedbackIdSchema.nullable().optional(),
  convertedToBacklog: z.boolean().optional(),
  externalTicketRef: z.string().trim().max(120).nullable().optional(),
  externalRefs: feedbackExternalRefsSchema.nullable().optional(),
  engineeringLifecycle: feedbackEngineeringLifecycleSchema.nullable().optional(),
  publicSummary: z.string().trim().max(3000).nullable().optional(),
  notifyRequester: z.boolean().default(false),
  expectedUpdatedAt: z.string().datetime().optional(),
  statusNote: feedbackStatusNoteSchema.optional(),
});

export const feedbackBulkStatusMutationSchema = z.object({
  feedbackIds: z.array(feedbackIdSchema).min(1).max(100),
  status: feedbackStatusSchema,
  note: z.string().trim().min(1, "Add an internal note explaining the status change.").max(3000),
});

export const feedbackExpertMutationSchema = z.union([
  z.object({ status: feedbackStatusSchema, statusNote: feedbackStatusNoteSchema.extend({ visibility: z.literal("internal") }) }).strict(),
  z.object({ ownerId: entityIdSchema.nullable() }).strict(),
  z.object({ labels: z.array(labelSchema).max(20) }).strict(),
]);

export const feedbackBulkExpertMutationSchema = z.object({
  items: z.array(z.object({
    feedbackId: feedbackIdSchema,
    expectedUpdatedAt: z.string().datetime(),
    mutation: feedbackExpertMutationSchema,
  }).strict()).min(1).max(100),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  value.items.forEach((item, index) => {
    if (seen.has(item.feedbackId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "feedbackId"],
        message: "Each feedback item can appear only once per bulk operation.",
      });
    }
    seen.add(item.feedbackId);
  });
});

export const feedbackCommentSchema = z.object({
  body: z.string().trim().min(1).max(3000),
  visibility: z.enum(["internal", "public"]).default("internal"),
  publicSummary: z.string().trim().max(3000).nullable().optional(),
  notifyRequester: z.boolean().default(false),
  deliveryTarget: z.literal("requester_and_subscribers").optional(),
  clientRequestId: z.string().uuid().optional(),
}).superRefine((value, context) => {
  if (!value.notifyRequester) return;
  if (value.visibility !== "public") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["visibility"],
      message: "Requester delivery must be requester-visible.",
    });
  }
  if (value.deliveryTarget !== "requester_and_subscribers") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["deliveryTarget"],
      message: "Choose the requester and enabled subscribers before sending.",
    });
  }
});

export const feedbackSubscriberCreateSchema = z.object({
  email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(255).optional(),
  recipientType: feedbackRecipientTypeSchema.exclude(["requester"]).default("external_subscriber"),
  notifyOnTriage: z.boolean().default(true),
  notifyOnStatusChange: z.boolean().default(true),
});

export const feedbackSubscriberUpdateSchema = z.object({
  name: z.string().trim().min(1).max(255).nullable().optional(),
  recipientType: feedbackRecipientTypeSchema.exclude(["requester"]).optional(),
  notifyOnTriage: z.boolean().optional(),
  notifyOnStatusChange: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const projectUpsertSchema = z.object({
  key: projectKeySchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  defaultEnvironment: z.string().trim().max(64).default("production"),
  widgetConfig: widgetProjectConfigSchema.default(() => widgetProjectConfigSchema.parse({})),
  allowedOrigins: z.array(z.string().trim().url()).default([]),
  notificationEmails: z.array(z.string().trim().email()).min(1, "At least one notification email is required"),
  requesterEmailProductName: z.string().trim().min(2).max(120),
  isActive: z.boolean().default(true),
});

const projectSettingsVersionSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
});

function hasProjectSettingsMutation(value: Record<string, unknown>) {
  return Object.keys(value).some((key) => key !== "expectedUpdatedAt");
}

function projectSettingsPatchSchema<T extends z.ZodRawShape>(shape: T) {
  return projectSettingsVersionSchema
    .extend(shape)
    .strict()
    .refine(hasProjectSettingsMutation, "Provide at least one setting to update.");
}

const widgetFieldPatchSchema = widgetFieldConfigSchema.partial().strict();
const widgetFieldsPatchSchema = z.object({
  title: widgetFieldPatchSchema.optional(),
  description: widgetFieldPatchSchema.optional(),
  issueType: widgetFieldPatchSchema.optional(),
  severity: widgetFieldPatchSchema.optional(),
  stepsToReproduce: widgetFieldPatchSchema.optional(),
  expectedResult: widgetFieldPatchSchema.optional(),
  actualResult: widgetFieldPatchSchema.optional(),
}).strict();

export const projectSettingsDestinationSchema = z.enum([
  "general",
  "installation",
  "widget",
  "evidence",
  "notifications",
  "privacy",
]);

export const projectGeneralSettingsPatchSchema = projectSettingsPatchSchema({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  defaultEnvironment: z.string().trim().max(64).optional(),
  isActive: z.boolean().optional(),
});

export const projectInstallationSettingsPatchSchema = projectSettingsPatchSchema({
  allowedOrigins: z.array(z.string().trim().url()).optional(),
});

export const projectWidgetSettingsPatchSchema = projectSettingsPatchSchema({
  appearance: widgetAppearanceSchema.partial().strict().optional(),
  notificationBranding: z.object({
    primaryColor: widgetNotificationBrandingSchema.shape.primaryColor.removeDefault().optional(),
    accentColor: widgetNotificationBrandingSchema.shape.accentColor.removeDefault().optional(),
  }).strict().optional(),
});

export const projectEvidenceSettingsPatchSchema = projectSettingsPatchSchema({
  allowScreenshot: z.boolean().optional(),
  autoCaptureScreenshot: z.boolean().optional(),
  allowFileAttachments: z.boolean().optional(),
  allowPointSelection: z.boolean().optional(),
  allowConsoleCapture: z.boolean().optional(),
  allowClientErrorContext: z.boolean().optional(),
  allowNetworkSummary: z.boolean().optional(),
  maxConsoleEntries: z.number().int().min(0).max(100).optional(),
  maxNetworkEntries: z.number().int().min(0).max(100).optional(),
  defaultLabels: z.array(labelSchema).optional(),
  fields: widgetFieldsPatchSchema.optional(),
  surveyPrompt: widgetSurveyPromptSchema.partial().strict().optional(),
});

export const projectNotificationsSettingsPatchSchema = projectSettingsPatchSchema({
  notificationEmails: z.array(z.string().trim().email()).min(1, "At least one notification email is required").optional(),
  requesterEmailProductName: z.string().trim().min(2).max(120).optional(),
  notificationBranding: widgetNotificationBrandingSchema.partial().strict().optional(),
});

export const projectPrivacySettingsPatchSchema = projectSettingsPatchSchema({
  privacy: widgetPrivacyConfigSchema.partial().strict().optional(),
});

export const projectSettingsPatchSchemas = {
  general: projectGeneralSettingsPatchSchema,
  installation: projectInstallationSettingsPatchSchema,
  widget: projectWidgetSettingsPatchSchema,
  evidence: projectEvidenceSettingsPatchSchema,
  notifications: projectNotificationsSettingsPatchSchema,
  privacy: projectPrivacySettingsPatchSchema,
} as const;

export type ProjectSettingsDestination = z.infer<typeof projectSettingsDestinationSchema>;
