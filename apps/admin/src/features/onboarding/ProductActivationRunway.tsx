import type { ProjectInstallDiagnosticsResponse,ProjectSummary } from "@tracegenie/shared";
import { AlertTriangle,Check,CheckCircle2,ChevronRight,Clock3 } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "../../components/ui/Button";
import type { AdminUserSummary,AdminUsersResponse } from "../../lib/api";
import { productCaptureReadiness } from "./productActivation";

export const ACTIVATION_STEP_LABELS = [
  "Create product",
  "Install",
  "Verify capture",
] as const;

const CORE_STEP_IDS = ["product", "install", "capture"] as const;
const CORE_STEP_COUNT = CORE_STEP_IDS.length;

type ActivationStepId = "product" | "install" | "capture" | "privacy" | "invite";
type ActivationStep = {
  id: ActivationStepId;
  label: string;
  title: string;
  reason: string;
  complete: boolean;
  evidenceAt: string | Date | null;
  action: { label: string; href: string } | null;
  blockers?: Array<{ label: string; detail: string }>;
  blocked?: boolean;
  permissionDenied?: boolean;
};

type ProductActivationRunwayProps = {
  project: Pick<ProjectSummary, "key" | "name" | "createdAt" | "updatedAt"> | null;
  diagnostics: ProjectInstallDiagnosticsResponse | null;
  team: AdminUsersResponse | null;
  actor: AdminUserSummary | null;
  isLoading?: boolean;
  isError?: boolean;
  isTeamLoading?: boolean;
  isTeamError?: boolean;
  issueCount?: number;
  onRetry?: () => void;
};

function proof(
  diagnostics: ProjectInstallDiagnosticsResponse | null,
  id: ProjectInstallDiagnosticsResponse["proofs"][number]["id"],
) {
  return diagnostics?.proofs.find((item) => item.id === id) ?? null;
}

function latestTimestamp(values: Array<string | Date | null | undefined>) {
  const valid = values
    .map((value) => value ? new Date(value) : null)
    .filter((value): value is Date => Boolean(value && !Number.isNaN(value.getTime())));
  if (valid.length === 0) return null;
  return new Date(Math.max(...valid.map((value) => value.getTime())));
}

function formatProofTime(value: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function currentInstallProof(
  origin: ReturnType<typeof proof>,
  session: ReturnType<typeof proof>,
) {
  return [origin, session].find((item) => item?.status === "failed" || item?.status === "stale")
    ?? [origin, session].find((item) => item?.status !== "configured" && item?.status !== "verified")
    ?? null;
}

function firstAction(...proofs: Array<ReturnType<typeof proof>>) {
  return proofs.find((item) => item?.status !== "verified" && item?.action)?.action ?? null;
}

function buildSteps(
  project: ProductActivationRunwayProps["project"],
  diagnostics: ProjectInstallDiagnosticsResponse | null,
  team: AdminUsersResponse | null,
  actor: AdminUserSummary | null,
  isTeamLoading: boolean,
  isTeamError: boolean,
): ActivationStep[] {
  const origin = proof(diagnostics, "origin");
  const session = proof(diagnostics, "session");
  const report = proof(diagnostics, "first_report");
  const attachment = proof(diagnostics, "attachment");
  const readiness = productCaptureReadiness(diagnostics);
  const installComplete = Boolean(project) && readiness.installed;
  const captureComplete = Boolean(project) && readiness.captured;
  const evidenceConfigured = attachment?.status === "verified" || attachment?.status === "manual";
  const privacyComplete = Boolean(diagnostics?.privacyReadiness.status === "ready" && evidenceConfigured);
  const collaborator = team?.data.find((member) => (
    member.id !== actor?.id
    && member.isActive
    && member.organizationMembershipStatus === "ACTIVE"
    && (
      member.effectiveAccess.allProjects
      || member.projectMemberships.some((membership) => (
        membership.project.key === project?.key
        && membership.status === "ACTIVE"
        && membership.capabilities.canViewProject
      ))
    )
  )) ?? null;
  const inviteComplete = Boolean(collaborator);
  const installBlocked = [origin, session].some((item) => item?.status === "failed" || item?.status === "stale");
  const captureBlocked = report?.status === "failed";
  const privacyBlockers = diagnostics?.privacyReadiness.blockers ?? [];
  const privacyBlocked = privacyBlockers.length > 0 || attachment?.status === "failed";
  const canInvite = Boolean(actor?.effectiveAccess.capabilities.canInviteMembers);
  const installCurrentProof = currentInstallProof(origin, session);

  return [
    {
      id: "product",
      label: "Create product",
      title: "Create product",
      reason: "Name the application that will send feedback to TraceGenie.",
      complete: Boolean(project),
      evidenceAt: project?.createdAt ?? null,
      action: null,
    },
    {
      id: "install",
      label: "Install",
      title: installBlocked ? "Repair installation" : "Complete installation",
      reason: installCurrentProof?.detail ?? "The browser origin and server session are configured.",
      complete: installComplete,
      evidenceAt: installComplete ? latestTimestamp([origin?.evidenceAt, session?.evidenceAt]) : null,
      action: installCurrentProof?.action ?? null,
      blocked: installBlocked,
    },
    {
      id: "capture",
      label: "Verify capture",
      title: captureBlocked ? "Repair capture" : "Verify capture",
      reason: report?.detail ?? "Send one real report to prove the intake path.",
      complete: captureComplete,
      evidenceAt: captureComplete ? report?.evidenceAt ?? null : null,
      action: firstAction(report),
      blocked: captureBlocked,
    },
    {
      id: "privacy",
      label: "Evidence & privacy",
      title: "Configure evidence & privacy",
      reason: privacyBlockers.length > 0
        ? "Resolve the saved privacy requirements before production activation."
        : attachment?.status !== "verified" && attachment?.status !== "manual"
          ? attachment?.detail ?? "Confirm the evidence capture policy."
          : "The evidence policy, retention, redaction, and AI access defaults are saved.",
      complete: privacyComplete,
      evidenceAt: privacyComplete ? attachment?.evidenceAt ?? null : null,
      action: privacyBlockers.length > 0
        ? {
            label: "Review privacy",
            href: `/projects/${encodeURIComponent(project?.key ?? "")}/settings/privacy#project-privacy-readiness`,
          }
        : firstAction(attachment),
      blockers: privacyBlockers,
      blocked: privacyBlocked,
    },
    {
      id: "invite",
      label: "Invite",
      title: "Invite collaborators",
      reason: collaborator
        ? `${collaborator.name || collaborator.email} has active organization access.`
        : isTeamLoading
          ? "Checking saved organization membership."
          : isTeamError
            ? "Saved collaborators could not be loaded. Retry before inviting anyone."
            : canInvite
              ? "Invite the first teammate who will triage and resolve incoming reports."
              : "Ask an organization owner or admin to invite a collaborator.",
      complete: inviteComplete,
      evidenceAt: null,
      action: !collaborator && !isTeamLoading && !isTeamError && canInvite
        ? { label: "Invite collaborator", href: "/users/new" }
        : null,
      blocked: isTeamError,
      permissionDenied: !collaborator && !isTeamLoading && !isTeamError && Boolean(actor) && !canInvite,
    },
  ];
}

export function ProductActivationRunway({
  project,
  diagnostics,
  team,
  actor,
  isLoading = false,
  isError = false,
  isTeamLoading = false,
  isTeamError = false,
  issueCount = 0,
  onRetry,
}: ProductActivationRunwayProps) {
  const steps = buildSteps(project, diagnostics, team, actor, isTeamLoading, isTeamError);
  const coreSteps = steps.filter((step) => (CORE_STEP_IDS as readonly string[]).includes(step.id));
  const optionalSteps = steps.filter((step) => step.id === "privacy" || step.id === "invite");
  const currentIndex = coreSteps.findIndex((step) => !step.complete);
  const coreComplete = currentIndex === -1;
  const currentStep = coreComplete ? null : coreSteps[currentIndex];
  const completedSteps = currentIndex < 0 ? coreSteps : coreSteps.slice(0, currentIndex).filter((step) => step.complete);
  const upcomingSteps = currentIndex < 0 ? [] : coreSteps.slice(currentIndex + 1);
  const progressValue = coreComplete ? CORE_STEP_COUNT : Math.max(0, currentIndex);
  const pendingOptional = optionalSteps.filter((step) => !step.complete);
  const issuesUrl = project ? `/issues?projectKey=${encodeURIComponent(project.key)}` : "/issues";

  if (coreComplete && project) {
    const completedAt = latestTimestamp(coreSteps.map((step) => step.evidenceAt));
    const refreshUnavailable = isError;
    return (
      <section
        id="product-activation-status-strip"
        className="border-y border-border/35 bg-surface-muted/20"
        aria-label="Product activation"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {refreshUnavailable ? (
              <AlertTriangle className="size-5 shrink-0 text-warning-700" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="size-5 shrink-0 text-success-700" aria-hidden="true" />
            )}
            <div className="min-w-0">
              <p className="text-label font-semibold text-foreground">
                {refreshUnavailable ? "Saved activation complete" : "Activation complete"}
              </p>
              <p className="text-caption text-muted">
                {refreshUnavailable
                  ? "Last saved evidence completes capture, but current status could not be refreshed."
                  : "Capture is verified from saved server evidence."}
                {!refreshUnavailable && formatProofTime(completedAt) ? ` Latest timestamped proof: ${formatProofTime(completedAt)}.` : ""}
              </p>
            </div>
          </div>
          {refreshUnavailable && onRetry ? (
            <Button className="min-h-11" tone="secondary" onClick={onRetry}>
              Retry activation status
            </Button>
          ) : (
            <Link className="tg-inline-link min-h-11 content-center text-label font-semibold" to={issuesUrl}>
              Open issues
            </Link>
          )}
        </div>
        {pendingOptional.length > 0 ? (
          <div id="product-activation-optional" className="border-t border-border/25 px-4 py-4 sm:px-5">
            <h3 id="product-activation-optional-title" className="text-caption font-semibold text-muted">
              Optional after capture
            </h3>
            <ul className="mt-3 space-y-4">
              {pendingOptional.map((step) => (
                <li key={step.id} id={`product-activation-optional-${step.id}`}>
                  <h4 className="text-title text-foreground">
                    {step.title}
                  </h4>
                  <p className="mt-1 max-w-3xl text-label leading-relaxed text-muted">
                    {step.reason}
                  </p>
                  {step.permissionDenied ? (
                    <p className="mt-2 text-caption font-semibold text-warning-700">
                      Permission required
                    </p>
                  ) : null}
                  {step.blockers && step.blockers.length > 0 ? (
                    <ul className="mt-2 space-y-1.5 text-caption text-foreground">
                      {step.blockers.map((blocker) => (
                        <li key={blocker.label}>
                          <strong>
                            {blocker.label}:
                          </strong>
                          {" "}
                          {blocker.detail}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {step.action ? (
                    <Link
                      className="tg-inline-link mt-3 inline-flex min-h-11 items-center text-label font-semibold"
                      to={step.action.href}
                    >
                      {step.action.label}
                    </Link>
                  ) : step.id === "invite" && isTeamError && onRetry ? (
                    <Button className="mt-3 min-h-11" tone="secondary" onClick={onRetry}>
                      Retry collaborators
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section id="product-activation-runway" className="border-y border-border/40 bg-surface" aria-labelledby="product-activation-runway-title">
      <header id="product-activation-runway-header" className="px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <p className="text-caption font-semibold text-muted">
            Activation runway
          </p>
          <h2 id="product-activation-runway-title" className="mt-1 text-title text-foreground">
            {project ? `${progressValue} of 3 complete` : "Step 1 of 3"}
          </h2>
        </div>
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-border/45"
          role="progressbar"
          aria-label="Activation progress"
          aria-valuemin={0}
          aria-valuemax={3}
          aria-valuenow={progressValue}
        >
          <span className="block h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${(progressValue / CORE_STEP_COUNT) * 100}%` }} />
        </div>
        <ol id="product-activation-step-track" className="mt-3 flex min-w-0 gap-4 overflow-x-auto pb-1" aria-label="Activation steps">
          {coreSteps.map((step, index) => (
            <li
              key={step.id}
              data-testid="activation-runway-step"
              aria-current={index === currentIndex ? "step" : undefined}
              className={`flex shrink-0 items-center gap-1.5 text-caption ${step.complete ? "text-success-700" : index === currentIndex ? "font-semibold text-foreground" : "text-muted"}`}
            >
              {step.complete ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <span className="tabular-nums" aria-hidden="true">
                  {index + 1}.
                </span>
              )}
              {step.label}
            </li>
          ))}
        </ol>
      </header>

      {isLoading && !diagnostics && project ? (
        <div id="product-activation-loading" className="border-t border-border/25 px-4 py-6 text-label text-muted sm:px-5" role="status">
          Loading saved activation evidence...
        </div>
      ) : isError && !diagnostics && project ? (
        <div id="product-activation-error" className="flex flex-wrap items-center justify-between gap-3 border-t border-border/25 px-4 py-5 sm:px-5" role="alert">
          <p className="text-label text-danger-700">
            Saved activation evidence could not be loaded. Product settings were not changed.
          </p>
          {onRetry ? (
            <Button className="min-h-11" tone="secondary" onClick={onRetry}>
              Retry evidence
            </Button>
          ) : null}
        </div>
      ) : currentStep ? (
        <div id="product-activation-current-and-proof" className="border-t border-border/25">
          <article id={`product-activation-current-${currentStep.id}`} className="px-4 py-5 sm:px-5" aria-labelledby="product-activation-current-title">
            <div className="flex items-start gap-3">
              {currentStep.blocked || currentStep.permissionDenied ? (
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning-700" aria-hidden="true" />
              ) : (
                <Clock3 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-caption font-semibold text-primary">
                  Step {currentIndex + 1} of 3
                </p>
                <h3 id="product-activation-current-title" className="mt-1 text-title text-foreground">
                  {currentStep.title}
                </h3>
                <p className="mt-1 max-w-3xl text-label leading-relaxed text-muted">
                  {currentStep.reason}
                </p>
                {currentStep.permissionDenied ? (
                  <p className="mt-3 text-caption font-semibold text-warning-700">
                    Permission required
                  </p>
                ) : null}
                {currentStep.blockers && currentStep.blockers.length > 0 ? (
                  <ul id="product-activation-current-blockers" className="mt-3 space-y-1.5 text-caption text-foreground">
                    {currentStep.blockers.map((blocker) => (
                      <li key={blocker.label}>
                        <strong>{blocker.label}:</strong> {blocker.detail}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {currentStep.action ? (
                  <Link
                    id="product-activation-primary-action"
                    className="tg-action-button mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-label font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    data-tg-primary-target="true"
                    to={currentStep.action.href}
                  >
                    {currentStep.action.label}
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Link>
                ) : currentStep.id === "invite" && isTeamError && onRetry ? (
                  <Button className="mt-4 min-h-11" tone="secondary" onClick={onRetry}>
                    Retry collaborators
                  </Button>
                ) : null}
              </div>
            </div>
          </article>

          {project ? (
            <div id="product-activation-secondary-read" className="grid border-t border-border/25 lg:grid-cols-2">
              <section id="product-activation-completed-proof" className="px-4 py-4 sm:px-5" aria-labelledby="product-activation-completed-title">
                <h4 id="product-activation-completed-title" className="text-caption font-semibold text-muted">
                  Completed proof
                </h4>
                {completedSteps.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {completedSteps.map((step) => (
                      <li key={step.id} className="flex items-start gap-2 text-caption">
                        <Check className="mt-0.5 size-4 shrink-0 text-success-700" aria-hidden="true" />
                        <span className="text-foreground">
                          <strong>
                            {step.label}
                          </strong>
                          {formatProofTime(step.evidenceAt) ? (
                            <span className="text-muted">
                              {" · "}
                              {formatProofTime(step.evidenceAt)}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-caption text-muted">
                    The first saved proof will appear here.
                  </p>
                )}
              </section>
              {upcomingSteps.length > 0 ? (
                <section id="product-activation-upcoming" className="border-t border-border/25 px-4 py-4 sm:px-5 lg:border-l lg:border-t-0" aria-labelledby="product-activation-upcoming-title">
                  <h4 id="product-activation-upcoming-title" className="text-caption font-semibold text-muted">
                    Next
                  </h4>
                  <ol className="mt-3 space-y-2">
                    {upcomingSteps.map((step) => (
                      <li key={step.id} className="flex items-center gap-2 text-caption text-muted">
                        <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                        {step.title}
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}
            </div>
          ) : null}

          {diagnostics ? (
            <details id="product-activation-advanced-diagnostics" className="border-t border-border/25 px-4 py-3 sm:px-5">
              <summary className="min-h-11 cursor-pointer content-center text-caption font-semibold text-muted focus-visible:outline-2 focus-visible:outline-primary">
                Advanced diagnostics
              </summary>
              {isError ? (
                <p className="mb-3 text-caption text-warning-700" role="status">
                  Showing the last saved proof while refresh is unavailable.
                </p>
              ) : null}
              <ul className="grid gap-2 pb-3 sm:grid-cols-2">
                {diagnostics.proofs.map((item) => (
                  <li key={item.id} className="border-l-2 border-border pl-3 text-caption">
                    <p className="font-semibold text-foreground">
                      {item.label} · {item.status.replace("_", " ")}
                    </p>
                    <p className="mt-0.5 leading-relaxed text-muted">
                      {item.detail}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="pb-2 text-caption text-muted">
                Open issues: {issueCount}. Checked {formatProofTime(diagnostics.checkedAt) ?? "time unavailable"}.
              </p>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
