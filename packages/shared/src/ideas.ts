import { z } from "zod";

export const ideaSourceKinds = ["widget", "reporter", "manual", "slack", "provider", "import"] as const;
export type IdeaSourceKind = (typeof ideaSourceKinds)[number];
export type IdeaSuggestionKind = "theme" | "duplicate";
export type IdeaSuggestionStatus = "pending" | "accepted" | "rejected" | "undone";

const safeText = (max: number) => z.string().trim().min(1).max(max);

export const ideaSourceInputSchema = z.object({
  organizationId: safeText(120),
  projectId: safeText(120),
  feedbackItemId: safeText(120).nullable().optional(),
  kind: z.enum(ideaSourceKinds),
  sourceLabel: safeText(120),
  externalRef: safeText(200).nullable().optional(),
  title: safeText(200),
  body: safeText(4_000),
  evidenceUrl: z.string().url().max(1_000).nullable().optional(),
  occurredAt: z.string().datetime(),
  idempotencyKey: safeText(160).regex(/^[A-Za-z0-9._:-]+$/),
});

export const ideaSynthesisInputSchema = z.object({
  organizationId: safeText(120),
  projectId: safeText(120).optional(),
  requestId: safeText(160).regex(/^[A-Za-z0-9._:-]+$/),
});

export const ideaSuggestionDecisionSchema = z.object({
  action: z.enum(["accept", "reject", "undo"]),
  note: z.string().trim().max(500).nullable().optional(),
  requestId: safeText(160).regex(/^[A-Za-z0-9._:-]+$/),
  expectedVersion: z.number().int().positive(),
});

export type IdeaSourceInput = z.infer<typeof ideaSourceInputSchema>;

export type IdeaSourceSummary = {
  id: string;
  project: { id: string; key: string; name: string };
  feedback: { id: string; ticketNumber: number; title: string; status: string } | null;
  kind: IdeaSourceKind;
  sourceLabel: string;
  externalRef: string | null;
  title: string;
  body: string;
  evidenceUrl: string | null;
  ingestedBy: { id: string; name: string } | null;
  occurredAt: string;
  ingestedAt: string;
};

export type IdeaSuggestionSummary = {
  id: string;
  project: { id: string; key: string; name: string };
  kind: IdeaSuggestionKind;
  status: IdeaSuggestionStatus;
  title: string;
  rationale: string;
  confidence: "low" | "medium" | "high";
  evidence: IdeaSourceSummary[];
  targetFeedback: IdeaSourceSummary["feedback"];
  duplicateFeedback: IdeaSourceSummary["feedback"];
  generatedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  reviewedBy: { id: string; name: string } | null;
  version: number;
  audit: Array<{
    id: string;
    action: "generated" | "accepted" | "rejected" | "undone";
    note: string | null;
    actor: { id: string; name: string } | null;
    createdAt: string;
  }>;
};

export type IdeasWorkspaceResponse = {
  sources: IdeaSourceSummary[];
  suggestions: IdeaSuggestionSummary[];
  topAsks: Array<{ title: string; evidenceCount: number; latestAt: string; evidence: IdeaSourceSummary[] }>;
  changedThisWeek: Array<{ id: string; label: string; detail: string; at: string; evidence: IdeaSourceSummary[] }>;
  shippedFollowUp: Array<{ feedback: NonNullable<IdeaSourceSummary["feedback"]>; sourceCount: number; latestAt: string; evidence: IdeaSourceSummary[] }>;
  pagination: { page: number; pageSize: number; pageCount: number; total: number };
  suggestionPagination: { page: number; pageSize: number; pageCount: number; total: number };
  limits: { sources: number; suggestions: number; evidencePerSuggestion: number; truncated: boolean; suggestionsTruncated: boolean };
};
