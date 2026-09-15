import { z } from "zod";

import {
  MCP_EXTERNAL_FEEDBACK_STATUSES,
  MCP_INTEGRATION_ACTIONS,
  MCP_NOTIFICATION_EVENT_TYPES,
  MCP_NOTIFICATION_STATUSES,
} from "../constants/mcp";
import {
  entityIdSchema,
  feedbackExternalRefProviderSchema,
  feedbackExternalRefsSchema,
  projectKeySchema,
} from "./widget";
import {
  issueTypeSchema,
  severitySchema,
} from "./common";

export const mcpIntegrationActionSchema = z.enum(MCP_INTEGRATION_ACTIONS);
export const mcpExternalStatusSchema = z.enum(MCP_EXTERNAL_FEEDBACK_STATUSES);
export const mcpNotificationEventTypeSchema = z.enum(MCP_NOTIFICATION_EVENT_TYPES);
export const mcpNotificationStatusSchema = z.enum(MCP_NOTIFICATION_STATUSES);
export const mcpIdeaDecisionSchema = z.enum(["reviewing", "backlog", "resolved"]);

const mcpBooleanQuerySchema = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === "boolean" ? value : value.toLowerCase() === "true"));

export const mcpTicketsListQuerySchema = z.object({
  projectKey: projectKeySchema.optional(),
  appName: z.string().trim().min(1).max(255).optional(),
  status: mcpExternalStatusSchema.optional(),
  externalRefProvider: feedbackExternalRefProviderSchema.optional(),
  externalRefId: z.string().trim().min(1).max(255).optional(),
  externalRefStatus: mcpExternalStatusSchema.optional(),
  externalRefObservedBefore: z.string().datetime().optional(),
  externalRefObservedAfter: z.string().datetime().optional(),
  includeClosed: mcpBooleanQuerySchema.default(true),
  includeEngineeringContext: mcpBooleanQuerySchema.default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const mcpIdeasListQuerySchema = z.object({
  projectKey: projectKeySchema.optional(),
  status: mcpExternalStatusSchema.optional(),
  ideaDecision: mcpIdeaDecisionSchema.optional(),
  includeClosed: mcpBooleanQuerySchema.default(true),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const mcpReleasesListQuerySchema = z.object({
  projectKey: projectKeySchema.optional(),
});

export const mcpCustomersGetQuerySchema = z
  .object({
    projectKey: projectKeySchema.optional(),
    accountId: z.string().trim().min(1).max(120).optional(),
    accountName: z.string().trim().min(1).max(160).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
  })
  .refine((value) => value.accountId !== undefined || value.accountName !== undefined, {
    message: "Provide accountId or accountName.",
  });

export const mcpTicketTriageSchema = z.object({
  suggestedSeverity: severitySchema.optional(),
  suggestedCategory: z.string().trim().min(1).max(120).optional(),
  suggestedIssueType: issueTypeSchema.optional(),
  likelyRootCause: z.string().trim().min(1).max(4000).optional(),
  affectedArea: z.string().trim().min(1).max(255).optional(),
  reproductionSteps: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  nextAction: z.string().trim().min(1).max(2000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  filesToInspect: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  proposedCodeChange: z.string().trim().min(1).max(4000).optional(),
  validationCommand: z.string().trim().min(1).max(1000).optional(),
  rollbackRisk: z.string().trim().min(1).max(2000).optional(),
});

export const mcpSaveTriageSchema = z.object({
  triage: mcpTicketTriageSchema,
  triageVersion: z.enum(["v1", "engineering_fix_plan_v1"]).default("v1"),
  setStatus: mcpExternalStatusSchema.optional(),
  saveInternalNote: z.boolean().default(true),
  safeRequesterSummary: z.string().trim().min(1).max(1200).optional(),
  notifyRequester: z.boolean().default(false),
  expectedUpdatedAt: z.string().datetime().optional(),
  idempotencyKey: z.string().trim().min(8).max(255),
});

export const mcpChangeStatusSchema = z.object({
  status: mcpExternalStatusSchema,
  publicSummary: z.string().trim().min(1).max(1200).optional(),
  notifyRequester: z.boolean().default(false),
  expectedUpdatedAt: z.string().datetime().optional(),
  idempotencyKey: z.string().trim().min(8).max(255),
});

export const mcpAddCommentSchema = z.object({
  body: z.string().trim().min(1).max(3000),
  visibility: z.enum(["internal", "public"]).default("internal"),
  notifyRequester: z.boolean().default(false),
  safeRequesterSummary: z.string().trim().min(1).max(1200).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
  idempotencyKey: z.string().trim().min(8).max(255),
});

export const mcpLinkExternalRefSchema = z
  .object({
    externalTicketRef: z.string().trim().min(1).max(120).nullable().optional(),
    externalRefs: feedbackExternalRefsSchema.nullable().optional(),
    expectedUpdatedAt: z.string().datetime().optional(),
    idempotencyKey: z.string().trim().min(8).max(255),
  })
  .refine((value) => value.externalTicketRef !== undefined || value.externalRefs !== undefined, {
    message: "Provide externalTicketRef or externalRefs.",
  });

const providerAuthorizationSchema = z
  .string()
  .trim()
  .min(8)
  .max(2048)
  .refine((value) => /^(Bearer|Basic)\s+\S+/i.test(value), {
    message: "Use a Bearer or Basic provider authorization header.",
  });

const providerSlugSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_.-]+$/);
const providerConnectionIdSchema = z.string().trim().min(1).max(128);
const storedProviderConnectionProviders = ["github", "linear", "jira"];

const providerBaseUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Provider base URL must use HTTPS.",
  });

export const mcpCreateExternalIssueSchema = z
  .object({
    provider: z.enum(["github", "linear", "jira"]),
    providerAuthorization: providerAuthorizationSchema.optional(),
    providerConnectionId: providerConnectionIdSchema.optional(),
    owner: providerSlugSchema.optional(),
    repo: providerSlugSchema.optional(),
    teamId: z.string().trim().min(1).max(120).optional(),
    baseUrl: providerBaseUrlSchema.optional(),
    projectKey: z.string().trim().min(1).max(120).optional(),
    issueType: z.string().trim().min(1).max(120).optional(),
    expectedUpdatedAt: z.string().datetime().optional(),
    idempotencyKey: z.string().trim().min(8).max(255),
  })
  .superRefine((value, ctx) => {
    if (value.providerConnectionId && !storedProviderConnectionProviders.includes(value.provider)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerConnectionId"],
        message: "Stored provider connections are currently supported for GitHub, Linear, and Jira.",
      });
    }
    if (!value.providerAuthorization && !value.providerConnectionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerAuthorization"],
        message: "Provide providerAuthorization or providerConnectionId.",
      });
    }
    if (value.provider === "github") {
      if (!value.owner && !value.providerConnectionId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["owner"], message: "owner is required for GitHub." });
      }
      if (!value.repo && !value.providerConnectionId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["repo"], message: "repo is required for GitHub." });
      }
    }
    if (value.provider === "linear" && !value.teamId && !value.providerConnectionId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["teamId"], message: "teamId is required for Linear." });
    }
    if (value.provider === "jira") {
      if (!value.baseUrl && !value.providerConnectionId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["baseUrl"], message: "baseUrl is required for Jira." });
      }
      if (!value.projectKey && !value.providerConnectionId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["projectKey"], message: "projectKey is required for Jira." });
      }
      if (!value.issueType && !value.providerConnectionId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["issueType"], message: "issueType is required for Jira." });
      }
    }
  });

export const mcpSyncExternalIssueSchema = z
  .object({
    provider: z.enum(["github", "linear", "jira"]),
    providerAuthorization: providerAuthorizationSchema.optional(),
    providerConnectionId: providerConnectionIdSchema.optional(),
    externalRefUrl: z.string().trim().url().max(2048).optional(),
    expectedUpdatedAt: z.string().datetime().optional(),
    idempotencyKey: z.string().trim().min(8).max(255),
  })
  .superRefine((value, ctx) => {
    if (value.providerConnectionId && !storedProviderConnectionProviders.includes(value.provider)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerConnectionId"],
        message: "Stored provider connections are currently supported for GitHub, Linear, and Jira.",
      });
    }
    if (!value.providerAuthorization && !value.providerConnectionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerAuthorization"],
        message: "Provide providerAuthorization or providerConnectionId.",
      });
    }
  });

export const mcpMarkDuplicateSchema = z.object({
  duplicateOfId: entityIdSchema.nullable(),
  publicSummary: z.string().trim().min(1).max(1200).optional(),
  notifyRequester: z.boolean().default(false),
  expectedUpdatedAt: z.string().datetime().optional(),
  idempotencyKey: z.string().trim().min(8).max(255),
});

export const mcpClientAuthHeadersSchema = z.object({
  clientId: entityIdSchema,
  clientSecret: z.string().trim().min(16).max(512),
});

export type McpTicketsListQuery = z.infer<typeof mcpTicketsListQuerySchema>;
export type McpIdeasListQuery = z.infer<typeof mcpIdeasListQuerySchema>;
export type McpReleasesListQuery = z.infer<typeof mcpReleasesListQuerySchema>;
export type McpCustomersGetQuery = z.infer<typeof mcpCustomersGetQuerySchema>;
export type McpTicketTriageInput = z.infer<typeof mcpTicketTriageSchema>;
export type McpSaveTriageInput = z.infer<typeof mcpSaveTriageSchema>;
export type McpChangeStatusInput = z.infer<typeof mcpChangeStatusSchema>;
export type McpAddCommentInput = z.infer<typeof mcpAddCommentSchema>;
export type McpLinkExternalRefInput = z.infer<typeof mcpLinkExternalRefSchema>;
export type McpSyncExternalIssueInput = z.infer<typeof mcpSyncExternalIssueSchema>;
export type McpMarkDuplicateInput = z.infer<typeof mcpMarkDuplicateSchema>;
