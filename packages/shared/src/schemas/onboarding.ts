import { z } from "zod";

import {
  projectKeySchema,
  widgetAppearanceSchema,
  widgetNotificationBrandingSchema,
  widgetPrivacyConfigSchema,
  widgetReporterIdentityConfigSchema,
} from "./widget";

export const productOnboardingStepSchema = z.enum([
  "product",
  "customize",
  "reports",
  "team",
  "connect",
]);

export const productOnboardingSetupSourceSchema = z.enum([
  "organization_defaults",
  "copy_product",
  "fresh",
]);

export const productOnboardingInstallMethodSchema = z.enum(["embedded", "hosted"]);

export const productOnboardingCreateSchema = z
  .object({
    organizationId: z.string().trim().min(1),
    name: z.string().trim().min(2).max(120),
    website: z.string().trim().url().or(z.literal("")).default(""),
    defaultEnvironment: z.string().trim().min(1).max(64).default("production"),
    setupSource: productOnboardingSetupSourceSchema.default("organization_defaults"),
    sourceProjectKey: projectKeySchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.setupSource === "copy_product" && !value.sourceProjectKey) {
      context.addIssue({
        code: "custom",
        message: "Choose the product whose setup you want to copy.",
        path: ["sourceProjectKey"],
      });
    }
    if (value.setupSource !== "copy_product" && value.sourceProjectKey) {
      context.addIssue({
        code: "custom",
        message: "A source product is only valid when copying product setup.",
        path: ["sourceProjectKey"],
      });
    }
  });

export const productOnboardingCustomizeSchema = z.object({
  step: z.literal("customize"),
  expectedUpdatedAt: z.string().datetime(),
  appearance: widgetAppearanceSchema,
  branding: widgetNotificationBrandingSchema.pick({ primaryColor: true }),
}).strict();

export const productOnboardingReportsSchema = z.object({
  step: z.literal("reports"),
  expectedUpdatedAt: z.string().datetime(),
  reportPreset: z.enum(["essential", "visual", "developer"]),
  reporterIdentity: widgetReporterIdentityConfigSchema,
  privacy: widgetPrivacyConfigSchema,
  notificationEmails: z.array(z.string().trim().email()).min(1).max(20),
  requesterEmailProductName: z.string().trim().min(2).max(120),
}).strict();

export const productOnboardingTeamSchema = z.object({
  step: z.literal("team"),
  expectedUpdatedAt: z.string().datetime(),
  setupOwner: z.enum(["me", "teammate"]),
}).strict();

export const productOnboardingConnectSchema = z.object({
  step: z.literal("connect"),
  expectedUpdatedAt: z.string().datetime(),
  installMethod: productOnboardingInstallMethodSchema,
  origin: z.string().trim().url().or(z.literal("")).default(""),
}).strict().superRefine((value, context) => {
  if (value.installMethod !== "embedded") return;
  if (!value.origin) {
    context.addIssue({ code: "custom", path: ["origin"], message: "Enter the website where the widget will run." });
    return;
  }
  const parsed = new URL(value.origin);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    context.addIssue({ code: "custom", path: ["origin"], message: `Use only the website origin: ${parsed.origin}.` });
  }
});

export const productOnboardingVerifySchema = z.object({
  step: z.literal("verify"),
  expectedUpdatedAt: z.string().datetime(),
}).strict();

export const productOnboardingUpdateSchema = z.discriminatedUnion("step", [
  productOnboardingCustomizeSchema,
  productOnboardingReportsSchema,
  productOnboardingTeamSchema,
  productOnboardingConnectSchema,
  productOnboardingVerifySchema,
]);

export type ProductOnboardingStep = z.infer<typeof productOnboardingStepSchema>;
export type ProductOnboardingSetupSource = z.infer<typeof productOnboardingSetupSourceSchema>;
export type ProductOnboardingInstallMethod = z.infer<typeof productOnboardingInstallMethodSchema>;
export type ProductOnboardingCreateInput = z.infer<typeof productOnboardingCreateSchema>;
export type ProductOnboardingUpdateInput = z.infer<typeof productOnboardingUpdateSchema>;
