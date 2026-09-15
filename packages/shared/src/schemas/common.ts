import { z } from "zod";

import {
  ATTACHMENT_TYPES,
  COMMENT_VISIBILITY,
  FEEDBACK_RECIPIENT_TYPES,
  FEEDBACK_LABELS,
  FEEDBACK_STATUSES,
  ISSUE_TYPES,
  PROJECT_ENVIRONMENTS,
  SEVERITY_LEVELS,
} from "../constants/feedback";

export const issueTypeSchema = z.enum(ISSUE_TYPES);
export const severitySchema = z.enum(SEVERITY_LEVELS);
export const feedbackStatusSchema = z.enum(FEEDBACK_STATUSES);
export const attachmentTypeSchema = z.enum(ATTACHMENT_TYPES);
export const commentVisibilitySchema = z.enum(COMMENT_VISIBILITY);
export const feedbackRecipientTypeSchema = z.enum(FEEDBACK_RECIPIENT_TYPES);
export const labelSchema = z.enum(FEEDBACK_LABELS);
export const projectEnvironmentSchema = z.enum(PROJECT_ENVIRONMENTS);

export const userIdentitySchema = z
  .object({
    id: z.string().trim().min(1).max(128).optional(),
    email: z.string().trim().email().max(255).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    role: z.string().trim().max(128).optional(),
  })
  .partial()
  .refine(
    (value) => Boolean(value.id || value.email || value.name),
    "At least one user identity field is required when currentUser is provided.",
  );

export type UserIdentity = z.infer<typeof userIdentitySchema>;

export const browserMetadataSchema = z.object({
  userAgent: z.string().trim().max(2048),
  language: z.string().trim().max(32).optional(),
  platform: z.string().trim().max(128).optional(),
  browserName: z.string().trim().max(128).optional(),
  browserVersion: z.string().trim().max(64).optional(),
  osName: z.string().trim().max(128).optional(),
  osVersion: z.string().trim().max(64).optional(),
  viewportWidth: z.number().int().positive(),
  viewportHeight: z.number().int().positive(),
});

export const routeMetadataSchema = z.object({
  url: z.string().trim().url(),
  routeName: z.string().trim().max(255).optional(),
  pageTitle: z.string().trim().max(255).optional(),
  referrer: z.string().trim().max(2048).optional(),
});

export const releaseMetadataSchema = z.object({
  appName: z.string().trim().min(1).max(255),
  appEnvironment: projectEnvironmentSchema.or(z.string().trim().min(1).max(64)),
  appVersion: z.string().trim().min(1).max(128),
  buildNumber: z.string().trim().max(128).optional(),
  releaseChannel: z.string().trim().max(64).optional(),
});

export const consoleEntrySchema = z.object({
  level: z.enum(["log", "info", "warn", "error"]),
  message: z.string().trim().max(4000),
  timestamp: z.string().datetime(),
});

export const clientErrorContextSchema = z.object({
  message: z.string().trim().max(2000),
  stack: z.string().trim().max(12000).optional(),
  source: z.string().trim().max(255).optional(),
});
