import type { Prisma } from "@prisma/client";
import { productContextSchema } from "@tracegenie/shared";
import { z } from "zod";

import { AppError } from "../../lib/errors";

export const EVIDENCE_QUALITY_KEYS = [
  "screenshot",
  "url",
  "console-error",
  "steps",
  "release",
  "account",
  "reporter",
  "repro-confidence",
] as const;

export const evidenceGateOverrideSchema = z.object({
  reason: z.string().trim().min(10).max(500),
  evidenceScore: z.number().int().min(0).max(100),
  missing: z.array(z.enum(EVIDENCE_QUALITY_KEYS)).max(EVIDENCE_QUALITY_KEYS.length),
  createdAt: z.string().datetime(),
});

export const evidenceGateOverrideMutationSchema = z.object({
  reason: z.string().trim().min(10, "Explain why engineering should proceed with incomplete evidence.").max(500),
  expectedUpdatedAt: z.string().datetime(),
});

export type EvidenceGateOverride = z.infer<typeof evidenceGateOverrideSchema>;

type EvidenceGateFeedback = {
  attachments: Array<unknown>;
  currentUrl: string;
  consoleEntries: Prisma.JsonValue | null;
  clientErrorContext: Prisma.JsonValue | null;
  stepsToReproduce: string | null;
  expectedResult: string | null;
  actualResult: string | null;
  appVersion: string;
  buildNumber: string | null;
  releaseChannel: string | null;
  reporterEmail: string | null;
  reporterName: string | null;
  extraContext: Prisma.JsonValue | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function readEvidenceGateOverride(extraContext: unknown): EvidenceGateOverride | null {
  const result = evidenceGateOverrideSchema.safeParse(record(extraContext)?.evidenceGateOverride);
  return result.success ? result.data : null;
}

export function mergeEvidenceGateOverride(
  extraContext: unknown,
  override: EvidenceGateOverride,
): Prisma.InputJsonObject {
  return {
    ...(record(extraContext) ?? {}),
    evidenceGateOverride: override,
  } as Prisma.InputJsonObject;
}

export function calculateFeedbackEvidenceQuality(feedback: EvidenceGateFeedback) {
  const parsedProductContext = productContextSchema.safeParse(record(feedback.extraContext)?.productContext);
  const productContext = parsedProductContext.success ? parsedProductContext.data : null;
  const hasConsoleOrError = (Array.isArray(feedback.consoleEntries) && feedback.consoleEntries.length > 0)
    || Boolean(feedback.clientErrorContext);
  const hasSteps = Boolean(feedback.stepsToReproduce?.trim());
  const hasOutcome = Boolean(feedback.expectedResult?.trim() || feedback.actualResult?.trim());
  const signals: Record<(typeof EVIDENCE_QUALITY_KEYS)[number], boolean> = {
    screenshot: feedback.attachments.length > 0,
    url: Boolean(feedback.currentUrl),
    "console-error": hasConsoleOrError,
    steps: hasSteps,
    release: Boolean(feedback.appVersion || feedback.buildNumber || feedback.releaseChannel),
    account: Boolean(productContext?.account?.id || productContext?.account?.name || productContext?.customer?.id),
    reporter: Boolean(feedback.reporterEmail || feedback.reporterName),
    "repro-confidence": hasSteps && (hasConsoleOrError || feedback.attachments.length > 0 || hasOutcome),
  };
  const missing = EVIDENCE_QUALITY_KEYS.filter((key) => !signals[key]);
  const score = Math.round(((EVIDENCE_QUALITY_KEYS.length - missing.length) / EVIDENCE_QUALITY_KEYS.length) * 100);

  return { score, missing, ready: score >= 75 };
}

export function assertEvidenceGate(feedback: EvidenceGateFeedback) {
  const quality = calculateFeedbackEvidenceQuality(feedback);
  if (!quality.ready && !readEvidenceGateOverride(feedback.extraContext)) {
    throw new AppError(
      422,
      "feedback.evidence_insufficient",
      `Evidence is ${quality.score}% complete. Ask the reporter for missing detail or record a reasoned override before engineering starts.`,
    );
  }
}

export function assertEvidenceGateForStatus(feedback: EvidenceGateFeedback, status: string | null | undefined) {
  if (status === "IN_PROGRESS" || status === "FIXED") {
    assertEvidenceGate(feedback);
  }
}
