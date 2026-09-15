import { useEffect,useRef,useState } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { AlertCircle,CheckCircle2,RotateCcw } from "lucide-react";

export type MutationRecoveryEntry = {
  id: string;
  message: string;
  successMessage?: string;
  retryLabel: string;
  status: "idle" | "pending" | "error" | "success";
  submittedAt: number;
  workflowOrder?: number;
  retry: () => void;
};

type MutationRecoveryOptions<TData, TVariables> = {
  id: string;
  message: string | ((variables: TVariables | undefined) => string);
  successMessage?: string | ((data: TData | undefined, variables: TVariables | undefined) => string);
  retryLabel: string;
  retry?: (variables: TVariables) => void;
};

let nextWorkflowOrder = 0;
const workflowStateById = new Map<string, {
  status: MutationRecoveryEntry["status"];
  submittedAt: number;
  workflowOrder: number;
}>();

function workflowOrderFor(id: string, status: MutationRecoveryEntry["status"], submittedAt: number) {
  if (submittedAt <= 0) {
    return 0;
  }

  const previous = workflowStateById.get(id);
  const startedNewWorkflow = !previous
    || previous.submittedAt !== submittedAt
    || (status === "pending" && previous.status !== "pending");
  const workflowOrder = startedNewWorkflow ? ++nextWorkflowOrder : previous.workflowOrder;
  workflowStateById.set(id, { status, submittedAt, workflowOrder });
  return workflowOrder;
}

export function mutationRecoveryEntry<TData, TError, TVariables, TContext>(
  mutation: UseMutationResult<TData, TError, TVariables, TContext>,
  options: MutationRecoveryOptions<TData, TVariables>,
): MutationRecoveryEntry {
  const workflowOrder = workflowOrderFor(options.id, mutation.status, mutation.submittedAt);
  return {
    id: options.id,
    message: typeof options.message === "function" ? options.message(mutation.variables) : options.message,
    successMessage: typeof options.successMessage === "function"
      ? options.successMessage(mutation.data, mutation.variables)
      : options.successMessage,
    retryLabel: options.retryLabel,
    status: mutation.status,
    submittedAt: mutation.submittedAt,
    workflowOrder,
    retry: () => {
      if (!mutation.isPending) {
        const variables = mutation.variables as TVariables;
        if (options.retry) {
          options.retry(variables);
        } else {
          mutation.mutate(variables);
        }
      }
    },
  };
}

export function latestMutationRecoveryEntry(entries: MutationRecoveryEntry[]) {
  return entries
    .filter((entry) => entry.submittedAt > 0)
    .reduce<MutationRecoveryEntry | null>((latest, entry) => (
      latest === null
        || (entry.workflowOrder ?? entry.submittedAt) >= (latest.workflowOrder ?? latest.submittedAt)
        ? entry
        : latest
    ), null);
}

export function MutationRecovery({
  entries,
  id = "mutation-recovery",
}: {
  entries: MutationRecoveryEntry[];
  id?: string;
}) {
  const latest = latestMutationRecoveryEntry(entries);
  const retryingIdRef = useRef<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  useEffect(() => {
    if (latest?.status !== "error") {
      retryingIdRef.current = null;
      setRetryingId(null);
    }
  }, [latest?.id, latest?.status, latest?.submittedAt]);

  if (!latest || latest.status === "idle" || latest.status === "pending") {
    return null;
  }

  if (latest.status === "success") {
    if (!latest.successMessage) {
      return null;
    }
    return (
      <section
        id={id}
        className="flex items-start gap-2.5 rounded-lg border border-success-200 bg-success-50 px-4 py-3"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-700" aria-hidden="true" />
        <p className="text-label font-semibold text-success-700">{latest.successMessage}</p>
      </section>
    );
  }

  const isRetrying = retryingId === latest.id;

  return (
    <section
      id={id}
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger-700" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-label font-semibold text-danger-700">{latest.message}</p>
          <p className="mt-0.5 text-caption text-danger-700">Your previous input is unchanged.</p>
        </div>
      </div>
      <button
        type="button"
        className="tg-action-button inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-danger-200 bg-surface px-3 text-label font-semibold text-danger-700 hover:bg-danger-50 focus-visible:outline-2 focus-visible:outline-danger-700"
        disabled={isRetrying}
        onClick={() => {
          if (retryingIdRef.current !== null) {
            return;
          }
          retryingIdRef.current = latest.id;
          setRetryingId(latest.id);
          latest.retry();
        }}
      >
        <RotateCcw className="size-4" aria-hidden="true" />
        {isRetrying ? "Retrying..." : latest.retryLabel}
      </button>
    </section>
  );
}
