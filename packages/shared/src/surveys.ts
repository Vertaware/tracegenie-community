import { z } from "zod";

import { feedbackSurveyTypeSchema, productContextSchema } from "./schemas/widget";

export const surveyCampaignStatusSchema = z.enum(["draft", "active", "closed"]);
export const surveyAnswerKindSchema = z.enum(["score", "choice", "text"]);

const surveyAudienceSchema = z.object({
  segments: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  roles: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  featureKeys: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  funnelSteps: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
}).default(() => ({ segments: [], roles: [], featureKeys: [], funnelSteps: [] }));

const surveyContextRequirementsSchema = z.object({
  required: z.array(z.enum(["account", "customer.segment", "customer.role", "feature.key", "funnelStep", "release.version"]))
    .max(6)
    .default([]),
}).default(() => ({ required: [] }));

export const surveyCampaignInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  status: surveyCampaignStatusSchema.default("draft"),
  type: feedbackSurveyTypeSchema,
  question: z.string().trim().min(1).max(240),
  answerKind: surveyAnswerKindSchema,
  scaleMin: z.number().int().min(0).max(10).nullable().default(null),
  scaleMax: z.number().int().min(1).max(10).nullable().default(null),
  options: z.array(z.string().trim().min(1).max(100)).max(8).default([]),
  audience: surveyAudienceSchema,
  contextRequirements: surveyContextRequirementsSchema,
  consentRequired: z.boolean().default(false),
  consentLabel: z.string().trim().min(1).max(240).default("I agree to share this feedback with the product team."),
  privacyUrl: z.string().trim().url().or(z.literal("")).default(""),
  retentionDays: z.number().int().min(1).max(3650).default(365),
}).superRefine((value, context) => {
  if (value.answerKind === "score" && (value.scaleMin === null || value.scaleMax === null || value.scaleMin >= value.scaleMax)) {
    context.addIssue({ code: "custom", path: ["scaleMax"], message: "Choose a valid score scale." });
  }
  if (value.answerKind === "choice" && value.options.length < 2) {
    context.addIssue({ code: "custom", path: ["options"], message: "Add at least two response options." });
  }
  if (value.answerKind !== "score" && (value.scaleMin !== null || value.scaleMax !== null)) {
    context.addIssue({ code: "custom", path: ["scaleMin"], message: "Only score surveys can define a scale." });
  }
  if (value.answerKind !== "choice" && value.options.length > 0) {
    context.addIssue({ code: "custom", path: ["options"], message: "Only choice surveys can define options." });
  }
});

export type SurveyCampaignInput = z.infer<typeof surveyCampaignInputSchema>;

export const surveyResponseInputSchema = z.object({
  clientSubmissionId: z.string().trim().min(12).max(120),
  score: z.number().int().min(0).max(10).optional(),
  option: z.string().trim().min(1).max(100).optional(),
  answer: z.string().trim().min(1).max(1000).optional(),
  consentGranted: z.boolean().default(false),
  productContext: productContextSchema.optional(),
}).strict();

export type SurveyResponseInput = z.infer<typeof surveyResponseInputSchema>;

export function surveyAnswerLabel(campaign: Pick<SurveyCampaignInput, "answerKind" | "scaleMin" | "scaleMax">) {
  if (campaign.answerKind === "score") return `${campaign.scaleMin}-${campaign.scaleMax}`;
  return campaign.answerKind === "choice" ? "Choose one" : "Written response";
}
