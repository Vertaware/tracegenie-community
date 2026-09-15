import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import { Link,useNavigate,useParams,useSearchParams } from "react-router-dom";
import { useInfiniteQuery,useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { AlertTriangle,Check,ChevronDown,ChevronLeft,ChevronRight,Copy,ExternalLink,LockKeyhole,MessageSquarePlus,RefreshCw } from "lucide-react";
import {
FEEDBACK_STATUSES,
FEEDBACK_STATUS_TRANSITIONS,
hasCustomerStatusRecipient,
type FeedbackStatus,
featureContextSchema,
feedbackConsentSnapshotSchema,
feedbackCustomerImpactSchema,
feedbackEvidenceTimelineSchema,
feedbackEventTrailSchema,
feedbackNetworkEntriesSchema,
feedbackSelectedTextSuggestionSchema,
feedbackSurveyResponseSchema,productContextSchema,
readPointSelectionFromExtraContext,
SEVERITY_LEVELS,
SEVERITY_META,
selectedElementSchema,
sessionReplayClipIdSchema,
STATUS_META,
type FeedbackDetailResponse,
type FeedbackAiCodingTaskResponse,
type FeedbackActivityItem,
type FeedbackConsentSnapshot,
type FeedbackCustomerImpact,
type FeedbackEngineeringLifecycle,type FeedbackEvidenceTimeline,
type FeedbackEventTrail,
type FeedbackExternalRef,
type FeatureContext,
type FeedbackNetworkEntries,
type FeedbackSelectedTextSuggestion,
type FeedbackSurveyResponse,
type PointSelection,
type ProductContext,
type SelectedElement
} from "@tracegenie/shared";

import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input,Textarea } from "../../components/ui/Input";
import { MutationRecovery,mutationRecoveryEntry,type MutationRecoveryEntry } from "../../components/ui/MutationRecovery";
import { SeverityIndicator } from "../../components/ui/SeverityIndicator";
import { StatusChip } from "../../components/ui/StatusChip";
import { useToast,ToastContainer } from "../../components/ui/Toast";
import { api,ApiError } from "../../lib/api";
import { cn } from "../../lib/utils";
import { copy } from "../../lib/copy";
import { formatFullDate,formatRelativeDate } from "../../lib/formatRelativeDate";
import { formatBytes } from "../../lib/utils";
import { FeedbackSubscribersCard } from "../../components/issues/FeedbackSubscribersCard";
import { useAdminFormExitGuard } from "../../components/guards/AdminFormExitGuard";
import { issueDetailReturnTo,issueDetailTab,issueListSearchParams,issueNeighborSearch,parseIssueWork,type IssueDetailTab } from "./issueWork";

type ConsoleEntryLike = { level?: string; message?: string };
type FeedbackDetail = FeedbackDetailResponse["feedback"];
type DuplicateGroup = NonNullable<FeedbackDetail["duplicateGroup"]>;
type DuplicateGroupRelease = DuplicateGroup["affectedReleases"][number];

type IssueMutationIdentity = {
  feedbackId: string;
  submissionId: number;
  routeVersion: number;
};
type IssueToastAction =
  | "copy-summary"
  | "reporter-question"
  | "labels"
  | "ticket-link"
  | "external-refs"
  | "status";
type IssueUpdateMutationVariables = IssueMutationIdentity & {
  payload: Record<string, unknown>;
};
type CopySummaryMutationVariables = IssueMutationIdentity & {
  summary: string;
};
type NoteStatusWorkflowVariables = IssueMutationIdentity & {
  note: {
    body: string;
    visibility: "internal" | "public";
    notifyRequester: false;
    clientRequestId: string;
  } | null;
  statusUpdate: Record<string, unknown> | null;
  completed: {
    note: boolean;
    status: boolean;
  };
};
type RequesterMessageVariables = IssueMutationIdentity & {
  message: string;
  clientRequestId: string;
  deliveryTarget: "requester_and_subscribers";
};
type SubscriberMutationAction =
  | { kind: "add"; body: Record<string, unknown> }
  | { kind: "update"; id: string; body: Record<string, unknown> }
  | { kind: "remove"; id: string };
type SubscriberMutationVariables = IssueMutationIdentity & {
  action: SubscriberMutationAction;
};
type NotificationReplayMutationVariables = IssueMutationIdentity & {
  notificationId: string;
};
type AiCodingTaskMutationVariables = IssueMutationIdentity;
type EvidenceGateOverrideMutationVariables = IssueMutationIdentity & {
  reason: string;
  expectedUpdatedAt: string;
};

const ISSUE_TOAST_ACTIONS: IssueToastAction[] = [
  "copy-summary",
  "reporter-question",
  "labels",
  "ticket-link",
  "external-refs",
  "status",
];

function issueToastScope(feedbackId: string, action: IssueToastAction) {
  return `issue:${feedbackId}:${action}`;
}

function issueUpdateLabel(payload: Record<string, unknown> | undefined) {
  if (!payload) return "issue changes";
  if ("status" in payload) return "status change";
  if ("severity" in payload) return "severity change";
  if ("ownerId" in payload) return "owner change";
  if ("labels" in payload) return "label changes";
  if ("duplicateOfId" in payload) return "duplicate link";
  if ("externalRefs" in payload || "externalTicketRef" in payload) return "external links";
  if ("engineeringLifecycle" in payload) {
    return payload.engineeringLifecycle === null ? "engineering lifecycle details" : "engineering lifecycle";
  }
  return "issue changes";
}

function issueUpdateSuccessLabel(payload: Record<string, unknown> | undefined) {
  if (payload && "engineeringLifecycle" in payload && payload.engineeringLifecycle === null) {
    return "Engineering lifecycle details removed";
  }
  return `${issueUpdateLabel(payload).replace(/^./, (letter) => letter.toUpperCase())} saved`;
}

function issueUpdateFailureMessage(payload: Record<string, unknown> | undefined, issueLabel: string) {
  if (payload && "engineeringLifecycle" in payload && payload.engineeringLifecycle === null) {
    return `Couldn't remove the engineering lifecycle details for ${issueLabel}.`;
  }
  return `Couldn't save the ${issueUpdateLabel(payload)} for ${issueLabel}.`;
}

function issueUpdateRetryLabel(payload: Record<string, unknown> | undefined) {
  if (payload && "engineeringLifecycle" in payload && payload.engineeringLifecycle === null) {
    return "Retry removing lifecycle details";
  }
  return `Retry saving ${issueUpdateLabel(payload)}`;
}

function subscriberActionLabel(action: SubscriberMutationAction | undefined) {
  if (action?.kind === "add") return "adding the recipient";
  if (action?.kind === "remove") return "disabling the recipient";
  return "updating the recipient";
}

function subscriberSuccessLabel(action: SubscriberMutationAction | undefined) {
  if (action?.kind === "add") return "Recipient added";
  if (action?.kind === "remove") return "Recipient disabled";
  return "Recipient updated";
}

function noteStatusWorkflowLabel(workflow: NoteStatusWorkflowVariables | undefined) {
  const note = workflow?.note?.visibility === "public" ? "customer reply" : "internal note";
  return workflow?.statusUpdate ? `${note} and status change` : note;
}

function remainingNoteStatusWorkflowLabel(workflow: NoteStatusWorkflowVariables | undefined) {
  const noteRemaining = Boolean(workflow?.note && !workflow.completed.note);
  const statusRemaining = Boolean(workflow?.statusUpdate && !workflow.completed.status);
  if (noteRemaining && statusRemaining) return noteStatusWorkflowLabel(workflow);
  if (statusRemaining) return "status change";
  return "internal note";
}

function noteStatusWorkflowSuccess(workflow: NoteStatusWorkflowVariables | undefined) {
  const label = noteStatusWorkflowLabel(workflow).replace(/^./, (letter) => letter.toUpperCase());
  return `${label} saved`;
}
type EvidenceTimelineItem = {
  id: string;
  label: string;
  detail: string;
  at?: string | Date | null;
};
type EvidenceQualityMetric = {
  key: EvidenceQualityKey;
  label: string;
  present: boolean;
  question: string;
};
type EvidenceQualityKey = "screenshot" | "url" | "console-error" | "steps" | "release" | "account" | "reporter" | "repro-confidence";
type EvidenceGateOverride = {
  reason: string;
  evidenceScore: number;
  missing: EvidenceQualityKey[];
  createdAt: string;
};
type EvidenceQuality = {
  score: number;
  label: string;
  tone: "success" | "warning" | "danger";
  metrics: EvidenceQualityMetric[];
  missing: EvidenceQualityMetric[];
};
const ISSUE_RETAINED_SEARCH_PARAMS = ["tab"] as const;

/* Soft-input override: hide the resting border, lift with a whisper shadow.
   Focus border + ring come from the shared Input/Textarea primitives. */
const SOFT_INPUT = "border-transparent bg-surface-muted/55 focus:bg-surface";
const DETAIL_CONTEXT_LIST = "grid gap-x-8 gap-y-3 rounded-xl bg-surface-muted/50 p-4";
const REQUESTER_UPDATE_DUE_MS = 7 * 24 * 60 * 60 * 1000;
const REQUESTER_UPDATE_EVENTS = new Set(["triage_requester", "status_change_requester", "fixed_requester", "reopen_requester"]);
const REQUESTER_UPDATE_ACTIVE_STATUSES = new Set(["new", "triaged", "blocked", "backlog", "in_progress"]);

const EXTERNAL_REF_PROVIDER_OPTIONS: Array<{ value: FeedbackExternalRef["provider"]; label: string }> = [
  { value: "github", label: "GitHub" },
  { value: "linear", label: "Linear" },
  { value: "jira", label: "Jira" },
  { value: "sentry", label: "Sentry" },
  { value: "posthog", label: "PostHog" },
  { value: "launchdarkly", label: "LaunchDarkly" },
  { value: "zendesk", label: "Zendesk" },
  { value: "intercom", label: "Intercom" },
  { value: "other", label: "Other" },
];

function blankExternalRef(): FeedbackExternalRef {
  return {
    provider: "github",
    label: "",
    url: "",
  };
}

function providerLabel(provider: FeedbackExternalRef["provider"]) {
  return EXTERNAL_REF_PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ?? "Other";
}

function externalRefTarget(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return {
      href: parsed.href,
      hostname: parsed.hostname.replace(/^www\./, ""),
    };
  } catch {
    return null;
  }
}

function ExternalRefDisplay({ externalRef }: { externalRef: FeedbackExternalRef }) {
  const target = externalRefTarget(externalRef.url);
  const provider = providerLabel(externalRef.provider);
  const hostLabel = target?.hostname ?? "Unsupported link protocol";
  const content = (
    <span className="flex min-w-0 items-center gap-2">
      <Badge tone={externalRef.provider === "sentry" || externalRef.provider === "posthog" ? "primary" : "neutral"}>
        {provider}
      </Badge>
      <span className="min-w-0">
        <span className="block truncate font-medium">{externalRef.label}</span>
        <span className="block truncate text-caption text-muted">{hostLabel}</span>
      </span>
    </span>
  );

  if (!target) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2 text-label text-foreground shadow-panel">
        {content}
      </div>
    );
  }

  return (
    <a
      className="group flex min-h-11 items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2 text-label text-foreground shadow-panel transition hover:bg-surface-muted/60"
      href={target.href}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${provider} link: ${externalRef.label} on ${hostLabel} in a new tab`}
    >
      {content}
      <ExternalLink className="size-4 shrink-0 text-muted transition group-hover:text-primary" />
    </a>
  );
}

/* ── Primitives ── */

/** Section heading. One weight, near-black, no shouty uppercase. */
function SectionHead({ children }: { children: React.ReactNode }) {
  return <h2 className="text-label font-semibold text-foreground">{children}</h2>;
}

/** Labelled control wrapper. Label sits above the field. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="mb-1.5 block text-caption font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}

function AiCodingTaskPreview({
  task,
  copyState,
  onCopy,
  onClose,
}: {
  task: FeedbackAiCodingTaskResponse;
  copyState: "idle" | "copying" | "copied" | "error";
  onCopy: () => void;
  onClose: () => void;
}) {
  const { preview } = task;
  const repositoryLabel = preview.repository.worktreePath ?? preview.repository.url ?? "Not configured";

  return (
    <section
      id="issue-ai-coding-task-preview"
      className="border-y border-primary/20 bg-primary/[0.025] px-6 py-5 md:px-8"
      aria-labelledby="issue-ai-coding-task-title"
      tabIndex={-1}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-caption font-medium uppercase text-primary">Review before use</p>
          <h2 id="issue-ai-coding-task-title" className="mt-1 text-title text-foreground">
            AI coding task for #{preview.ticket.number}
          </h2>
          <p className="mt-1 max-w-3xl text-caption leading-relaxed text-muted">
            This preview is evidence-backed and read-only. Copying it never runs commands, changes code, or contacts the reporter.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button tone="secondary" onClick={onClose}>Close preview</Button>
          <Button onClick={onCopy} disabled={copyState === "copying"}>
            {copyState === "copied" ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copyState === "copying" ? "Copying prompt..." : copyState === "copied" ? "Prompt copied" : "Copy prompt"}
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-x-8 gap-y-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-5">
          <div>
            <p className="text-caption font-semibold text-muted">Ticket evidence</p>
            <p className="mt-1 text-label font-semibold text-foreground">{preview.ticket.title}</p>
            <p className="mt-1 break-words text-caption text-muted">
              {preview.ticket.severity} · {preview.ticket.status}
              {preview.ticket.release ? ` · ${preview.ticket.release}` : ""}
            </p>
            {preview.ticket.url ? <p className="mt-1 break-all text-caption text-muted">{preview.ticket.url}</p> : null}
          </div>

          <div>
            <p className="text-caption font-semibold text-muted">Repository and worktree</p>
            <p className="mt-1 break-all font-mono text-caption text-foreground">{repositoryLabel}</p>
            <p className="mt-1 text-caption text-muted">
              Default branch: {preview.repository.defaultBranch ?? "Not configured"}
            </p>
          </div>

          <div>
            <p className="text-caption font-semibold text-muted">Files to inspect</p>
            {preview.filesToInspect.length > 0 ? (
              <ul className="mt-1 space-y-1" aria-label="Files to inspect">
                {preview.filesToInspect.map((file) => <li key={file} className="break-all font-mono text-caption text-foreground">{file}</li>)}
              </ul>
            ) : <p className="mt-1 text-caption text-warning-foreground">No validated file hints are available.</p>}
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <div>
            <p className="text-caption font-semibold text-muted">Verification commands</p>
            <dl className="mt-1 space-y-1 text-caption">
              <div><dt className="inline text-muted">Test: </dt><dd className="inline break-all font-mono text-foreground">{preview.commands.test ?? "Not configured"}</dd></div>
              <div><dt className="inline text-muted">Build: </dt><dd className="inline break-all font-mono text-foreground">{preview.commands.build ?? "Not configured"}</dd></div>
            </dl>
          </div>

          <div>
            <p className="text-caption font-semibold text-muted">Expected outcome</p>
            {preview.expectedOutcome.length > 0 ? (
              <ul className="mt-1 space-y-1 text-caption text-foreground">
                {preview.expectedOutcome.map((outcome) => <li key={outcome}>{outcome}</li>)}
              </ul>
            ) : <p className="mt-1 text-caption text-warning-foreground">No outcome is documented. The prompt names this gap instead of guessing.</p>}
          </div>

          <div>
            <p className="text-caption font-semibold text-muted">Evidence gaps</p>
            {preview.evidenceGaps.length > 0 ? (
              <p className="mt-1 text-caption leading-relaxed text-warning-foreground">{preview.evidenceGaps.join(" · ")}</p>
            ) : <p className="mt-1 text-caption text-success-700">No required context gaps detected.</p>}
          </div>

          <div>
            <p className="text-caption font-semibold text-muted">Owner and reviewer hints</p>
            {preview.ownerHints.length > 0 ? (
              <ul className="mt-1 space-y-1 text-caption text-foreground">
                {preview.ownerHints.map((hint) => <li key={`${hint.file}-${hint.pattern}`}>{hint.file}: {hint.owners.join(", ")}</li>)}
              </ul>
            ) : <p className="mt-1 text-caption text-muted">No validated owner mapping matches the current file hints.</p>}
            <p className="mt-1 text-caption text-muted">Review policy: {preview.reviewerPolicy.replaceAll("_", " ").toLowerCase()}</p>
          </div>
        </div>
      </div>

      <p
        className={cn("mt-5 text-caption", copyState === "error" ? "text-danger" : "text-muted")}
        role={copyState === "error" ? "alert" : "status"}
        aria-live={copyState === "error" ? "assertive" : "polite"}
      >
        {copyState === "error"
          ? "The prompt could not be copied. Clipboard access may be blocked; retry Copy prompt."
          : copyState === "copied"
            ? "The reviewed prompt is now on your clipboard."
            : "Private reporter identity, account values, storage keys, URL query data, and detected secrets are excluded."}
      </p>
    </section>
  );
}

/** Quiet select: rich display with a transparent native control on top.
    Borderless white chip that lifts on hover; accent ring on focus. */
function OverlaySelect({
  id,
  value,
  onChange,
  options,
  display,
  ariaLabel,
  disabled = false,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  display: React.ReactNode;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <div id={id} className={cn("relative", disabled ? "cursor-not-allowed opacity-70" : "")}>
      <div
        className={cn(
          "flex h-10 items-center justify-between gap-2 rounded-xl border border-border/25 bg-surface-muted/45 px-3 transition-colors focus-within:border-primary/55 focus-within:bg-surface focus-within:ring-2 focus-within:ring-primary/15",
          disabled ? "text-muted" : "hover:bg-surface",
        )}
      >
        <span className="min-w-0 truncate">{display}</span>
        <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
      </div>
      <select
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={cn("absolute inset-0 w-full opacity-0", disabled ? "cursor-not-allowed" : "cursor-pointer")}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Initials avatar. White circle lifted by a soft shadow — no border, no grey. */


function FactItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-7 min-w-0 max-w-full items-center gap-2 text-label">
      <p className="shrink-0 text-muted">{label}</p>
      <div className="flex min-w-0 items-center font-medium text-foreground">
        {typeof children === "string" ? <span className="truncate">{children}</span> : children}
      </div>
    </div>
  );
}

function ScreenshotPreview({
  attachment,
  attachmentCount,
  pointSelection,
}: {
  attachment: FeedbackDetail["attachments"][number];
  attachmentCount: number;
  pointSelection: PointSelection | null;
}) {
  const [failed, setFailed] = useState(false);
  const originalLinkRef = useRef<HTMLAnchorElement>(null);

  return (
    <div className="mt-3 overflow-hidden rounded-xl bg-surface-muted/50">
      {failed ? (
        <div className="flex flex-wrap items-start gap-3 p-4" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-label font-medium text-foreground">Screenshot preview unavailable</p>
            <p className="mt-1 text-caption text-muted">Try loading it again or open the original attachment.</p>
          <Button type="button" tone="ghost" className="mt-2 gap-2" onClick={() => {
            setFailed(false);
            originalLinkRef.current?.focus();
          }}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry preview
          </Button>
          </div>
        </div>
      ) : (
        <a href={attachment.downloadUrl} target="_blank" rel="noreferrer" className="tg-screenshot-link block focus-visible:outline-2 focus-visible:outline-primary">
          <div className="relative mx-auto aspect-[16/10] w-full max-w-lg">
            <img src={attachment.downloadUrl} alt={attachment.fileName} onError={() => setFailed(true)} className="size-full object-contain" />
            {pointSelection ? <ScreenshotPointOverlay pointSelection={pointSelection} /> : null}
          </div>
        </a>
      )}
      <a ref={originalLinkRef} href={attachment.downloadUrl} target="_blank" rel="noreferrer" className="tg-inline-link flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-caption text-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
        <span className="truncate">{failed ? "Open original attachment" : attachmentCount === 1 ? "Open full screenshot" : `Open screenshot (${attachmentCount} attached)`}</span>
        <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
      </a>
    </div>
  );
}

function ConsoleLog({ entries }: { entries: unknown }) {
  if (!entries) return <p className="text-body text-muted">No console output captured.</p>;

  if (Array.isArray(entries) && entries.every((entry) => entry && typeof entry === "object")) {
    const rows = entries as ConsoleEntryLike[];
    return (
      <div className="max-h-64 overflow-y-auto rounded-xl bg-code px-3 py-2.5 shadow-soft">
        {rows.map((entry, index) => (
          <p
            key={index}
            className={cn(
              "whitespace-pre-wrap break-words py-0.5 font-mono text-caption leading-relaxed",
              entry.level === "error"
                ? "text-danger-200"
                : entry.level === "warn"
                  ? "text-warning"
                  : "text-code-text/80",
            )}
          >
            <span className="select-none opacity-50">[{entry.level ?? "log"}]</span> {entry.message ?? ""}
          </p>
        ))}
      </div>
    );
  }

  return (
    <pre className="max-h-64 overflow-auto rounded-xl bg-code p-3 font-mono text-caption text-code-text shadow-soft">
      {JSON.stringify(entries, null, 2)}
    </pre>
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function ClientErrorPanel({ clientErrorContext }: { clientErrorContext: unknown }) {
  const record = asRecord(clientErrorContext);
  const summary = clientErrorSummary(clientErrorContext);
  const source = asText(record?.source);
  const stack = asText(record?.stack);

  if (!summary && !source && !stack) {
    return null;
  }

  return (
    <section id="issue-client-error-stack" className="space-y-2.5">
      <SectionHead>Client error</SectionHead>
      <div className="border-y border-border/35 py-3">
        {summary ? (
          <p className="whitespace-pre-wrap break-words text-body font-medium leading-relaxed text-foreground">{summary}</p>
        ) : null}
        {source ? (
          <p className="mt-2 break-words font-mono text-caption text-muted">source: {source}</p>
        ) : null}
        {stack ? (
          <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-code p-3 font-mono text-caption leading-relaxed text-code-text shadow-soft">
            {stack}
          </pre>
        ) : null}
      </div>
    </section>
  );
}

function arrayCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function joinContextParts(values: Array<string | null | undefined>) {
  const parts = values.filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(", ") : null;
}

function readProductContext(extraContext: unknown): ProductContext | null {
  const record = asRecord(extraContext);
  if (!record) {
    return null;
  }
  const result = productContextSchema.safeParse(record.productContext);
  return result.success ? result.data : null;
}

function readEvidenceGateOverride(extraContext: unknown): EvidenceGateOverride | null {
  const value = asRecord(asRecord(extraContext)?.evidenceGateOverride);
  if (
    !value
    || typeof value.reason !== "string"
    || typeof value.evidenceScore !== "number"
    || !Array.isArray(value.missing)
    || typeof value.createdAt !== "string"
  ) {
    return null;
  }
  return value as EvidenceGateOverride;
}

function readFeatureContext(extraContext: unknown): FeatureContext | null {
  const record = asRecord(extraContext);
  const result = featureContextSchema.safeParse(record?.featureContext);
  return result.success ? result.data : null;
}

function readEventTrail(extraContext: unknown): FeedbackEventTrail {
  const record = asRecord(extraContext);
  const result = feedbackEventTrailSchema.safeParse(record?.eventTrail);
  return result.success ? result.data : [];
}

function readEvidenceTimeline(extraContext: unknown): FeedbackEvidenceTimeline {
  const record = asRecord(extraContext);
  const result = feedbackEvidenceTimelineSchema.safeParse(record?.evidenceTimeline);
  return result.success ? result.data : [];
}

function readNetworkEntries(extraContext: unknown): FeedbackNetworkEntries {
  const record = asRecord(extraContext);
  const result = feedbackNetworkEntriesSchema.safeParse(record?.networkEntries);
  return result.success ? result.data : [];
}

function readSurveyResponse(extraContext: unknown): FeedbackSurveyResponse | null {
  const record = asRecord(extraContext);
  const result = feedbackSurveyResponseSchema.safeParse(record?.surveyResponse);
  return result.success ? result.data : null;
}

function readSelectedTextSuggestion(extraContext: unknown): FeedbackSelectedTextSuggestion | null {
  const record = asRecord(extraContext);
  const result = feedbackSelectedTextSuggestionSchema.safeParse(record?.selectedTextSuggestion);
  return result.success ? result.data : null;
}

function readSelectedElement(extraContext: unknown): SelectedElement | null {
  const record = asRecord(extraContext);
  const result = selectedElementSchema.safeParse(record?.selectedElement);
  return result.success ? result.data : null;
}

function selectedElementFromPointSelection(pointSelection: PointSelection | null): SelectedElement | null {
  if (!pointSelection || pointSelection.mode !== "element") {
    return null;
  }

  const result = selectedElementSchema.safeParse({
    tagName: pointSelection.tagName,
    role: pointSelection.role,
    label: pointSelection.label,
  });
  return result.success ? result.data : null;
}

function readCustomerImpact(extraContext: unknown): FeedbackCustomerImpact | null {
  const record = asRecord(extraContext);
  const result = feedbackCustomerImpactSchema.safeParse(record?.customerImpact);
  return result.success ? result.data : null;
}

function readConsentSnapshot(extraContext: unknown): FeedbackConsentSnapshot | null {
  const record = asRecord(extraContext);
  const result = feedbackConsentSnapshotSchema.safeParse(record?.consentSnapshot);
  return result.success ? result.data : null;
}

function readSessionReplayClipId(extraContext: unknown): string | null {
  const record = asRecord(extraContext);
  const result = sessionReplayClipIdSchema.safeParse(record?.sessionReplayClipId);
  return result.success ? result.data : null;
}

function productContextSummary(productContext: ProductContext) {
  const experiments = Object.entries(productContext.experiments ?? {})
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${value}`);

  return joinContextParts([
    productContext.account ? joinContextParts([productContext.account.name, productContext.account.id]) : null,
    productContext.customer ? joinContextParts([productContext.customer.segment, productContext.customer.cohort]) : null,
    productContext.plan ? joinContextParts([productContext.plan.name, productContext.plan.tier]) : null,
    productContextRevenue(productContext),
    productContext.feature ? joinContextParts([productContext.feature.area, productContext.feature.key]) : null,
    productContext.funnelStep,
    ...experiments,
  ]);
}

function evidenceExtraContextSummary(extraContext: unknown, pointSelection: PointSelection | null) {
  const record = asRecord(extraContext);
  if (!record) {
    return null;
  }
  const keys = Object.keys(record).filter((key) => ![
    "consentSnapshot",
    "evidenceTimeline",
    "eventTrail",
    "customerImpact",
    "externalRefs",
    "featureContext",
    "networkEntries",
    "pointSelection",
    "productContext",
    "selectedElement",
    "selectedTextSuggestion",
    "sessionReplayClipId",
    "surveyResponse",
  ].includes(key));
  if (keys.length === 0) {
    return pointSelection ? "Point selection captured." : null;
  }
  return `Extra context captured: ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ` and ${keys.length - 4} more` : ""}.`;
}

function truncateEvidenceText(value: string, length = 220) {
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function customerImpactMoney(customerImpact: FeedbackCustomerImpact) {
  if (!customerImpact.revenueAtRisk) {
    return null;
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: customerImpact.revenueAtRisk.currency,
    maximumFractionDigits: 0,
  }).format(customerImpact.revenueAtRisk.amount);
}

function productContextMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function productContextRevenue(productContext: ProductContext) {
  if (!productContext.revenue?.currency) {
    return null;
  }

  return joinContextParts([
    productContext.revenue.mrr !== undefined ? `${productContextMoney(productContext.revenue.mrr, productContext.revenue.currency)} MRR` : null,
    productContext.revenue.arr !== undefined ? `${productContextMoney(productContext.revenue.arr, productContext.revenue.currency)} ARR` : null,
  ]);
}

function customerImpactSummary(customerImpact: FeedbackCustomerImpact) {
  const revenueAtRisk = customerImpactMoney(customerImpact);
  return joinContextParts([
    customerImpact.summary,
    customerImpact.affectedUsers !== undefined ? `${customerImpact.affectedUsers} affected ${customerImpact.affectedUsers === 1 ? "user" : "users"}` : null,
    customerImpact.affectedAccounts !== undefined ? `${customerImpact.affectedAccounts} affected ${customerImpact.affectedAccounts === 1 ? "account" : "accounts"}` : null,
    revenueAtRisk ? `${revenueAtRisk} at risk` : null,
    customerImpact.churnRisk ? `${humanizeToken(customerImpact.churnRisk)} churn risk` : null,
  ]);
}

function consentEvidenceState(state: { allowed: boolean; included: boolean }) {
  if (state.included) {
    return "Included";
  }

  return state.allowed ? "Not included" : "Disabled";
}

function consentSnapshotRows(consentSnapshot: FeedbackConsentSnapshot) {
  return [
    { label: "Screenshot", state: consentSnapshot.screenshot },
    { label: "Point selection", state: consentSnapshot.pointSelection },
    { label: "Console", state: consentSnapshot.console },
    { label: "Client error", state: consentSnapshot.clientError },
    { label: "Network", state: consentSnapshot.network },
    { label: "Selected text", state: consentSnapshot.selectedText },
  ];
}

function consentSnapshotSummary(consentSnapshot: FeedbackConsentSnapshot) {
  const included = consentSnapshotRows(consentSnapshot)
    .filter((row) => row.state.included)
    .map((row) => row.label.toLowerCase());

  return included.length > 0
    ? `Included: ${included.join(", ")}.`
    : "No optional evidence included.";
}

function featureContextSummary(featureContext: FeatureContext) {
  return joinContextParts([featureContext.area, featureContext.key]);
}

function selectedElementSummary(selectedElement: SelectedElement) {
  return joinContextParts([selectedElement.label, selectedElement.role, selectedElement.tagName]);
}

function eventPropertiesSummary(properties: Record<string, unknown> | undefined) {
  const keys = Object.keys(properties ?? {});
  if (keys.length === 0) {
    return null;
  }

  return `Properties captured: ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ` and ${keys.length - 4} more` : ""}.`;
}

function networkSummary(entries: FeedbackNetworkEntries) {
  const failedCount = entries.filter((entry) => entry.error || (entry.statusCode && entry.statusCode >= 400)).length;
  return `${entries.length} recent network ${entries.length === 1 ? "request" : "requests"} captured${failedCount > 0 ? `; ${failedCount} failed or returned errors` : ""}.`;
}

function clientErrorSummary(clientErrorContext: unknown) {
  const record = asRecord(clientErrorContext);
  if (!record) {
    return clientErrorContext ? "Client error context captured." : null;
  }
  const message = asText(record.message);
  const name = asText(record.name);
  if (name && message) {
    return `${name}: ${message}`;
  }
  return message ?? name ?? "Client error context captured.";
}

function surveyTypeLabel(type: FeedbackSurveyResponse["type"]) {
  return type.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function surveyResponseSummary(surveyResponse: FeedbackSurveyResponse) {
  return [
    surveyResponse.question,
    surveyResponse.score !== undefined ? `Score ${surveyResponse.score}` : null,
    surveyResponse.choice,
    surveyResponse.answer,
  ].filter(Boolean).join(" · ");
}

function duplicateReleaseLabel(release: DuplicateGroupRelease) {
  return `${release.appName} ${release.appVersion}${release.buildNumber ? ` (${release.buildNumber})` : ""}`;
}

function duplicateReleaseMeta(release: DuplicateGroupRelease) {
  return [release.appEnvironment, release.releaseChannel].filter(Boolean).join(" · ");
}

function fixedReleaseSignalLabel(signal: NonNullable<FeedbackDetail["releaseSignal"]>) {
  return [
    signal.fixedRelease.appVersion,
    signal.fixedRelease.buildNumber ? `build ${signal.fixedRelease.buildNumber}` : null,
    signal.fixedRelease.releaseChannel,
  ].filter(Boolean).join(" · ");
}

function requesterUpdateDueState(fb: FeedbackDetail, canEmailRequester: boolean) {
  if (!canEmailRequester || !REQUESTER_UPDATE_ACTIVE_STATUSES.has(fb.status)) {
    return null;
  }

  const sentRequesterUpdates = fb.notificationHistory
    .filter((notification) => notification.recipientType.toLowerCase() === "requester" && REQUESTER_UPDATE_EVENTS.has(notification.eventType) && notification.status === "sent")
    .map((notification) => new Date(notification.sentAt ?? notification.createdAt))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());
  const lastRequesterUpdateAt = sentRequesterUpdates[0] ?? null;
  const dueFrom = lastRequesterUpdateAt ?? new Date(fb.createdAt);
  const dueAt = new Date(dueFrom.getTime() + REQUESTER_UPDATE_DUE_MS);

  return dueAt <= new Date()
    ? {
        lastRequesterUpdateAt,
      }
    : null;
}

function notificationStatusCounts(fb: FeedbackDetail) {
  return fb.notificationHistory.reduce((counts, notification) => {
    if (notification.recipientType.toLowerCase() !== "requester" || !REQUESTER_UPDATE_EVENTS.has(notification.eventType)) return counts;
    counts[notification.status] = (counts[notification.status] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
}

function lastRequesterUpdate(fb: FeedbackDetail) {
  return fb.notificationHistory
    .filter((notification) => notification.recipientType.toLowerCase() === "requester" && REQUESTER_UPDATE_EVENTS.has(notification.eventType) && notification.status === "sent")
    .map((notification) => new Date(notification.sentAt ?? notification.createdAt))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}

function RequesterLoopSummary({ fb, canEmailRequester }: { fb: FeedbackDetail; canEmailRequester: boolean }) {
  const counts = notificationStatusCounts(fb);
  const lastUpdate = lastRequesterUpdate(fb);
  const acknowledgement = fb.notificationHistory.find((notification) => notification.recipientType.toLowerCase() === "requester"
    && notification.eventType === "requester_confirmation" && notification.status === "sent");

  return (
    <section id="issue-requester-loop-summary" className="mt-4 rounded-2xl border border-border/25 bg-surface-muted/35 px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-label font-semibold text-foreground">Reporter updates</h3>
          <p className="mt-1 text-caption leading-relaxed text-muted">
            {canEmailRequester
              ? "Customer replies are emailed on save. Internal notes stay private."
              : fb.reporter.email ? "Reporter email is paused and no enabled recipients are available." : "No reply channel is available. Investigate internally or add a known recipient."}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-1 text-caption font-medium", canEmailRequester ? "bg-success-50 text-success-700" : "bg-warning-50 text-warning-700")}>
          {canEmailRequester ? "Enabled" : fb.reporter.email ? "Paused" : "No reply channel"}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-caption">
        <div>
          <dt className="text-muted">Sent</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-foreground">{counts.sent ?? 0}</dd>
        </div>
        <div>
          <dt className="text-muted">Skipped</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-foreground">{counts.skipped ?? 0}</dd>
        </div>
        <div>
          <dt className="text-muted">Failed</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-foreground">{counts.failed ?? 0}</dd>
        </div>
      </dl>
      {acknowledgement ? <p className="mt-3 text-caption text-muted">Submission acknowledgement sent. Counted separately from progress updates.</p> : null}
      <p className="mt-3 text-caption leading-relaxed text-muted">
        {lastUpdate ? `Last reporter update ${formatRelativeDate(lastUpdate)}.` : "No reporter update has been sent yet."}
      </p>
    </section>
  );
}

function buildEvidenceQuality(fb: FeedbackDetail, productContext: ProductContext | null): EvidenceQuality {
  const hasConsoleOrError = arrayCount(fb.consoleEntries) > 0 || Boolean(fb.clientErrorContext);
  const hasSteps = Boolean(fb.stepsToReproduce?.trim());
  const hasOutcome = Boolean(fb.expectedResult?.trim() || fb.actualResult?.trim());
  const confidencePresent = hasSteps && (hasConsoleOrError || fb.attachments.length > 0 || hasOutcome);
  const metrics: EvidenceQualityMetric[] = [
    {
      key: "screenshot",
      label: "Attachment",
      present: fb.attachments.length > 0,
      question: "Can you attach a screenshot or screen recording of what you saw?",
    },
    {
      key: "url",
      label: "URL",
      present: Boolean(fb.route.url),
      question: "Can you share the exact page URL where this happened?",
    },
    {
      key: "console-error",
      label: "Console/error",
      present: hasConsoleOrError,
      question: "Can you paste the console error, error toast, or exact message shown before this happened?",
    },
    {
      key: "steps",
      label: "Steps",
      present: hasSteps,
      question: "Can you confirm the button or action you clicked immediately before this happened?",
    },
    {
      key: "release",
      label: "Release",
      present: Boolean(fb.release.appVersion || fb.release.buildNumber || fb.release.releaseChannel),
      question: "Can you confirm the app version, build, or release where this happened?",
    },
    {
      key: "account",
      label: "Account",
      present: Boolean(productContext?.account?.id || productContext?.account?.name || productContext?.customer?.id),
      question: "Can you confirm the account or workspace where this happened?",
    },
    {
      key: "reporter",
      label: "Reporter",
      present: Boolean(fb.reporter.email || fb.reporter.name),
      question: "Can you confirm who reported this so we can follow up if needed?",
    },
    {
      key: "repro-confidence",
      label: "Repro confidence",
      present: confidencePresent,
      question: "Can you confirm whether this happens every time or only sometimes?",
    },
  ];
  const missing = metrics.filter((metric) => !metric.present);
  const score = Math.round(((metrics.length - missing.length) / metrics.length) * 100);

  return {
    score,
    label: score >= 75 ? "Context captured" : score >= 50 ? "Some context missing" : "Limited context",
    tone: score >= 75 ? "success" : score >= 50 ? "warning" : "danger",
    metrics,
    missing,
  };
}

function EvidenceQualityPanel({
  quality,
}: {
  quality: EvidenceQuality;
}) {
  return (
    <section id="issue-evidence-quality" className="rounded-xl bg-surface-muted/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionHead>Captured evidence</SectionHead>
          <p className="mt-1 text-caption leading-relaxed text-muted">
            {quality.missing.length > 0
              ? `Not captured: ${quality.missing.map((metric) => metric.label).join(", ")}.`
              : "All capture fields are present."}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-caption font-semibold tabular-nums",
            quality.tone === "success" && "bg-success-50 text-success-700",
            quality.tone === "warning" && "bg-warning-50 text-warning-700",
            quality.tone === "danger" && "bg-danger-50 text-danger-700",
          )}
        >
          {quality.label}
        </span>
      </div>
      <p className="mt-2 text-caption text-muted">Capture completeness does not confirm that the issue is reproducible or that attachments are usable.</p>
      <div id="issue-evidence-quality-actions" className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <details id="issue-evidence-quality-details" className="min-w-0">
          <summary className="tg-disclosure-summary cursor-pointer text-caption font-medium text-muted hover:text-foreground">
            View evidence details
          </summary>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {quality.metrics.map((metric) => (
              <div key={metric.key} className="flex items-center justify-between gap-2 py-1.5 text-caption sm:px-2">
                <span className="truncate text-muted">{metric.label}</span>
                <span className={cn("shrink-0 font-medium", metric.present ? "text-success-700" : "text-warning-700")}>
                  {metric.present ? "Captured" : "Missing"}
                </span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}

function buildEvidenceTimeline(
  fb: FeedbackDetail,
  pointSelection: PointSelection | null,
  productContext: ProductContext | null,
  hostEvidenceTimeline: FeedbackEvidenceTimeline,
  eventTrail: FeedbackEventTrail,
  networkEntries: FeedbackNetworkEntries,
  surveyResponse: FeedbackSurveyResponse | null,
  selectedTextSuggestion: FeedbackSelectedTextSuggestion | null,
  customerImpact: FeedbackCustomerImpact | null,
  consentSnapshot: FeedbackConsentSnapshot | null,
  featureContext: FeatureContext | null,
  sessionReplayClipId: string | null,
  selectedElement: SelectedElement | null,
): EvidenceTimelineItem[] {
  const consoleCount = arrayCount(fb.consoleEntries);
  const extraSummary = evidenceExtraContextSummary(fb.extraContext, pointSelection);
  const clientError = clientErrorSummary(fb.clientErrorContext);
  const events: EvidenceTimelineItem[] = [
    {
      id: "submitted",
      label: "Report submitted",
      detail: `${fb.reporter.name ?? fb.reporter.email ?? "Anonymous reporter"} sent the report from ${fb.route.url}.`,
      at: fb.createdAt,
    },
    {
      id: "route",
      label: "Page context",
      detail: fb.route.referrer
        ? `Page ${fb.route.url}; referrer ${fb.route.referrer}.`
        : `Page ${fb.route.url}.`,
      at: fb.clientTimestamp,
    },
    {
      id: "release",
      label: "Release context",
      detail: `${fb.release.appName} ${fb.release.appVersion}${fb.release.buildNumber ? ` (${fb.release.buildNumber})` : ""} in ${fb.release.appEnvironment}.`,
      at: fb.clientTimestamp,
    },
    {
      id: "browser",
      label: "Browser context",
      detail: `${fb.browser.browserName ?? "Unknown browser"} ${fb.browser.browserVersion ?? ""}`.trim()
        + ` on ${fb.browser.osName ?? "unknown OS"}; viewport ${fb.browser.viewportWidth} x ${fb.browser.viewportHeight}.`,
      at: fb.clientTimestamp,
    },
  ];

  for (const [index, event] of hostEvidenceTimeline.entries()) {
    events.push({
      id: `host-evidence-${index}`,
      label: event.label,
      detail: event.url ? `${event.detail} (${event.url})` : event.detail,
      at: event.timestamp,
    });
  }

  if (fb.attachments.length > 0) {
    events.push({
      id: "attachments",
      label: "Screenshot evidence",
      detail: `${fb.attachments.length} screenshot${fb.attachments.length === 1 ? "" : "s"} attached${pointSelection ? " with point selection" : ""}.`,
      at: fb.attachments[0]?.createdAt ?? fb.createdAt,
    });
  }
  if (selectedTextSuggestion) {
    events.push({
      id: "selected-text",
      label: "Selected text",
      detail: truncateEvidenceText(selectedTextSuggestion.text),
      at: selectedTextSuggestion.createdAt ?? fb.clientTimestamp,
    });
  }
  if (selectedElement) {
    events.push({
      id: "selected-element",
      label: "Selected element",
      detail: selectedElementSummary(selectedElement) ?? "Selected element captured.",
      at: fb.clientTimestamp,
    });
  }
  if (consoleCount > 0) {
    events.push({
      id: "console",
      label: "Console context",
      detail: `${consoleCount} recent console ${consoleCount === 1 ? "entry" : "entries"} captured.`,
      at: fb.clientTimestamp,
    });
  }
  if (clientError) {
    events.push({
      id: "client-error",
      label: "Client error",
      detail: clientError,
      at: fb.clientTimestamp,
    });
  }
  if (productContext) {
    events.push({
      id: "product-context",
      label: copy.detail.productContextTitle,
      detail: productContextSummary(productContext) ?? copy.detail.productContextCaptured,
      at: fb.clientTimestamp,
    });
  }
  if (customerImpact) {
    events.push({
      id: "customer-impact",
      label: "Customer impact",
      detail: customerImpactSummary(customerImpact) ?? "Customer impact captured.",
      at: fb.clientTimestamp,
    });
  }
  if (featureContext && !productContext?.feature) {
    events.push({
      id: "feature-context",
      label: "Feature context",
      detail: featureContextSummary(featureContext) ?? "Feature context captured.",
      at: fb.clientTimestamp,
    });
  }
  if (consentSnapshot) {
    events.push({
      id: "consent-snapshot",
      label: "Consent snapshot",
      detail: consentSnapshotSummary(consentSnapshot),
      at: consentSnapshot.capturedAt,
    });
  }
  if (sessionReplayClipId) {
    events.push({
      id: "session-replay",
      label: "Replay clip",
      detail: `Replay clip ${sessionReplayClipId} linked.`,
      at: fb.clientTimestamp,
    });
  }
  if (surveyResponse) {
    events.push({
      id: "survey-response",
      label: copy.detail.surveyResponseTitle,
      detail: surveyResponseSummary(surveyResponse),
      at: surveyResponse.submittedAt ?? fb.clientTimestamp,
    });
  }
  for (const [index, event] of eventTrail.entries()) {
    const propertiesSummary = eventPropertiesSummary(event.properties);
    events.push({
      id: `tracked-event-${index}`,
      label: `Tracked event: ${event.name}`,
      detail: propertiesSummary ? `${event.url}. ${propertiesSummary}` : `Reported from ${event.url}.`,
      at: event.timestamp,
    });
  }
  if (networkEntries.length > 0) {
    events.push({
      id: "network-summary",
      label: "Network summary",
      detail: networkSummary(networkEntries),
      at: networkEntries[networkEntries.length - 1]?.timestamp ?? fb.clientTimestamp,
    });
  }
  if (extraSummary) {
    events.push({
      id: "extra-context",
      label: "Extra context",
      detail: extraSummary,
      at: fb.clientTimestamp,
    });
  }

  return events.sort((left, right) => new Date(right.at ?? 0).getTime() - new Date(left.at ?? 0).getTime());
}

function SurveyResponsePanel({ surveyResponse }: { surveyResponse: FeedbackSurveyResponse }) {
  const rows = [
    { label: copy.detail.surveyResponseLabels.type, value: surveyTypeLabel(surveyResponse.type) },
    { label: copy.detail.surveyResponseLabels.question, value: surveyResponse.question ?? null },
    { label: copy.detail.surveyResponseLabels.score, value: surveyResponse.score !== undefined ? String(surveyResponse.score) : null },
    { label: copy.detail.surveyResponseLabels.choice, value: surveyResponse.choice ?? null },
    { label: copy.detail.surveyResponseLabels.answer, value: surveyResponse.answer ?? null },
  ].flatMap((row) => (row.value ? [{ label: row.label, value: row.value }] : []));

  return (
    <section id="issue-survey-response" className="space-y-3">
      <SectionHead>{copy.detail.surveyResponseTitle}</SectionHead>
      <dl id="issue-survey-response-list" className={cn(DETAIL_CONTEXT_LIST, "sm:grid-cols-2")}>
        {rows.map((row) => (
          <EnvRow key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>
    </section>
  );
}

function SelectedTextPanel({ selectedTextSuggestion }: { selectedTextSuggestion: FeedbackSelectedTextSuggestion }) {
  return (
    <section id="issue-selected-text" className="space-y-3">
      <SectionHead>Selected text</SectionHead>
      <div id="issue-selected-text-body" className="border-y border-border/35 py-3">
        <blockquote className="whitespace-pre-wrap break-words text-body leading-relaxed text-foreground">
          {selectedTextSuggestion.text}
        </blockquote>
        {selectedTextSuggestion.url ? (
          <p className="mt-3 text-caption text-muted">
            Captured from{" "}
            <a
              href={selectedTextSuggestion.url}
              target="_blank"
              rel="noreferrer"
              className="tg-inline-link inline-flex max-w-full items-center gap-1 align-bottom text-primary hover:underline"
            >
              <span className="truncate">{selectedTextSuggestion.url}</span>
              <ExternalLink className="size-3 shrink-0 opacity-60" />
            </a>
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SelectedElementPanel({ selectedElement }: { selectedElement: SelectedElement }) {
  return (
    <section id="issue-selected-element" className="space-y-3">
      <SectionHead>Selected element</SectionHead>
      <dl id="issue-selected-element-list" className={cn(DETAIL_CONTEXT_LIST, "sm:grid-cols-2")}>
        {selectedElement.label ? <EnvRow label="Label" value={selectedElement.label} /> : null}
        {selectedElement.role ? <EnvRow label="Role" value={selectedElement.role} /> : null}
        {selectedElement.tagName ? <EnvRow label="Tag" value={selectedElement.tagName} /> : null}
      </dl>
    </section>
  );
}

function CustomerImpactPanel({ customerImpact }: { customerImpact: FeedbackCustomerImpact }) {
  const rows = [
    { label: "Summary", value: customerImpact.summary ?? null },
    {
      label: "Affected users",
      value: customerImpact.affectedUsers !== undefined ? String(customerImpact.affectedUsers) : null,
    },
    {
      label: "Affected accounts",
      value: customerImpact.affectedAccounts !== undefined ? String(customerImpact.affectedAccounts) : null,
    },
    { label: "Revenue at risk", value: customerImpactMoney(customerImpact) },
    { label: "Churn risk", value: customerImpact.churnRisk ? humanizeToken(customerImpact.churnRisk) : null },
  ].flatMap((row) => (row.value ? [{ label: row.label, value: row.value }] : []));

  if (rows.length === 0) {
    return null;
  }

  return (
    <section id="issue-customer-impact" className="space-y-3">
      <SectionHead>Customer impact</SectionHead>
      <dl id="issue-customer-impact-list" className={cn(DETAIL_CONTEXT_LIST, "sm:grid-cols-2")}>
        {rows.map((row) => (
          <EnvRow key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>
    </section>
  );
}

function ConsentSnapshotPanel({ consentSnapshot }: { consentSnapshot: FeedbackConsentSnapshot }) {
  const rows = consentSnapshotRows(consentSnapshot);

  return (
    <section id="issue-consent-snapshot" className="space-y-3">
      <SectionHead>Consent snapshot</SectionHead>
      <dl id="issue-consent-snapshot-list" className={cn(DETAIL_CONTEXT_LIST, "sm:grid-cols-2")}>
        {rows.map((row) => (
          <EnvRow key={row.label} label={row.label} value={consentEvidenceState(row.state)} />
        ))}
        <EnvRow label="Attachments" value={String(consentSnapshot.attachmentCount)} />
      </dl>
    </section>
  );
}

function FeatureContextPanel({ featureContext }: { featureContext: FeatureContext }) {
  return (
    <section id="issue-feature-context" className="space-y-3">
      <SectionHead>Feature context</SectionHead>
      <dl id="issue-feature-context-list" className={cn(DETAIL_CONTEXT_LIST, "sm:grid-cols-2")}>
        {featureContext.area ? <EnvRow label="Area" value={featureContext.area} /> : null}
        {featureContext.key ? <EnvRow label="Feature key" value={featureContext.key} /> : null}
      </dl>
    </section>
  );
}

function SessionReplayPanel({ sessionReplayClipId }: { sessionReplayClipId: string }) {
  return (
    <section id="issue-session-replay" className="space-y-3">
      <SectionHead>Replay clip</SectionHead>
      <dl id="issue-session-replay-list" className={DETAIL_CONTEXT_LIST}>
        <EnvRow label="Clip ID" value={sessionReplayClipId} />
      </dl>
    </section>
  );
}

function ProductContextPanel({ productContext }: { productContext: ProductContext }) {
  const rows = [
    {
      label: copy.detail.productContextLabels.account,
      value: productContext.account ? joinContextParts([productContext.account.name, productContext.account.id]) : null,
    },
    {
      label: copy.detail.productContextLabels.customer,
      value: productContext.customer
        ? joinContextParts([productContext.customer.role, productContext.customer.segment, productContext.customer.cohort, productContext.customer.id])
        : null,
    },
    {
      label: copy.detail.productContextLabels.plan,
      value: productContext.plan ? joinContextParts([productContext.plan.name, productContext.plan.tier]) : null,
    },
    {
      label: copy.detail.productContextLabels.revenue,
      value: productContextRevenue(productContext),
    },
    {
      label: copy.detail.productContextLabels.feature,
      value: productContext.feature ? joinContextParts([productContext.feature.area, productContext.feature.key]) : null,
    },
    {
      label: copy.detail.productContextLabels.funnelStep,
      value: productContext.funnelStep ?? null,
    },
    {
      label: copy.detail.productContextLabels.release,
      value: productContext.release
        ? joinContextParts([productContext.release.version, productContext.release.buildNumber, productContext.release.channel])
        : null,
    },
  ].flatMap((row) => (row.value ? [{ label: row.label, value: row.value }] : []));
  const flags = Object.entries(productContext.featureFlags ?? {});
  const experiments = Object.entries(productContext.experiments ?? {});

  if (rows.length === 0 && flags.length === 0 && experiments.length === 0) {
    return null;
  }

  return (
    <section id="issue-product-context" className="space-y-3">
      <SectionHead>{copy.detail.productContextTitle}</SectionHead>
      {rows.length > 0 ? (
        <dl id="issue-product-context-list" className={cn(DETAIL_CONTEXT_LIST, "sm:grid-cols-2")}>
          {rows.map((row) => (
            <EnvRow key={row.label} label={row.label} value={row.value} />
          ))}
        </dl>
      ) : null}
      {flags.length > 0 ? (
        <div id="issue-product-feature-flags" className="border-t border-border/35 pt-3">
          <p className="text-caption text-muted">{copy.detail.productContextLabels.featureFlags}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {flags.map(([key, value]) => (
              <Badge key={key}>{`${key}: ${String(value)}`}</Badge>
            ))}
          </div>
        </div>
      ) : null}
      {experiments.length > 0 ? (
        <div id="issue-product-experiments" className="border-t border-border/35 pt-3">
          <p className="text-caption text-muted">{copy.detail.productContextLabels.experiments}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {experiments.map(([key, value]) => (
              <Badge key={key}>{`${key}: ${value}`}</Badge>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ScreenshotPointOverlay({ pointSelection }: { pointSelection: PointSelection }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {pointSelection.rectPct ? (
        <div
          className="absolute rounded-lg border border-primary/70 bg-primary/10 ring-1 ring-surface"
          style={{
            left: `${pointSelection.rectPct.left}%`,
            top: `${pointSelection.rectPct.top}%`,
            width: `${pointSelection.rectPct.width}%`,
            height: `${pointSelection.rectPct.height}%`,
          }}
        />
      ) : null}
      <div
        className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-surface bg-primary shadow-overlay"
        style={{
          left: `${pointSelection.xPct}%`,
          top: `${pointSelection.yPct}%`,
        }}
      />
    </div>
  );
}

/** One row in the environment list — separated by space, not lines. */
function EnvRow({ label, value, href }: { label: string; value: React.ReactNode; href?: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4">
      <dt className="shrink-0 text-caption text-muted">{label}</dt>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="group inline-flex min-h-10 min-w-0 flex-1 items-center justify-end gap-1 text-label text-primary hover:underline"
          data-tg-reflow-value="true"
        >
          <span className="truncate">{value}</span>
          <ExternalLink className="size-3 shrink-0 opacity-60" />
        </a>
      ) : (
        <dd className="min-w-0 flex-1 truncate text-right text-label text-foreground" data-tg-reflow-value="true">{value}</dd>
      )}
    </div>
  );
}

/* ── Activity timeline ── */

function activityOutcomeClass(outcome: FeedbackActivityItem["outcome"]) {
  if (outcome === "failed") return "border-danger/35 bg-danger/10 text-danger";
  if (outcome === "success") return "border-success/35 bg-success/10 text-success";
  if (outcome === "pending") return "border-warning/35 bg-warning/10 text-warning-foreground";
  return "border-border/40 bg-surface-muted/55 text-muted";
}

function activityOutcomeLabel(outcome: FeedbackActivityItem["outcome"]) {
  if (!outcome || outcome === "neutral") return null;
  return outcome.charAt(0).toUpperCase() + outcome.slice(1);
}

function humanizeToken(value: string | null | undefined) {
  return value ? value.replace(/[_-]/g, " ").toLowerCase() : "unknown";
}

export function IssueDetailPage() {
  const { feedbackId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toasts, addToast, dismissToast, dismissToastScope } = useToast();
  const legacySection = issueDetailTab(searchParams);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [controlTarget, setControlTarget] = useState<string | null>(null);
  const [managementOpen, setManagementOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const openIssueControl = (target: string, section?: IssueDetailTab) => {
    if (target === "issue-internal-note") setComposerMode("internal");
    if (target === "issue-requester-message" || target === "issue-requester-summary") setComposerMode("public");
    if (target.startsWith("issue-evidence") || section === "investigate") setTechnicalOpen(true);
    if (target === "issue-assignee-field" || target === "issue-engineering-lifecycle-field" || section === "resolve") setManagementOpen(true);
    if (target === "issue-engineering-lifecycle-field") setDeliveryOpen(true);
    if (target === "new-subscriber-email") setAddingSubscriber(true);
    if (section === "activity") setHistoryOpen(true);
    setControlTarget(target);
  };
  useEffect(() => {
    if (!controlTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const node = document.getElementById(controlTarget);
      if (!node) return;
      if (node instanceof HTMLDetailsElement) node.open = true;
      if (controlTarget === "new-subscriber-email") {
        const recipients = node.closest("details");
        if (recipients) recipients.open = true;
      }
      const scrollTarget = controlTarget === "new-subscriber-email"
        ? node.closest("#subscriber-add-section") ?? node
        : node.closest("#issue-update-panel") ?? node;
      scrollTarget.scrollIntoView?.({ block: scrollTarget === node ? "nearest" : "start" });
      const focusTarget = node.matches("textarea, input, select, button, [tabindex]") ? node
        : controlTarget === "issue-requester-message" ? node.querySelector<HTMLElement>("textarea")
        : node.querySelector<HTMLElement>("summary, textarea, input, select, button, a[href]");
      focusTarget?.focus();
      setControlTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [technicalOpen, historyOpen, controlTarget, managementOpen, deliveryOpen]);
  const [copySummaryCopied, setCopySummaryCopied] = useState(false);
  const [aiTaskPreview, setAiTaskPreview] = useState<FeedbackAiCodingTaskResponse | null>(null);
  const [aiTaskPreviewOpen, setAiTaskPreviewOpen] = useState(false);
  const [aiTaskCopyState, setAiTaskCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");

  const workParam = parseIssueWork(searchParams.get("work"));
  const backTo = issueDetailReturnTo(searchParams);
  const [mutationLockNotice, setMutationLockNotice] = useState(false);

  /* Prev/next ticket — follows the exact filtered/sorted slice the user came from,
     read straight out of the cached list query. Disabled at the edges; hidden when
     we have no list context (e.g. opened by direct link). */
  const neighbors = useMemo(() => {
    if (!feedbackId) return null;
    type ListLike = { items: Array<{ id: string }> } | undefined;
    const overviewList = searchParams.get("from") === "overview"
      ? queryClient.getQueryData<ListLike>(["feedback-list", "overview-priority"])
      : undefined;
    const exact = overviewList ?? queryClient.getQueryData<ListLike>(["feedback-list", issueListSearchParams(searchParams).toString()]);
    const candidates = exact
      ? [exact]
      : queryClient.getQueriesData<ListLike>({ queryKey: ["feedback-list"] }).map(([, data]) => data);
    for (const list of candidates) {
      const items = list?.items ?? [];
      const index = items.findIndex((item) => item.id === feedbackId);
      if (index !== -1) {
        return {
          prevId: index > 0 ? items[index - 1].id : null,
          nextId: index < items.length - 1 ? items[index + 1].id : null,
          position: index + 1,
          count: items.length,
        };
      }
    }
    return null;
  }, [feedbackId, searchParams, queryClient]);

  const goToTicket = useCallback(
    (id: string | null) => {
      if (!id) return;
      const nextParams = new URLSearchParams(issueNeighborSearch(searchParams));
      const query = nextParams.toString();
      navigate(`/issues/${id}${query ? `?${query}` : ""}`);
    },
    [navigate, searchParams],
  );

  const detailQuery = useQuery({
    queryKey: ["feedback-detail", feedbackId],
    queryFn: () => api.getFeedbackDetail(feedbackId!),
    enabled: Boolean(feedbackId),
  });
  const activityQuery = useInfiniteQuery({
    queryKey: ["feedback-activity", feedbackId],
    queryFn: ({ pageParam, signal }) => api.getFeedbackActivity(feedbackId!, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined,
    enabled: Boolean(feedbackId) && historyOpen,
  });

  const [labelDraft, setLabelDraft] = useState<string | null>(null);
  const [ticketDraft, setTicketDraft] = useState<string | null>(null);
  const [externalRefsDraft, setExternalRefsDraft] = useState<FeedbackExternalRef[] | null>(null);
  const [engineeringLifecycleDraft, setEngineeringLifecycleDraft] = useState<FeedbackEngineeringLifecycle | null>(null);
  const lifecycleFocusTargetRef = useRef<"editor" | "trigger" | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [requesterSummary, setRequesterSummary] = useState("");
  const [composerPreference, setComposerMode] = useState<"internal" | "public">("internal");
  const [customerReplyNotice, setCustomerReplyNotice] = useState(false);
  const [replyTarget, setReplyTarget] = useState<FeedbackDetail["comments"][number] | null>(null);
  const conversationQuery = useInfiniteQuery({
    queryKey: ["feedback-conversation", feedbackId],
    queryFn: ({ pageParam, signal }) => api.getFeedbackConversation(feedbackId!, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor ?? undefined,
    enabled: Boolean(feedbackId),
  });
  const [statusDraft, setStatusDraft] = useState<string | null>(null);
  const [showEvidenceOverride, setShowEvidenceOverride] = useState(false);
  const [evidenceOverrideReason, setEvidenceOverrideReason] = useState("");
  const [newSubscriberEmail, setNewSubscriberEmail] = useState("");
  const [addingSubscriber, setAddingSubscriber] = useState(false);
  const [newSubscriberName, setNewSubscriberName] = useState("");
  const [newSubscriberType, setNewSubscriberType] = useState("external_subscriber");
  const [newSubscriberNotifyTriage, setNewSubscriberNotifyTriage] = useState(false);
  const [newSubscriberNotifyStatus, setNewSubscriberNotifyStatus] = useState(false);
  const [duplicateAction, setDuplicateAction] = useState<
    | { kind: "mark"; feedbackId: string }
    | { kind: "clear" }
    | null
  >(null);
  const activeFeedbackIdRef = useRef(feedbackId);
  const toastOwnerFeedbackIdRef = useRef(feedbackId);
  const renderedFeedbackIdRef = useRef(feedbackId);
  const activeRouteVersionRef = useRef(0);
  const issueMutationLockRef = useRef<IssueMutationIdentity | null>(null);
  const copySummaryLockRef = useRef<IssueMutationIdentity | null>(null);
  const latestCopySummaryRef = useRef<IssueMutationIdentity | null>(null);
  const latestOptimisticIssueMutationRef = useRef(new Map<string, IssueMutationIdentity>());
  const nextSubmissionIdRef = useRef(0);
  if (renderedFeedbackIdRef.current !== feedbackId) {
    renderedFeedbackIdRef.current = feedbackId;
    activeRouteVersionRef.current += 1;
  }
  activeFeedbackIdRef.current = feedbackId;

  const nextIssueMutationIdentity = (): IssueMutationIdentity | null => {
    if (!feedbackId) return null;
    nextSubmissionIdRef.current += 1;
    return {
      feedbackId,
      submissionId: nextSubmissionIdRef.current,
      routeVersion: activeRouteVersionRef.current,
    };
  };

  const submitIssueMutation = <TVariables extends IssueMutationIdentity,>(
    variables: TVariables,
    mutate: (submittedVariables: TVariables) => void,
  ) => {
    if (issueMutationLockRef.current !== null) {
      setMutationLockNotice(true);
      return false;
    }
    setMutationLockNotice(false);
    issueMutationLockRef.current = {
      feedbackId: variables.feedbackId,
      submissionId: variables.submissionId,
      routeVersion: variables.routeVersion,
    };
    try {
      mutate(variables);
      return true;
    } catch (error) {
      issueMutationLockRef.current = null;
      throw error;
    }
  };

  const releaseIssueMutation = (variables: IssueMutationIdentity) => {
    const lock = issueMutationLockRef.current;
    if (
      lock?.feedbackId === variables.feedbackId
      && lock.submissionId === variables.submissionId
      && lock.routeVersion === variables.routeVersion
    ) {
      issueMutationLockRef.current = null;
    }
  };

  const releaseCopySummary = (variables: IssueMutationIdentity) => {
    const lock = copySummaryLockRef.current;
    if (
      lock?.feedbackId === variables.feedbackId
      && lock.submissionId === variables.submissionId
      && lock.routeVersion === variables.routeVersion
    ) {
      copySummaryLockRef.current = null;
    }
  };

  const isActiveIssueMutation = (variables: IssueMutationIdentity) =>
    activeFeedbackIdRef.current === variables.feedbackId
    && activeRouteVersionRef.current === variables.routeVersion;

  const addIssueToast = (
    action: IssueToastAction,
    type: "success" | "error",
    message: string,
    identity?: IssueMutationIdentity,
  ) => {
    const scopedFeedbackId = identity?.feedbackId ?? activeFeedbackIdRef.current;
    if (!scopedFeedbackId) return;
    if (identity && !isActiveIssueMutation(identity)) return;
    addToast(type, message, issueToastScope(scopedFeedbackId, action));
  };

  const isLatestCopySummary = (variables: IssueMutationIdentity) => {
    const latest = latestCopySummaryRef.current;
    return isActiveIssueMutation(variables)
      && latest?.feedbackId === variables.feedbackId
      && latest.submissionId === variables.submissionId
      && latest.routeVersion === variables.routeVersion;
  };

  const queueIssueInvalidation = (submittedFeedbackId: string, includeSummaries = false) => {
    void Promise.resolve()
      .then(() => {
        const invalidations = [
          queryClient.invalidateQueries({ queryKey: ["feedback-detail", submittedFeedbackId] }),
          queryClient.invalidateQueries({ queryKey: ["feedback-activity", submittedFeedbackId] }),
          queryClient.invalidateQueries({ queryKey: ["feedback-conversation", submittedFeedbackId] }),
        ];
        if (includeSummaries) {
          invalidations.push(
            queryClient.invalidateQueries({ queryKey: ["feedback-list"] }),
            queryClient.invalidateQueries({ queryKey: ["analytics-summary"] }),
          );
        }
        return Promise.all(invalidations);
      })
      .catch(() => undefined);
  };

  const detail = detailQuery.data;
  const fb = detail?.feedback;
  const customerReplyAvailable = Boolean(fb && hasCustomerStatusRecipient({
    reporterEmail: fb.reporter.email,
    requesterNotificationsEnabled: fb.requesterNotificationsEnabled,
    subscribers: fb.subscribers,
  }));
  const customerReplyRequired = Boolean(fb && statusDraft && statusDraft !== fb.status && customerReplyAvailable);
  // The requirement changes the active editor, never the contents of either draft.
  const composerMode = customerReplyRequired ? "public" : composerPreference;
  
  

  /* Auto-save with optimistic update. Mutation identity owns every cache/UI callback. */
  const updateMutation = useMutation({
    mutationFn: (variables: IssueUpdateMutationVariables) =>
      api.updateFeedback(variables.feedbackId, variables.payload),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["feedback-detail", variables.feedbackId] });
      const previous = queryClient.getQueryData<FeedbackDetailResponse>(["feedback-detail", variables.feedbackId]);
      const { payload } = variables;
      if (previous) {
        const next: FeedbackDetailResponse = { ...previous, feedback: { ...previous.feedback } };
        if ("status" in payload) next.feedback.status = payload.status as string;
        if ("severity" in payload) next.feedback.severity = payload.severity as string;
        if ("labels" in payload) next.feedback.labels = payload.labels as string[];
        if ("externalTicketRef" in payload) next.feedback.externalTicketRef = (payload.externalTicketRef as string) || null;
        if ("externalRefs" in payload) next.feedback.externalRefs = (payload.externalRefs as FeedbackExternalRef[] | null) ?? [];
        if ("engineeringLifecycle" in payload) next.feedback.engineeringLifecycle = (payload.engineeringLifecycle as FeedbackEngineeringLifecycle | null) ?? null;
        if ("ownerId" in payload) {
          const owner = previous.assignableUsers.find((user) => user.id === payload.ownerId);
          next.feedback.owner = owner ? { ...owner } : null;
        }
        queryClient.setQueryData(["feedback-detail", variables.feedbackId], next);
        latestOptimisticIssueMutationRef.current.set(variables.feedbackId, variables);
      }
      return { previous };
    },
    onSuccess: (_data, variables) => {
      if (!isActiveIssueMutation(variables)) return;
      const { payload } = variables;
      if ("duplicateOfId" in payload) {
        setDuplicateAction(null);
      }
      if ("labels" in payload) setLabelDraft(null);
      if ("externalTicketRef" in payload) setTicketDraft(null);
      if ("externalRefs" in payload) setExternalRefsDraft(null);
      if ("engineeringLifecycle" in payload) {
        lifecycleFocusTargetRef.current = "trigger";
        setEngineeringLifecycleDraft(null);
      }
    },
    onError: (_error, variables, context) => {
      const latestOptimisticMutation = latestOptimisticIssueMutationRef.current.get(variables.feedbackId);
      if (
        context?.previous
        && latestOptimisticMutation?.submissionId === variables.submissionId
        && latestOptimisticMutation.routeVersion === variables.routeVersion
      ) {
        queryClient.setQueryData(["feedback-detail", variables.feedbackId], context.previous);
      }
    },
    onSettled: (_data, _error, variables) => {
      releaseIssueMutation(variables);
      queueIssueInvalidation(variables.feedbackId, true);
    },
  });

  const evidenceOverrideMutation = useMutation({
    mutationFn: (variables: EvidenceGateOverrideMutationVariables) =>
      api.overrideFeedbackEvidenceGate(variables.feedbackId, {
        reason: variables.reason,
        expectedUpdatedAt: variables.expectedUpdatedAt,
      }),
    onSuccess: (updatedDetail, variables) => {
      queryClient.setQueryData(["feedback-detail", variables.feedbackId], updatedDetail);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["feedback-list"] }),
        queryClient.invalidateQueries({ queryKey: ["analytics-summary"] }),
      ]).catch(() => undefined);
      if (!isActiveIssueMutation(variables)) return;
      setShowEvidenceOverride(false);
      setEvidenceOverrideReason("");
    },
    onSettled: (_data, _error, variables) => {
      releaseIssueMutation(variables);
    },
  });

  const noteStatusMutation = useMutation({
    mutationFn: async (variables: NoteStatusWorkflowVariables) => {
      let detail: FeedbackDetailResponse | null = null;
      if (variables.statusUpdate && !variables.completed.status) {
        // The API records the note and status in one transaction.
        detail = await api.updateFeedback(variables.feedbackId, variables.statusUpdate);
        variables.completed.note = true;
        variables.completed.status = true;
      } else if (variables.note && !variables.completed.note) {
        await api.addComment(variables.feedbackId, variables.note);
        variables.completed.note = true;
      }
      return { detail };
    },
    onSuccess: ({ detail: updatedDetail }, variables) => {
      if (updatedDetail) {
        queryClient.setQueryData(["feedback-detail", variables.feedbackId], updatedDetail);
      }
      queueIssueInvalidation(variables.feedbackId, Boolean(variables.statusUpdate));
      if (!isActiveIssueMutation(variables)) return;
      if (variables.note?.visibility === "public") {
        setRequesterSummary((current) => current.trim() === variables.note?.body ? "" : current);
        setReplyTarget(null);
      }
      else setCommentBody((current) => current.trim() === variables.note?.body ? "" : current);
      setStatusDraft((current) => current === variables.statusUpdate?.status ? null : current);
    },
    onSettled: (_data, _error, variables) => {
      releaseIssueMutation(variables);
    },
  });

  const requesterMessageMutation = useMutation({
    mutationFn: (variables: RequesterMessageVariables) => api.addComment(variables.feedbackId, {
      body: variables.message,
      visibility: "public",
      notifyRequester: true,
      publicSummary: variables.message,
      deliveryTarget: variables.deliveryTarget,
      clientRequestId: variables.clientRequestId,
    }),
    onSuccess: (_data, variables) => {
      queueIssueInvalidation(variables.feedbackId);
      if (!isActiveIssueMutation(variables)) return;
      setRequesterSummary((current) => current.trim() === variables.message ? "" : current);
      setReplyTarget(null);
    },
    onSettled: (_data, _error, variables) => {
      releaseIssueMutation(variables);
    },
  });

  const replayNotificationMutation = useMutation({
    mutationFn: (variables: NotificationReplayMutationVariables) =>
      api.replayNotification(variables.notificationId),
    onSuccess: (_data, variables) => {
      queueIssueInvalidation(variables.feedbackId);
    },
    onSettled: (_data, _error, variables) => {
      releaseIssueMutation(variables);
    },
  });

  const subscriberMutation = useMutation({
    mutationFn: async (variables: SubscriberMutationVariables) => {
      const { action } = variables;
      if (action.kind === "add") {
        return api.addFeedbackSubscriber(variables.feedbackId, action.body);
      }
      if (action.kind === "update") return api.updateFeedbackSubscriber(variables.feedbackId, action.id, action.body);
      return api.removeFeedbackSubscriber(variables.feedbackId, action.id);
    },
    onSuccess: (_, variables) => {
      queueIssueInvalidation(variables.feedbackId);
      if (!isActiveIssueMutation(variables)) return;
      const { action } = variables;
      if (action.kind === "add") {
        setNewSubscriberEmail("");
        setNewSubscriberName("");
      }
    },
    onSettled: (_data, _error, variables) => {
      releaseIssueMutation(variables);
    },
  });

  const aiCodingTaskMutation = useMutation({
    mutationFn: (variables: AiCodingTaskMutationVariables) => api.createAiCodingTask(variables.feedbackId),
    onSuccess: (data, variables) => {
      if (!isActiveIssueMutation(variables)) return;
      setAiTaskPreview(data);
      setAiTaskPreviewOpen(true);
      setAiTaskCopyState("idle");
      window.requestAnimationFrame(() => document.getElementById("issue-ai-coding-task-preview")?.focus());
    },
    onSettled: (_data, _error, variables) => {
      releaseIssueMutation(variables);
    },
  });

  const copySummaryMutation = useMutation({
    mutationFn: (variables: CopySummaryMutationVariables) =>
      navigator.clipboard.writeText(variables.summary),
    onSuccess: (_data, variables) => {
      if (!isLatestCopySummary(variables)) return;
      setCopySummaryCopied(true);
      window.setTimeout(() => {
        if (isLatestCopySummary(variables)) setCopySummaryCopied(false);
      }, 1600);
      addIssueToast("copy-summary", "success", copy.detail.copied, variables);
    },
    onSettled: (_data, _error, variables) => {
      releaseCopySummary(variables);
    },
  });

  /* Route changes are a hard ownership boundary for drafts, recovery, and locks. */
  useEffect(() => {
    const previousFeedbackId = toastOwnerFeedbackIdRef.current;
    if (previousFeedbackId && previousFeedbackId !== feedbackId) {
      ISSUE_TOAST_ACTIONS.forEach((action) => {
        dismissToastScope(issueToastScope(previousFeedbackId, action));
      });
    }
    toastOwnerFeedbackIdRef.current = feedbackId;
    issueMutationLockRef.current = null;
    copySummaryLockRef.current = null;
    latestCopySummaryRef.current = null;
    updateMutation.reset();
    evidenceOverrideMutation.reset();
    noteStatusMutation.reset();
    requesterMessageMutation.reset();
    aiCodingTaskMutation.reset();
    setAiTaskPreview(null);
    setAiTaskPreviewOpen(false);
    setAiTaskCopyState("idle");
    replayNotificationMutation.reset();
    subscriberMutation.reset();
    copySummaryMutation.reset();
    setStatusDraft(null);
    setShowEvidenceOverride(false);
    setEvidenceOverrideReason("");
    setCommentBody("");
    setRequesterSummary("");
    setComposerMode(workParam === "follow-up" ? "public" : "internal");
    setCustomerReplyNotice(false);
    setReplyTarget(null);
    setManagementOpen(workParam === "assign" || legacySection === "resolve" && !workParam);
    setTechnicalOpen(legacySection === "investigate");
    setHistoryOpen(legacySection === "activity" && workParam !== "follow-up");
    setDeliveryOpen(false);
    setControlTarget(null);
    setLabelDraft(null);
    setTicketDraft(null);
    setExternalRefsDraft(null);
    setEngineeringLifecycleDraft(null);
    setDuplicateAction(null);
    setNewSubscriberEmail("");
    setAddingSubscriber(false);
    setNewSubscriberName("");
    setNewSubscriberType("external_subscriber");
    setNewSubscriberNotifyTriage(false);
    setNewSubscriberNotifyStatus(false);
    setCopySummaryCopied(false);
  }, [feedbackId, dismissToastScope, workParam, legacySection]);

  useEffect(() => {
    const target = lifecycleFocusTargetRef.current;
    if (!target) return;
    if ((target === "editor") !== (engineeringLifecycleDraft !== null)) return;
    if (target === "trigger" && updateMutation.isPending) return;
    lifecycleFocusTargetRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(
        target === "editor" ? "issue-lifecycle-branch-name" : "issue-engineering-lifecycle-edit-button",
      )?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [engineeringLifecycleDraft, updateMutation.isPending]);

  useEffect(() => {
    if (!fb) return;
    const targetId = workParam === "assign"
      ? "issue-assignee-field"
      : workParam === "triage" || workParam === "blocker"
        ? "issue-status-update"
        : workParam === "follow-up"
          ? "issue-requester-message"
          : null;
    if (!targetId) return;
    const frame = window.requestAnimationFrame(() => {
      const node = document.getElementById(targetId);
      node?.scrollIntoView?.({ block: "nearest" });
      node?.querySelector<HTMLElement>("select, textarea, input, button")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fb, workParam, managementOpen]);

  const submitUpdate = (payload: Record<string, unknown>) => {
    const identity = nextIssueMutationIdentity();
    if (identity && fb) {
      submitIssueMutation({
        ...identity,
        payload: {
          ...payload,
          expectedUpdatedAt: new Date(fb.updatedAt).toISOString(),
        },
      }, updateMutation.mutate);
    }
  };

  const submitSubscriberAction = (action: SubscriberMutationAction) => {
    const identity = nextIssueMutationIdentity();
    if (identity) {
      submitIssueMutation({ ...identity, action }, subscriberMutation.mutate);
    }
  };

  const submitNotificationReplay = (notificationId: string) => {
    const identity = nextIssueMutationIdentity();
    if (identity) {
      submitIssueMutation({ ...identity, notificationId }, replayNotificationMutation.mutate);
    }
  };

  const submitCopySummary = (variables: CopySummaryMutationVariables) => {
    if (copySummaryLockRef.current !== null) return false;
    copySummaryLockRef.current = variables;
    latestCopySummaryRef.current = variables;
    setCopySummaryCopied(false);
    try {
      copySummaryMutation.mutate(variables);
      return true;
    } catch (error) {
      copySummaryLockRef.current = null;
      throw error;
    }
  };

  const withIssueRetry = <TVariables extends IssueMutationIdentity,>(
    entry: MutationRecoveryEntry,
    variables: TVariables | undefined,
    mutate: (submittedVariables: TVariables) => void,
  ): MutationRecoveryEntry => ({
    ...entry,
    retry: () => {
      if (variables) submitIssueMutation(variables, mutate);
    },
  });

  const issueLabel = fb ? `#${fb.ticketNumber}` : "the issue";
  const updateIsStale = updateMutation.error instanceof ApiError
    && updateMutation.error.code === "feedback.stale_update";
  const noteStatusIsStale = noteStatusMutation.error instanceof ApiError
    && noteStatusMutation.error.code === "feedback.stale_update";
  const evidenceOverrideIsStale = evidenceOverrideMutation.error instanceof ApiError
    && evidenceOverrideMutation.error.code === "feedback.evidence_override_stale";
  const issueMutationBusy = updateMutation.isPending
    || evidenceOverrideMutation.isPending
    || noteStatusMutation.isPending
    || requesterMessageMutation.isPending
    || replayNotificationMutation.isPending
    || subscriberMutation.isPending
    || aiCodingTaskMutation.isPending;
  const issueDraftDirty = Boolean(
    commentBody.trim()
    || (statusDraft !== null && statusDraft !== fb?.status)
    || requesterSummary.trim()
    || labelDraft !== null
    || ticketDraft !== null
    || externalRefsDraft !== null
    || engineeringLifecycleDraft !== null,
  );
  const { requestExit } = useAdminFormExitGuard({
    id: `issue-detail:${feedbackId ?? "none"}`,
    isDirty: issueDraftDirty,
    isMutationPending: issueMutationBusy,
    retainedSearchParams: ISSUE_RETAINED_SEARCH_PARAMS,
    onDiscard: () => {
      setCommentBody("");
      setStatusDraft(null);
      setRequesterSummary("");
      setComposerMode("internal");
      setLabelDraft(null);
      setTicketDraft(null);
      setExternalRefsDraft(null);
      setEngineeringLifecycleDraft(null);
    },
  });
  const requestTicketChange = useCallback(
    (id: string | null) => {
      if (!id) return;
      requestExit("internal-navigation", () => goToTicket(id));
    },
    [goToTicket, requestExit],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "j") {
        event.preventDefault();
        requestTicketChange(neighbors?.nextId ?? null);
      } else if (event.key === "k") {
        event.preventDefault();
        requestTicketChange(neighbors?.prevId ?? null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [neighbors, requestTicketChange]);
  const copySummaryRecoveryEntry = {
    ...mutationRecoveryEntry(copySummaryMutation, {
      id: "issue-copy-summary",
      message: `Couldn't copy the issue summary for ${issueLabel}.`,
      retryLabel: "Retry copying summary",
    }),
    retry: () => {
      if (copySummaryMutation.variables) {
        submitCopySummary(copySummaryMutation.variables);
      }
    },
  };
  const mutationRecoveryEntries = [
    {
      ...mutationRecoveryEntry(updateMutation, {
        id: "issue-update",
        message: updateIsStale
          ? `${issueLabel} changed before this update was saved. Reload the latest issue and review the change again.`
          : (variables) => issueUpdateFailureMessage(variables?.payload, issueLabel),
        successMessage: (_data, variables) => `${issueUpdateSuccessLabel(variables?.payload)} for ${issueLabel}.`,
        retryLabel: updateIsStale ? "Reload latest issue" : issueUpdateRetryLabel(updateMutation.variables?.payload),
      }),
      retry: () => {
        if (updateIsStale) {
          const stalePayload = updateMutation.variables?.payload;
          if (stalePayload && "labels" in stalePayload) setLabelDraft(null);
          if (stalePayload && "externalTicketRef" in stalePayload) setTicketDraft(null);
          if (stalePayload && "externalRefs" in stalePayload) setExternalRefsDraft(null);
          if (stalePayload && "engineeringLifecycle" in stalePayload) setEngineeringLifecycleDraft(null);
          if (stalePayload && "duplicateOfId" in stalePayload) setDuplicateAction(null);
          void detailQuery.refetch().then(() => updateMutation.reset());
          return;
        }
        if (updateMutation.variables) {
          submitIssueMutation(updateMutation.variables, updateMutation.mutate);
        }
      },
    },
    {
      ...mutationRecoveryEntry(evidenceOverrideMutation, {
        id: "issue-evidence-override",
        message: evidenceOverrideIsStale
          ? `${issueLabel} changed while you reviewed its evidence. Reload the latest report before deciding again.`
          : `Couldn't record the evidence override for ${issueLabel}. Engineering is still blocked.`,
        successMessage: `Evidence override recorded for ${issueLabel}. Engineering can proceed.`,
        retryLabel: evidenceOverrideIsStale ? "Reload latest evidence" : "Retry evidence override",
      }),
      retry: () => {
        if (evidenceOverrideIsStale) {
          void detailQuery.refetch().then(() => evidenceOverrideMutation.reset());
          return;
        }
        if (evidenceOverrideMutation.variables) {
          submitIssueMutation(evidenceOverrideMutation.variables, evidenceOverrideMutation.mutate);
        }
      },
    },
    {
      ...mutationRecoveryEntry(noteStatusMutation, {
        id: "issue-note-status",
        message: (variables) => noteStatusMutation.error instanceof ApiError && noteStatusMutation.error.code === "feedback.customer_update_required"
          ? "This ticket now requires a customer update. Reload customer details to write the reply. Your private draft is kept."
          : noteStatusIsStale
          ? `${issueLabel} changed while you were writing. Reload the latest ticket, then review your status choice. Your draft is kept.`
          : `Couldn't finish the ${remainingNoteStatusWorkflowLabel(variables)} for ${issueLabel}.`,
        successMessage: (_data, variables) => `${noteStatusWorkflowSuccess(variables)} for ${issueLabel}.`,
        retryLabel: noteStatusMutation.error instanceof ApiError && noteStatusMutation.error.code === "feedback.customer_update_required"
          ? "Reload customer details" : noteStatusIsStale ? "Reload latest ticket" : `Retry saving ${remainingNoteStatusWorkflowLabel(noteStatusMutation.variables)}`,
      }),
      retry: () => {
        if (noteStatusMutation.error instanceof ApiError && noteStatusMutation.error.code === "feedback.customer_update_required") {
          const identity = noteStatusMutation.variables;
          void detailQuery.refetch().then((result) => {
            if (!result.isSuccess || !identity || !isActiveIssueMutation(identity)) return;
            noteStatusMutation.reset();
          });
        } else if (noteStatusIsStale) {
          const identity = noteStatusMutation.variables;
          void detailQuery.refetch().then((result) => {
            if (!result.isSuccess || !identity || !isActiveIssueMutation(identity)) return;
            setStatusDraft(null);
            noteStatusMutation.reset();
          });
        } else if (noteStatusMutation.variables) {
          submitIssueMutation(noteStatusMutation.variables, noteStatusMutation.mutate);
        }
      },
    },
    withIssueRetry(
      mutationRecoveryEntry(requesterMessageMutation, {
        id: "issue-requester-message",
        message: `Couldn't send the reporter update for ${issueLabel}.`,
        successMessage: `Customer reply saved for ${issueLabel}. Check the delivery result below.`,
        retryLabel: "Retry sending reporter update",
      }),
      requesterMessageMutation.variables,
      requesterMessageMutation.mutate,
    ),
    withIssueRetry(
      mutationRecoveryEntry(replayNotificationMutation, {
        id: "issue-notification-replay",
        message: `Couldn't retry the reporter notification for ${issueLabel}.`,
        successMessage: `Reporter notification queued for ${issueLabel}.`,
        retryLabel: "Retry notification",
      }),
      replayNotificationMutation.variables,
      replayNotificationMutation.mutate,
    ),
    withIssueRetry(
      mutationRecoveryEntry(subscriberMutation, {
        id: "issue-subscriber",
        message: (variables) => `Couldn't finish ${subscriberActionLabel(variables?.action)} on ${issueLabel}.`,
        successMessage: (_data, variables) => `${subscriberSuccessLabel(variables?.action)} on ${issueLabel}.`,
        retryLabel: "Retry recipient change",
      }),
      subscriberMutation.variables,
      subscriberMutation.mutate,
    ),
    withIssueRetry(
      mutationRecoveryEntry(aiCodingTaskMutation, {
        id: "issue-ai-coding-task",
        message: `Couldn't prepare the AI coding task for ${issueLabel}.`,
        successMessage: `AI coding task ready to review for ${issueLabel}.`,
        retryLabel: "Retry opening AI coding task",
      }),
      aiCodingTaskMutation.variables,
      aiCodingTaskMutation.mutate,
    ),
  ];

  const activity = activityQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const activityTotal = activityQuery.data?.pages[0]?.pagination.total ?? 0;

  const duplicateCandidates = (Array.isArray(fb?.duplicateCandidates) ? fb?.duplicateCandidates : []) as Array<{
    feedbackId: string;
    ticketNumber: number;
    title: string;
    score: number;
  }>;
  const pendingDuplicateCandidate = duplicateAction?.kind === "mark"
    ? duplicateCandidates.find((candidate) => candidate.feedbackId === duplicateAction.feedbackId) ?? null
    : null;
  const duplicates = fb?.duplicates ?? [];
  const duplicateGroup = fb?.duplicateGroup ?? null;
  const duplicateGroupReleases = duplicateGroup?.affectedReleases.slice(0, 4) ?? [];
  const hiddenDuplicateGroupReleaseCount = Math.max((duplicateGroup?.affectedReleases.length ?? 0) - duplicateGroupReleases.length, 0);
  const pointSelection = useMemo(
    () => readPointSelectionFromExtraContext(fb?.extraContext),
    [fb?.extraContext],
  );
  const selectedElement = useMemo(
    () => readSelectedElement(fb?.extraContext) ?? selectedElementFromPointSelection(pointSelection),
    [fb?.extraContext, pointSelection],
  );
  const productContext = useMemo(
    () => readProductContext(fb?.extraContext),
    [fb?.extraContext],
  );
  const evidenceQuality = useMemo(
    () => (fb ? buildEvidenceQuality(fb, productContext) : null),
    [fb, productContext],
  );
  const evidenceGateOverride = useMemo(
    () => readEvidenceGateOverride(fb?.extraContext),
    [fb?.extraContext],
  );
  const evidenceGateReady = Boolean(evidenceQuality && (evidenceQuality.score >= 75 || evidenceGateOverride));
  const hostEvidenceTimeline = useMemo(
    () => readEvidenceTimeline(fb?.extraContext),
    [fb?.extraContext],
  );
  const explicitFeatureContext = useMemo(
    () => readFeatureContext(fb?.extraContext),
    [fb?.extraContext],
  );
  const featureContext = explicitFeatureContext ?? productContext?.feature ?? null;
  const eventTrail = useMemo(
    () => readEventTrail(fb?.extraContext),
    [fb?.extraContext],
  );
  const networkEntries = useMemo(
    () => readNetworkEntries(fb?.extraContext),
    [fb?.extraContext],
  );
  const surveyResponse = useMemo(
    () => readSurveyResponse(fb?.extraContext),
    [fb?.extraContext],
  );
  const selectedTextSuggestion = useMemo(
    () => readSelectedTextSuggestion(fb?.extraContext),
    [fb?.extraContext],
  );
  const customerImpact = useMemo(
    () => readCustomerImpact(fb?.extraContext),
    [fb?.extraContext],
  );
  const consentSnapshot = useMemo(
    () => readConsentSnapshot(fb?.extraContext),
    [fb?.extraContext],
  );
  const sessionReplayClipId = useMemo(
    () => readSessionReplayClipId(fb?.extraContext),
    [fb?.extraContext],
  );
  const evidenceTimeline = useMemo(
    () => (fb ? buildEvidenceTimeline(fb, pointSelection, productContext, hostEvidenceTimeline, eventTrail, networkEntries, surveyResponse, selectedTextSuggestion, customerImpact, consentSnapshot, featureContext, sessionReplayClipId, selectedElement) : []),
    [fb, pointSelection, productContext, hostEvidenceTimeline, eventTrail, networkEntries, surveyResponse, selectedTextSuggestion, customerImpact, consentSnapshot, featureContext, sessionReplayClipId, selectedElement],
  );

  const hasReproduction = Boolean(fb?.stepsToReproduce || fb?.expectedResult || fb?.actualResult);
  const shownExternalRefs = externalRefsDraft ?? fb?.externalRefs ?? [];
  const shownEngineeringLifecycle = engineeringLifecycleDraft ?? fb?.engineeringLifecycle ?? null;

  const copySummary = () => {
    if (!fb) return;
    const identity = nextIssueMutationIdentity();
    if (!identity) return;
    const summary = [
      `#${fb.ticketNumber} ${fb.title}`,
      `Product: ${fb.project.name} (${fb.project.key})`,
      `Status: ${fb.status}`,
      `Severity: ${fb.severity}`,
      `URL: ${fb.route.url}`,
      "",
      fb.description,
      fb.stepsToReproduce ? `Steps:\n${fb.stepsToReproduce}` : "",
      fb.expectedResult ? `Expected:\n${fb.expectedResult}` : "",
      fb.actualResult ? `Actual:\n${fb.actualResult}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    submitCopySummary({ ...identity, summary });
  };

  const copyAiCodingTask = async () => {
    if (!aiTaskPreview || aiTaskCopyState === "copying") return;
    setAiTaskCopyState("copying");
    try {
      await navigator.clipboard.writeText(aiTaskPreview.prompt);
      setAiTaskCopyState("copied");
    } catch {
      setAiTaskCopyState("error");
    }
  };

  const submitEvidenceOverride = () => {
    if (!fb || evidenceGateReady || evidenceOverrideMutation.isPending) return;
    const reason = evidenceOverrideReason.trim();
    if (reason.length < 10) {
      addIssueToast("status", "error", "Explain why engineering should proceed with incomplete evidence.");
      return;
    }
    const identity = nextIssueMutationIdentity();
    if (!identity) return;
    submitIssueMutation({ ...identity, reason, expectedUpdatedAt: new Date(fb.updatedAt).toISOString() }, evidenceOverrideMutation.mutate);
  };

  const draftNeedsMoreInfo = () => {
    if (!canEmailRequester) {
      openIssueControl("issue-evidence-quality-details", "overview");
      return;
    }
    const question = evidenceQuality?.missing[0]?.question;
    if (!question) {
      addIssueToast("reporter-question", "success", copy.detail.evidenceReady);
      return;
    }

    setRequesterSummary(question);
    setComposerMode("public");
    window.requestAnimationFrame(() => {
      document.getElementById("issue-requester-summary")?.scrollIntoView?.({ block: "nearest" });
      document.getElementById("issue-requester-summary")?.focus();
    });
    addIssueToast("reporter-question", "success", copy.detail.needsMoreInfoDrafted);
  };

  const saveLabels = () => {
    if (labelDraft === null || !fb) return;
    if (fb.isOverageLocked) {
      addIssueToast("labels", "error", "Labels can't be changed until more issue credits are added.");
      return;
    }
    const labels = labelDraft.split(",").map((item) => item.trim()).filter(Boolean);
    if (labels.join(",") !== fb.labels.join(",")) {
      submitUpdate({ labels });
    } else {
      setLabelDraft(null);
    }
  };

  const saveTicket = () => {
    if (ticketDraft === null || !fb) return;
    if (fb.isOverageLocked) {
      addIssueToast("ticket-link", "error", "The external ticket can't be changed until more issue credits are added.");
      return;
    }
    const value = ticketDraft.trim();
    if (value !== (fb.externalTicketRef ?? "")) {
      submitUpdate({ externalTicketRef: value || null });
    } else {
      setTicketDraft(null);
    }
  };

  const updateExternalRefDraft = (index: number, patch: Partial<FeedbackExternalRef>) => {
    setExternalRefsDraft((currentDraft) =>
      (currentDraft ?? fb?.externalRefs ?? []).map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...patch } : item
      )),
    );
  };

  const saveExternalRefs = () => {
    if (!fb || externalRefsDraft === null) return;
    if (fb.isOverageLocked) {
      addIssueToast("external-refs", "error", "External links can't be changed until more issue credits are added.");
      return;
    }
    const refs = externalRefsDraft
      .map((item) => ({
        provider: item.provider,
        label: item.label.trim(),
        url: item.url.trim(),
        ...(item.status ? { status: item.status } : {}),
      }))
      .filter((item) => item.label || item.url);

    if (refs.some((item) => !item.label || !item.url)) {
      addIssueToast("external-refs", "error", "External links need a label and URL.");
      return;
    }

    for (const item of refs) {
      try {
        new URL(item.url);
      } catch {
        addIssueToast("external-refs", "error", "Enter a valid URL for each external link.");
        return;
      }
    }

    if (JSON.stringify(refs) !== JSON.stringify(fb.externalRefs)) {
      submitUpdate({ externalRefs: refs });
    } else {
      setExternalRefsDraft(null);
    }
  };

  

  

  /* Only the selected draft is submitted. Switching audiences never copies private text. */
  const saveChanges = () => {
    if (!fb) return;
    if (fb.isOverageLocked) {
      addIssueToast("status", "error", "Notes and status can't be changed until more issue credits are added.");
      return;
    }
    const statusChanged = statusDraft !== null && statusDraft !== fb.status;
    const body = (composerMode === "public" ? requesterSummary : commentBody).trim();
    if (!body) return;
    if (composerMode === "public" && !customerReplyAvailable) return;
    if (statusChanged && ["in_progress", "fixed"].includes(statusDraft!) && !evidenceGateReady) {
      addIssueToast("status", "error", "Engineering is blocked until the missing evidence is supplied or a reasoned override is recorded.");
      return;
    }
    if (composerMode === "public" && !statusChanged) {
      sendRequesterMessage();
      return;
    }
    const identity = nextIssueMutationIdentity();
    if (!identity) return;
    const note = { body, visibility: composerMode, notifyRequester: false as const, clientRequestId: crypto.randomUUID() };
    submitIssueMutation({
      ...identity,
      note,
      statusUpdate: statusChanged ? {
        status: statusDraft!,
        convertedToBacklog: statusDraft === "backlog",
        statusNote: { body, visibility: composerMode, clientRequestId: note.clientRequestId },
        expectedUpdatedAt: new Date(fb.updatedAt).toISOString(),
        notifyRequester: composerMode === "public",
        publicSummary: composerMode === "public" ? body : null,
      } : null,
      completed: { note: false, status: false },
    }, noteStatusMutation.mutate);
  };

  const sendRequesterMessage = () => {
    if (!fb || issueLocked || issueMutationBusy) return;
    const message = requesterSummary.trim();
    if (!message || !customerReplyAvailable) return;
    const identity = nextIssueMutationIdentity();
    if (!identity) return;
    submitIssueMutation({
      ...identity,
      message,
      deliveryTarget: "requester_and_subscribers",
      clientRequestId: crypto.randomUUID(),
    }, requesterMessageMutation.mutate);
  };

  /* ── Loading / error ── */
  if (detailQuery.isLoading || !fb) {
    return (
      <div className="-mx-4 -my-6 min-h-screen px-6 py-7 md:-mx-8 md:-my-8 md:px-8">
        <Link to={backTo} className="tg-inline-link inline-flex items-center gap-1 text-label text-muted hover:text-foreground">
          <ChevronLeft className="size-4" />
          {copy.issues.title}
        </Link>
        {detailQuery.isError ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <p className="text-body text-danger-700">Couldn't load this issue.</p>
            <Button tone="secondary" onClick={() => void detailQuery.refetch()}>
              {copy.issues.retry}
            </Button>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <div className="tg-skeleton h-8 w-2/3" />
            <div className="tg-skeleton h-64 w-full" />
          </div>
        )}
      </div>
    );
  }

  const statusValue = statusDraft ?? fb.status;
  const statusChanged = statusValue !== fb.status;
  const hasNote = commentBody.trim().length > 0;
  const hasRequesterSummary = requesterSummary.trim().length > 0;
  const issueLocked = Boolean(fb.isOverageLocked);
  const requesterRecipients = [...new Set([
    fb.requesterNotificationsEnabled && fb.reporter.email ? fb.reporter.email : null,
    ...fb.subscribers
      .filter((subscriber) => subscriber.isActive && (subscriber.notifyOnStatusChange || !fb.reporter.email))
      .map((subscriber) => subscriber.email),
  ].filter((email): email is string => Boolean(email)))];
  const canEmailRequester = requesterRecipients.length > 0;
  const terminalIssue = fb.status === "closed" || fb.status === "duplicate";
  const requesterUpdateDue = requesterUpdateDueState(fb, canEmailRequester);
  const statusProgressionBlocked = statusChanged
    && ["in_progress", "fixed"].includes(statusValue)
    && !evidenceGateReady;
  const canSave = !issueLocked && !statusProgressionBlocked
    && (composerMode === "public" ? customerReplyAvailable && hasRequesterSummary : hasNote);
  const saveLabel = noteStatusMutation.isPending || requesterMessageMutation.isPending ? "Saving update..."
    : composerMode === "public" ? statusChanged ? "Save status and send reply" : "Send customer reply"
    : statusChanged ? "Save note and status" : "Save internal note";
  const conversation = [...new Map(conversationQuery.data?.pages.flatMap((page) => page.items).map((comment) => [comment.id, comment]) ?? []).values()];
  const loadedConversationTotal = conversationQuery.data?.pages.at(-1)?.pagination.total;
  const conversationTotal = detailQuery.dataUpdatedAt > conversationQuery.dataUpdatedAt
    ? fb.conversationCount ?? loadedConversationTotal : loadedConversationTotal ?? fb.conversationCount;
  const replyContext = replyTarget ?? conversation.find((comment) => comment.visibility === "public");
  const openConversation = () => openIssueControl("issue-conversation-heading", "conversation");
  const latestDeliveryByRecipient = new Map<string, FeedbackDetail["notificationHistory"][number]>();
  [...fb.notificationHistory]
    .filter((notification) => ["requester", "external_subscriber"].includes(notification.recipientType.toLowerCase()) && REQUESTER_UPDATE_EVENTS.has(notification.eventType))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .forEach((notification) => {
      const recipient = notification.recipientEmail ?? notification.recipientType;
      if (!latestDeliveryByRecipient.has(recipient)) latestDeliveryByRecipient.set(recipient, notification);
    });
  const latestCustomerUpdates = [...latestDeliveryByRecipient.values()].slice(0, 5);

  const statusUpdateHelp = issueLocked ? copy.detail.lockedToast
    : statusProgressionBlocked ? "More evidence is needed before work can start or be marked fixed."
    : null;

  return (
    <div id="issue-detail-page" className="-mx-4 -my-6 min-h-screen md:-mx-8 md:-my-8">
      {/* ── Sticky glass top bar: real frost, content scrolls behind it ── */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border/25 bg-surface/78 px-4 py-3 backdrop-blur-xl md:px-8">
        <nav className="flex min-w-0 items-center gap-1.5 text-label text-muted" aria-label="Breadcrumb">
          <Link to={backTo} className="tg-inline-link inline-flex items-center gap-1 rounded hover:text-foreground">
            <ChevronLeft className="size-4" />
            {copy.issues.title}
          </Link>
          <span className="text-brand-300">/</span>
          <span className="tabular-nums text-foreground">#{fb.ticketNumber}</span>
        </nav>
        <div className="flex items-center gap-2">
          <Button
            tone="ghost"
            className="tg-copy-button size-9 px-0"
            aria-label={copySummaryCopied ? "Summary copied" : copySummaryMutation.isPending ? "Copying summary..." : copy.detail.copySummary}
            title={copySummaryCopied ? "Copied" : copySummaryMutation.isPending ? "Copying summary..." : copy.detail.copySummary}
            disabled={copySummaryMutation.isPending}
            onClick={copySummary}
            data-copied={copySummaryCopied ? "true" : "false"}
          >
            {copySummaryCopied ? <Check className="size-4 text-success-700" /> : <Copy className="size-4" />}
          </Button>
          {neighbors ? (
            <div className="flex items-center gap-0.5 rounded-full border border-border/25 bg-surface-muted/45 px-0.5">
              <button
                type="button"
                aria-label={copy.detail.previousTicket}
                title={`${copy.detail.previousTicket} (k)`}
                disabled={!neighbors.prevId}
                onClick={() => requestTicketChange(neighbors.prevId)}
                className="tg-icon-button flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-primary/[0.06] hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="px-1 text-caption tabular-nums text-muted">
                {neighbors.position} / {neighbors.count}
              </span>
              <span className="sr-only">
                {copy.detail.keyboardNeighbors}
              </span>
              <button
                type="button"
                aria-label={copy.detail.nextTicket}
                title={`${copy.detail.nextTicket} (j)`}
                disabled={!neighbors.nextId}
                onClick={() => requestTicketChange(neighbors.nextId)}
                className="tg-icon-button flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-primary/[0.06] hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div id="issue-mutation-recovery-region" className="empty:hidden px-4 pt-4 md:px-8">
        {mutationLockNotice ? (
          <p id="issue-mutation-lock-notice" className="pb-3 text-caption text-muted" role="status" aria-live="polite">
            {copy.detail.savingInProgress}
          </p>
        ) : null}
        <MutationRecovery id="issue-mutation-recovery" entries={mutationRecoveryEntries} />
        {copySummaryRecoveryEntry.status === "error" ? (
          <section
            id="issue-copy-summary-recovery"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3"
            role="alert"
            aria-live="assertive"
          >
            <p className="text-label font-semibold text-danger-700">{copySummaryRecoveryEntry.message}</p>
            <Button
              tone="secondary"
              disabled={copySummaryMutation.isPending}
              onClick={copySummaryRecoveryEntry.retry}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              {copySummaryRecoveryEntry.retryLabel}
            </Button>
          </section>
        ) : null}
      </div>

      {aiTaskPreviewOpen && aiTaskPreview ? (
        <AiCodingTaskPreview
          task={aiTaskPreview}
          copyState={aiTaskCopyState}
          onCopy={() => void copyAiCodingTask()}
          onClose={() => {
            setAiTaskPreviewOpen(false);
            setAiTaskPreview(null);
            setAiTaskCopyState("idle");
            window.requestAnimationFrame(() => document.getElementById("issue-ai-coding-task-trigger")?.focus());
          }}
        />
      ) : null}

      <div className="mx-auto max-w-[1440px] px-4 md:px-8">
        <header id="issue-detail-hero" className="flex flex-col gap-3 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
              <span className="tabular-nums">#{fb.ticketNumber}</span>
              <span className="text-brand-300">·</span>
              <span>{fb.project.name}</span>
              <span className="text-brand-300">·</span>
              <span title={formatFullDate(fb.createdAt)}>Reported {formatRelativeDate(fb.createdAt)}</span>
              {fb.reporter.name || fb.reporter.email ? (
                <>
                  <span className="text-brand-300">·</span>
                  <span>by {fb.reporter.name ?? fb.reporter.email}</span>
                </>
              ) : null}
            </p>
            <h1 className="max-w-3xl text-title text-foreground md:text-display">
              {fb.title}
            </h1>
            <div id="issue-key-facts" className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <FactItem label="Status">
                <StatusChip status={fb.status} />
                {issueLocked ? <span className="ml-2 text-caption text-muted">Read-only</span> : null}
              </FactItem>
              <FactItem label="Severity">
                <SeverityIndicator severity={fb.severity} />
              </FactItem>
              <FactItem label="Reporter">
                {fb.reporter.name ?? fb.reporter.email ?? "Unknown"}
              </FactItem>
              <FactItem label="Owner">
                <button type="button" className="min-h-7 truncate text-left hover:text-primary focus-visible:outline-2 focus-visible:outline-primary" onClick={() => openIssueControl("issue-assignee-field")}>{fb.owner?.name ?? "Unassigned"}</button>
              </FactItem>
              {!canEmailRequester ? <FactItem label="Follow-up">No reply channel</FactItem> : null}
            </div>
          </div>
        </header>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] xl:gap-6">
        <section id="issue-panel-overview" aria-labelledby="issue-report-title" className="tg-card min-w-0 p-5 sm:p-6 xl:col-start-1 xl:row-start-1">
          <section
            id="issue-overview-report"
            className={cn(
              "grid gap-6",
              fb.attachments.length > 0 && "2xl:grid-cols-[minmax(0,1fr)_minmax(16rem,0.7fr)]",
            )}
          >
            {fb.attachments.length > 0 ? (
              <div id="issue-overview-visual" className="order-2 min-w-0">
                <SectionHead>Attachments</SectionHead>
                <ScreenshotPreview
                  key={`${fb.id}:${fb.attachments[0]!.downloadUrl}`}
                  attachment={fb.attachments[0]!}
                  attachmentCount={fb.attachments.length}
                  pointSelection={pointSelection}
                />
                {fb.attachments.length > 1 ? <Button type="button" tone="ghost" className="mt-2 px-0 text-caption" onClick={() => openIssueControl("issue-additional-attachments", "investigate")}>View {fb.attachments.length - 1} more attachments</Button> : null}
              </div>
            ) : null}
            <div className="order-1 min-w-0 space-y-5">
              <div className="space-y-2.5">
                <h2 id="issue-report-title" className="text-title text-foreground">Customer’s issue</h2>
                <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-foreground">{fb.description}</p>
              </div>
              {hasReproduction ? (
                <div className="space-y-4 pt-2">
                  {fb.stepsToReproduce ? (
                    <div>
                      <p className="text-caption font-medium text-muted">Steps to reproduce</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-body leading-relaxed text-foreground">{fb.stepsToReproduce}</p>
                    </div>
                  ) : null}
                  {(fb.expectedResult || fb.actualResult) ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {fb.expectedResult ? (
                        <div>
                          <p className="text-caption font-medium text-muted">Expected</p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-body leading-relaxed text-foreground">{fb.expectedResult}</p>
                        </div>
                      ) : null}
                      {fb.actualResult ? (
                        <div>
                          <p className="text-caption font-medium text-muted">Actual</p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-body leading-relaxed text-foreground">{fb.actualResult}</p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

        </section>

        <section
          id="issue-panel-conversation"
          aria-labelledby="issue-conversation-heading"
          className="tg-card min-w-0 p-5 sm:p-6 xl:col-start-1 xl:row-start-2"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="issue-conversation-heading" tabIndex={-1} className="scroll-mt-24 text-title text-foreground">Conversation{conversationTotal !== undefined && conversationTotal > 0 ? <span className="ml-2 text-label font-normal text-muted">({conversationTotal})</span> : null}</h2>
                <p className="mt-1 text-caption text-muted">Notes and customer-visible messages · Newest first</p>
              </div>
              <Button type="button" tone="ghost" disabled={conversationQuery.isFetching} onClick={() => void conversationQuery.refetch()}>Refresh conversation</Button>
            </div>
            {conversationQuery.isLoading ? <p role="status" className="mt-5 text-label text-muted">Loading conversation...</p> : null}
            {conversationQuery.isError ? <div role="alert" className="mt-5 rounded-lg bg-warning/10 p-4">
              <p className="text-label text-foreground">{conversation.length ? "More messages could not be loaded. Your loaded messages and draft are still here." : "Conversation could not be loaded."}</p>
              <Button type="button" tone="secondary" className="mt-3" onClick={() => void (conversationQuery.isFetchNextPageError ? conversationQuery.fetchNextPage() : conversationQuery.refetch())}>Retry conversation</Button>
            </div> : null}
            {conversationQuery.isSuccess && conversation.length === 0 ? <p className="mt-5 text-label text-muted">No notes or replies yet.</p> : null}
            {conversation.length > 0 ? <ol className="mt-5 space-y-4 max-xl:max-h-96 max-xl:overflow-y-auto" aria-label="Notes and customer replies">
              {conversation.map((comment) => <li key={comment.id}>
                <article className={cn("rounded-xl p-4", comment.visibility === "internal" ? "bg-surface-muted/60" : "border border-border/40")}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-label font-semibold text-foreground">{comment.author?.name ?? (comment.visibility === "internal" ? "Internal note" : "Public message")}</p>
                      <p className="mt-1 text-caption text-muted">{comment.visibility === "internal" ? "Private note" : "Customer-visible"} · <time dateTime={new Date(comment.createdAt).toISOString()} title={formatFullDate(new Date(comment.createdAt))}>{formatRelativeDate(comment.createdAt)}</time></p>
                    </div>
                    {comment.visibility === "public" ? <Button type="button" tone="ghost" disabled={issueLocked || issueMutationBusy} onClick={() => {
                      setReplyTarget(comment);
                      openIssueControl("issue-requester-summary");
                    }}>Reply to this message</Button> : null}
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-body text-foreground">{comment.body}</p>
                </article>
              </li>)}
            </ol> : null}
            {conversationQuery.hasNextPage ? <Button type="button" tone="secondary" className="mt-5 w-full" disabled={conversationQuery.isFetching} onClick={() => void conversationQuery.fetchNextPage()}>
              {conversationQuery.isFetchingNextPage ? "Loading older messages..." : `Load older messages (${conversation.length} of ${conversationTotal})`}
            </Button> : conversation.length > 0 ? <p className="mt-5 text-center text-caption text-muted">
              {conversationTotal !== undefined && conversationTotal > conversation.length
                ? `${conversation.length} messages shown. Refresh to load newer messages.` : `All ${conversation.length} messages shown.`}
            </p> : null}
        </section>

        <aside id="issue-update-panel" aria-label="Ticket update" className="tg-card min-w-0 scroll-mt-24 space-y-5 p-5 xl:sticky xl:top-20 xl:col-start-2 xl:row-start-1 xl:row-end-5">
          <section id="issue-requester-message" aria-labelledby="issue-composer-title">
            <h2 id="issue-composer-title" className="text-title text-foreground">Update ticket</h2>
            {requesterUpdateDue ? <p className="mt-2 text-label text-warning-700">Customer update due</p> : null}
            <div id="issue-status-update" className="mt-4">
              <p className="mb-2 text-label font-medium text-foreground">Status</p>
              <OverlaySelect ariaLabel="Status" value={statusValue} disabled={issueLocked || issueMutationBusy}
                onChange={(value) => { setStatusDraft(value === fb.status ? null : value); setCustomerReplyNotice(false); }} display={<StatusChip status={statusValue} />}
                options={FEEDBACK_STATUSES.filter((status) => status === fb.status || status !== "duplicate" && FEEDBACK_STATUS_TRANSITIONS[fb.status as FeedbackStatus]?.includes(status)).map((status) => ({ value: status, label: STATUS_META[status].label }))} />
              {statusUpdateHelp ? <p className="mt-2 text-caption text-muted">{statusUpdateHelp}</p> : null}
              {statusProgressionBlocked && !issueLocked ? <Button type="button" tone="ghost" className="mt-1 px-0 text-caption" onClick={() => openIssueControl("issue-evidence-quality-details")}>Review missing evidence</Button> : null}
            </div>
            <fieldset className="mt-3" disabled={issueLocked || issueMutationBusy}>
              <legend className="sr-only">Update visibility</legend>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-muted/60 p-1">
                {([['internal', 'Internal note'], ['public', 'Customer reply']] as const).map(([value, label]) => (
                  <label key={value} onClick={(event) => {
                    if (customerReplyRequired && value === "internal") {
                      event.preventDefault();
                      setCustomerReplyNotice(true);
                    }
                  }} className={cn("flex min-h-11 items-center justify-center rounded-lg px-2 text-label font-medium focus-within:ring-2 focus-within:ring-primary", customerReplyRequired && value === "internal" || !customerReplyAvailable && value === "public" ? "cursor-not-allowed opacity-50" : "cursor-pointer", composerMode === value ? "bg-surface text-primary shadow-soft" : "text-muted")}>
                    <input type="radio" name="issue-note-visibility" value={value} checked={composerMode === value} disabled={value === "public" && !customerReplyAvailable} aria-disabled={customerReplyRequired && value === "internal" || undefined} aria-describedby={customerReplyRequired && value === "internal" ? "issue-customer-reply-required" : value === "public" && !customerReplyAvailable ? "issue-customer-reply-unavailable" : undefined}
                      onChange={() => {
                        if (customerReplyRequired && value === "internal") setCustomerReplyNotice(true);
                        else { setComposerMode(value); setCustomerReplyNotice(false); }
                      }} className="sr-only" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            {!customerReplyAvailable ? <p id="issue-customer-reply-unavailable" className="mt-3 text-caption text-muted">
              {fb.reporter.email ? "Customer replies are paused. Enable a recipient or add one." : "Add a customer email to enable replies."}
              {!issueLocked ? <> <button type="button" className="rounded text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50" disabled={issueMutationBusy} onClick={() => {
                setNewSubscriberType("external_subscriber");
                setNewSubscriberNotifyStatus(true);
                openIssueControl("new-subscriber-email");
              }}>Add recipient</button></> : null}
            </p> : null}
            {customerReplyRequired ? <p id="issue-customer-reply-required" role={customerReplyNotice ? "alert" : undefined} className={cn("mt-3 text-caption", customerReplyNotice ? "text-warning-700" : "text-muted")}>
              {customerReplyNotice ? "The status is changing, so a customer reply is required. Restore the current status to add an internal note." : "A status change requires an update to the customer."}
            </p> : null}
            <p className="mt-3 break-words text-caption text-muted">
              {composerMode === "internal" ? "Visible only to your team."
                : customerReplyAvailable ? `Email to ${requesterRecipients.join(", ")}. Also visible on the customer's ticket.` : "Your reply draft is kept until a customer can receive it."}
            </p>
            {composerMode === "public" && replyContext ? <section aria-label="Reply context" className="mt-4 rounded-lg bg-surface-muted/45 p-3">
              <p className="text-caption font-medium text-foreground">{replyTarget ? "Replying to message" : "Latest public message"} · {replyContext.author?.name ?? "Customer-visible message"}</p>
              <time className="mt-1 block text-caption text-muted" dateTime={new Date(replyContext.createdAt).toISOString()}>{formatRelativeDate(replyContext.createdAt)}</time>
              <blockquote className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-label text-foreground">{replyContext.body}</blockquote>
              <Button type="button" tone="ghost" className="mt-2 px-0 text-caption" onClick={openConversation}>Choose another message</Button>
            </section> : null}
            <label htmlFor={composerMode === "internal" ? "issue-internal-note" : "issue-requester-summary"} className="mt-4 block text-label font-medium text-foreground">
              {customerReplyRequired ? "Customer update" : statusChanged ? "Reason for status change" : composerMode === "internal" ? "Internal note" : "Customer reply"} <span className="text-caption text-muted">(required)</span>
            </label>
            {composerMode === "internal" ? <Textarea id="issue-internal-note" aria-label="New note" required maxLength={3000} rows={5} className={cn(SOFT_INPUT, "mt-2")}
              value={commentBody} disabled={issueLocked || issueMutationBusy} onChange={(event) => setCommentBody(event.target.value)} placeholder={statusChanged ? "Explain why the status is changing." : "Record your findings, decision, or handoff."} />
              : <Textarea id="issue-requester-summary" aria-label="Reporter-visible message" required maxLength={3000} rows={5} className={cn(SOFT_INPUT, "mt-2")}
                value={requesterSummary} disabled={issueLocked || issueMutationBusy} onChange={(event) => setRequesterSummary(event.target.value)} placeholder={statusChanged ? "Explain the status change to the customer." : "Write only what the customer should receive."} />}
            <div className="mt-4 flex flex-col gap-2">
              <Button type="button" onClick={saveChanges} disabled={issueMutationBusy || !canSave}>{saveLabel}</Button>
              {(composerMode === "internal" ? hasNote : hasRequesterSummary) || statusChanged ? <Button type="button" tone="ghost" disabled={issueMutationBusy} onClick={() => {
                if (composerMode === "internal") setCommentBody(""); else { setRequesterSummary(""); setReplyTarget(null); }
                setStatusDraft(null);
                setCustomerReplyNotice(false);
              }}>Cancel draft</Button> : null}
            </div>
            {latestCustomerUpdates.length ? <section className="mt-4 space-y-2" aria-label="Latest customer update delivery">
              <h3 className="text-caption font-medium text-foreground">Latest delivery by recipient</h3>
              {latestCustomerUpdates.map((notification) => <div key={notification.id} className="rounded-lg bg-surface-muted/45 p-3 text-caption">
                <p className="break-words font-medium text-foreground">{notification.recipientEmail ?? "Reporter"}: {notification.status === "pending" ? "queued" : notification.status}</p>
                <p className="mt-1 text-muted">{formatRelativeDate(notification.sentAt ?? notification.createdAt)}</p>
                {notification.skipReason ? <p className="mt-1 text-muted">{notification.skipReason.replaceAll("_", " ")}</p> : null}
                {notification.status === "failed" ? <Button type="button" tone="secondary" className="mt-2" disabled={issueMutationBusy} onClick={() => submitNotificationReplay(notification.id)} aria-label={`Retry delivery to ${notification.recipientEmail ?? "reporter"}`}>Retry delivery</Button> : null}
              </div>)}
            </section> : null}
                {!issueLocked ? (
                  <details id="issue-recipient-settings" className="mt-4 border-t border-border/25 pt-3">
                    <summary className="cursor-pointer text-caption font-medium text-muted hover:text-foreground">Recipients</summary>
                    <div className="pt-3">
                      <FeedbackSubscribersCard
                        detail={detail}
                        addingSubscriber={addingSubscriber}
                        onAddingSubscriberChange={setAddingSubscriber}
                        newSubscriberEmail={newSubscriberEmail}
                        newSubscriberName={newSubscriberName}
                        newSubscriberNotifyOnStatusChange={newSubscriberNotifyStatus}
                        newSubscriberNotifyOnTriage={newSubscriberNotifyTriage}
                        newSubscriberRecipientType={newSubscriberType}
                        onAddSubscriber={() => submitSubscriberAction({ kind: "add", body: {
                          email: newSubscriberEmail.trim(),
                          name: newSubscriberName.trim() || undefined,
                          recipientType: newSubscriberType,
                          notifyOnTriage: newSubscriberNotifyTriage,
                          notifyOnStatusChange: newSubscriberNotifyStatus,
                        } })}
                        onNewSubscriberEmailChange={setNewSubscriberEmail}
                        onNewSubscriberNameChange={setNewSubscriberName}
                        onNewSubscriberNotifyOnStatusChangeChange={setNewSubscriberNotifyStatus}
                        onNewSubscriberNotifyOnTriageChange={setNewSubscriberNotifyTriage}
                        onNewSubscriberRecipientTypeChange={setNewSubscriberType}
                        onRemoveSubscriber={(id) => submitSubscriberAction({ kind: "remove", id })}
                        onToggleSubscriberStatus={(id, next) => submitSubscriberAction({ kind: "update", id, body: { notifyOnStatusChange: next } })}
                        onToggleSubscriberTriage={(id, next) => submitSubscriberAction({ kind: "update", id, body: { notifyOnTriage: next } })}
                        onUpdateSubscriberType={(id, next) => submitSubscriberAction({ kind: "update", id, body: { recipientType: next } })}
                        savingSubscriber={issueMutationBusy}
                      />
                    </div>
                  </details>
                ) : null}
          </section>
        </aside>

        <div id="issue-supporting-work" className="min-w-0 xl:col-start-1 xl:row-start-3">
          <details id="issue-panel-investigate" className="tg-card min-w-0 p-5 sm:p-6" open={technicalOpen} onToggle={(event) => setTechnicalOpen(event.currentTarget.open)}>
            <summary className="cursor-pointer text-label font-semibold text-foreground">Technical details</summary>
            {technicalOpen ? <div className="mt-5 space-y-6">
          {evidenceQuality ? (
            <div id="issue-evidence-stage-gate" className="space-y-3">
              <EvidenceQualityPanel
                quality={evidenceQuality}
              />
              <section
                className={cn(
                  "rounded-xl border px-4 py-4",
                  evidenceQuality.score >= 75
                    ? "border-success/25 bg-success-50/35"
                    : evidenceGateOverride
                      ? "border-warning/30 bg-warning-50/35"
                      : "border-danger/25 bg-danger-50/20",
                )}
                aria-labelledby="issue-evidence-gate-title"
              >
                <div className="flex items-start gap-3">
                  <LockKeyhole className={cn("mt-0.5 size-4 shrink-0", evidenceGateReady ? "text-success-700" : "text-danger-700")} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <h3 id="issue-evidence-gate-title" className="text-label font-semibold text-foreground">
                      {evidenceQuality.score >= 75
                        ? "Engineering gate open"
                        : evidenceGateOverride
                          ? "Engineering gate overridden"
                          : "Engineering blocked"}
                    </h3>
                    <p className="mt-1 text-caption leading-relaxed text-muted">
                      {evidenceQuality.score >= 75
                        ? "The capture requirements are met. Review the evidence before planning or verifying a fix."
                        : evidenceGateOverride
                          ? `Override recorded at ${evidenceGateOverride.evidenceScore}%: ${evidenceGateOverride.reason}`
                          : canEmailRequester
                            ? "Request missing evidence, or record a reasoned override if work needs to proceed."
                            : "No reply channel is available. Investigate internally, then record a reasoned override if the available evidence supports proceeding."}
                    </p>
                    {!evidenceGateReady ? (
                      <details
                        id="issue-evidence-override-disclosure"
                        className="mt-3"
                        open={showEvidenceOverride}
                        onToggle={(event) => setShowEvidenceOverride(event.currentTarget.open)}
                      >
                        <summary className="tg-disclosure-summary cursor-pointer text-caption font-medium text-muted">
                          Override with audited reason
                        </summary>
                        <div className="mt-3 space-y-2">
                          <label htmlFor="issue-evidence-override-reason" className="block text-caption font-medium text-foreground">
                            Why should engineering proceed now?
                          </label>
                          <Textarea
                            id="issue-evidence-override-reason"
                            className={SOFT_INPUT}
                            value={evidenceOverrideReason}
                            disabled={issueLocked || issueMutationBusy}
                            onChange={(event) => setEvidenceOverrideReason(event.target.value)}
                            placeholder="Example: A production outage is active and logs are available directly to the incident team."
                          />
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              tone="secondary"
                              disabled={issueLocked || issueMutationBusy || evidenceOverrideReason.trim().length < 10}
                              onClick={submitEvidenceOverride}
                            >
                              {evidenceOverrideMutation.isPending ? "Recording override..." : "Record override and proceed"}
                            </Button>
                          </div>
                        </div>
                      </details>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          ) : null}

            {canEmailRequester && !issueLocked && !terminalIssue && Boolean(evidenceQuality?.missing.length) ? (
              <Button type="button" tone="secondary" disabled={issueMutationBusy} onClick={draftNeedsMoreInfo}>
                <MessageSquarePlus className="size-4" aria-hidden="true" />{copy.detail.askReporter}
              </Button>
            ) : null}
          <div id="issue-evidence-detail" className="space-y-6">
            {fb.attachments.length > 1 ? (
              <section id="issue-additional-attachments" className="space-y-2.5">
                <SectionHead>More attachments</SectionHead>
                <div className="grid gap-3">
                  {fb.attachments.slice(1).map((attachment) => (
                    <div key={attachment.id} className="min-w-0">
                      <p className="flex justify-between gap-3 text-caption text-muted"><span className="truncate">{attachment.fileName}</span><span>{formatBytes(attachment.byteSize)}</span></p>
                      <ScreenshotPreview key={`${fb.id}:${attachment.downloadUrl}`} attachment={attachment} attachmentCount={1} pointSelection={pointSelection} />
                    </div>
                  ))}
                </div>
                {pointSelection ? (
                  <p className="text-caption text-muted">
                    {pointSelection.label ? `Selected element: ${pointSelection.label}` : "Selected point on page"}
                  </p>
                ) : null}
              </section>
            ) : null}

            {selectedElement ? <SelectedElementPanel selectedElement={selectedElement} /> : null}
            {selectedTextSuggestion ? <SelectedTextPanel selectedTextSuggestion={selectedTextSuggestion} /> : null}


          </div>

          {fb.clientErrorContext ? <ClientErrorPanel clientErrorContext={fb.clientErrorContext} /> : null}

          {/* Environment */}
          <section className="space-y-3">
            <SectionHead>Environment</SectionHead>
            <dl id="issue-environment-list" className={cn(DETAIL_CONTEXT_LIST, "sm:grid-cols-2")}>
              <EnvRow label="Browser" value={`${fb.browser.browserName ?? "Unknown"} ${fb.browser.browserVersion ?? ""}`.trim()} />
              <EnvRow label="OS" value={`${fb.browser.osName ?? "Unknown"} ${fb.browser.osVersion ?? ""}`.trim()} />
              <EnvRow label="Viewport" value={`${fb.browser.viewportWidth} × ${fb.browser.viewportHeight}`} />
              <EnvRow label="Release" value={`${fb.release.appVersion}${fb.release.buildNumber ? ` (${fb.release.buildNumber})` : ""}`} />
              <EnvRow label="Page" value={fb.route.url} href={fb.route.url} />
            </dl>
            {fb.releaseSignal?.kind === "regression" ? (
              <div id="issue-release-regression-signal" className="rounded-2xl border border-danger-200 bg-danger-50 px-4 py-3">
                <p className="text-caption font-medium text-danger-700">Regression after fixed release</p>
                <p className="mt-1 text-body text-foreground">
                  Previously fixed in {fixedReleaseSignalLabel(fb.releaseSignal)} by{" "}
                  <Link className="font-medium text-danger-700 underline-offset-2 hover:underline" to={`/issues/${fb.releaseSignal.fixedIssue.id}`}>
                    #{fb.releaseSignal.fixedIssue.ticketNumber} {fb.releaseSignal.fixedIssue.title}
                  </Link>
                  .
                </p>
                <p className="mt-1 text-caption text-muted">
                  Fixed {formatRelativeDate(fb.releaseSignal.fixedRelease.fixedAt)}.
                </p>
              </div>
            ) : null}
          {fb.consoleEntries ? (
            <details className="pt-1">
              <summary className="tg-disclosure-summary cursor-pointer select-none text-caption font-medium text-muted hover:text-foreground">
                Console output
              </summary>
                <div className="mt-2.5">
                  <ConsoleLog entries={fb.consoleEntries} />
              </div>
            </details>
          ) : null}
            {networkEntries.length > 0 ? (
              <details id="issue-network-summary" className="pt-1">
                <summary className="tg-disclosure-summary cursor-pointer select-none text-caption font-medium text-muted hover:text-foreground">
                  Network summary
                </summary>
                <div className="mt-2.5 max-h-64 overflow-y-auto rounded-xl bg-code px-3 py-2.5 shadow-soft">
                  {networkEntries.map((entry, index) => (
                    <p
                      key={`${entry.timestamp}-${index}`}
                      className={entry.error || (entry.statusCode && entry.statusCode >= 400) ? "whitespace-pre-wrap break-words py-0.5 font-mono text-caption leading-relaxed text-danger-200" : "whitespace-pre-wrap break-words py-0.5 font-mono text-caption leading-relaxed text-code-text/80"}
                    >
                      [{entry.method}] {entry.statusCode ?? "failed"} {entry.url} ({entry.durationMs}ms){entry.requestId ? ` request ${entry.requestId}` : ""}
                    </p>
                  ))}
                </div>
              </details>
            ) : null}
        </section>

          {productContext ? <ProductContextPanel productContext={productContext} /> : null}
          {featureContext && !productContext?.feature ? <FeatureContextPanel featureContext={featureContext} /> : null}
          {customerImpact ? <CustomerImpactPanel customerImpact={customerImpact} /> : null}
          {consentSnapshot ? <ConsentSnapshotPanel consentSnapshot={consentSnapshot} /> : null}
          {sessionReplayClipId ? <SessionReplayPanel sessionReplayClipId={sessionReplayClipId} /> : null}
          {surveyResponse ? <SurveyResponsePanel surveyResponse={surveyResponse} /> : null}

          {evidenceTimeline.some((event) => event.id.startsWith("host-evidence-") || event.id.startsWith("tracked-event-")) ? (
            <section id="issue-evidence-timeline" className="space-y-3">
              <SectionHead>Events around the report</SectionHead>
              <ol className="space-y-4">
                {evidenceTimeline.filter((event) => event.id === "submitted" || event.id.startsWith("host-evidence-") || event.id.startsWith("tracked-event-")).map((event) => (
                  <li key={event.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0"><p className="text-label font-medium">{event.label}</p><p className="mt-1 break-words text-caption text-muted">{event.detail}</p></div>
                    {event.at ? <time className="text-caption text-muted" dateTime={new Date(event.at).toISOString()} title={formatFullDate(new Date(event.at))}>{formatRelativeDate(new Date(event.at))}</time> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          <details id="issue-capture-context" className="space-y-3">
            <summary className="tg-disclosure-summary cursor-pointer text-label font-medium text-muted">Additional capture context</summary>
            <ol className="space-y-3 py-3">
              {evidenceTimeline.filter((event) => event.id !== "submitted" && !event.id.startsWith("host-evidence-") && !event.id.startsWith("tracked-event-")).map((event) => (
                <li key={event.id} className="flex gap-3">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-300" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-label font-medium text-foreground">{event.label}</p>
                      {event.at ? (
                        <p className="text-caption text-muted" title={formatFullDate(new Date(event.at))}>
                          {formatRelativeDate(new Date(event.at))}
                        </p>
                      ) : null}
                    </div>
                    <p className="mt-1 break-words text-caption leading-relaxed text-muted">{event.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </details>

          {fb.duplicateOf ? (
            <section id="issue-duplicate-of" className="space-y-2.5">
              <SectionHead>{copy.detail.duplicateOf}</SectionHead>
              <div className="rounded-2xl bg-surface-muted/35 p-3">
                <p className="px-1 pb-2 text-caption text-muted">{copy.detail.duplicateOfBody}</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Link
                    to={`/issues/${fb.duplicateOf.id}`}
                    className="tg-inline-link min-w-0 truncate text-label text-foreground hover:text-primary"
                    title={fb.duplicateOf.title}
                  >
                    <span className="tabular-nums text-muted">#{fb.duplicateOf.ticketNumber}</span> {fb.duplicateOf.title}
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDuplicateAction({ kind: "clear" })}
                    disabled={issueLocked || issueMutationBusy || duplicateAction?.kind === "clear"}
                    className="tg-copy-button shrink-0 text-caption font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
                  >
                    {copy.detail.clearDuplicate}
                  </button>
                </div>
                {duplicateAction?.kind === "clear" ? (
                  <div id="issue-clear-duplicate-confirmation" className="mt-3 rounded-xl border border-border/35 bg-surface px-3 py-2.5">
                    <p className="text-caption leading-relaxed text-muted">{copy.detail.clearDuplicateBody}</p>
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setDuplicateAction(null)}
                        className="tg-copy-button text-caption font-medium text-muted hover:text-foreground"
                      >
                        {copy.detail.cancelDuplicate}
                      </button>
                      <button
                        type="button"
                        onClick={() => submitUpdate({ duplicateOfId: null })}
                        disabled={issueLocked || issueMutationBusy}
                        className="tg-copy-button text-caption font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
                      >
                        {copy.detail.confirmClearDuplicate}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* Similar tickets */}
          {duplicateCandidates.length > 0 ? (
            <section id="issue-similar-tickets" className="space-y-2.5">
              <SectionHead>Similar tickets</SectionHead>
              <div className="rounded-2xl bg-surface-muted/35 p-3">
                {duplicateCandidates.map((candidate) => (
                  <div key={candidate.feedbackId} className="grid gap-2 border-b border-border/20 py-2 first:pt-0 last:border-b-0 last:pb-0">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <Link
                        to={`/issues/${candidate.feedbackId}`}
                        className="tg-inline-link min-w-0 truncate text-label text-foreground hover:text-primary"
                        title={candidate.title}
                      >
                        <span className="tabular-nums text-muted">#{candidate.ticketNumber}</span> {candidate.title}
                      </Link>
                      <button
                        type="button"
                        onClick={() => setDuplicateAction({ kind: "mark", feedbackId: candidate.feedbackId })}
                        disabled={issueLocked || issueMutationBusy || pendingDuplicateCandidate?.feedbackId === candidate.feedbackId}
                        className="tg-copy-button shrink-0 text-caption font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
                      >
                        {copy.detail.markDuplicate}
                      </button>
                    </div>
                    {pendingDuplicateCandidate?.feedbackId === candidate.feedbackId ? (
                      <div id={`issue-duplicate-confirmation-${candidate.feedbackId}`} className="rounded-xl border border-border/35 bg-surface px-3 py-2.5">
                        <p className="text-caption leading-relaxed text-muted">{copy.detail.duplicateConfirmBody(candidate.ticketNumber)}</p>
                        <div className="mt-2 flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setDuplicateAction(null)}
                            className="tg-copy-button text-caption font-medium text-muted hover:text-foreground"
                          >
                            {copy.detail.cancelDuplicate}
                          </button>
                          <button
                            type="button"
                            onClick={() => submitUpdate({ status: "duplicate", duplicateOfId: candidate.feedbackId })}
                            disabled={issueLocked || issueMutationBusy}
                            className="tg-copy-button text-caption font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
                          >
                            {copy.detail.confirmDuplicate}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {duplicates.length > 0 ? (
            <section id="issue-duplicate-reports" className="space-y-2.5">
              <SectionHead>{copy.detail.duplicateReports}</SectionHead>
              <div className="rounded-2xl bg-surface-muted/35 p-3">
                <p className="px-1 pb-2 text-caption text-muted">{copy.detail.duplicateReportsBody}</p>
                {duplicateGroup ? (
                  <div id="issue-duplicate-group-summary" className="mb-3 grid gap-2">
                    <div className="grid gap-2 rounded-xl border border-border/25 bg-surface px-3 py-2.5 sm:grid-cols-3">
                      <div className="min-w-0">
                        <p className="text-caption text-muted">{copy.detail.duplicateGroupReports}</p>
                        <p className="mt-0.5 text-label font-semibold tabular-nums text-foreground">{duplicateGroup.reportCount}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-caption text-muted">{copy.detail.duplicateGroupFirstSeen}</p>
                        <p className="mt-0.5 truncate text-label font-semibold text-foreground" title={formatFullDate(duplicateGroup.firstSeenAt)}>
                          {formatRelativeDate(duplicateGroup.firstSeenAt)}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-caption text-muted">{copy.detail.duplicateGroupLastSeen}</p>
                        <p className="mt-0.5 truncate text-label font-semibold text-foreground" title={formatFullDate(duplicateGroup.lastSeenAt)}>
                          {formatRelativeDate(duplicateGroup.lastSeenAt)}
                        </p>
                      </div>
                    </div>
                    {duplicateGroupReleases.length > 0 ? (
                      <div id="issue-duplicate-group-releases" className="rounded-xl border border-border/25 bg-surface px-3 py-2.5">
                        <p className="text-caption font-medium text-muted">{copy.detail.duplicateGroupAffectedReleases}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {duplicateGroupReleases.map((release) => (
                            <span
                              key={`${release.appName}-${release.appEnvironment}-${release.appVersion}-${release.buildNumber ?? ""}-${release.releaseChannel ?? ""}`}
                              className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border/30 bg-surface-muted/45 px-2.5 py-1 text-caption text-muted"
                              title={`${duplicateReleaseLabel(release)} · ${release.reportCount} ${release.reportCount === 1 ? "report" : "reports"}`}
                            >
                              <span className="max-w-[14rem] truncate text-foreground">{duplicateReleaseLabel(release)}</span>
                              {duplicateReleaseMeta(release) ? (
                                <span className="truncate">{duplicateReleaseMeta(release)}</span>
                              ) : null}
                              <span className="tabular-nums text-muted">{release.reportCount}</span>
                            </span>
                          ))}
                          {hiddenDuplicateGroupReleaseCount > 0 ? (
                            <span className="inline-flex items-center rounded-full border border-border/30 bg-surface-muted/45 px-2.5 py-1 text-caption text-muted">
                              {copy.detail.duplicateGroupMoreReleases(hiddenDuplicateGroupReleaseCount)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid gap-1.5">
                  {duplicates.map((duplicate) => (
                    <Link
                      key={duplicate.id}
                      to={`/issues/${duplicate.id}`}
                      aria-label={copy.detail.openDuplicate(duplicate.ticketNumber)}
                      className="flex min-w-0 flex-col gap-1 rounded-xl px-3 py-2 transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="min-w-0 truncate text-label font-medium text-foreground">
                        <span className="tabular-nums text-muted">#{duplicate.ticketNumber}</span> {duplicate.title}
                      </span>
                      <span className="flex shrink-0 flex-wrap items-center gap-2">
                        <StatusChip status={duplicate.status} />
                        {duplicate.commentCount > 0 ? (
                          <span
                            className="text-caption text-muted"
                            title={duplicate.latestCommentAt ? formatFullDate(duplicate.latestCommentAt) : undefined}
                          >
                            {copy.detail.duplicateNoteCount(duplicate.commentCount)}
                          </span>
                        ) : null}
                        <span className="text-caption text-muted" title={formatFullDate(duplicate.createdAt)}>
                          {formatRelativeDate(duplicate.createdAt)}
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

            </div> : null}
          </details>

          <section id="issue-management" className="tg-card mt-3 min-w-0 p-5 sm:p-6">
            <details id="issue-management-more" open={managementOpen} onToggle={(event) => setManagementOpen(event.currentTarget.open)}>
              <summary className="cursor-pointer text-label font-semibold text-foreground">Ticket details</summary>
              {managementOpen ? (
              <div id="issue-management-details" className="pt-4">
              <h2 id="issue-management-title" className="text-title text-foreground">
                Ticket details
              </h2>
              <p className="mt-1 text-caption text-muted">
                Ownership and classification.
              </p>

              {!issueLocked && !terminalIssue ? <div className="mt-4 flex flex-wrap gap-3">
                {evidenceGateReady ? null : <Button type="button" tone="secondary" onClick={() => openIssueControl("issue-evidence-quality-details")}>
                  Review missing evidence
                </Button>}
              </div> : null}
              <div className="pt-5">

            {issueLocked ? (
              <div id="issue-locked-alert" className="mt-4 flex gap-3 rounded-2xl border border-warning/25 bg-warning-50 px-4 py-3 text-warning-700">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                  <LockKeyhole className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-label font-semibold">{copy.detail.lockedTitle}</p>
                  <p className="mt-1 text-caption leading-relaxed">{copy.detail.lockedBody}</p>
                </div>
              </div>
            ) : null}

            <p className="mb-3 text-caption text-muted">Owner and severity save immediately. Labels and external ticket save when you leave the field.</p>
            {/* Metadata — auto-saves on change */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Severity">
                <OverlaySelect
                  ariaLabel="Severity"
                  value={fb.severity}
                  disabled={issueLocked || issueMutationBusy}
                  onChange={(value) => submitUpdate({ severity: value })}
                  display={<SeverityIndicator severity={fb.severity} />}
                  options={SEVERITY_LEVELS.map((level) => ({ value: level, label: SEVERITY_META[level].label }))}
                />
              </Field>
              <Field label="Assignee">
                <OverlaySelect
                  id="issue-assignee-field"
                  ariaLabel="Assignee"
                  value={fb.owner?.id ?? ""}
                  disabled={issueLocked || issueMutationBusy}
                  onChange={(value) => submitUpdate({ ownerId: value || null })}
                  display={
                    <span className="text-label text-foreground">
                      {fb.owner?.name ?? <span className="text-muted">{copy.common.unassigned}</span>}
                    </span>
                  }
                  options={[
                    { value: "", label: copy.common.unassigned },
                    ...detail.assignableUsers.map((user) => ({ value: user.id, label: user.name })),
                  ]}
                />
              </Field>
              <Field label="Labels">
                <Input
                  className={SOFT_INPUT}
                  value={labelDraft ?? fb.labels.join(", ")}
                  disabled={issueLocked || issueMutationBusy}
                  onChange={(event) => setLabelDraft(event.target.value)}
                  onBlur={saveLabels}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      (event.target as HTMLInputElement).blur();
                    }
                  }}
                  placeholder="bug, blocker, release"
                  aria-label="Labels"
                />
              </Field>
              <Field label="External ticket">
                <Input
                  className={SOFT_INPUT}
                  value={ticketDraft ?? fb.externalTicketRef ?? ""}
                  disabled={issueLocked || issueMutationBusy}
                  onChange={(event) => setTicketDraft(event.target.value)}
                  onBlur={saveTicket}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      (event.target as HTMLInputElement).blur();
                    }
                  }}
                  placeholder="JIRA-1234"
                  aria-label="External ticket"
                />
              </Field>
              <div id="issue-external-links-field" className="lg:col-span-2">
                <Field label="External links">
                  <div id="issue-external-links-editor" className="rounded-xl bg-surface-muted/35 p-2">
                    {externalRefsDraft === null ? (
                      <div id="issue-external-links-readonly" className="space-y-2">
                        {shownExternalRefs.length > 0 ? (
                          <div id="issue-external-links-list" className="grid gap-1.5">
                            {shownExternalRefs.map((ref) => (
                              <div
                                key={`${ref.provider}-${ref.url}`}
                                className="min-w-0"
                              >
                                <ExternalRefDisplay externalRef={ref} />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="px-1 py-1 text-caption text-muted">No external links.</p>
                        )}
                        <Button
                          id="issue-external-links-edit-button"
                          type="button"
                          tone="secondary"
                          className="h-8 rounded-lg px-3 text-caption"
                          disabled={issueLocked || issueMutationBusy}
                          onClick={() => setExternalRefsDraft(fb.externalRefs.length > 0 ? fb.externalRefs : [blankExternalRef()])}
                        >
                          {fb.externalRefs.length > 0 ? "Edit links" : "Add link"}
                        </Button>
                      </div>
                    ) : (
                      <div id="issue-external-links-draft" className="space-y-2">
                        <div id="issue-external-links-draft-list" className="grid gap-2">
                          {shownExternalRefs.map((ref, index) => (
                            <div
                              key={index}
                              className="grid gap-2 rounded-lg bg-surface p-2 shadow-panel md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1.6fr)_auto]"
                            >
                              <label className="sr-only" htmlFor={`issue-external-provider-${index}`}>
                                Provider
                              </label>
                              <select
                                id={`issue-external-provider-${index}`}
                                className="h-9 rounded-lg border border-border/35 bg-surface px-2 text-label text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                value={ref.provider}
                                disabled={issueLocked || issueMutationBusy}
                                onChange={(event) => updateExternalRefDraft(index, { provider: event.target.value as FeedbackExternalRef["provider"] })}
                              >
                                {EXTERNAL_REF_PROVIDER_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <Input
                                className={SOFT_INPUT}
                                value={ref.label}
                                disabled={issueLocked || issueMutationBusy}
                                onChange={(event) => updateExternalRefDraft(index, { label: event.target.value })}
                                placeholder="Issue link"
                                aria-label="External link label"
                              />
                              <Input
                                className={SOFT_INPUT}
                                value={ref.url}
                                disabled={issueLocked || issueMutationBusy}
                                onChange={(event) => updateExternalRefDraft(index, { url: event.target.value })}
                                placeholder="https://"
                                aria-label="External link URL"
                              />
                              <Button
                                type="button"
                                tone="ghost"
                                className="h-9 rounded-lg px-3 text-caption"
                                disabled={issueLocked || issueMutationBusy}
                                onClick={() => setExternalRefsDraft((currentDraft) => (currentDraft ?? []).filter((_, itemIndex) => itemIndex !== index))}
                              >
                                Remove
                              </Button>
                            </div>
                          ))}
                        </div>
                        <div id="issue-external-links-actions" className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            tone="secondary"
                            className="h-8 rounded-lg px-3 text-caption"
                            disabled={issueLocked || issueMutationBusy}
                            onClick={() => setExternalRefsDraft((currentDraft) => [...(currentDraft ?? []), blankExternalRef()])}
                          >
                            Add link
                          </Button>
                          <Button type="button" className="h-8 rounded-lg px-3 text-caption" disabled={issueLocked || issueMutationBusy} onClick={saveExternalRefs}>
                            Save links
                          </Button>
                          <Button
                            type="button"
                            tone="ghost"
                            className="h-8 rounded-lg px-3 text-caption"
                            onClick={() => setExternalRefsDraft(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </Field>
              </div>
              {(shownEngineeringLifecycle || (fb.engineeringLifecycleHistory?.length ?? 0) > 0 || engineeringLifecycleDraft !== null || managementOpen) ? (
              null
              ) : null}
            </div>
            {fb.labels.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {fb.labels.map((label) => (
                  <Badge key={label}>{label}</Badge>
                ))}
              </div>
            ) : null}

            </div>
            </div>
              ) : null}
            </details>
          </section>
        </div>

        <details id="issue-panel-activity" className="tg-card min-w-0 p-5 sm:p-6 xl:col-start-1 xl:row-start-4" open={historyOpen} onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer text-label font-semibold text-foreground">Activity history</summary>
          {historyOpen ? (
          <div id="issue-unified-activity" className="mt-5">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <h2 className="text-title text-foreground">Activity</h2>
                <p className="mt-1 text-caption text-muted">
                  {activityTotal > 0 ? `${activityTotal} recorded events` : "Notes, delivery, integrations, and audited outcomes"}
                </p>
              </div>
              {activityQuery.isFetching && !activityQuery.isLoading ? (
                <span role="status" className="text-caption text-muted">Updating...</span>
              ) : null}
            </div>

            <div className="mt-5">
              <RequesterLoopSummary fb={fb} canEmailRequester={canEmailRequester} />
            </div>

            {activityQuery.isLoading ? (
              <div id="issue-activity-loading" role="status" className="mt-5 space-y-4" aria-label="Loading issue activity">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-16 animate-pulse rounded-md bg-surface-muted/60" />
                ))}
              </div>
            ) : activityQuery.isError && activity.length === 0 ? (
              <div id="issue-activity-error" role="alert" className="mt-5 border-l-2 border-danger pl-4">
                <p className="text-label font-medium text-foreground">Activity could not be loaded.</p>
                <p className="mt-1 text-caption text-muted">The Issue is still available. Retry to restore its chronology.</p>
                <Button tone="secondary" className="mt-3 h-11 gap-2" onClick={() => void activityQuery.refetch()}>
                  <RefreshCw className="size-4" aria-hidden="true" />
                  <span>Retry activity</span>
                </Button>
              </div>
            ) : activity.length === 0 ? (
              <div id="issue-activity-empty" className="mt-5 border-l-2 border-border pl-4">
                <p className="text-label font-medium text-foreground">No activity recorded yet.</p>
                <p className="mt-1 text-caption text-muted">The first note, status change, provider event, or delivery outcome will appear here.</p>
              </div>
            ) : (
              <div id="issue-activity-content">
                {activityQuery.isError ? (
                  <div id="issue-activity-stale" role="alert" className="mt-5 border-l-2 border-warning pl-4">
                    <p className="text-label font-medium text-foreground">Activity could not be refreshed.</p>
                    <p className="mt-1 text-caption text-muted">Showing the last loaded chronology. Retry to check for newer events.</p>
                    <Button tone="secondary" className="mt-3 h-11 gap-2" onClick={() => void activityQuery.refetch()}>
                      <RefreshCw className="size-4" aria-hidden="true" />
                      <span>Retry activity refresh</span>
                    </Button>
                  </div>
                ) : null}
                <ol id="issue-activity-chronology" aria-label="Issue activity chronology" className="mt-5">
                {activity.map((event) => {
                  const outcomeLabel = activityOutcomeLabel(event.outcome);
                  const technicalEvent = event.kind === "notification" || event.kind === "integration" || event.kind === "lifecycle";
                  const isReplaying = Boolean(event.retry) && replayNotificationMutation.isPending &&
                    replayNotificationMutation.variables?.notificationId === event.retry?.notificationId;
                  return (
                    <li key={event.id} data-activity-kind={event.kind} className="relative border-l border-border/45 pb-6 pl-6 last:border-transparent last:pb-0">
                      <span
                        className={cn(
                          "absolute -left-1.5 top-1 size-3 rounded-full border-2 border-surface",
                          event.outcome === "failed" ? "bg-danger" : event.outcome === "success" ? "bg-success" : "bg-brand-300",
                        )}
                        aria-hidden="true"
                      />
                      <article className="min-w-0">
                        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                          <div className="min-w-0">
                            <p className="break-words text-label font-semibold text-foreground">{event.title}</p>
                            {!technicalEvent ? <p className="mt-0.5 break-words text-caption text-muted">
                              {event.actor.label} · {event.provenance}
                            </p> : null}
                          </div>
                          <time
                            dateTime={new Date(event.occurredAt).toISOString()}
                            title={formatFullDate(new Date(event.occurredAt))}
                            className="shrink-0 text-caption text-muted"
                          >
                            {formatRelativeDate(new Date(event.occurredAt))}
                          </time>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {outcomeLabel ? (
                            <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-caption font-medium", activityOutcomeClass(event.outcome))}>
                              {outcomeLabel}
                            </span>
                          ) : null}
                          {event.visibility === "internal" ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-surface-muted/55 px-2 py-0.5 text-caption font-medium text-muted">
                              <LockKeyhole className="size-3" aria-hidden="true" />
                              Private
                            </span>
                          ) : null}
                          {event.visibility === "requester" ? (
                            <span className="inline-flex rounded-full border border-border/40 bg-surface-muted/55 px-2 py-0.5 text-caption font-medium text-muted">
                              Reporter-visible
                            </span>
                          ) : null}
                        </div>
                        {event.summary ? (
                          <p className="mt-2 whitespace-pre-wrap break-words text-label leading-relaxed text-foreground">{event.summary}</p>
                        ) : null}
                        {technicalEvent ? (
                          <details className="mt-2 text-caption text-muted" open={event.outcome === "failed" || undefined}>
                            <summary className="tg-disclosure-summary cursor-pointer">Event details</summary>
                            <p className="mt-2">{event.actor.label} · {event.provenance}</p>
                            {event.safeDetails.length > 0 ? <ul className="mt-2 space-y-1" aria-label={`${event.title} details`}>
                              {event.safeDetails.map((detail) => <li key={detail} className="break-words leading-relaxed">{detail}</li>)}
                            </ul> : null}
                          </details>
                        ) : event.safeDetails.length > 0 ? (
                          <ul className="mt-2 space-y-1" aria-label={`${event.title} details`}>
                            {event.safeDetails.map((detail) => (
                              <li key={detail} className="break-words text-caption leading-relaxed text-muted">{detail}</li>
                            ))}
                          </ul>
                        ) : null}
                        {event.retry ? (
                          <Button
                            tone="secondary"
                            className="mt-3 h-11 gap-2"
                            disabled={issueMutationBusy}
                            onClick={() => submitNotificationReplay(event.retry!.notificationId)}
                          >
                            <RefreshCw className="size-4" aria-hidden="true" />
                            <span>{isReplaying ? copy.detail.notificationReplaying : event.retry.label}</span>
                          </Button>
                        ) : null}
                      </article>
                    </li>
                  );
                })}
                </ol>
              </div>
            )}

            {activityQuery.hasNextPage ? (
              <Button
                tone="secondary"
                className="mt-6 h-11 w-full gap-2"
                disabled={activityQuery.isFetchingNextPage}
                onClick={() => void activityQuery.fetchNextPage()}
              >
                <ChevronDown className="size-4" aria-hidden="true" />
                <span>{activityQuery.isFetchingNextPage ? "Loading older activity..." : `Load older activity (${activity.length} of ${activityTotal})`}</span>
              </Button>
            ) : activity.length > 0 ? (
              <p className="mt-5 text-center text-caption text-muted">All {activityTotal} recorded events shown.</p>
            ) : null}
          </div>
          ) : null}
        </details>
        </div>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
