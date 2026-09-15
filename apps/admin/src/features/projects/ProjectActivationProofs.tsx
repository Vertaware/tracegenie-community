import type { ProjectActivationProofStatus,ProjectInstallDiagnosticsResponse } from "@tracegenie/shared";
import { CheckCircle2,CircleAlert,CircleDashed,Clock3,Settings2,ShieldQuestion } from "lucide-react";
import { Link } from "react-router-dom";

const STATUS_META: Record<ProjectActivationProofStatus, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  verified: { label: "Verified", className: "border-success/25 bg-success-50 text-success-700", icon: CheckCircle2 },
  configured: { label: "Configured", className: "border-primary/25 bg-primary-50 text-primary", icon: Settings2 },
  missing: { label: "Missing proof", className: "border-warning/25 bg-warning-50 text-warning-700", icon: CircleDashed },
  failed: { label: "Action required", className: "border-danger/25 bg-danger-50 text-danger-700", icon: CircleAlert },
  stale: { label: "Stale proof", className: "border-warning/25 bg-warning-50 text-warning-700", icon: Clock3 },
  manual: { label: "Manual review", className: "border-border/45 bg-surface-muted text-foreground", icon: ShieldQuestion },
};

function formatEvidenceAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function activationSummary(status: ProjectInstallDiagnosticsResponse["status"]) {
  if (status === "ready") return "All six activation paths have verified proof.";
  if (status === "action_required") return "Activation is blocked until failed delivery or privacy requirements are repaired.";
  return "Setup exists, but one or more paths still need proof or review.";
}

export function ProjectActivationProofs({ diagnostics, id = "project-activation-proof-list" }: {
  diagnostics: ProjectInstallDiagnosticsResponse;
  id?: string;
}) {
  return (
    <ol id={id} className="divide-y divide-border/25">
      {diagnostics.proofs.map((proof) => {
        const meta = STATUS_META[proof.status];
        const Icon = meta.icon;
        const evidenceAt = formatEvidenceAt(proof.evidenceAt);
        const scheduledDeletionAt = formatEvidenceAt(proof.scheduledDeletionAt);
        return (
          <li id={`${id}-${proof.id}`} key={proof.id} data-proof-status={proof.status} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="flex min-w-0 items-start gap-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-label font-semibold text-foreground">{proof.label}</p>
                <p className="mt-1 text-caption leading-relaxed text-muted">{proof.detail}</p>
                {evidenceAt ? <p className="mt-1 text-caption text-foreground">Evidence {evidenceAt}</p> : null}
                {scheduledDeletionAt ? (
                  <p className="mt-1 text-caption font-medium text-foreground">Deletes {scheduledDeletionAt}</p>
                ) : proof.id === "first_report" || proof.id === "attachment" ? (
                  <p className="mt-1 text-caption font-medium text-warning-700">Deletion date not scheduled</p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-caption font-semibold ${meta.className}`}>
                {meta.label}
              </span>
              {proof.action ? (
                <Link className="inline-flex min-h-9 items-center rounded-md border border-border/45 px-3 text-caption font-semibold text-foreground hover:bg-surface-muted/55 focus-visible:outline-2 focus-visible:outline-primary" to={proof.action.href}>
                  {proof.action.label}
                </Link>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
