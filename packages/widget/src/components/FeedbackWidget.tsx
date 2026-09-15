import { MotionCelebration,MotionPresence,MotionSurface } from "@tracegenie/shared/motion";
import { useCallback,useEffect,useMemo,useRef,useState,type CSSProperties } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toPng } from "html-to-image";
import {
buildPointSelection,
DEFAULT_WIDGET_SHORTCUT,
featureContextSchema,
feedbackEvidenceTimelineSchema,
feedbackConsentSnapshotSchema,
feedbackCustomerImpactSchema,
feedbackExternalRefsSchema,
type FeedbackSelectedTextSuggestion,
feedbackSubmissionSchema,
feedbackSurveyResponseSchema,
issueTypeSchema,
productContextSchema,
sessionReplayClipIdSchema,
selectedElementSchema,
shouldUsePointSelectionFallback,
severitySchema,
toDocumentSpacePoint,
toDocumentSpaceRect,
toLocalSpacePoint,
toLocalSpaceRect,
type PointSelection,
type ProductContext,
type RectLike,type WidgetProjectConfig,
widgetProjectConfigSchema,
type UserIdentity
} from "@tracegenie/shared";
import { z } from "zod";
import traceGenieMarkUrl from "../../../../packages/shared/src/assets/tracegenie-mark.svg?inline";

import { useClientErrorCapture } from "../hooks/useClientErrorCapture";
import { useConsoleCapture } from "../hooks/useConsoleCapture";
import { useKeyboardShortcut } from "../hooks/useKeyboardShortcut";
import { useNetworkSummaryCapture } from "../hooks/useNetworkSummaryCapture";
import { collectProtectedMaskRegions,transformImagePixels } from "../lib/imagePrivacy";
import { formatShortcut,parseBrowserInfo,redactCapturedText } from "../lib/utils";
import { ScreenshotPrivacyEditor } from "./ScreenshotPrivacyEditor";
import "../styles/widget.css";

// Zod v4 uses JIT object validators by default. Disable that in the browser
// so the embed remains compatible with strict CSP policies that forbid eval.
z.config({ jitless: true });

const ISSUE_TYPE_LABELS: Record<string, string> = {
  bug: "Bug",
  ux: "UX issue",
  enhancement: "Enhancement",
  performance: "Performance",
  data: "Data issue",
  other: "Other",
};

const SEVERITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

type SurveyPromptType = WidgetProjectConfig["surveyPrompt"]["type"];

export function readableBrandForeground(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const luminance = channels
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return whiteContrast >= blackContrast ? "#ffffff" : "#000000";
}

function surveyPromptUsesText(type: SurveyPromptType) {
  return type === "beta_feedback" || type === "churn_reason" || type === "abandonment";
}

const formSchema = feedbackSubmissionSchema.pick({
  title: true,
  description: true,
  issueType: true,
  severity: true,
  stepsToReproduce: true,
  expectedResult: true,
  actualResult: true,
});

type FormValues = z.infer<typeof formSchema>;

export type FeedbackWidgetProps = {
  apiBaseUrl: string;
  projectKey: string;
  appName: string;
  appEnvironment: string;
  appVersion: string;
  buildNumber?: string;
  releaseChannel?: string;
  currentUser?: UserIdentity;
  routeName?: string;
  pageTitle?: string;
  /** Arbitrary report metadata. Reserved keys include consentSnapshot, customerImpact, evidenceTimeline, externalRefs, featureContext, selectedElement, sessionReplayClipId, surveyResponse, eventTrail, networkEntries, pointSelection, and selectedTextSuggestion. */
  extraContext?: Record<string, unknown>;
  /** Bounded report-adjacent product context stored under extraContext.productContext. */
  productContext?: ProductContext;
  widgetConfig?: Partial<WidgetProjectConfig>;
  fetchProjectConfig?: boolean;
  captureTarget?: HTMLElement | (() => HTMLElement | null) | null;
  launcherLabel?: string;
  /** Widget theme. Defaults to 'light'. Set to 'dark' for dark host apps. */
  theme?: "light" | "dark";
  widgetSessionToken?: string;
  getWidgetSessionToken?: () => Promise<string>;
  openRequest?: FeedbackWidgetOpenRequest;
  onSubmitted?: (payload: unknown) => void;
  onError?: (error: Error) => void;
};

export type FeedbackWidgetOpenRequest = {
  id: number;
  title?: string;
  issueType?: FormValues["issueType"];
  extraContext?: Record<string, unknown>;
};

type UploadedAttachment = {
  uploadToken: string;
  attachment: {
    id: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
  };
};

type AdditionalAttachment = {
  metadata: DraftAttachmentMetadata;
  file: File | null;
  uploaded?: UploadedAttachment;
};

const MAX_REPORT_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 5_242_880;
const FILE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.log";

type SubmissionAttempt = {
  id: string;
  uploadId: string;
  attachmentChecksum?: string;
  pointSelectionDigest?: string;
  snapshotKey?: string;
  draftContent?: WidgetDraftContent;
  uploadedAttachment?: UploadedAttachment | null;
  payload?: z.infer<typeof feedbackSubmissionSchema>;
};

type RemoteProjectConfig = {
  key: string;
  name: string;
  organizationName: string;
  defaultEnvironment: string;
  widgetConfig: WidgetProjectConfig;
};

type LauncherPresentation = "icon" | "icon-text" | "text";
type SubmissionFailureKind = "offline" | "timeout" | "server" | "network" | "request";

class WidgetRequestError extends Error {
  constructor(
    message: string,
    readonly kind: SubmissionFailureKind,
  ) {
    super(message);
    this.name = "WidgetRequestError";
  }
}

type CaptureStatus = "none" | "capturing" | "ready" | "removed" | "failed";
type ImageEvidenceSource = "screenshot" | "upload";
type SelectionMode = "idle" | "picking";
type DraftAttachmentMetadata = {
  name: string;
  type: string;
  size: number;
  source: ImageEvidenceSource;
  checksum?: string;
  clientUploadId?: string;
};
type WidgetDirtySnapshot = {
  form: FormValues;
  surveyScore: number | null;
  surveyAnswer: string;
  attachment: DraftAttachmentMetadata | null;
  attachments?: DraftAttachmentMetadata[];
  pointSelection: PointSelection | null;
  includeConsole: boolean;
  includeClientError: boolean;
  includeNetwork: boolean;
  includeSelectedText: boolean;
  reporterName: string;
  reporterEmail: string;
  reporterConsent: boolean;
};

type WidgetSubmissionSnapshot = Omit<WidgetDirtySnapshot, "pointSelection"> & {
  pointSelectionDigest: string | null;
};

type SubmissionReceipt = {
  ticketNumber: number | null;
  trackingUrl: string | null;
  responseExpectation: string;
  processingState: "queued" | "capacity_locked";
};

function safeTrackingUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function submissionReceipt(value: unknown, fallbackExpectation: string): SubmissionReceipt {
  const feedback = value && typeof value === "object" && "feedback" in value
    ? (value as { feedback?: unknown }).feedback
    : null;
  const record = feedback && typeof feedback === "object" ? feedback as Record<string, unknown> : {};
  return {
    ticketNumber: typeof record.ticketNumber === "number" && Number.isInteger(record.ticketNumber) ? record.ticketNumber : null,
    trackingUrl: safeTrackingUrl(record.trackingUrl),
    responseExpectation: typeof record.responseExpectation === "string" && record.responseExpectation.trim()
      ? record.responseExpectation.trim().slice(0, 240)
      : fallbackExpectation,
    processingState: record.processingState === "capacity_locked" || record.isOverageLocked === true
      ? "capacity_locked"
      : "queued",
  };
}

function widgetDirtySnapshotKey(snapshot: WidgetDirtySnapshot) {
  return JSON.stringify({
    ...snapshot,
    form: {
      ...snapshot.form,
      title: snapshot.form.title.trim(),
      description: snapshot.form.description.trim(),
      stepsToReproduce: snapshot.form.stepsToReproduce?.trim() ?? "",
      expectedResult: snapshot.form.expectedResult?.trim() ?? "",
      actualResult: snapshot.form.actualResult?.trim() ?? "",
    },
    surveyAnswer: snapshot.surveyAnswer.trim(),
  });
}

async function sha256Text(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function widgetSubmissionSnapshotDigest(snapshot: WidgetSubmissionSnapshot) {
  return sha256Text(JSON.stringify({
    ...snapshot,
    ...(snapshot.attachments?.length ? { attachments: snapshot.attachments.map(({ clientUploadId: _id, ...metadata }) => metadata) } : {}),
    form: {
      ...snapshot.form,
      title: snapshot.form.title.trim(),
      description: snapshot.form.description.trim(),
      stepsToReproduce: snapshot.form.stepsToReproduce?.trim() ?? "",
      expectedResult: snapshot.form.expectedResult?.trim() ?? "",
      actualResult: snapshot.form.actualResult?.trim() ?? "",
    },
    surveyAnswer: snapshot.surveyAnswer.trim(),
  }));
}

async function widgetPointSelectionDigest(selection: PointSelection) {
  return sha256Text(JSON.stringify({
    version: selection.version,
    mode: selection.mode,
    xPct: selection.xPct,
    yPct: selection.yPct,
    rectPct: selection.rectPct ?? null,
  }));
}
type PickerHighlight = {
  mode: "element" | "point";
  point: {
    x: number;
    y: number;
  };
  rect?: RectLike;
} | null;

const SELECTED_TEXT_MAX_LENGTH = 1000;
const SELECTED_TEXT_PREVIEW_LENGTH = 96;
const SELECTED_TEXT_CACHE_TTL_MS = 30_000;
const WIDGET_DRAFT_VERSION = 1;
const WIDGET_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const WIDGET_DRAFT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const WIDGET_REQUEST_TIMEOUT_MS = 15_000;

const widgetDraftFormSchema = z
  .object({
    title: z.string().max(160),
    description: z.string().max(4000),
    issueType: issueTypeSchema,
    severity: severitySchema,
    stepsToReproduce: z.string().max(4000).optional(),
    expectedResult: z.string().max(2000).optional(),
    actualResult: z.string().max(2000).optional(),
  })
  .strict();

const widgetDraftSurveyResponseSchema = z
  .object({
    type: z.enum(["nps", "csat", "ces", "feature_satisfaction", "beta_feedback", "churn_reason", "abandonment"]),
    question: z.string().min(1).max(160),
    score: z.number().finite().min(0).max(10).optional(),
    answer: z.string().max(1000).optional(),
  })
  .strict()
  .refine((value) => value.score !== undefined || value.answer !== undefined, {
    message: "A draft survey response must contain an answer.",
  });

const widgetDraftAttachmentSchema = z
  .object({
    name: z.string().min(1).max(255),
    type: z.string().min(1).max(120),
    size: z.number().int().positive().max(20_000_000),
    source: z.enum(["screenshot", "upload"]),
    checksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    clientUploadId: z.string().trim().min(12).max(191).optional(),
  })
  .strict();

const widgetDraftEvidenceConsentSchema = z.object({
  includeConsole: z.boolean(),
  includeClientError: z.boolean(),
  includeNetwork: z.boolean(),
  includeSelectedText: z.boolean(),
}).strict();

const widgetDraftSchema = z
  .object({
    version: z.literal(WIDGET_DRAFT_VERSION),
    savedAt: z.number().int().nonnegative(),
    writerId: z.string().min(1).max(128),
    revision: z.number().int().positive(),
    form: widgetDraftFormSchema,
    advancedOpen: z.boolean(),
    submissionId: z.string().trim().min(12).max(191).optional(),
    submissionSnapshot: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    pointSelectionDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    evidenceConsent: widgetDraftEvidenceConsentSchema.optional(),
    surveyResponse: widgetDraftSurveyResponseSchema.optional(),
    attachment: widgetDraftAttachmentSchema.optional(),
    attachments: z.array(widgetDraftAttachmentSchema).max(MAX_REPORT_ATTACHMENTS).optional(),
  })
  .strict();
const widgetDraftContentSchema = widgetDraftSchema.omit({ writerId: true, revision: true });

type WidgetDraft = z.infer<typeof widgetDraftSchema>;
type WidgetDraftContent = Omit<WidgetDraft, "writerId" | "revision">;
type WidgetDraftScope = {
  storageKey: string;
  legacyStorageKey: string;
  storageKind: "local" | "session" | "none";
  tenantScope: string;
  projectKey: string;
  identityMarker: string;
  identityEmail?: string;
  emailFallbackStorageKey?: string;
};

function opaqueDraftScope(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function randomDraftScope() {
  return window.crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function widgetSubmissionId() {
  return `tg-widget:${randomDraftScope()}`;
}

function widgetUploadId() {
  return `tg-widget-upload:${randomDraftScope()}`;
}

async function fileSha256(file: File) {
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read attachment."));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function attachmentMatchesFile(attachment: DraftAttachmentMetadata, file: File, checksum: string) {
  return attachment.name === file.name
    && attachment.type === file.type
    && attachment.size === file.size
    && attachment.checksum === checksum;
}

function canonicalApiScope(apiBaseUrl: string) {
  try {
    const url = new URL(apiBaseUrl, window.location.origin);
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${path}`;
  } catch {
    return `invalid:${opaqueDraftScope(apiBaseUrl)}`;
  }
}

function widgetDraftIdentityMarker(currentUser?: UserIdentity) {
  if (!currentUser) return "anonymous";
  if (currentUser.id) return `id:${currentUser.id.trim()}`;
  if (currentUser.email) return `email:${currentUser.email.trim().toLowerCase()}`;
  return `name:${currentUser.name?.trim() ?? "unknown"}`;
}

function resolveWidgetDraftScope(props: Pick<FeedbackWidgetProps, "apiBaseUrl" | "projectKey" | "currentUser">): WidgetDraftScope {
  const tenantScope = canonicalApiScope(props.apiBaseUrl);
  const identityMarker = widgetDraftIdentityMarker(props.currentUser);
  const hasStableIdentity = Boolean(props.currentUser?.id || props.currentUser?.email);
  const identityScope = hasStableIdentity
    ? `user:${opaqueDraftScope(identityMarker)}`
    : props.currentUser
      ? "unstable-user"
      : "anonymous-session";
  const scope = opaqueDraftScope(`${window.location.origin}|${tenantScope}|${props.projectKey}|${identityScope}`);
  const emailFallbackMarker = props.currentUser?.id && props.currentUser.email
    ? `email:${props.currentUser.email.trim().toLowerCase()}`
    : null;
  const emailFallbackScope = emailFallbackMarker
    ? opaqueDraftScope(`${window.location.origin}|${tenantScope}|${props.projectKey}|user:${opaqueDraftScope(emailFallbackMarker)}`)
    : null;
  sweepExpiredWidgetDrafts(window.localStorage);
  sweepExpiredWidgetDrafts(window.sessionStorage);
  return {
    storageKey: `tracegenie:widget-draft:${scope}`,
    legacyStorageKey: `tracegenie:widget-draft:v${WIDGET_DRAFT_VERSION}:${encodeURIComponent(window.location.origin)}:${encodeURIComponent(props.projectKey)}`,
    storageKind: hasStableIdentity ? "local" : props.currentUser ? "none" : "session",
    tenantScope,
    projectKey: props.projectKey,
    identityMarker,
    identityEmail: props.currentUser?.email?.trim().toLowerCase(),
    emailFallbackStorageKey: emailFallbackScope ? `tracegenie:widget-draft:${emailFallbackScope}` : undefined,
  };
}

function draftStorage(scope: WidgetDraftScope) {
  if (scope.storageKind === "none") return null;
  return scope.storageKind === "local" ? window.localStorage : window.sessionStorage;
}

function sweepExpiredWidgetDrafts(storage: Storage) {
  const now = Date.now();
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith("tracegenie:widget-draft:")));
    for (const key of keys) {
      const raw = storage.getItem(key);
      if (!raw) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        storage.removeItem(key);
        continue;
      }
      const parsedVersion = typeof parsed === "object" && parsed !== null && "version" in parsed
        ? (parsed as { version?: unknown }).version
        : undefined;
      if (typeof parsedVersion === "number" && parsedVersion > WIDGET_DRAFT_VERSION) {
        continue;
      }
      const result = widgetDraftSchema.safeParse(parsed);
      if (
        !result.success
        || now - result.data.savedAt >= WIDGET_DRAFT_TTL_MS
        || result.data.savedAt - now > WIDGET_DRAFT_MAX_FUTURE_SKEW_MS
      ) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Best-effort cleanup must not affect widget availability.
  }
}

function removeStorageItem(storage: Storage, storageKey: string) {
  try {
    storage.removeItem(storageKey);
  } catch {
    // The host may block storage. Draft persistence must never block reporting.
  }
}

function draftRecordKey(scope: WidgetDraftScope, writerId: string) {
  return `${scope.storageKey}:writer:${encodeURIComponent(writerId)}`;
}

function readDraftRecord(storage: Storage, storageKey: string) {
  let rawDraft: string | null = null;
  try {
    rawDraft = storage.getItem(storageKey);
  } catch {
    return null;
  }
  if (rawDraft === null) return null;

  let parsedDraft: unknown;
  try {
    parsedDraft = JSON.parse(rawDraft);
  } catch {
    removeStorageItem(storage, storageKey);
    return null;
  }

  const parsedVersion = typeof parsedDraft === "object" && parsedDraft !== null && "version" in parsedDraft
    ? (parsedDraft as { version?: unknown }).version
    : undefined;
  if (typeof parsedVersion === "number" && parsedVersion > WIDGET_DRAFT_VERSION) {
    return null;
  }

  const draftResult = widgetDraftSchema.safeParse(parsedDraft);
  const now = Date.now();
  if (
    !draftResult.success
    || now - draftResult.data.savedAt >= WIDGET_DRAFT_TTL_MS
    || draftResult.data.savedAt - now > WIDGET_DRAFT_MAX_FUTURE_SKEW_MS
  ) {
    removeStorageItem(storage, storageKey);
    return null;
  }

  return draftResult.data;
}

function draftRecordKeys(storage: Storage, scope: WidgetDraftScope) {
  const prefix = `${scope.storageKey}:writer:`;
  const keys: string[] = [scope.storageKey];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {
    return keys;
  }
  return keys;
}

function readWidgetDraft(scope: WidgetDraftScope): WidgetDraft | null {
  removeStorageItem(window.localStorage, scope.legacyStorageKey);
  let latest: WidgetDraft | null = null;
  const storage = draftStorage(scope);
  if (!storage) return null;
  for (const key of draftRecordKeys(storage, scope)) {
    const candidate = readDraftRecord(storage, key);
    if (
      candidate
      && (!latest || candidate.savedAt > latest.savedAt || (candidate.savedAt === latest.savedAt && candidate.revision > latest.revision))
    ) {
      latest = candidate;
    }
  }
  return latest;
}

function clearWidgetDraftScope(scope: WidgetDraftScope) {
  const storage = draftStorage(scope);
  if (!storage) return;
  for (const key of draftRecordKeys(storage, scope)) {
    removeStorageItem(storage, key);
  }
}

function contentFromWidgetDraft(draft: WidgetDraft) {
  const { writerId: _writerId, revision: _revision, ...content } = draft;
  return widgetDraftContentSchema.parse(content);
}

function widgetDraftContentMatches(left: WidgetDraftContent, right: WidgetDraftContent) {
  const { savedAt: _leftSavedAt, ...leftComparable } = left;
  const { savedAt: _rightSavedAt, ...rightComparable } = right;
  return JSON.stringify(leftComparable) === JSON.stringify(rightComparable);
}

function sanitizeWidgetDraftRecords(
  scope: WidgetDraftScope,
  sanitize: (draft: WidgetDraft) => WidgetDraftContent,
) {
  try {
    const storage = draftStorage(scope);
    if (!storage) return;
    for (const key of draftRecordKeys(storage, scope)) {
      const draft = readDraftRecord(storage, key);
      if (!draft) continue;
      const sanitized = widgetDraftContentSchema.parse(sanitize(draft));
      const targetKey = draftRecordKey(scope, draft.writerId);
      const targetDraft = key === targetKey ? draft : readDraftRecord(storage, targetKey);
      if (
        targetDraft
        && targetDraft !== draft
        && (targetDraft.savedAt > draft.savedAt || (targetDraft.savedAt === draft.savedAt && targetDraft.revision >= draft.revision))
      ) {
        removeStorageItem(storage, key);
        continue;
      }
      const changed = !widgetDraftContentMatches(contentFromWidgetDraft(draft), sanitized);
      if (changed || key !== targetKey) {
        const updated = widgetDraftSchema.parse({
          ...sanitized,
          writerId: draft.writerId,
          revision: draft.revision + (changed ? 1 : 0),
        });
        storage.setItem(targetKey, JSON.stringify(updated));
      }
      if (key !== targetKey) removeStorageItem(storage, key);
    }
  } catch {
    // Storage sanitization is best effort and must never prevent reporting.
  }
}

function migrateWidgetDraftScope(source: WidgetDraftScope, target: WidgetDraftScope) {
  try {
    const sourceStorage = draftStorage(source);
    const targetStorage = draftStorage(target);
    if (!sourceStorage || !targetStorage) return;
    for (const key of draftRecordKeys(sourceStorage, source)) {
      const raw = sourceStorage.getItem(key);
      if (!raw) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        removeStorageItem(sourceStorage, key);
        continue;
      }
      const writerId = typeof parsed === "object" && parsed !== null && "writerId" in parsed && typeof (parsed as { writerId?: unknown }).writerId === "string"
        ? (parsed as { writerId: string }).writerId
        : null;
      if (!writerId) continue;
      const targetKey = draftRecordKey(target, writerId);
      const draftResult = widgetDraftSchema.safeParse(parsed);
      if (!draftResult.success) {
        const parsedVersion = typeof parsed === "object" && parsed !== null && "version" in parsed
          ? (parsed as { version?: unknown }).version
          : undefined;
        if (typeof parsedVersion === "number" && parsedVersion > WIDGET_DRAFT_VERSION && targetStorage.getItem(targetKey) === null) {
          targetStorage.setItem(targetKey, raw);
          removeStorageItem(sourceStorage, key);
        }
        continue;
      }
      const draft = draftResult.data;
      const existing = readDraftRecord(targetStorage, targetKey);
      if (!existing || draft.savedAt > existing.savedAt || (draft.savedAt === existing.savedAt && draft.revision > existing.revision)) {
        targetStorage.setItem(targetKey, raw);
      }
      removeStorageItem(sourceStorage, key);
    }
  } catch {
    // Identity enrichment must not interrupt the active report.
  }
}

function migrateEmailFallbackScope(scope: WidgetDraftScope) {
  if (!scope.emailFallbackStorageKey || !scope.identityEmail) return;
  migrateWidgetDraftScope(
    {
      ...scope,
      storageKey: scope.emailFallbackStorageKey,
      identityMarker: `email:${scope.identityEmail}`,
      emailFallbackStorageKey: undefined,
    },
    scope,
  );
}

function writeWidgetDraft(
  scope: WidgetDraftScope,
  content: WidgetDraftContent,
  writerId: string,
) {
  try {
    const storage = draftStorage(scope);
    if (!storage) return null;
    const storageKey = draftRecordKey(scope, writerId);
    const existing = readDraftRecord(storage, storageKey);
    if (existing) {
      if (widgetDraftContentMatches(contentFromWidgetDraft(existing), content)) return existing;
    }
    const draft = widgetDraftSchema.parse({
      ...content,
      writerId,
      revision: (existing?.revision ?? 0) + 1,
    });
    storage.setItem(storageKey, JSON.stringify(draft));
    removeStorageItem(storage, scope.storageKey);
    return draft;
  } catch {
    // Storage can be unavailable or full without affecting the widget flow.
    return null;
  }
}

function removeWidgetDraftIfMatch(scope: WidgetDraftScope, draft: WidgetDraft | null) {
  if (!draft) return;
  try {
    const storage = draftStorage(scope);
    if (!storage) return;
    const storageKey = draftRecordKey(scope, draft.writerId);
    const current = readDraftRecord(storage, storageKey);
    if (current?.writerId === draft.writerId && current.revision === draft.revision) {
      storage.removeItem(storageKey);
    }
  } catch {
    // Submission success remains valid when storage cleanup is blocked.
  }
}

function resolveLauncherPresentation(value: unknown): LauncherPresentation {
  if (value === "icon" || value === "icon-text" || value === "text") {
    return value;
  }

  return "icon-text";
}

function browserIsOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

async function fetchJson<T>(url: string, options?: RequestInit, timeoutMs?: number) {
  const controller = timeoutMs ? new AbortController() : null;
  const timeout = controller
    ? window.setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetch(url, {
      ...options,
      ...(controller ? { signal: controller.signal } : {}),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new WidgetRequestError(
        payload?.error?.message ?? "TraceGenie could not accept the report.",
        response.status >= 500 ? "server" : "request",
      );
    }

    return payload as T;
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new WidgetRequestError("The request timed out.", "timeout");
    }
    if (error instanceof WidgetRequestError) {
      throw error;
    }
    if (browserIsOffline()) {
      throw new WidgetRequestError("The browser is offline.", "offline");
    }
    if (error instanceof TypeError) {
      throw new WidgetRequestError("TraceGenie could not be reached.", "network");
    }
    throw error;
  } finally {
    if (timeout !== null) {
      window.clearTimeout(timeout);
    }
  }
}

function submissionFailure(error: unknown): { kind: SubmissionFailureKind; message: string } {
  const kind = error instanceof WidgetRequestError
    ? error.kind
    : browserIsOffline()
      ? "offline"
      : "request";

  if (kind === "offline") {
    return {
      kind,
      message: "You are offline. Your report is saved on this device. Reconnect and retry.",
    };
  }
  if (kind === "timeout") {
    return {
      kind,
      message: "The connection timed out. Your report is still here. Retry when you are ready.",
    };
  }
  if (kind === "server") {
    return {
      kind,
      message: "TraceGenie could not accept the report right now. Your report is still here. Retry in a moment.",
    };
  }
  if (kind === "network") {
    return {
      kind,
      message: "TraceGenie could not be reached. Your report is still here. Check your connection and retry.",
    };
  }
  return {
    kind,
    message: error instanceof Error ? error.message : "Unable to send the report. Your report is still here.",
  };
}

function dataUrlToBlob(dataUrl: string) {
  const [metadata = "", payload = ""] = dataUrl.split(",", 2);
  const mimeMatch = metadata.match(/^data:([^;]+)(;base64)?$/);
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";
  const isBase64 = Boolean(mimeMatch?.[2]);
  const binary = isBase64 ? window.atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function defaultConfig() {
  return widgetProjectConfigSchema.parse({
    allowScreenshot: true,
    allowPointSelection: false,
    allowConsoleCapture: false,
    allowClientErrorContext: false,
    appearance: {
      launcherPosition: "bottom-right",
      keyboardShortcut: DEFAULT_WIDGET_SHORTCUT,
    },
  });
}

function retentionSummary(config: WidgetProjectConfig["privacy"]) {
  const reportRetention = config.retentionDays === null
    ? "Report retention follows the recipient's policy"
    : `Reports retained for ${config.retentionDays} days`;
  const attachmentRetention = config.attachmentRetentionDays === null
    ? "attachment retention follows the recipient's policy"
    : `attachments for ${config.attachmentRetentionDays} days`;
  return `${reportRetention}; ${attachmentRetention}.`;
}

async function resolveWidgetSessionToken(props: FeedbackWidgetProps) {
  if (props.getWidgetSessionToken) {
    return props.getWidgetSessionToken();
  }

  return props.widgetSessionToken;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

type BodyScrollLockState = {
  count: number;
  body: HTMLElement;
  overflow: string;
  overflowPriority: string;
};

const bodyScrollLocks = new WeakMap<Document, BodyScrollLockState>();

function lockBodyScroll(hostDocument: Document) {
  const existing = bodyScrollLocks.get(hostDocument);
  if (existing) {
    existing.count += 1;
    return;
  }

  const body = hostDocument.body;
  if (!body) return;
  bodyScrollLocks.set(hostDocument, {
    count: 1,
    body,
    overflow: body.style.getPropertyValue("overflow"),
    overflowPriority: body.style.getPropertyPriority("overflow"),
  });
  body.style.setProperty("overflow", "hidden", "important");
}

function unlockBodyScroll(hostDocument: Document) {
  const existing = bodyScrollLocks.get(hostDocument);
  if (!existing) return;
  existing.count -= 1;
  if (existing.count > 0) return;

  existing.body.style.setProperty("overflow", existing.overflow, existing.overflowPriority);
  bodyScrollLocks.delete(hostDocument);
}

function getDeepActiveElement(hostDocument: Document): Element | null {
  let activeElement: Element | null = hostDocument.activeElement;
  while (activeElement instanceof HTMLElement && activeElement.shadowRoot?.activeElement) {
    activeElement = activeElement.shadowRoot.activeElement;
  }
  return activeElement;
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => (
    element.isConnected
    && !element.hidden
    && element.getAttribute("aria-hidden") !== "true"
    && !element.closest("[hidden], [inert], [aria-hidden='true']")
  ));
}

function normalizeText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function boundedSelectedText(value: string | null | undefined) {
  const text = normalizeText(redactCapturedText(value));
  return text ? text.slice(0, SELECTED_TEXT_MAX_LENGTH) : null;
}

function canReadInputSelection(input: HTMLInputElement) {
  return ["", "email", "search", "tel", "text", "url"].includes(input.type);
}

function readSelectedTextFromActiveControl() {
  const activeElement = document.activeElement;
  if (!activeElement || isWidgetElement(activeElement)) {
    return null;
  }

  if (activeElement instanceof HTMLTextAreaElement || (activeElement instanceof HTMLInputElement && canReadInputSelection(activeElement))) {
    const start = activeElement.selectionStart;
    const end = activeElement.selectionEnd;
    if (typeof start === "number" && typeof end === "number" && end > start) {
      return boundedSelectedText(activeElement.value.slice(start, end));
    }
  }

  return null;
}

function isSelectionInsideWidget(selection: Selection | null) {
  if (!selection || selection.rangeCount === 0) {
    return false;
  }

  const container = selection.getRangeAt(0).commonAncestorContainer;
  const element = container instanceof Element ? container : container.parentElement;
  return isWidgetElement(element);
}

function selectedTextSourceUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.href;
}

function captureSelectedTextSuggestion(): FeedbackSelectedTextSuggestion | null {
  const activeControlText = readSelectedTextFromActiveControl();
  const browserSelection = window.getSelection();
  const selection = activeControlText ?? (
    isSelectionInsideWidget(browserSelection)
      ? null
      : boundedSelectedText(browserSelection?.toString())
  );
  if (!selection) {
    return null;
  }

  return {
    text: selection,
    url: selectedTextSourceUrl(),
    createdAt: new Date().toISOString(),
  };
}

function selectedTextPreview(value: string) {
  return value.length > SELECTED_TEXT_PREVIEW_LENGTH
    ? `${value.slice(0, SELECTED_TEXT_PREVIEW_LENGTH)}...`
    : value;
}

function freshSelectedTextSuggestion(value: FeedbackSelectedTextSuggestion | null) {
  if (!value?.createdAt) {
    return null;
  }

  return Date.now() - new Date(value.createdAt).getTime() <= SELECTED_TEXT_CACHE_TTL_MS
    ? value
    : null;
}

function formatByteSize(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  const kb = value / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  }

  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function buildElementLabel(element: Element) {
  const ariaLabel = normalizeText(element.getAttribute("aria-label"));
  if (ariaLabel) {
    return ariaLabel.slice(0, 120);
  }

  const visibleText = normalizeText((element as HTMLElement).innerText ?? element.textContent);
  if (visibleText) {
    return visibleText.slice(0, 120);
  }

  if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
    const valueText = normalizeText(element.value);
    if (valueText) {
      return valueText.slice(0, 120);
    }
  }

  return undefined;
}

function isWidgetElement(element: Element | null) {
  if (!element) {
    return false;
  }

  if (element.id === "tracegenie-embed-root" || element.id === "tracegenie-widget-root") {
    return true;
  }

  if (element.closest("#tracegenie-embed-root") || element.closest("#tracegenie-widget-root")) {
    return true;
  }

  const rootNode = element.getRootNode();
  if (rootNode instanceof ShadowRoot) {
    const hostId = rootNode.host?.id;
    return hostId === "tracegenie-embed-root" || hostId === "tracegenie-widget-root";
  }

  return false;
}

function resolveSelectableElement(clientX: number, clientY: number) {
  const elements = document.elementsFromPoint(clientX, clientY);
  return elements.find((element) => !isWidgetElement(element)) ?? null;
}

function getDocumentCaptureBounds() {
  const { body, documentElement } = document;
  return {
    originX: 0,
    originY: 0,
    width: Math.max(
      body.scrollWidth,
      body.offsetWidth,
      documentElement.scrollWidth,
      documentElement.offsetWidth,
      window.innerWidth,
    ),
    height: Math.max(
      body.scrollHeight,
      body.offsetHeight,
      documentElement.scrollHeight,
      documentElement.offsetHeight,
      window.innerHeight,
    ),
  };
}

function isPointInsideRect(rect: DOMRect, point: { x: number; y: number }) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

/* ── Inline icons (the embed must stay dependency-light) ── */

function ReportIcon() {
  // Bug glyph — signals "report an issue," not "live chat."
  return (
    <svg className="tgw-launcher-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m8 2 1.88 1.88" />
      <path d="M14.12 3.88 16 2" />
      <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
      <path d="M12 20v-9" />
      <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
      <path d="M6 13H2" />
      <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
      <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
      <path d="M22 13h-4" />
      <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg className="tgw-launcher-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="tgw-disclosure-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function FeedbackWidget(props: FeedbackWidgetProps) {
  const [open, setOpen] = useState(false);
  const [remoteProject, setRemoteProject] = useState<RemoteProjectConfig | null>(null);
  const [submissionState, setSubmissionState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [submissionMessage, setSubmissionMessage] = useState<string | null>(null);
  const [submissionFailureKind, setSubmissionFailureKind] = useState<SubmissionFailureKind | null>(null);
  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null);

  const [isOnline, setIsOnline] = useState(() => !browserIsOffline());
  const submissionPendingRef = useRef(false);
  const submissionBannerRef = useRef<HTMLDivElement | null>(null);
  const submissionAttemptRef = useRef<SubmissionAttempt | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("idle");
  const [pointSelection, setPointSelection] = useState<PointSelection | null>(null);
  const [restoredPointSelectionDigest, setRestoredPointSelectionDigest] = useState<string | null>(null);
  const [selectedTextSuggestion, setSelectedTextSuggestion] = useState<FeedbackSelectedTextSuggestion | null>(null);
  const [pickerHighlight, setPickerHighlight] = useState<PickerHighlight>(null);
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [additionalAttachments, setAdditionalAttachments] = useState<AdditionalAttachment[]>([]);
  const [preparingFiles, setPreparingFiles] = useState(false);
  const preparingFilesRef = useRef(false);
  const filePreparationRunRef = useRef(0);
  const autoCapturePendingRef = useRef(false);
  const additionalAttachmentsRef = useRef(additionalAttachments);
  additionalAttachmentsRef.current = additionalAttachments;
  const addFilesInputRef = useRef<HTMLInputElement | null>(null);
  const automaticScreenshotRef = useRef<File | null>(null);
  const [screenshotPreviewUrl, setScreenshotPreviewUrl] = useState<string | null>(null);
  const [imageEvidenceSource, setImageEvidenceSource] = useState<ImageEvidenceSource | null>(null);
  const [imagePreviewBlocked, setImagePreviewBlocked] = useState(false);
  const [showScreenshotReview, setShowScreenshotReview] = useState(false);
  const [showScreenshotEditor, setShowScreenshotEditor] = useState(false);
  const [showIncludedDetails, setShowIncludedDetails] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("none");
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);
  const [includeConsole, setIncludeConsole] = useState(true);
  const [showConsoleView, setShowConsoleView] = useState(false);
  const [includeClientError, setIncludeClientError] = useState(true);
  const [showClientErrorView, setShowClientErrorView] = useState(false);
  const [includeNetwork, setIncludeNetwork] = useState(true);
  const [showNetworkView, setShowNetworkView] = useState(false);
  const [includeSelectedText, setIncludeSelectedText] = useState(true);
  const [showSelectedTextView, setShowSelectedTextView] = useState(false);
  const [openRequestContext, setOpenRequestContext] = useState<Record<string, unknown> | null>(null);
  const [surveyScore, setSurveyScore] = useState<number | null>(null);
  const [surveyAnswer, setSurveyAnswer] = useState("");
  const [reporterName, setReporterName] = useState("");
  const [reporterEmail, setReporterEmail] = useState("");
  const [reporterConsent, setReporterConsent] = useState(false);
  const [restoredAttachment, setRestoredAttachment] = useState<DraftAttachmentMetadata | null>(null);
  const attachmentChecksumRef = useRef<string | null>(null);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const attachImageInputRef = useRef<HTMLInputElement | null>(null);
  const reattachImageInputRef = useRef<HTMLInputElement | null>(null);
  const imageEditButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreAttachmentFocusRef = useRef(false);
  const openTriggerRef = useRef<HTMLElement | null>(null);
  const discardTriggerRef = useRef<HTMLElement | null>(null);
  const restoreDiscardTriggerRef = useRef(false);
  const requestCloseRef = useRef<() => void>(() => undefined);
  const keepEditingRef = useRef<() => void>(() => undefined);
  const captureRunRef = useRef(0);
  const lastSelectedTextSuggestionRef = useRef<FeedbackSelectedTextSuggestion | null>(null);
  const openRequestIdRef = useRef<number | null>(null);
  const draftWriterIdRef = useRef(randomDraftScope());
  const activeDraftScopeRef = useRef<WidgetDraftScope | null>(null);
  const restoredDraftRef = useRef<{ scope: WidgetDraftScope; draft: WidgetDraft } | null>(null);
  const dirtyBaselineRef = useRef<string | null>(null);

  const mergedConfig = useMemo(
    () =>
      widgetProjectConfigSchema.parse({
        ...defaultConfig(),
        ...remoteProject?.widgetConfig,
        ...props.widgetConfig,
        appearance: {
          ...defaultConfig().appearance,
          ...remoteProject?.widgetConfig.appearance,
          ...props.widgetConfig?.appearance,
          launcherLabel: props.launcherLabel ?? props.widgetConfig?.appearance?.launcherLabel ?? remoteProject?.widgetConfig.appearance.launcherLabel,
        },
        privacy: {
          ...defaultConfig().privacy,
          ...remoteProject?.widgetConfig.privacy,
          ...props.widgetConfig?.privacy,
        },
        reporterIdentity: {
          ...defaultConfig().reporterIdentity,
          ...remoteProject?.widgetConfig.reporterIdentity,
          ...props.widgetConfig?.reporterIdentity,
        },
      }),
    [props.launcherLabel, props.widgetConfig, remoteProject],
  );
  const privacyUrl = mergedConfig.privacy.privacyUrl;
  const strictRedaction = mergedConfig.privacy.redactionMode === "strict";
  const suppressRawTechnicalEvidence = mergedConfig.privacy.redactionMode !== "standard";
  const allowSelectedText = !mergedConfig.privacy.suppressSelectedText;

  const consoleEntriesRef = useConsoleCapture(
    mergedConfig.allowConsoleCapture && !suppressRawTechnicalEvidence,
    mergedConfig.maxConsoleEntries,
  );
  const clientErrorRef = useClientErrorCapture(mergedConfig.allowClientErrorContext && !suppressRawTechnicalEvidence);
  const networkEntriesRef = useNetworkSummaryCapture(
    mergedConfig.allowNetworkSummary && !strictRedaction,
    mergedConfig.maxNetworkEntries,
    props.apiBaseUrl,
  );
  const hasAdvancedFields = useMemo(() => {
    return (
      mergedConfig.fields.stepsToReproduce.enabled ||
      mergedConfig.fields.expectedResult.enabled ||
      mergedConfig.fields.actualResult.enabled
    );
  }, [mergedConfig.fields.actualResult.enabled, mergedConfig.fields.expectedResult.enabled, mergedConfig.fields.stepsToReproduce.enabled]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema as any),
    defaultValues: {
      title: "",
      description: "",
      issueType: issueTypeSchema.options[0],
      severity: severitySchema.options[1],
      stepsToReproduce: "",
      expectedResult: "",
      actualResult: "",
    },
  });

  const selectedSeverity = form.watch("severity");
  const draftScope = useMemo(
    () => resolveWidgetDraftScope(props),
    [props.apiBaseUrl, props.currentUser?.email, props.currentUser?.id, props.currentUser?.name, props.currentUser?.role, props.projectKey],
  );

  const persistDraft = useCallback(() => {
    const activeScope = activeDraftScopeRef.current;
    if (!activeScope) return null;
    const values = form.getValues();
    const formResult = widgetDraftFormSchema.safeParse({
      title: values.title.slice(0, 160),
      description: values.description.slice(0, 4000),
      issueType: mergedConfig.fields.issueType.enabled ? values.issueType : issueTypeSchema.options[0],
      severity: mergedConfig.fields.severity.enabled ? values.severity : severitySchema.options[1],
      ...(mergedConfig.fields.stepsToReproduce.enabled
        ? { stepsToReproduce: values.stepsToReproduce?.slice(0, 4000) }
        : {}),
      ...(mergedConfig.fields.expectedResult.enabled
        ? { expectedResult: values.expectedResult?.slice(0, 2000) }
        : {}),
      ...(mergedConfig.fields.actualResult.enabled
        ? { actualResult: values.actualResult?.slice(0, 2000) }
        : {}),
    });
    if (!formResult.success) return null;

    const surveyResponse = mergedConfig.surveyPrompt.enabled
      && props.extraContext?.surveyResponse === undefined
      && openRequestContext?.surveyResponse === undefined
      ? surveyPromptUsesText(mergedConfig.surveyPrompt.type)
        ? surveyAnswer.length > 0
          ? {
            type: mergedConfig.surveyPrompt.type,
            question: mergedConfig.surveyPrompt.question,
            answer: surveyAnswer.slice(0, 1000),
          }
          : undefined
        : surveyScore !== null
          ? {
            type: mergedConfig.surveyPrompt.type,
            question: mergedConfig.surveyPrompt.question,
            score: surveyScore,
          }
          : undefined
      : undefined;
    const attachmentCandidate = mergedConfig.allowScreenshot && screenshotFile
      ? {
        name: screenshotFile.name,
        type: screenshotFile.type,
        size: screenshotFile.size,
        source: imageEvidenceSource ?? "upload",
        ...(attachmentChecksumRef.current ? { checksum: attachmentChecksumRef.current } : {}),
        ...(attachmentChecksumRef.current
          && submissionAttemptRef.current?.attachmentChecksum === attachmentChecksumRef.current
          ? { clientUploadId: submissionAttemptRef.current.uploadId }
          : {}),
      }
      : mergedConfig.allowScreenshot
        ? restoredAttachment ?? undefined
        : undefined;
    const attachmentResult = attachmentCandidate
      ? widgetDraftAttachmentSchema.safeParse(attachmentCandidate)
      : null;
    const draftResult = widgetDraftContentSchema.safeParse({
      version: WIDGET_DRAFT_VERSION,
      savedAt: Date.now(),
      form: formResult.data,
      advancedOpen: hasAdvancedFields && showAdvancedFields,
      ...(submissionAttemptRef.current ? { submissionId: submissionAttemptRef.current.id } : {}),
      ...(submissionAttemptRef.current?.snapshotKey ? { submissionSnapshot: submissionAttemptRef.current.snapshotKey } : {}),
      ...(submissionAttemptRef.current?.pointSelectionDigest
        ? { pointSelectionDigest: submissionAttemptRef.current.pointSelectionDigest }
        : {}),
      evidenceConsent: {
        includeConsole,
        includeClientError,
        includeNetwork,
        includeSelectedText,
      },
      ...(surveyResponse ? { surveyResponse } : {}),
      ...(attachmentResult?.success ? { attachment: attachmentResult.data } : {}),
      ...(mergedConfig.allowFileAttachments && additionalAttachments.length
        ? { attachments: additionalAttachments.map((item) => item.metadata) } : {}),
    });

    if (!draftResult.success) return null;
    const stored = writeWidgetDraft(
      activeScope,
      draftResult.data,
      draftWriterIdRef.current,
    );
    return stored;
  }, [
    additionalAttachments,
    mergedConfig.allowFileAttachments,
    form,
    hasAdvancedFields,
    imageEvidenceSource,
    includeClientError,
    includeConsole,
    includeNetwork,
    includeSelectedText,
    mergedConfig.allowScreenshot,
    mergedConfig.fields.actualResult.enabled,
    mergedConfig.fields.expectedResult.enabled,
    mergedConfig.fields.issueType.enabled,
    mergedConfig.fields.severity.enabled,
    mergedConfig.fields.stepsToReproduce.enabled,
    mergedConfig.surveyPrompt.enabled,
    mergedConfig.surveyPrompt.question,
    mergedConfig.surveyPrompt.type,
    openRequestContext?.surveyResponse,
    props.extraContext?.surveyResponse,
    restoredAttachment,
    screenshotFile,
    showAdvancedFields,
    surveyAnswer,
    surveyScore,
  ]);

  useEffect(() => {
    if (form.formState.errors.stepsToReproduce || form.formState.errors.expectedResult || form.formState.errors.actualResult) {
      setShowAdvancedFields(true);
    }
  }, [form.formState.errors.actualResult, form.formState.errors.expectedResult, form.formState.errors.stepsToReproduce]);

  useEffect(() => {
    if (props.fetchProjectConfig === false) {
      return;
    }

    let cancelled = false;
    void fetchJson<RemoteProjectConfig>(
      `${props.apiBaseUrl}/api/projects/public/${props.projectKey}/widget-config`,
    )
      .then((payload) => {
        if (!cancelled) {
          setRemoteProject({
            ...payload,
            widgetConfig: widgetProjectConfigSchema.parse(payload.widgetConfig),
          });
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          props.onError?.(error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.apiBaseUrl, props.fetchProjectConfig, props.onError, props.projectKey]);

  useEffect(() => {
    function rememberSelectedText() {
      const suggestion = captureSelectedTextSuggestion();
      if (suggestion) {
        lastSelectedTextSuggestionRef.current = suggestion;
      }
    }

    document.addEventListener("selectionchange", rememberSelectedText);
    window.addEventListener("keyup", rememberSelectedText, true);
    window.addEventListener("mouseup", rememberSelectedText, true);
    return () => {
      document.removeEventListener("selectionchange", rememberSelectedText);
      window.removeEventListener("keyup", rememberSelectedText, true);
      window.removeEventListener("mouseup", rememberSelectedText, true);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (screenshotPreviewUrl) {
        URL.revokeObjectURL(screenshotPreviewUrl);
      }
    };
  }, [screenshotPreviewUrl]);

  useEffect(() => {
    if (captureStatus !== "ready" || !restoreAttachmentFocusRef.current) {
      return;
    }

    restoreAttachmentFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => imageEditButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [captureStatus, screenshotFile]);

  const getCaptureTarget = useCallback(() => {
    if (typeof props.captureTarget === "function") {
      return props.captureTarget();
    }

    return props.captureTarget ?? document.body;
  }, [props.captureTarget]);

  const attachFile = useCallback(async (
    file: File,
    options?: { preservePointSelection?: boolean; restoreFocusAfterAttach?: boolean; source?: ImageEvidenceSource; captureRun?: number; automatic?: boolean },
  ) => {
    autoCapturePendingRef.current = false;
    const runId = options?.captureRun ?? ++captureRunRef.current;
    if (file.size > MAX_FILE_BYTES || file.size === 0) {
      setSubmissionMessage("Choose a non-empty image up to 5 MB.");
      setSubmissionState("error");
      setCaptureStatus("failed");
      return;
    }
    if (additionalAttachmentsRef.current.length >= MAX_REPORT_ATTACHMENTS) {
      setSubmissionMessage("Remove a file before adding a screenshot. You can send up to 5 attachments.");
      setSubmissionState("error");
      setCaptureStatus("none");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setSubmissionMessage("Only image files can be attached.");
      setSubmissionState("error");
      return;
    }

    let checksum: string | null = null;
    try {
      checksum = await fileSha256(file);
    } catch {
      // Recovery identity is optional; upload remains available when Web Crypto is unavailable.
    }
    if (runId !== captureRunRef.current) return;
    automaticScreenshotRef.current = options?.automatic ? file : null;
    const restoresPreviousEvidence = Boolean(
      checksum
      && restoredAttachment
      && restoredAttachment.clientUploadId
      && attachmentMatchesFile(restoredAttachment, file, checksum),
    );
    if (!restoresPreviousEvidence) {
      submissionAttemptRef.current = null;
    } else if (submissionAttemptRef.current) {
      submissionAttemptRef.current.uploadId = restoredAttachment!.clientUploadId!;
      submissionAttemptRef.current.attachmentChecksum = checksum!;
    }
    setScreenshotFile(file);
    attachmentChecksumRef.current = checksum;
    setRestoredAttachment(null);
    setImageEvidenceSource(restoresPreviousEvidence ? restoredAttachment!.source : options?.source ?? "upload");
    if (!options?.preservePointSelection) {
      setPointSelection(null);
      setRestoredPointSelectionDigest(null);
    }
    setScreenshotPreviewUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return URL.createObjectURL(file);
    });
    setImagePreviewBlocked(false);
    setShowScreenshotReview(false);
    setShowScreenshotEditor(false);
    restoreAttachmentFocusRef.current = Boolean(options?.restoreFocusAfterAttach);
    setCaptureStatus("ready");
  }, [restoredAttachment]);

  /**
   * Capture the host screen. Runs AFTER the sheet has painted; the widget's
   * own DOM is excluded from the image so reporters see exactly what the
   * team will see.
   */
  const captureScreen = useCallback(async (options?: { preservePointSelection?: boolean; automatic?: boolean }) => {
    autoCapturePendingRef.current = false;
    const captureTarget = getCaptureTarget();
    if (!captureTarget || !mergedConfig.allowScreenshot) {
      setCaptureStatus("none");
      return;
    }

    const runId = ++captureRunRef.current;
    setCaptureStatus("capturing");

    try {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const protectedRegions = collectProtectedMaskRegions(captureTarget);
      const dataUrl = await toPng(captureTarget, {
        backgroundColor: "#ffffff",
        pixelRatio,
        cacheBust: true,
        filter: (node) => {
          const id = (node as Element).id;
          return id !== "tracegenie-embed-root" && id !== "tracegenie-widget-root";
        },
      });

      if (runId !== captureRunRef.current) {
        return;
      }

      const blob = dataUrlToBlob(dataUrl);
      const protectedFile = await transformImagePixels(
        new File([blob], `feedback-${Date.now()}.png`, { type: "image/png" }),
        { protectedRegions },
      );
      if (runId !== captureRunRef.current) return;
      await attachFile(protectedFile, { ...options, source: "screenshot", captureRun: runId });
    } catch {
      if (runId === captureRunRef.current) {
        setCaptureStatus("failed");
      }
    }
  }, [attachFile, getCaptureTarget, mergedConfig.allowScreenshot]);

  useEffect(() => {
    if (!open || !autoCapturePendingRef.current) return;
    // Wait for the product's settings before capturing anything automatically.
    if (props.fetchProjectConfig !== false && !remoteProject) return;
    autoCapturePendingRef.current = false;
    if (!mergedConfig.allowScreenshot || !mergedConfig.autoCaptureScreenshot) return;
    setCaptureStatus("capturing");
    const runId = ++captureRunRef.current;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (runId === captureRunRef.current) void captureScreen({ automatic: true });
    }));
  }, [open, remoteProject, props.fetchProjectConfig, mergedConfig.allowScreenshot, mergedConfig.autoCaptureScreenshot, captureScreen]);

  useEffect(() => () => {
    captureRunRef.current += 1;
    filePreparationRunRef.current += 1;
  }, []);

  async function addFiles(files: File[]) {
    if (!mergedConfig.allowFileAttachments || preparingFilesRef.current || submissionPendingRef.current) return;
    preparingFilesRef.current = true;
    setPreparingFiles(true);
    const runId = ++filePreparationRunRef.current;
    const scope = activeDraftScopeRef.current;
    const next = [...additionalAttachmentsRef.current];
    const errors: string[] = [];
    try {
      for (const file of files) {
        if (!/\.(png|jpe?g|webp|gif|pdf|txt|log)$/i.test(file.name)) {
          errors.push(`${file.name}: choose an image, PDF, text, or log file.`); continue;
        }
        if (!file.size || file.size > MAX_FILE_BYTES || file.name.length > 255) {
          errors.push(`${file.name}: choose a non-empty file up to 5 MB with a shorter name.`); continue;
        }
        const checksum = await fileSha256(file);
        const restored = next.findIndex((item) => !item.file && (item.metadata.name === file.name && item.metadata.type === (file.type || "application/octet-stream") && item.metadata.size === file.size && item.metadata.checksum === checksum));
        if (restored >= 0) {
          next[restored] = { ...next[restored], file };
          continue;
        }
        if (next.some((item) => item.metadata.name === file.name && item.metadata.checksum === checksum)) continue;
        const screenshotSlots = screenshotFile || restoredAttachment || captureStatus === "capturing" ? 1 : 0;
        if (next.length + screenshotSlots >= MAX_REPORT_ATTACHMENTS) {
          errors.push("You can send up to 5 attachments, including the screenshot. Remove one to add another."); break;
        }
        submissionAttemptRef.current = null;
        next.push({ file, metadata: { name: file.name, type: file.type || "application/octet-stream",
          size: file.size, source: "upload", checksum, clientUploadId: widgetUploadId() } });
      }
      if (runId !== filePreparationRunRef.current || scope !== activeDraftScopeRef.current) return;
      setAdditionalAttachments(next);
      if (errors.length) {
        setSubmissionState("error"); setSubmissionFailureKind("request"); setSubmissionMessage(errors.join(" "));
      } else {
        setSubmissionState("idle"); setSubmissionMessage(null);
      }
    } catch {
      setSubmissionState("error"); setSubmissionMessage("These files could not be prepared. Please choose them again.");
    } finally {
      if (runId === filePreparationRunRef.current) { preparingFilesRef.current = false; setPreparingFiles(false); }
    }
  }

  function removeAdditionalAttachment(index: number) {
    if (submissionPendingRef.current) return;
    setSubmissionState("idle"); setSubmissionMessage(null); setSubmissionFailureKind(null);
    submissionAttemptRef.current = null;
    setAdditionalAttachments((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  }

  function removeScreenshot() {
    autoCapturePendingRef.current = false;
    automaticScreenshotRef.current = null;
    captureRunRef.current += 1;
    submissionAttemptRef.current = null;
    setScreenshotFile(null);
    attachmentChecksumRef.current = null;
    setRestoredAttachment(null);
    setImageEvidenceSource(null);
    setImagePreviewBlocked(false);
    setPointSelection(null);
    setRestoredPointSelectionDigest(null);
    setScreenshotPreviewUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return null;
    });
    setShowScreenshotReview(false);
    setShowScreenshotEditor(false);
    setCaptureStatus("removed");
  }

  function openWidget(options: { title?: string; issueType?: FormValues["issueType"]; extraContext?: Record<string, unknown> } = {}) {
    const hostDocument = launcherRef.current?.ownerDocument ?? document;
    const activeElement = getDeepActiveElement(hostDocument);
    openTriggerRef.current = activeElement instanceof HTMLElement && activeElement.isConnected
      ? activeElement
      : launcherRef.current;
    activeDraftScopeRef.current = draftScope;
    migrateEmailFallbackScope(draftScope);
    sanitizeWidgetDraftRecords(draftScope, (candidate) => ({
      version: WIDGET_DRAFT_VERSION,
      savedAt: candidate.savedAt,
      form: {
        title: candidate.form.title,
        description: candidate.form.description,
        issueType: mergedConfig.fields.issueType.enabled ? candidate.form.issueType : issueTypeSchema.options[0],
        severity: mergedConfig.fields.severity.enabled ? candidate.form.severity : severitySchema.options[1],
        ...(mergedConfig.fields.stepsToReproduce.enabled
          ? { stepsToReproduce: candidate.form.stepsToReproduce }
          : {}),
        ...(mergedConfig.fields.expectedResult.enabled
          ? { expectedResult: candidate.form.expectedResult }
          : {}),
        ...(mergedConfig.fields.actualResult.enabled
          ? { actualResult: candidate.form.actualResult }
          : {}),
      },
      advancedOpen: hasAdvancedFields && candidate.advancedOpen,
      ...(candidate.submissionId ? { submissionId: candidate.submissionId } : {}),
      ...(candidate.submissionSnapshot ? { submissionSnapshot: candidate.submissionSnapshot } : {}),
      ...(candidate.pointSelectionDigest ? { pointSelectionDigest: candidate.pointSelectionDigest } : {}),
      ...(candidate.evidenceConsent ? { evidenceConsent: candidate.evidenceConsent } : {}),
      ...(candidate.surveyResponse
        && mergedConfig.surveyPrompt.enabled
        && candidate.surveyResponse.type === mergedConfig.surveyPrompt.type
        && candidate.surveyResponse.question === mergedConfig.surveyPrompt.question
        && props.extraContext?.surveyResponse === undefined
        && options.extraContext?.surveyResponse === undefined
        ? { surveyResponse: candidate.surveyResponse }
        : {}),
      ...(mergedConfig.allowScreenshot && candidate.attachment ? { attachment: candidate.attachment } : {}),
      ...(mergedConfig.allowFileAttachments && candidate.attachments?.length ? { attachments: candidate.attachments } : {}),
    }));
    const draft = readWidgetDraft(draftScope);
    restoredDraftRef.current = draft ? { scope: draftScope, draft } : null;
    submissionAttemptRef.current = draft?.submissionId && draft.submissionSnapshot
      ? {
        id: draft.submissionId,
        uploadId: draft.attachment?.clientUploadId ?? widgetUploadId(),
        attachmentChecksum: draft.attachment?.checksum,
        pointSelectionDigest: draft.pointSelectionDigest,
        snapshotKey: draft.submissionSnapshot,
        draftContent: contentFromWidgetDraft(draft),
      }
      : null;
    const matchingSurveyResponse = draft?.surveyResponse
      && draft.surveyResponse.type === mergedConfig.surveyPrompt.type
      && draft.surveyResponse.question === mergedConfig.surveyPrompt.question
      && props.extraContext?.surveyResponse === undefined
      && options.extraContext?.surveyResponse === undefined
      ? draft.surveyResponse
      : undefined;

    const initialFormValues: FormValues = {
      title: options.title ?? draft?.form.title ?? "",
      description: draft?.form.description ?? "",
      issueType: mergedConfig.fields.issueType.enabled
        ? options.issueType ?? draft?.form.issueType ?? issueTypeSchema.options[0]
        : issueTypeSchema.options[0],
      severity: mergedConfig.fields.severity.enabled ? draft?.form.severity ?? severitySchema.options[1] : severitySchema.options[1],
      stepsToReproduce: mergedConfig.fields.stepsToReproduce.enabled ? draft?.form.stepsToReproduce ?? "" : "",
      expectedResult: mergedConfig.fields.expectedResult.enabled ? draft?.form.expectedResult ?? "" : "",
      actualResult: mergedConfig.fields.actualResult.enabled ? draft?.form.actualResult ?? "" : "",
    };
    const initialAttachment = mergedConfig.allowScreenshot ? draft?.attachment ?? null : null;
    const initialFiles = mergedConfig.allowFileAttachments ? draft?.attachments ?? [] : [];
    setAdditionalAttachments(initialFiles.map((metadata) => ({ metadata: { ...metadata, clientUploadId: metadata.clientUploadId ?? widgetUploadId() }, file: null })));
    automaticScreenshotRef.current = null;
    const initialReporterName = mergedConfig.reporterIdentity.enabled && mergedConfig.reporterIdentity.collectName
      ? props.currentUser?.name ?? ""
      : "";
    const initialReporterEmail = mergedConfig.reporterIdentity.enabled && mergedConfig.reporterIdentity.collectEmail
      ? props.currentUser?.email ?? ""
      : "";
    form.reset(initialFormValues);
    setShowAdvancedFields(hasAdvancedFields && (draft?.advancedOpen ?? false));
    setSubmissionState("idle");
    setReceipt(null);

    setSubmissionMessage(null);
    setSubmissionFailureKind(null);
    setSelectionMode("idle");
    setPointSelection(null);
    setRestoredPointSelectionDigest(draft?.pointSelectionDigest ?? null);
    setSelectedTextSuggestion(captureSelectedTextSuggestion() ?? freshSelectedTextSuggestion(lastSelectedTextSuggestionRef.current));
    setPickerHighlight(null);
    setScreenshotFile(null);
    attachmentChecksumRef.current = null;
    setScreenshotPreviewUrl(null);
    setImageEvidenceSource(null);
    setRestoredAttachment(initialAttachment);
    setImagePreviewBlocked(false);
    setShowScreenshotReview(false);
    setIncludeConsole(draft?.evidenceConsent?.includeConsole ?? true);
    setShowConsoleView(false);
    setIncludeClientError(draft?.evidenceConsent?.includeClientError ?? true);
    setShowClientErrorView(false);
    setIncludeNetwork(draft?.evidenceConsent?.includeNetwork ?? true);
    setShowNetworkView(false);
    setIncludeSelectedText(draft?.evidenceConsent?.includeSelectedText ?? true);
    setShowSelectedTextView(false);
    setOpenRequestContext(options.extraContext ?? null);
    setSurveyScore(matchingSurveyResponse?.score ?? null);
    setSurveyAnswer(matchingSurveyResponse?.answer ?? "");
    setReporterName(initialReporterName);
    setReporterEmail(initialReporterEmail);
    setReporterConsent(false);
    setCaptureStatus("none");
    setDiscardConfirmationOpen(false);
    dirtyBaselineRef.current = widgetDirtySnapshotKey({
      form: initialFormValues,
      surveyScore: matchingSurveyResponse?.score ?? null,
      surveyAnswer: matchingSurveyResponse?.answer ?? "",
      attachment: initialAttachment,
      ...(initialFiles.length ? { attachments: initialFiles } : {}),
      pointSelection: null,
      includeConsole: draft?.evidenceConsent?.includeConsole ?? true,
      includeClientError: draft?.evidenceConsent?.includeClientError ?? true,
      includeNetwork: draft?.evidenceConsent?.includeNetwork ?? true,
      includeSelectedText: draft?.evidenceConsent?.includeSelectedText ?? true,
      reporterName: initialReporterName,
      reporterEmail: initialReporterEmail,
      reporterConsent: false,
    } satisfies WidgetDirtySnapshot);
    discardTriggerRef.current = null;
    restoreDiscardTriggerRef.current = false;
    setOpen(true);
    captureRunRef.current += 1;
    filePreparationRunRef.current += 1;
    preparingFilesRef.current = false;
    setPreparingFiles(false);
    autoCapturePendingRef.current = !initialAttachment && initialFiles.length < MAX_REPORT_ATTACHMENTS && !draft?.submissionId;
  }

  const hasMeaningfulReport = useCallback(() => {
    const values = form.getValues();
    const hasFormContent = [
      values.title,
      values.description,
      mergedConfig.fields.stepsToReproduce.enabled ? values.stepsToReproduce : "",
      mergedConfig.fields.expectedResult.enabled ? values.expectedResult : "",
      mergedConfig.fields.actualResult.enabled ? values.actualResult : "",
    ].some((value) => Boolean(value?.trim()));
    const hasChangedClassification = (
      mergedConfig.fields.issueType.enabled && values.issueType !== issueTypeSchema.options[0]
    ) || (
      mergedConfig.fields.severity.enabled && values.severity !== severitySchema.options[1]
    );
    const hasSurveyResponse = surveyScore !== null || surveyAnswer.trim().length > 0;
    const manualScreenshot = screenshotFile && screenshotFile !== automaticScreenshotRef.current ? screenshotFile : null;
    const hasImageEvidence = Boolean(manualScreenshot || restoredAttachment || pointSelection || additionalAttachments.length);
    const hasEvidencePreference = !includeConsole || !includeClientError || !includeNetwork || !includeSelectedText;
    const currentAttachment = manualScreenshot
      ? {
        name: manualScreenshot.name,
        type: manualScreenshot.type,
        size: manualScreenshot.size,
        source: imageEvidenceSource ?? "upload",
      }
      : restoredAttachment;
    const currentSnapshot = widgetDirtySnapshotKey({
      form: values,
      surveyScore,
      surveyAnswer,
      attachment: currentAttachment,
      ...(additionalAttachments.length ? { attachments: additionalAttachments.map((item) => item.metadata) } : {}),
      pointSelection,
      includeConsole,
      includeClientError,
      includeNetwork,
      includeSelectedText,
      reporterName,
      reporterEmail,
      reporterConsent,
    } satisfies WidgetDirtySnapshot);
    const changedFromOpen = dirtyBaselineRef.current !== null
      && dirtyBaselineRef.current !== currentSnapshot;

    return hasFormContent
      || hasChangedClassification
      || hasSurveyResponse
      || hasImageEvidence
      || hasEvidencePreference
      || changedFromOpen;
  }, [
    additionalAttachments,
    form,
    includeClientError,
    includeConsole,
    includeNetwork,
    includeSelectedText,
    imageEvidenceSource,
    mergedConfig.fields.actualResult.enabled,
    mergedConfig.fields.expectedResult.enabled,
    mergedConfig.fields.issueType.enabled,
    mergedConfig.fields.severity.enabled,
    mergedConfig.fields.stepsToReproduce.enabled,
    pointSelection,
    reporterConsent,
    reporterEmail,
    reporterName,
    restoredAttachment,
    screenshotFile,
    surveyAnswer,
    surveyScore,
  ]);

  const finishClose = useCallback((persist = true) => {
    if (persist && submissionState !== "success") {
      persistDraft();
    }
    captureRunRef.current += 1;
    filePreparationRunRef.current += 1;
    autoCapturePendingRef.current = false;
    setSelectionMode("idle");
    setPickerHighlight(null);
    setDiscardConfirmationOpen(false);
    setOpen(false);
    const origin = openTriggerRef.current;
    const launcher = launcherRef.current;
    const focusTarget = origin?.isConnected ? origin : launcher?.isConnected ? launcher : null;
    focusTarget?.focus();
    openTriggerRef.current = null;
    discardTriggerRef.current = null;
    restoreDiscardTriggerRef.current = false;
  }, [persistDraft, submissionState]);

  const keepEditing = useCallback(() => {
    restoreDiscardTriggerRef.current = true;
    setDiscardConfirmationOpen(false);
  }, []);

  const requestClose = useCallback(() => {
    if (discardConfirmationOpen) return;
    if (submissionState === "success" || !hasMeaningfulReport()) {
      if (submissionState !== "success") {
        const scope = activeDraftScopeRef.current;
        const draft = persistDraft();
        if (scope) removeWidgetDraftIfMatch(scope, draft);
      }
      finishClose(false);
      return;
    }

    const hostDocument = sheetRef.current?.ownerDocument ?? launcherRef.current?.ownerDocument ?? document;
    const activeElement = getDeepActiveElement(hostDocument);
    discardTriggerRef.current = activeElement instanceof HTMLElement && sheetRef.current?.contains(activeElement)
      ? activeElement
      : null;
    setDiscardConfirmationOpen(true);
  }, [discardConfirmationOpen, finishClose, hasMeaningfulReport, persistDraft, submissionState]);

  const discardAndClose = useCallback(() => {
    const activeScope = activeDraftScopeRef.current;
    const currentDraft = persistDraft();
    if (activeScope) {
      removeWidgetDraftIfMatch(activeScope, currentDraft);
    }
    const restoredSource = restoredDraftRef.current;
    if (restoredSource) {
      removeWidgetDraftIfMatch(restoredSource.scope, restoredSource.draft);
    }
    restoredDraftRef.current = null;
    submissionAttemptRef.current = null;
    draftWriterIdRef.current = randomDraftScope();
    removeScreenshot();
    finishClose(false);
  }, [finishClose, persistDraft]);

  requestCloseRef.current = requestClose;
  keepEditingRef.current = keepEditing;

  useKeyboardShortcut(
    mergedConfig.appearance.keyboardShortcut,
    true,
    () => {
      if (open) {
        requestClose();
      } else {
        openWidget();
      }
    },
  );

  useEffect(() => {
    const activeScope = activeDraftScopeRef.current;
    if (!activeScope) return;
    const identityChanged = activeScope.identityMarker !== draftScope.identityMarker;
    const storageScopeChanged = activeScope.storageKey !== draftScope.storageKey;
    if (!identityChanged && !storageScopeChanged) return;
    const identifierEnriched = activeScope.identityMarker.startsWith("email:")
      && draftScope.identityMarker.startsWith("id:")
      && Boolean(activeScope.identityEmail)
      && activeScope.identityEmail === draftScope.identityEmail;

    if (identifierEnriched) {
      migrateWidgetDraftScope(activeScope, draftScope);
      activeDraftScopeRef.current = draftScope;
      if (restoredDraftRef.current?.scope.storageKey === activeScope.storageKey) {
        restoredDraftRef.current = { ...restoredDraftRef.current, scope: draftScope };
      }
      return;
    }

    if (identityChanged) {
      clearWidgetDraftScope(activeScope);
    }

    activeDraftScopeRef.current = null;
    restoredDraftRef.current = null;
    if (open) {
      captureRunRef.current += 1;
      setSelectionMode("idle");
      setPickerHighlight(null);
      setOpen(false);
      const origin = openTriggerRef.current;
      const launcher = launcherRef.current;
      const focusTarget = origin?.isConnected ? origin : launcher?.isConnected ? launcher : null;
      focusTarget?.focus();
      openTriggerRef.current = null;
    }
  }, [draftScope.identityEmail, draftScope.identityMarker, draftScope.storageKey, open]);

  const canAutoPersistDraft = open && submissionState !== "success";
  const canPersistUserEdits = open && submissionState !== "success";

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      setSubmissionMessage((message) => submissionFailureKind === "offline" && message
        ? "Connection restored. Your report is ready to retry."
        : message);
    }

    function handleOffline() {
      setIsOnline(false);
      if (submissionState === "error") {
        setSubmissionFailureKind("offline");
        setSubmissionMessage("You are offline. Your report is saved on this device. Reconnect and retry.");
      }
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [submissionFailureKind, submissionState]);

  useEffect(() => {
    if (submissionState !== "error" || !submissionMessage) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const banner = submissionBannerRef.current;
      if (typeof banner?.scrollIntoView === "function") {
        banner.scrollIntoView({ block: "nearest" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [submissionMessage, submissionState]);

  useEffect(() => {
    if (!canAutoPersistDraft) return;
    persistDraft();
  }, [canAutoPersistDraft, persistDraft, restoredAttachment, screenshotFile, showAdvancedFields, surveyAnswer, surveyScore]);

  useEffect(() => {
    if (!canPersistUserEdits) return;

    const subscription = form.watch(() => {
      persistDraft();
    });
    return () => subscription.unsubscribe();
  }, [canPersistUserEdits, form, persistDraft]);

  useEffect(() => {
    if (!props.openRequest || props.openRequest.id === openRequestIdRef.current) {
      return;
    }
    openRequestIdRef.current = props.openRequest.id;
    openWidget({
      title: props.openRequest.title,
      issueType: props.openRequest.issueType,
      extraContext: props.openRequest.extraContext,
    });
  }, [props.openRequest]);

  const cancelPointSelection = useCallback(() => {
    setSelectionMode("idle");
    setPickerHighlight(null);
  }, []);

  const resolvePointSelectionPayload = useCallback((targetElement: Element, clientX: number, clientY: number) => {
    const captureTarget = getCaptureTarget();
    if (!captureTarget) {
      return null;
    }

    const tagName = targetElement.tagName.toLowerCase();
    const role = targetElement.getAttribute("role") ?? undefined;
    const label = buildElementLabel(targetElement);
    const targetRect = targetElement.getBoundingClientRect();
    const forcePoint = tagName === "iframe";
    const clickPoint = { x: clientX, y: clientY };
    const isDocumentCapture = captureTarget === document.body || captureTarget === document.documentElement;

    if (isDocumentCapture) {
      return buildPointSelection({
        captureBounds: getDocumentCaptureBounds(),
        clickPoint: toDocumentSpacePoint(clickPoint, { x: window.scrollX, y: window.scrollY }),
        targetRect: toDocumentSpaceRect(targetRect, { x: window.scrollX, y: window.scrollY }),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        forcePoint,
        tagName,
        role,
        label,
      });
    }

    const captureRect = captureTarget.getBoundingClientRect();
    if (!isPointInsideRect(captureRect, clickPoint)) {
      return null;
    }

    return buildPointSelection({
      captureBounds: {
        originX: 0,
        originY: 0,
        width: captureRect.width,
        height: captureRect.height,
      },
      clickPoint: toLocalSpacePoint(clickPoint, captureRect),
      targetRect: toLocalSpaceRect(targetRect, captureRect),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      forcePoint,
      tagName,
      role,
      label,
    });
  }, [getCaptureTarget]);

  const startPointSelection = useCallback(() => {
    if (!mergedConfig.allowScreenshot || !mergedConfig.allowPointSelection) {
      return;
    }

    if (!getCaptureTarget()) {
      setSubmissionMessage("Point selection is unavailable on this screen.");
      setSubmissionState("error");
      return;
    }

    captureRunRef.current += 1;
    setSubmissionState("idle");
    setSubmissionMessage(null);
    setSelectionMode("picking");
    setPickerHighlight(null);
  }, [
    getCaptureTarget,
    mergedConfig.allowPointSelection,
    mergedConfig.allowScreenshot,
  ]);

  useEffect(() => {
    if (!open) return;
    const hostDocument = launcherRef.current?.ownerDocument ?? document;
    lockBodyScroll(hostDocument);
    return () => unlockBodyScroll(hostDocument);
  }, [open]);

  // Escape is owned by the host document so it works inside the shadow root.
  useEffect(() => {
    if (!open) {
      return;
    }

    const sheet = sheetRef.current;
    if (!sheet && selectionMode !== "picking") {
      return;
    }

    if (sheet && selectionMode !== "picking") {
      if (!discardConfirmationOpen && restoreDiscardTriggerRef.current) {
        restoreDiscardTriggerRef.current = false;
        const target = discardTriggerRef.current;
        discardTriggerRef.current = null;
        const fallback = sheet.querySelector<HTMLElement>("[data-tgw-initial-focus]") ?? sheet;
        (target?.isConnected ? target : fallback).focus();
      } else {
        const initialFocus = (discardConfirmationOpen
          ? sheet.querySelector<HTMLElement>("[data-tgw-discard-initial-focus]")
          : sheet.querySelector<HTMLElement>("[data-tgw-initial-focus]"))
          ?? getFocusableElements(sheet)[0]
          ?? sheet;
        initialFocus.focus();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (selectionMode !== "picking") {
          const active = getDeepActiveElement(hostDocument);
          if (!sheet?.contains(active)) {
            return;
          }
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (selectionMode === "picking") {
          cancelPointSelection();
        } else if (discardConfirmationOpen) {
          keepEditingRef.current();
        } else {
          requestCloseRef.current();
        }
        return;
      }

      if (selectionMode === "picking" || event.key !== "Tab") {
        return;
      }

      if (!sheet) return;

      const active = getDeepActiveElement(hostDocument);
      if (!sheet.contains(active)) {
        return;
      }

      const focusable = getFocusableElements(sheet);
      if (focusable.length === 0) {
        event.preventDefault();
        sheet!.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const hostDocument = sheet?.ownerDocument ?? launcherRef.current?.ownerDocument ?? document;
    hostDocument.addEventListener("keydown", onKeyDown, true);
    return () => {
      hostDocument.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, cancelPointSelection, discardConfirmationOpen, selectionMode]);

  useEffect(() => {
    if (!open || selectionMode !== "picking") {
      return;
    }

    function updatePickerHighlight(clientX: number, clientY: number) {
      const targetElement = resolveSelectableElement(clientX, clientY);
      if (!targetElement) {
        setPickerHighlight(null);
        return;
      }

      const captureTarget = getCaptureTarget();
      if (
        captureTarget &&
        captureTarget !== document.body &&
        captureTarget !== document.documentElement &&
        !isPointInsideRect(captureTarget.getBoundingClientRect(), { x: clientX, y: clientY })
      ) {
        setPickerHighlight(null);
        return;
      }

      const targetRect = targetElement.getBoundingClientRect();
      const tagName = targetElement.tagName.toLowerCase();
      const mode = shouldUsePointSelectionFallback({
        targetRect,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        forcePoint: tagName === "iframe",
      })
        ? "point"
        : "element";

      setPickerHighlight({
        mode,
        point: { x: clientX, y: clientY },
        rect:
          mode === "element"
            ? {
              left: targetRect.left,
              top: targetRect.top,
              width: targetRect.width,
              height: targetRect.height,
            }
            : undefined,
      });
    }

    function handleMouseMove(event: MouseEvent) {
      const rawTarget = event.composedPath().find((value): value is Element => value instanceof Element) ?? null;
      if (isWidgetElement(rawTarget)) {
        setPickerHighlight(null);
        return;
      }

      updatePickerHighlight(event.clientX, event.clientY);
    }

    function handleClick(event: MouseEvent) {
      const rawTarget = event.composedPath().find((value): value is Element => value instanceof Element) ?? null;
      if (isWidgetElement(rawTarget)) {
        return;
      }

      const targetElement = resolveSelectableElement(event.clientX, event.clientY);
      if (!targetElement) {
        return;
      }

      const payload = resolvePointSelectionPayload(targetElement, event.clientX, event.clientY);
      if (!payload) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      setPointSelection(payload);
      setRestoredPointSelectionDigest(null);
      setSelectionMode("idle");
      setPickerHighlight(null);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void captureScreen({ preservePointSelection: true });
        });
      });
    }

    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("click", handleClick, true);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, [
    cancelPointSelection,
    captureScreen,
    getCaptureTarget,
    open,
    resolvePointSelectionPayload,
    selectionMode,
  ]);

  async function uploadScreenshot(clientUploadId: string, widgetSessionToken?: string): Promise<UploadedAttachment | null> {
    if (!screenshotFile) {
      return null;
    }

    setUploadingScreenshot(true);
    try {
      const formData = new FormData();
      formData.set("file", screenshotFile);
      formData.set("projectKey", props.projectKey);
      formData.set("clientUploadId", clientUploadId);

      const image = new Image();
      const temporaryPreviewUrl = screenshotPreviewUrl ? null : URL.createObjectURL(screenshotFile);
      image.src = screenshotPreviewUrl ?? temporaryPreviewUrl!;
      const dimensions = await new Promise<{ width?: number; height?: number }>((resolve) => {
        image.onload = () => resolve({ width: image.width, height: image.height });
        image.onerror = () => resolve({});
      }).finally(() => {
        if (temporaryPreviewUrl) URL.revokeObjectURL(temporaryPreviewUrl);
      });

      if (dimensions.width) {
        formData.set("width", String(dimensions.width));
      }
      if (dimensions.height) {
        formData.set("height", String(dimensions.height));
      }

      return await fetchJson<UploadedAttachment>(`${props.apiBaseUrl}/api/public/uploads`, {
        method: "POST",
        headers: widgetSessionToken
          ? {
            "x-tracegenie-widget-session": widgetSessionToken,
          }
          : undefined,
        body: formData,
      }, WIDGET_REQUEST_TIMEOUT_MS);
    } finally {
      setUploadingScreenshot(false);
    }
  }

  async function onSubmit(values: FormValues) {
    if (submissionPendingRef.current || preparingFilesRef.current || captureStatus === "capturing") {
      return;
    }

    if (restoredAttachment && !screenshotFile) {
      setSubmissionState("error");
      setSubmissionFailureKind("request");
      setSubmissionMessage("Reattach the previous image or remove it before sending this report.");
      return;
    }

    if (additionalAttachments.some((item) => !item.file)) {
      setSubmissionState("error"); setSubmissionFailureKind("request");
      setSubmissionMessage("Reattach or remove the previous files before sending this report."); return;
    }
    submissionPendingRef.current = true;

    if (screenshotFile && !attachmentChecksumRef.current) {
      try {
        attachmentChecksumRef.current = await fileSha256(screenshotFile);
      } catch {
        // A report can still be sent, but this attempt cannot be recovered across reloads.
      }
    }
    const attachmentChecksum = attachmentChecksumRef.current;

    const submissionScope = activeDraftScopeRef.current;
    const restoredSource = restoredDraftRef.current;
    let submissionSnapshot: string;
    let pointSelectionDigest: string | null;
    try {
      pointSelectionDigest = pointSelection
        ? await widgetPointSelectionDigest(pointSelection)
        : restoredPointSelectionDigest;
      submissionSnapshot = await widgetSubmissionSnapshotDigest({
        form: values,
        surveyScore,
        surveyAnswer,
        attachment: screenshotFile
          ? {
            name: screenshotFile.name,
            type: screenshotFile.type,
            size: screenshotFile.size,
            source: imageEvidenceSource ?? "upload",
            ...(attachmentChecksum ? { checksum: attachmentChecksum } : {}),
          }
          : restoredAttachment
            ? {
              name: restoredAttachment.name,
              type: restoredAttachment.type,
              size: restoredAttachment.size,
              source: restoredAttachment.source,
              ...(restoredAttachment.checksum ? { checksum: restoredAttachment.checksum } : {}),
            }
            : null,
        ...(additionalAttachments.length ? { attachments: additionalAttachments.map((item) => item.metadata) } : {}),
        pointSelectionDigest,
        includeConsole,
        includeClientError,
        includeNetwork,
        includeSelectedText,
        reporterName,
        reporterEmail,
        reporterConsent,
      });
    } catch {
      submissionPendingRef.current = false;
      setSubmissionState("error");
      setSubmissionFailureKind("request");
      setSubmissionMessage("TraceGenie could not prepare this report securely. Your report is still here.");
      return;
    }
    const draftBeforeAttempt = persistDraft();
    const currentAttempt = submissionAttemptRef.current;
    const attemptDraftChanged = Boolean(
      currentAttempt?.draftContent
      && draftBeforeAttempt
      && !widgetDraftContentMatches(currentAttempt.draftContent, contentFromWidgetDraft(draftBeforeAttempt)),
    );
    if (
      !currentAttempt
      || attemptDraftChanged
      || (currentAttempt.snapshotKey !== undefined && currentAttempt.snapshotKey !== submissionSnapshot)
    ) {
      submissionAttemptRef.current = {
        id: !currentAttempt
          && restoredSource?.draft.submissionId
          && restoredSource.draft.submissionSnapshot === submissionSnapshot
          ? restoredSource.draft.submissionId
          : widgetSubmissionId(),
        uploadId: widgetUploadId(),
        attachmentChecksum: attachmentChecksum ?? undefined,
        pointSelectionDigest: pointSelectionDigest ?? undefined,
        snapshotKey: submissionSnapshot,
      };
      // A changed report is a new submission. Previously uploaded files may
      // already belong to an accepted report whose response was lost.
      if (submissionAttemptRef.current.id !== (currentAttempt?.id ?? restoredSource?.draft.submissionId)) {
        for (const item of additionalAttachments) {
          item.metadata = { ...item.metadata, clientUploadId: widgetUploadId() };
          item.uploaded = undefined;
        }
      }
    } else {
      currentAttempt.snapshotKey = submissionSnapshot;
      currentAttempt.attachmentChecksum = attachmentChecksum ?? undefined;
      currentAttempt.pointSelectionDigest = pointSelectionDigest ?? undefined;
    }
    const submissionAttempt = submissionAttemptRef.current;
    if (!submissionAttempt) {
      submissionPendingRef.current = false;
      return;
    }
    const submittedDraft = persistDraft();
    submissionAttempt.draftContent = submittedDraft ? contentFromWidgetDraft(submittedDraft) : undefined;
    const clientSubmissionId = submissionAttempt.id;
    setSubmissionState("submitting");
    setSubmissionMessage(null);
    setSubmissionFailureKind(null);

    try {
      if (browserIsOffline()) {
        throw new WidgetRequestError("The browser is offline.", "offline");
      }
      const widgetSessionToken = await resolveWidgetSessionToken(props);
      const upload = submissionAttempt.uploadedAttachment !== undefined
        ? submissionAttempt.uploadedAttachment
        : await uploadScreenshot(submissionAttempt.uploadId, widgetSessionToken);
      submissionAttempt.uploadedAttachment = upload;
      const attachmentTokens = upload?.uploadToken ? [upload.uploadToken] : [];
      for (const item of additionalAttachments) {
        if (!item.uploaded) {
          const body = new FormData();
          body.set("file", item.file!);
          body.set("projectKey", props.projectKey);
          body.set("clientUploadId", item.metadata.clientUploadId!);
          body.set("kind", "file");
          item.uploaded = await fetchJson<UploadedAttachment>(`${props.apiBaseUrl}/api/public/uploads`, {
            method: "POST", body,
            headers: widgetSessionToken ? { "x-tracegenie-widget-session": widgetSessionToken } : undefined,
          }, WIDGET_REQUEST_TIMEOUT_MS);
        }
        attachmentTokens.push(item.uploaded.uploadToken);
      }
      const productContext = props.productContext ? productContextSchema.parse(props.productContext) : undefined;
      const openCustomerImpact = openRequestContext?.customerImpact !== undefined
        ? feedbackCustomerImpactSchema.parse(openRequestContext.customerImpact)
        : undefined;
      const openSurveyResponse = openRequestContext?.surveyResponse !== undefined
        ? feedbackSurveyResponseSchema.parse(openRequestContext.surveyResponse)
        : undefined;
      const hasProvidedSurveyResponse = props.extraContext?.surveyResponse !== undefined || openSurveyResponse !== undefined;
      const configuredSurveyResponseResult = !hasProvidedSurveyResponse && mergedConfig.surveyPrompt.enabled
        ? feedbackSurveyResponseSchema.safeParse({
          type: mergedConfig.surveyPrompt.type,
          question: mergedConfig.surveyPrompt.question,
          ...(surveyPromptUsesText(mergedConfig.surveyPrompt.type)
            ? { answer: surveyAnswer.trim() || undefined }
            : { score: surveyScore ?? undefined }),
          submittedAt: new Date().toISOString(),
        })
        : undefined;
      const configuredSurveyResponse = configuredSurveyResponseResult?.success ? configuredSurveyResponseResult.data : undefined;
      const openEvidenceTimeline = openRequestContext?.evidenceTimeline !== undefined
        ? feedbackEvidenceTimelineSchema.parse(openRequestContext.evidenceTimeline)
        : undefined;
      const openFeatureContext = openRequestContext?.featureContext !== undefined
        ? featureContextSchema.parse(openRequestContext.featureContext)
        : undefined;
      const openSessionReplayClipId = openRequestContext?.sessionReplayClipId !== undefined
        ? sessionReplayClipIdSchema.parse(openRequestContext.sessionReplayClipId)
        : undefined;
      const openExternalRefs = openRequestContext?.externalRefs !== undefined
        ? feedbackExternalRefsSchema.parse(openRequestContext.externalRefs)
        : undefined;
      const openSelectedElement = openRequestContext?.selectedElement !== undefined
        ? selectedElementSchema.parse(openRequestContext.selectedElement)
        : undefined;
      const featureContext = productContext?.feature ?? openFeatureContext;
      const selectedElementCandidate = pointSelection?.mode === "element"
        ? {
          tagName: pointSelection.tagName,
          role: pointSelection.role,
          label: pointSelection.label,
        }
        : undefined;
      const selectedElement = selectedElementCandidate && Object.values(selectedElementCandidate).some(Boolean)
        ? selectedElementSchema.parse(selectedElementCandidate)
        : openSelectedElement;
      const networkEntries = mergedConfig.allowNetworkSummary && includeNetwork && networkEntriesRef.current.length > 0
        ? networkEntriesRef.current
        : undefined;
      const capturedReporterIdentity = mergedConfig.reporterIdentity.enabled && reporterConsent
        ? {
          ...(mergedConfig.reporterIdentity.collectName && reporterName.trim() ? { name: reporterName.trim() } : {}),
          ...(mergedConfig.reporterIdentity.collectEmail && reporterEmail.trim() ? { email: reporterEmail.trim() } : {}),
        }
        : undefined;
      const hasCapturedReporterIdentity = Boolean(capturedReporterIdentity && Object.keys(capturedReporterIdentity).length > 0);
      const consentSnapshot = feedbackConsentSnapshotSchema.parse({
        capturedAt: new Date().toISOString(),
        screenshot: {
          allowed: mergedConfig.allowScreenshot,
          included: Boolean(upload?.uploadToken),
        },
        pointSelection: {
          allowed: mergedConfig.allowScreenshot && mergedConfig.allowPointSelection,
          included: Boolean(pointSelection),
        },
        console: {
          allowed: mergedConfig.allowConsoleCapture,
          included: Boolean(mergedConfig.allowConsoleCapture && !suppressRawTechnicalEvidence && includeConsole && consoleEntriesRef.current.length > 0),
        },
        clientError: {
          allowed: mergedConfig.allowClientErrorContext,
          included: Boolean(mergedConfig.allowClientErrorContext && !suppressRawTechnicalEvidence && includeClientError && clientErrorRef.current),
        },
        network: {
          allowed: mergedConfig.allowNetworkSummary,
          included: Boolean(networkEntries?.length),
        },
        selectedText: {
          allowed: allowSelectedText,
          included: Boolean(allowSelectedText && includeSelectedText && selectedTextSuggestion),
        },
        attachmentCount: attachmentTokens.length,
      });
      const extraContext = {
        ...(props.extraContext ?? {}),
        ...(openRequestContext ? { openContext: openRequestContext } : {}),
        ...(openCustomerImpact ? { customerImpact: openCustomerImpact } : {}),
        ...(openEvidenceTimeline ? { evidenceTimeline: openEvidenceTimeline } : {}),
        ...(openSurveyResponse ? { surveyResponse: openSurveyResponse } : {}),
        ...(configuredSurveyResponse ? { surveyResponse: configuredSurveyResponse } : {}),
        ...(productContext ? { productContext } : {}),
        ...(featureContext ? { featureContext } : {}),
        ...(openSessionReplayClipId ? { sessionReplayClipId: openSessionReplayClipId } : {}),
        ...(openExternalRefs ? { externalRefs: openExternalRefs } : {}),
        ...(pointSelectionDigest ? { pointSelectionDigest } : {}),
        ...(pointSelection ? { pointSelection } : {}),
        ...(selectedElement ? { selectedElement } : {}),
        ...(pointSelectionDigest && !pointSelection
          ? {
            pointSelectionRecovery: {
              rawEvidenceAvailable: false,
              reason: "unavailable_after_reload",
            },
          }
          : {}),
        ...(allowSelectedText && includeSelectedText && selectedTextSuggestion ? { selectedTextSuggestion } : {}),
        consentSnapshot,
      };
      const payload = submissionAttempt.payload ?? feedbackSubmissionSchema.parse({
        projectKey: props.projectKey,
        clientSubmissionId,
        title: values.title,
        description: values.description,
        issueType: mergedConfig.fields.issueType.enabled ? values.issueType : issueTypeSchema.options[0],
        severity: mergedConfig.fields.severity.enabled ? values.severity : severitySchema.options[1],
        stepsToReproduce: mergedConfig.fields.stepsToReproduce.enabled ? values.stepsToReproduce : undefined,
        expectedResult: mergedConfig.fields.expectedResult.enabled ? values.expectedResult : undefined,
        actualResult: mergedConfig.fields.actualResult.enabled ? values.actualResult : undefined,
        labels: mergedConfig.defaultLabels,
        route: {
          url: window.location.href,
          routeName: props.routeName,
          pageTitle: props.pageTitle ?? document.title,
          referrer: document.referrer || undefined,
        },
        release: {
          appName: props.appName,
          appEnvironment: props.appEnvironment,
          appVersion: props.appVersion,
          buildNumber: props.buildNumber,
          releaseChannel: props.releaseChannel,
        },
        browser: parseBrowserInfo(),
        currentUser: mergedConfig.reporterIdentity.enabled
          ? hasCapturedReporterIdentity ? capturedReporterIdentity : undefined
          : props.currentUser,
        reporterIdentityConsent: mergedConfig.reporterIdentity.enabled && hasCapturedReporterIdentity && reporterConsent
          ? { granted: true, capturedAt: new Date().toISOString() }
          : undefined,
        clientTimestamp: new Date().toISOString(),
        consoleEntries:
          mergedConfig.allowConsoleCapture && !suppressRawTechnicalEvidence && includeConsole ? consoleEntriesRef.current : undefined,
        clientErrorContext:
          mergedConfig.allowClientErrorContext && !suppressRawTechnicalEvidence && includeClientError ? clientErrorRef.current : undefined,
        attachmentTokens,
        extraContext: {
          ...extraContext,
          ...(networkEntries ? { networkEntries } : {}),
        },
      });
      submissionAttempt.payload = payload;

      const result = await fetchJson(`${props.apiBaseUrl}/api/public/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(widgetSessionToken ? { "x-tracegenie-widget-session": widgetSessionToken } : {}),
        },
        body: JSON.stringify(payload),
      }, WIDGET_REQUEST_TIMEOUT_MS);

      if (submissionScope) {
        removeWidgetDraftIfMatch(submissionScope, submittedDraft);
      }
      const currentSubmissionScope = activeDraftScopeRef.current;
      if (currentSubmissionScope && currentSubmissionScope.storageKey !== submissionScope?.storageKey) {
        removeWidgetDraftIfMatch(currentSubmissionScope, submittedDraft);
      }
      const currentRestoredSource = restoredDraftRef.current ?? restoredSource;
      if (currentRestoredSource) {
        removeWidgetDraftIfMatch(currentRestoredSource.scope, currentRestoredSource.draft);
      }
      restoredDraftRef.current = null;
      submissionAttemptRef.current = null;
      draftWriterIdRef.current = randomDraftScope();
      setReceipt(submissionReceipt(result, mergedConfig.reporterIdentity.responseExpectation));
      setSubmissionState("success");
      void Promise.resolve()
        .then(() => props.onSubmitted?.(result))
        .catch((callbackError) => {
          const resolved = callbackError instanceof Error ? callbackError : new Error("The host submission callback failed.");
          props.onError?.(resolved);
        });
    } catch (error) {
      const resolved = error instanceof Error ? error : new Error("Unable to send the report.");
      props.onError?.(resolved);
      const failure = submissionFailure(error);
      setSubmissionState("error");
      setSubmissionFailureKind(failure.kind);
      setSubmissionMessage(failure.message);
    } finally {
      submissionPendingRef.current = false;
    }
  }

  const launcherPresentation = resolveLauncherPresentation(
    (mergedConfig.appearance as typeof mergedConfig.appearance & { launcherPresentation?: unknown }).launcherPresentation,
  );
  const launcherLabel = mergedConfig.appearance.launcherLabel;
  const showLauncherIcon = launcherPresentation === "icon" || launcherPresentation === "icon-text";
  const showLauncherText = launcherPresentation === "icon-text" || launcherPresentation === "text";
  const positionClass = mergedConfig.appearance.launcherPosition === "bottom-left" ? "left" : "right";
  const brandColor = mergedConfig.notificationBranding.primaryColor;
  const accentColor = mergedConfig.notificationBranding.accentColor;
  const widgetStyle = {
    "--tgw-primary": brandColor,
    "--tgw-primary-fg": readableBrandForeground(brandColor),
    "--tgw-picker-accent": accentColor,
    "--tgw-launcher-offset-x": `${mergedConfig.appearance.launcherOffsetX}px`,
    "--tgw-launcher-offset-y": `${mergedConfig.appearance.launcherOffsetY}px`,
  } as CSSProperties;
  const consoleEntries = consoleEntriesRef.current ?? [];
  const clientError = mergedConfig.allowClientErrorContext && !suppressRawTechnicalEvidence ? clientErrorRef.current : undefined;
  const networkEntries = networkEntriesRef.current ?? [];
  const showConsoleRow = mergedConfig.allowConsoleCapture && !suppressRawTechnicalEvidence;
  const showClientErrorRow = mergedConfig.allowClientErrorContext && !suppressRawTechnicalEvidence;
  const showNetworkRow = mergedConfig.allowNetworkSummary && !strictRedaction;

  const hasReporterIdentityValue = Boolean(
    (mergedConfig.reporterIdentity.collectName && reporterName.trim())
    || (mergedConfig.reporterIdentity.collectEmail && reporterEmail.trim()),
  );
  const reporterConsentRequired = mergedConfig.reporterIdentity.enabled && hasReporterIdentityValue && !reporterConsent;
  const recipientProduct = normalizeText(remoteProject?.name) || normalizeText(props.appName) || "this product";
  const recipientOrganization = normalizeText(remoteProject?.organizationName)
    || normalizeText(mergedConfig.notificationBranding.brandName);
  const recipientSummary = recipientOrganization && recipientOrganization.toLocaleLowerCase() !== recipientProduct.toLocaleLowerCase()
    ? `Sent to ${recipientOrganization} for ${recipientProduct}.`
    : `Sent to the ${recipientProduct} team.`;
  const privacyRetentionSummary = retentionSummary(mergedConfig.privacy);
  const showPointSelectionAction =
    mergedConfig.allowScreenshot && mergedConfig.allowPointSelection;
  const isCapturePending = mergedConfig.allowScreenshot && captureStatus === "capturing";
  const isSubmitPending = submissionState === "submitting" || uploadingScreenshot || isCapturePending || preparingFiles;
  const pointSelectionSummary = pointSelection
    ? pointSelection.mode === "point"
      ? "Selected point on page"
      : pointSelection.label
        ? `Selected element: ${pointSelection.label}`
        : "Selected element on page"
    : restoredPointSelectionDigest
      ? "Previous point selection is unavailable after reload. Select it again to include it."
      : null;
  const imageEvidenceLabel = imageEvidenceSource === "upload" ? "Attached image" : "Screenshot of this page";
  const imageEvidenceAlt = imageEvidenceSource === "upload" ? "Attached image preview" : "Screenshot review";
  const imageEvidenceRemoveLabel = imageEvidenceSource === "upload" ? "Remove attached image" : "Remove screenshot";
  const imageEvidenceMeta = screenshotFile ? `${screenshotFile.name} · ${formatByteSize(screenshotFile.size)}` : null;
  const restoredAttachmentSummary = restoredAttachment
    ? `${restoredAttachment.source === "screenshot" ? "Previous screenshot" : "Previous image"}: ${restoredAttachment.name} · ${formatByteSize(restoredAttachment.size)}. Reattach to send.`
    : null;
  const shortcut = mergedConfig.appearance.keyboardShortcut;

  return (
    <div id="tracegenie-widget-root" style={widgetStyle} {...(props.theme === "dark" ? { "data-tg-theme": "dark" } : {})}>
      <button
        ref={launcherRef}
        type="button"
        onClick={() => openWidget()}
        data-hidden={open ? "true" : "false"}
        className={[
          "tgw-launcher",
          `tgw-launcher--${positionClass}`,
          showLauncherText ? "tgw-launcher--with-text" : "",
        ].join(" ")}
        aria-label={launcherLabel}
        title={launcherLabel}
      >
        {showLauncherIcon ? (mergedConfig.appearance.launcherIcon === "message" ? <MessageIcon /> : <ReportIcon />) : null}
        {showLauncherText ? <span className="tgw-launcher-text">{launcherLabel}</span> : null}
      </button>

      <MotionPresence>
      {open ? (
        <MotionSurface kind="fade" className="tgw-presence-root">
          {selectionMode === "picking" ? (
            <div className="tgw-picker-layer" aria-live="polite">
              <div className="tgw-picker-hud">
                <p className="tgw-picker-copy">Click the issue on the page • Esc to cancel</p>
                <button type="button" className="tgw-button-secondary" onClick={cancelPointSelection}>
                  Cancel selection
                </button>
              </div>
              {pickerHighlight?.rect ? (
                <div
                  className="tgw-picker-highlight"
                  style={{
                    left: `${pickerHighlight.rect.left}px`,
                    top: `${pickerHighlight.rect.top}px`,
                    width: `${pickerHighlight.rect.width}px`,
                    height: `${pickerHighlight.rect.height}px`,
                  }}
                />
              ) : null}
              {pickerHighlight?.mode === "point" ? (
                <div
                  className="tgw-picker-point"
                  style={{
                    left: `${pickerHighlight.point.x}px`,
                    top: `${pickerHighlight.point.y}px`,
                  }}
                />
              ) : null}
            </div>
          ) : (
            <div className="tgw-dialog-layer">
              <MotionSurface kind="fade" className="tgw-scrim" onClick={requestClose} aria-hidden="true" />
              <MotionSurface kind="sheet"
                ref={sheetRef}
                className={`tgw-sheet tgw-sheet--${positionClass}${mergedConfig.appearance.compactMode ? " tgw-sheet--compact" : ""}`}
                data-compact={mergedConfig.appearance.compactMode ? "true" : "false"}
                role={discardConfirmationOpen ? "alertdialog" : "dialog"}
                aria-modal="true"
                aria-labelledby={discardConfirmationOpen ? "tgw-discard-title" : submissionState === "success" ? "tgw-success-title" : "tgw-title"}
                aria-describedby={discardConfirmationOpen ? "tgw-discard-description" : undefined}
                tabIndex={-1}
              >
                {submissionState === "success" ? (
                  <div className="tgw-sheet-content">
                    <div className="tgw-body tgw-success">
                      <div className="tgw-success-icon">
                        <MotionCelebration />
                        <CheckIcon />
                      </div>
                      <h2 id="tgw-success-title" className="tgw-success-title">
                        {receipt?.processingState === "capacity_locked" ? "Report saved" : "Report sent"}
                      </h2>
                      {receipt?.ticketNumber ? (
                        <p className="tgw-success-ticket">Ticket #{receipt.ticketNumber}</p>
                      ) : null}
                      {receipt?.processingState === "capacity_locked" ? (
                        <p className="tgw-success-state" role="status">Processing paused</p>
                      ) : null}
                      <p className="tgw-success-copy">{receipt?.responseExpectation ?? mergedConfig.reporterIdentity.responseExpectation}</p>
                      {receipt?.trackingUrl ? (
                        <a className="tgw-success-link" href={receipt.trackingUrl} target="_blank" rel="noreferrer">
                          Track this report
                        </a>
                      ) : null}
                      <button type="button" className="tgw-button-primary" onClick={() => finishClose()} data-tgw-initial-focus>
                        Done
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="tgw-compose-root">
                    <div
                      className="tgw-sheet-content"
                      hidden={discardConfirmationOpen}
                      aria-hidden={discardConfirmationOpen ? "true" : undefined}
                      inert={discardConfirmationOpen ? true : undefined}
                    >
                      <div className="tgw-header">
                      <div className="tgw-title-group">
                        <span className="tgw-brand-mark" aria-hidden="true">
                          <img src={traceGenieMarkUrl} alt="" width="18" height="18" />
                        </span>
                        <h2 id="tgw-title" className="tgw-title">{mergedConfig.appearance.modalTitle}</h2>
                      </div>
                      <button type="button" className="tgw-icon-button" onClick={requestClose} aria-label="Close">
                        <CloseIcon />
                      </button>
                      </div>

                    <form className="tgw-body" onSubmit={form.handleSubmit(onSubmit)}>
                      
                      <div className="tgw-field">
                        <label className="tgw-label" htmlFor="tgw-input-title">
                          Title{!mergedConfig.fields.title.required ? <span className="tgw-required"> (optional)</span> : null}
                        </label>
                        <input
                          id="tgw-input-title"
                          className="tgw-input"
                          data-tgw-initial-focus
                          maxLength={160}
                          {...form.register("title")}
                          placeholder="What went wrong?"
                        />
                        <span className="tgw-error">{form.formState.errors.title?.message}</span>
                      </div>

                      <div className="tgw-field">
                        <label className="tgw-label" htmlFor="tgw-input-description">What happened?</label>
                        <textarea
                          id="tgw-input-description"
                          className="tgw-textarea"
                          maxLength={4000}
                          {...form.register("description")}
                          placeholder="What were you trying to do, and what happened instead?"
                        />
                        <span className="tgw-error">{form.formState.errors.description?.message}</span>
                      </div>

                      <div className="tgw-row">
                        {mergedConfig.fields.issueType.enabled ? (
                          <div className="tgw-field">
                            <label className="tgw-label" htmlFor="tgw-input-type">Type</label>
                            <select id="tgw-input-type" className="tgw-select" {...form.register("issueType")}>
                              {issueTypeSchema.options.map((value) => (
                                <option key={value} value={value}>
                                  {ISSUE_TYPE_LABELS[value] ?? value}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                      </div>

                      {mergedConfig.fields.severity.enabled ? (
                        <div className="tgw-field">
                          <label className="tgw-label" id="tgw-severity-label">How much does this block you?</label>
                          <div className="tgw-segmented" role="group" aria-labelledby="tgw-severity-label">
                            {severitySchema.options.map((value) => (
                              <button
                                key={value}
                                type="button"
                                className="tgw-segment"
                                aria-pressed={selectedSeverity === value}
                                onClick={() => form.setValue("severity", value, { shouldDirty: true, shouldValidate: true })}
                              >
                                {SEVERITY_LABELS[value] ?? value}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      

                      {mergedConfig.reporterIdentity.enabled ? (
                        <details id="tgw-reporter-identity" className="tgw-reporter-identity">
                          <summary className="tgw-reporter-summary">Get updates <span>(optional)</span></summary>
                          <div className="tgw-reporter-fields">
                            {mergedConfig.reporterIdentity.collectName ? (
                              <div className="tgw-field">
                                <label className="tgw-label" htmlFor="tgw-reporter-name">Name <span className="tgw-required">(optional)</span></label>
                                <input
                                  id="tgw-reporter-name"
                                  className="tgw-input"
                                  value={reporterName}
                                  maxLength={255}
                                  autoComplete="name"
                                  onChange={(event) => {
                                    setReporterName(event.target.value);
                                    if (!event.target.value.trim() && !reporterEmail.trim()) setReporterConsent(false);
                                  }}
                                />
                              </div>
                            ) : null}
                            {mergedConfig.reporterIdentity.collectEmail ? (
                              <div className="tgw-field">
                                <label className="tgw-label" htmlFor="tgw-reporter-email">Email <span className="tgw-required">(optional)</span></label>
                                <input
                                  id="tgw-reporter-email"
                                  className="tgw-input"
                                  type="email"
                                  value={reporterEmail}
                                  maxLength={255}
                                  autoComplete="email"
                                  onChange={(event) => {
                                    setReporterEmail(event.target.value);
                                    if (!event.target.value.trim() && !reporterName.trim()) setReporterConsent(false);
                                  }}
                                />
                              </div>
                            ) : null}
                            <label className="tgw-reporter-consent">
                              <input
                                type="checkbox"
                                checked={reporterConsent}
                                disabled={!hasReporterIdentityValue}
                                required={hasReporterIdentityValue}
                                onChange={(event) => setReporterConsent(event.target.checked)}
                              />
                              <span>{mergedConfig.reporterIdentity.consentLabel}</span>
                            </label>
                            {reporterConsentRequired ? (
                              <p id="tgw-reporter-consent-required" className="tgw-error">Consent is required to include contact details.</p>
                            ) : null}
                          </div>
                        </details>
                      ) : null}

                      {mergedConfig.allowScreenshot || mergedConfig.allowFileAttachments || showPointSelectionAction ? (
                        <div className="tgw-evidence-toolbar" aria-label="Report evidence">
                          <span className="tgw-evidence-toolbar-label">Evidence</span>
                          <div className="tgw-evidence-toolbar-actions">
                            {mergedConfig.allowScreenshot ? (
                              captureStatus === "ready" && screenshotPreviewUrl ? (
                                <button
                                  type="button"
                                  className="tgw-evidence-action tgw-evidence-action--added"
                                  onClick={() => {
                                    setShowIncludedDetails(true);
                                    setShowScreenshotReview(true);
                                  }}
                                >
                                  Screenshot added
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="tgw-evidence-action"
                                  disabled={captureStatus === "capturing" || preparingFiles || additionalAttachments.length >= MAX_REPORT_ATTACHMENTS}
                                  onClick={() => void captureScreen()}
                                >
                                  {captureStatus === "capturing" ? "Capturing..." : captureStatus === "failed" ? "Retry screenshot" : "Add screenshot"}
                                </button>
                              )
                            ) : null}
                            {mergedConfig.allowScreenshot && captureStatus !== "ready" ? (
                              <button
                                type="button"
                                className="tgw-evidence-action"
                                onClick={() => attachImageInputRef.current?.click()}
                              >
                                Attach image
                              </button>
                            ) : null}
                            {mergedConfig.allowFileAttachments ? (
                              <button type="button" className="tgw-evidence-action" disabled={preparingFiles || submissionState === "submitting"} onClick={() => addFilesInputRef.current?.click()}>
                                {preparingFiles ? "Preparing files..." : "Add files"}
                              </button>
                            ) : null}
                            {showPointSelectionAction ? (
                              <button type="button" className="tgw-evidence-action" onClick={startPointSelection}>
                                {pointSelection ? "Change point" : "Point to issue"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {mergedConfig.allowFileAttachments ? (
                        <div className="tgw-file-attachments">
                          <input ref={addFilesInputRef} type="file" multiple accept={FILE_ACCEPT} aria-label="Add files" hidden
                            onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void addFiles(files); }} />
                          <p className="tgw-included-hint">Up to 5 attachments including the screenshot. Images, PDF, text or logs; 5 MB each.</p>
                          {additionalAttachments.length ? <ul className="tgw-file-list" aria-label="Attached files">
                            {additionalAttachments.map((item, index) => <li key={item.metadata.clientUploadId}>
                              <span><strong>{item.metadata.name}</strong><span className="tgw-included-hint">{formatByteSize(item.metadata.size)}{!item.file ? " · Reattach to send" : ""}</span></span>
                              {!item.file ? <button type="button" className="tgw-text-button" disabled={preparingFiles || submissionState === "submitting"} onClick={() => addFilesInputRef.current?.click()} aria-label={`Reattach ${item.metadata.name}`}>Reattach</button> : null}
                              <button type="button" className="tgw-text-button" disabled={preparingFiles || submissionState === "submitting"} aria-label={`Remove ${item.metadata.name}`} onClick={() => removeAdditionalAttachment(index)}>Remove</button>
                            </li>)}
                          </ul> : null}
                        </div>
                      ) : null}

                      <details
                        className="tgw-included"
                        aria-label="What's included with your report"
                        open={showIncludedDetails}
                        onToggle={(event) => setShowIncludedDetails(event.currentTarget.open)}
                      >
                        <summary className="tgw-included-summary">
                          <span className="tgw-included-title">What's included?</span>
                          <ChevronIcon />
                        </summary>
                        <div className="tgw-included-panel">
                          <div className="tgw-sharing-summary">
                            <p className="tgw-recipient-summary">{recipientSummary}</p>
                            <p className="tgw-retention-summary">{privacyRetentionSummary}</p>
                            {privacyUrl ? (
                              <a
                                className="tgw-privacy-link"
                                href={privacyUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Privacy policy
                              </a>
                            ) : null}
                          </div>

                        <div className="tgw-collector-inventory" aria-label="Enabled collectors">
                            <div className="tgw-collector-row">
                              <span>Page URL, title, and browser</span>
                              <span className="tgw-collector-state">Included</span>
                            </div>
                            <div className="tgw-collector-row">
                              <span>App release and environment</span>
                              <span className="tgw-collector-state">Included</span>
                            </div>
                            {(mergedConfig.reporterIdentity.enabled ? hasReporterIdentityValue && reporterConsent : props.currentUser) ? (
                              <div className="tgw-collector-row">
                                <span>Reporter identity</span>
                                <span className="tgw-collector-state">{mergedConfig.reporterIdentity.enabled ? "With consent" : "Included"}</span>
                              </div>
                            ) : null}
                        </div>

                          {mergedConfig.allowScreenshot ? (
                            <div className="tgw-included-block">
                              <div className="tgw-included-row">
                                {captureStatus === "ready" && screenshotPreviewUrl ? (
                                  <div className="tgw-screenshot-ready-row">
                                    <span className="tgw-thumb-wrap tgw-thumb-wrap--ready">
                                      {imagePreviewBlocked ? (
                                        <span className="tgw-thumb-fallback" aria-hidden="true">
                                          Preview unavailable
                                        </span>
                                      ) : (
                                        <img
                                          className="tgw-thumb"
                                          src={screenshotPreviewUrl}
                                          alt="Screenshot preview"
                                          onError={() => setImagePreviewBlocked(true)}
                                        />
                                      )}
                                      {!imagePreviewBlocked && pointSelection?.rectPct ? (
                                        <span
                                          className="tgw-thumb-rect"
                                          style={{
                                            left: `${pointSelection.rectPct.left}%`,
                                            top: `${pointSelection.rectPct.top}%`,
                                            width: `${pointSelection.rectPct.width}%`,
                                            height: `${pointSelection.rectPct.height}%`,
                                          }}
                                        />
                                      ) : null}
                                      {!imagePreviewBlocked && pointSelection ? (
                                        <span
                                          className="tgw-thumb-pin"
                                          style={{
                                            left: `${pointSelection.xPct}%`,
                                            top: `${pointSelection.yPct}%`,
                                          }}
                                        />
                                      ) : null}
                                    </span>
                                    <span className="tgw-evidence-summary">
                                      <span className="tgw-included-label">Image evidence</span>
                                      <span className="tgw-included-hint">{imageEvidenceMeta ?? imageEvidenceLabel}</span>
                                    </span>
                                    <div className="tgw-included-actions">
                                      <button
                                        ref={imageEditButtonRef}
                                        type="button"
                                        className="tgw-text-button"
                                        onClick={() => {
                                          setShowScreenshotReview(false);
                                          setShowScreenshotEditor(true);
                                        }}
                                        aria-expanded={showScreenshotEditor}
                                        aria-controls="tgw-screenshot-editor"
                                        aria-label="Crop or redact image"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="tgw-text-button"
                                        onClick={() => {
                                          setShowScreenshotEditor(false);
                                          setShowScreenshotReview((current) => !current);
                                        }}
                                        aria-expanded={showScreenshotReview}
                                        aria-controls="tgw-screenshot-review"
                                        aria-label={showScreenshotReview ? "Hide image preview" : "View image preview"}
                                      >
                                        {showScreenshotReview ? "Hide" : "View"}
                                      </button>
                                      <button
                                        type="button"
                                        className="tgw-text-button"
                                        onClick={removeScreenshot}
                                        aria-label={imageEvidenceRemoveLabel}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </div>
                                ) : restoredAttachment && restoredAttachmentSummary ? (
                                  <div className="tgw-screenshot-choice">
                                    <span className="tgw-included-hint">{restoredAttachmentSummary}</span>
                                    <div className="tgw-included-actions">
                                      <button
                                        type="button"
                                        className="tgw-text-button tgw-upload-button"
                                        onClick={() => reattachImageInputRef.current?.click()}
                                      >
                                        Reattach image
                                      </button>
                                      <input
                                        ref={reattachImageInputRef}
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        hidden
                                        aria-label="Reattach image"
                                        onChange={(event) => {
                                          const file = event.target.files?.[0];
                                          if (file) {
                                            void attachFile(file, { restoreFocusAfterAttach: true, source: "upload" });
                                          }
                                        }}
                                      />
                                      <button
                                        type="button"
                                        className="tgw-text-button"
                                        onClick={removeScreenshot}
                                        aria-label="Remove previous attachment"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </div>
                                ) : captureStatus === "capturing" ? (
                                  <span className="tgw-included-hint tgw-capture-status">
                                    <span className="tgw-capture-pulse" aria-hidden="true" />
                                    Capturing screenshot…
                                  </span>
                                ) : (
                                  <div className="tgw-screenshot-choice">
                                    <span className="tgw-included-hint">
                                      {captureStatus === "failed"
                                        ? "Screenshot capture failed."
                                        : captureStatus === "removed"
                                          ? "Screenshot removed."
                                          : "Add a screenshot or image if it helps explain the issue."}
                                    </span>
                                    <div className="tgw-included-actions">
                                      <button
                                        type="button"
                                        className="tgw-text-button"
                                        onClick={() => {
                                          void captureScreen();
                                        }}
                                      >
                                        {captureStatus === "failed" ? "Try again" : "Capture screenshot"}
                                      </button>
                                      <input
                                        ref={attachImageInputRef}
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        hidden
                                        aria-label="Attach image"
                                        onChange={(event) => {
                                          const file = event.target.files?.[0];
                                          if (file) {
                                            void attachFile(file, { restoreFocusAfterAttach: true, source: "upload" });
                                          }
                                        }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                              {captureStatus === "ready" && screenshotFile && screenshotPreviewUrl && showScreenshotEditor ? (
                                <ScreenshotPrivacyEditor
                                  file={screenshotFile}
                                  previewUrl={screenshotPreviewUrl}
                                  onCancel={() => setShowScreenshotEditor(false)}
                                  onApply={async (protectedFile) => {
                                    await attachFile(protectedFile, { source: imageEvidenceSource ?? "upload" });
                                  }}
                                />
                              ) : null}
                              {captureStatus === "ready" && screenshotPreviewUrl && showScreenshotReview ? (
                                <div id="tgw-screenshot-review" className="tgw-screenshot-review">
                                  {imagePreviewBlocked ? (
                                    <div className="tgw-image-preview-fallback">
                                      <p>Preview blocked by host policy.</p>
                                    </div>
                                  ) : (
                                    <img
                                      className="tgw-screenshot-review-image"
                                      src={screenshotPreviewUrl}
                                      alt={imageEvidenceAlt}
                                      onError={() => setImagePreviewBlocked(true)}
                                    />
                                  )}
                                  {!imagePreviewBlocked && pointSelection?.rectPct ? (
                                    <span
                                      className="tgw-screenshot-review-rect"
                                      style={{
                                        left: `${pointSelection.rectPct.left}%`,
                                        top: `${pointSelection.rectPct.top}%`,
                                        width: `${pointSelection.rectPct.width}%`,
                                        height: `${pointSelection.rectPct.height}%`,
                                      }}
                                    />
                                  ) : null}
                                  {!imagePreviewBlocked && pointSelection ? (
                                    <span
                                      className="tgw-screenshot-review-pin"
                                      style={{
                                        left: `${pointSelection.xPct}%`,
                                        top: `${pointSelection.yPct}%`,
                                      }}
                                    />
                                  ) : null}
                                  {imageEvidenceMeta ? (
                                    <p className="tgw-image-review-meta">{imageEvidenceMeta}</p>
                                  ) : null}
                                </div>
                              ) : null}
                              {pointSelectionSummary ? (
                                <div className="tgw-included-row tgw-point-row">
                                  <span className="tgw-selection-summary">{pointSelectionSummary}</span>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {allowSelectedText && selectedTextSuggestion ? (
                            <div className="tgw-included-row tgw-selected-text-row">
                              {selectedTextSuggestion && includeSelectedText ? (
                                <div className="tgw-selected-text-included">
                                  <span className="tgw-selected-text-summary">
                                    <span className="tgw-included-label">Selected text</span>
                                    <span className="tgw-selected-text-preview">{selectedTextPreview(selectedTextSuggestion.text)}</span>
                                  </span>
                                  <div className="tgw-included-actions">
                                    <button
                                      type="button"
                                      className="tgw-text-button"
                                      onClick={() => setShowSelectedTextView((current) => !current)}
                                      aria-expanded={showSelectedTextView}
                                      aria-controls="tgw-selected-text-view"
                                      aria-label={showSelectedTextView ? "Hide selected text" : "View selected text"}
                                    >
                                      {showSelectedTextView ? "Hide" : "View"}
                                    </button>
                                    <button
                                      type="button"
                                      className="tgw-text-button"
                                      onClick={() => {
                                        setIncludeSelectedText(false);
                                        setShowSelectedTextView(false);
                                      }}
                                      aria-label="Remove selected text"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              ) : selectedTextSuggestion ? (
                                <div className="tgw-selected-text-excluded">
                                  <span className="tgw-included-hint">Selected text excluded.</span>
                                  <button type="button" className="tgw-text-button" onClick={() => setIncludeSelectedText(true)}>
                                    Include
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {allowSelectedText && selectedTextSuggestion && includeSelectedText && showSelectedTextView ? (
                            <div id="tgw-selected-text-view" className="tgw-selected-text-view">
                              <p className="tgw-selected-text-view-text">{selectedTextSuggestion.text}</p>
                              {selectedTextSuggestion.url ? (
                                <p className="tgw-selected-text-view-source">{selectedTextSuggestion.url}</p>
                              ) : null}
                            </div>
                          ) : null}

                          {showConsoleRow ? (
                            <div className="tgw-included-row">
                              {includeConsole && consoleEntries.length > 0 ? (
                                <div className="tgw-evidence-row-content">
                                  <span className="tgw-included-label">
                                    Console log ({consoleEntries.length} recent {consoleEntries.length === 1 ? "entry" : "entries"})
                                  </span>
                                  <div className="tgw-included-actions">
                                    <button
                                      type="button"
                                      className="tgw-text-button"
                                      onClick={() => setShowConsoleView((current) => !current)}
                                      aria-expanded={showConsoleView}
                                      aria-controls="tgw-console-view"
                                      aria-label={showConsoleView ? "Hide console log" : "View console log"}
                                    >
                                      {showConsoleView ? "Hide" : "View"}
                                    </button>
                                    <button
                                      type="button"
                                      className="tgw-text-button"
                                      onClick={() => {
                                        setIncludeConsole(false);
                                        setShowConsoleView(false);
                                      }}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              ) : consoleEntries.length > 0 ? (
                                <div className="tgw-evidence-row-content">
                                  <span className="tgw-included-hint">Console log excluded.</span>
                                  <button type="button" className="tgw-text-button" onClick={() => setIncludeConsole(true)}>
                                    Include
                                  </button>
                                </div>
                              ) : (
                                <div className="tgw-evidence-row-content">
                                  <span className="tgw-included-label">Console log</span>
                                  <span className="tgw-included-hint">No entries captured</span>
                                </div>
                              )}
                            </div>
                          ) : null}

                          {showConsoleRow && includeConsole && showConsoleView ? (
                            <div id="tgw-console-view" className="tgw-console-view">
                              {consoleEntries.map((entry, index) => (
                                <p
                                  key={index}
                                  className={`tgw-console-line${entry.level === "error" ? " tgw-console-line--error" : entry.level === "warn" ? " tgw-console-line--warn" : ""}`}
                                >
                                  [{entry.level}] {entry.message}
                                </p>
                              ))}
                            </div>
                          ) : null}

                          {showClientErrorRow ? (
                            clientError && includeClientError ? (
                              <div className="tgw-included-row">
                                <span className="tgw-included-label">
                                  Client error: {clientError?.message.slice(0, 90)}
                                </span>
                                <button
                                  type="button"
                                  className="tgw-text-button"
                                  onClick={() => setShowClientErrorView((current) => !current)}
                                  aria-expanded={showClientErrorView}
                                  aria-controls="tgw-client-error-view"
                                  aria-label={showClientErrorView ? "Hide client error" : "View client error"}
                                >
                                  {showClientErrorView ? "Hide" : "View"}
                                </button>
                                <button
                                  type="button"
                                  className="tgw-text-button"
                                  onClick={() => {
                                    setIncludeClientError(false);
                                    setShowClientErrorView(false);
                                  }}
                                >
                                  Remove
                                </button>
                              </div>
                            ) : clientError ? (
                              <div className="tgw-included-row">
                                <span className="tgw-included-hint">Client error context excluded.</span>
                                <button type="button" className="tgw-text-button" onClick={() => setIncludeClientError(true)}>
                                  Include
                                </button>
                              </div>
                            ) : (
                              <div className="tgw-included-row">
                                <span className="tgw-included-label">Client error context</span>
                                <span className="tgw-included-hint">None detected</span>
                              </div>
                            )
                          ) : null}

                          {showClientErrorRow && includeClientError && showClientErrorView ? (
                            <div id="tgw-client-error-view" className="tgw-console-view">
                              <p className="tgw-console-line tgw-console-line--error">
                                {clientError?.message}
                              </p>
                              {clientError?.source ? (
                                <p className="tgw-console-line">source: {clientError.source}</p>
                              ) : null}
                              {clientError?.stack ? (
                                <p className="tgw-console-line">{clientError.stack.slice(0, 600)}</p>
                              ) : null}
                            </div>
                          ) : null}

                          {showNetworkRow ? (
                            <div className="tgw-included-row">
                              {includeNetwork && networkEntries.length > 0 ? (
                                <span className="tgw-included-label">
                                  Network summary ({networkEntries.length} recent {networkEntries.length === 1 ? "request" : "requests"})
                                </span>
                              ) : networkEntries.length > 0 ? (
                                <span className="tgw-included-hint">Network summary excluded.</span>
                              ) : (
                                <div className="tgw-evidence-row-content">
                                  <span className="tgw-included-label">Network summary</span>
                                  <span className="tgw-included-hint">No requests captured</span>
                                </div>
                              )}
                              {networkEntries.length > 0 && includeNetwork ? (
                                <div className="tgw-included-actions">
                                  <button
                                    type="button"
                                    className="tgw-text-button"
                                    onClick={() => setShowNetworkView((current) => !current)}
                                    aria-expanded={showNetworkView}
                                    aria-controls="tgw-network-view"
                                    aria-label={showNetworkView ? "Hide network summary" : "View network summary"}
                                  >
                                    {showNetworkView ? "Hide" : "View"}
                                  </button>
                                  <button
                                    type="button"
                                    className="tgw-text-button"
                                    onClick={() => {
                                      setIncludeNetwork(false);
                                      setShowNetworkView(false);
                                    }}
                                  >
                                    Remove
                                  </button>
                                </div>
                              ) : networkEntries.length > 0 ? (
                                <button type="button" className="tgw-text-button" onClick={() => setIncludeNetwork(true)}>
                                  Include
                                </button>
                              ) : null}
                            </div>
                          ) : null}

                          {showNetworkRow && includeNetwork && showNetworkView ? (
                            <div id="tgw-network-view" className="tgw-console-view">
                              {networkEntries.map((entry, index) => (
                                <p
                                  key={`${entry.timestamp}-${index}`}
                                  className={entry.error || (entry.statusCode && entry.statusCode >= 400) ? "tgw-console-line tgw-console-line--error" : "tgw-console-line"}
                                >
                                  [{entry.method}] {entry.statusCode ?? "failed"} {entry.url} ({entry.durationMs}ms)
                                </p>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </details>

                      {hasAdvancedFields ? (
                        <div className="tgw-advanced-section">
                          <button
                            type="button"
                            className="tgw-disclosure"
                            onClick={() => setShowAdvancedFields((currentValue) => !currentValue)}
                            aria-expanded={showAdvancedFields}
                          >
                            <ChevronIcon />
                            Add detail
                          </button>

                          {showAdvancedFields ? (
                            <div className="tgw-advanced-fields">
                              {mergedConfig.fields.stepsToReproduce.enabled ? (
                                <div className="tgw-field">
                                  <label className="tgw-label" htmlFor="tgw-input-steps">
                                    {mergedConfig.fields.stepsToReproduce.label ?? "Steps to reproduce"}
                                  </label>
                                  <textarea
                                    id="tgw-input-steps"
                                    className="tgw-textarea"
                                    maxLength={4000}
                                    {...form.register("stepsToReproduce")}
                                    placeholder={mergedConfig.fields.stepsToReproduce.placeholder ?? "1. Open…\n2. Click…\n3. Observe…"}
                                  />
                                  <span className="tgw-error">{form.formState.errors.stepsToReproduce?.message}</span>
                                </div>
                              ) : null}

                              {mergedConfig.fields.expectedResult.enabled ? (
                                <div className="tgw-field">
                                  <label className="tgw-label" htmlFor="tgw-input-expected">
                                    {mergedConfig.fields.expectedResult.label ?? "Expected result"}
                                  </label>
                                  <textarea
                                    id="tgw-input-expected"
                                    className="tgw-textarea"
                                    maxLength={2000}
                                    {...form.register("expectedResult")}
                                    placeholder={mergedConfig.fields.expectedResult.placeholder ?? "What should have happened?"}
                                  />
                                  <span className="tgw-error">{form.formState.errors.expectedResult?.message}</span>
                                </div>
                              ) : null}

                              {mergedConfig.fields.actualResult.enabled ? (
                                <div className="tgw-field">
                                  <label className="tgw-label" htmlFor="tgw-input-actual">
                                    {mergedConfig.fields.actualResult.label ?? "Actual result"}
                                  </label>
                                  <textarea
                                    id="tgw-input-actual"
                                    className="tgw-textarea"
                                    maxLength={2000}
                                    {...form.register("actualResult")}
                                    placeholder={mergedConfig.fields.actualResult.placeholder ?? "What happened instead?"}
                                  />
                                  <span className="tgw-error">{form.formState.errors.actualResult?.message}</span>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {!isOnline && submissionState !== "error" ? (
                        <div className="tgw-banner tgw-banner--warning" aria-live="polite">
                          You are offline. Your report stays here until you reconnect and retry.
                        </div>
                      ) : null}

                      <div
                        ref={submissionBannerRef}
                        className={submissionMessage && submissionState === "error" ? "tgw-banner tgw-banner--error" : "tgw-live-region"}
                        role="alert"
                        aria-live="assertive"
                        aria-atomic="true"
                      >
                        {submissionMessage && submissionState === "error" ? submissionMessage : ""}
                      </div>
                    </form>

                    <div className="tgw-footer">
                      <div className="tgw-footer-meta">
                        {shortcut ? (
                          <span className="tgw-shortcut-hint">
                            <kbd>{formatShortcut(shortcut)}</kbd>
                          </span>
                        ) : null}
                      </div>
                      <div className="tgw-footer-actions">
                        <button type="button" className="tgw-button-secondary" onClick={requestClose}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="tgw-button-primary"
                          data-state={isSubmitPending ? "pending" : "idle"}
                          disabled={isSubmitPending || reporterConsentRequired}
                          onClick={form.handleSubmit(onSubmit)}
                        >
                          {isSubmitPending ? (
                            <span className="tgw-button-spinner" aria-hidden="true" />
                          ) : null}
                          {preparingFiles
                            ? "Preparing files..."
                            : isCapturePending
                            ? "Capturing..."
                            : submissionState === "submitting" || uploadingScreenshot
                              ? "Sending..."
                              : submissionFailureKind || !isOnline
                                ? "Retry"
                                : "Send report"}
                        </button>
                      </div>
                      </div>
                    </div>
                    {discardConfirmationOpen ? (
                      <div className="tgw-sheet-content tgw-discard-confirmation">
                        <div className="tgw-header tgw-discard-header">
                          <div className="tgw-title-group">
                            <h2 id="tgw-discard-title" className="tgw-title">Discard report?</h2>
                          </div>
                        </div>
                        <div className="tgw-body tgw-discard-body">
                          <p id="tgw-discard-description" className="tgw-discard-description">
                            Your report and attached evidence will be removed. This cannot be undone.
                          </p>
                        </div>
                        <div className="tgw-footer tgw-discard-footer">
                          <div className="tgw-footer-actions">
                            <button
                              type="button"
                              className="tgw-button-secondary"
                              data-tgw-discard-initial-focus
                              onClick={keepEditing}
                            >
                              Keep editing
                            </button>
                            <button type="button" className="tgw-button-danger" onClick={discardAndClose}>
                              Discard draft
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </MotionSurface>
            </div>
          )}
        </MotionSurface>
      ) : null}
      </MotionPresence>
    </div>
  );
}
