import { MotionNumber } from "@tracegenie/shared/motion";
import { useCallback,useEffect,useMemo,useRef,useState,type PropsWithChildren } from "react";
import { useNavigate,useSearchParams } from "react-router-dom";
import { AlertTriangle,CheckCircle2,ChevronDown,Download,Filter,Inbox,LockKeyhole,RotateCcw,Search,Trash2,Undo2 } from "lucide-react";
import {
FEEDBACK_STATUSES,
FEEDBACK_STATUS_TRANSITIONS,
FEEDBACK_LABELS,
ISSUE_TYPES,
ISSUE_TYPE_META,
SEVERITY_LEVELS,
SEVERITY_META,
STATUS_META,
type FeedbackListItem,
type FeedbackStatus,
type SavedIssueViewFilters,
type SavedIssueViewSummary,
type SeverityLevel,
} from "@tracegenie/shared";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Textarea } from "../../components/ui/Input";
import {
FilterDate,
FilterReset,
FilterSearch,
FilterSelect,
HeaderFilterMenu,
ListEmptyState,
ListErrorState,
ListLoadingState,
ListStaleState,
RowButton,
Table,
TableSelectionHeader,
TableShell,
Td,
Th,
tableColumnClass,
} from "../../components/ui/DataTable";
import { Pagination } from "../../components/ui/Pagination";
import { SeverityIndicator } from "../../components/ui/SeverityIndicator";
import { StatusChip } from "../../components/ui/StatusChip";
import { useToast,ToastContainer } from "../../components/ui/Toast";
import { api,ApiError } from "../../lib/api";
import { copy } from "../../lib/copy";
import { exportIssuesToCSV } from "../../lib/export-issues";
import { formatFullDate,formatRelativeDate } from "../../lib/formatRelativeDate";
import { classifyAdminQueryState } from "../../lib/queryState";
import { cn } from "../../lib/utils";

const ATTENTION_FILTERS: Array<{ value: NonNullable<SavedIssueViewFilters["attention"]>; label: string }> = [
  { value: "waiting_on_customer", label: "Waiting on reporter" },
  { value: "weak_evidence", label: "Weak evidence" },
  { value: "high_impact_repeats", label: "High-impact repeats" },
  { value: "stale", label: "Stale tickets" },
  { value: "stuck_lifecycle", label: "Stuck lifecycle" },
];

const PAGE_SIZE = 20;
const BULK_STATUS_OPTIONS = FEEDBACK_STATUSES.filter((status) => status !== "duplicate");
const RELEASE_FILTER_KEYS = ["releaseId", "appEnvironment", "appVersion", "buildNumber", "releaseChannel"] as const;

type IssueSortKey = "reported" | "severity";
type IssueSortDir = "asc" | "desc";
type IssueLabel = (typeof FEEDBACK_LABELS)[number];

function buildSearchParams(searchParams: URLSearchParams) {
  const params = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (value) params.set(key, value);
  }
  if (!params.has("page")) params.set("page", "1");
  if (!params.has("pageSize")) params.set("pageSize", String(PAGE_SIZE));
  return params;
}

const FILTER_KEYS = [
  "query",
  "projectKey",
  ...RELEASE_FILTER_KEYS,
  "status",
  "severity",
  "issueType",
  "ownerId",
  "requesterIdentity",
  "labels",
  "accountId",
  "accountName",
  "planName",
  "planTier",
  "customerSegment",
  "customerCohort",
  "trackedEventName",
  "attention",
  "releaseRegression",
  "fromDate",
  "toDate",
] as const;
const SAVED_VIEW_KEYS = [...FILTER_KEYS, "sortBy", "sortDir"] as const satisfies readonly (keyof SavedIssueViewFilters)[];

export function applySavedViewFilters(searchParams: URLSearchParams, filters: SavedIssueViewFilters) {
  const next = new URLSearchParams(searchParams);
  for (const key of SAVED_VIEW_KEYS) {
    next.delete(key);
    const value = filters[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item) next.append(key, item);
      }
    } else if (typeof value === "boolean") {
      if (value) next.set(key, "true");
    } else if (value) {
      next.set(key, value);
    }
  }
  next.set("page", "1");
  return next;
}

function selectedLabels(searchParams: URLSearchParams): IssueLabel[] {
  return searchParams
    .getAll("labels")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value): value is IssueLabel => FEEDBACK_LABELS.includes(value as IssueLabel));
}

type IssueFiltersProps = {
  searchParams: URLSearchParams;
  projects: Array<{ key: string; name: string }>;
  ownerOptions: Array<{ id: string; name: string }>;
  hasActiveFilters: boolean;
  showReset: boolean;
  resetLabel: string;
  updateSearch: (key: string, value: string) => void;
  updateSort: (sortKey: IssueSortKey, sortDir: IssueSortDir) => void;
  clearFilters: () => void;
  className?: string;
};

/* URL-backed search input that commits after a typing pause so each keystroke
   does not refetch the list and churn the browser history. */
function DebouncedFilterSearch({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const committedRef = useRef(value);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    if (value !== committedRef.current) {
      committedRef.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    if (draft === committedRef.current) return;
    const timer = window.setTimeout(() => {
      committedRef.current = draft;
      onCommitRef.current(draft);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft]);

  return (
    <FilterSearch
      ariaLabel="Search issues"
      value={draft}
      onChange={setDraft}
      placeholder="Search title, URL, ticket #"
    />
  );
}

function FilterCluster({ id, legend, children, className }: PropsWithChildren<{ id: string; legend: string; className?: string }>) {
  return (
    <fieldset id={id} className={cn("min-w-0", className)}>
      <legend className="mb-1.5 text-caption font-medium text-muted">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {children}
      </div>
    </fieldset>
  );
}

function IssueFilters({
  searchParams,
  projects,
  ownerOptions,
  hasActiveFilters,
  showReset,
  resetLabel,
  updateSearch,
  updateSort,
  clearFilters,
  className,
}: IssueFiltersProps) {
  const additionalFilterCount = [
    searchParams.get("labels"),
    searchParams.get("releaseRegression"),
    searchParams.get("issueType"),
    searchParams.get("attention"),
    searchParams.get("requesterIdentity"),
    searchParams.get("ownerId"),
    searchParams.get("fromDate") || searchParams.get("toDate"),
  ].filter(Boolean).length;

  return (
    <section
      id="issue-filters"
      data-header-filter-root="true"
      className={cn("tg-panel tg-panel-reveal p-3 [&_button]:min-h-10 [&_input]:min-h-10 [&_select]:min-h-10 sm:[&_button]:min-h-9 sm:[&_input]:min-h-9 sm:[&_select]:min-h-9", className)}
    >
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(15rem,1.35fr)_repeat(3,minmax(0,1fr))]">
        <DebouncedFilterSearch
          value={searchParams.get("query") ?? ""}
          onCommit={(value) => updateSearch("query", value)}
        />
        
        <FilterSelect
          ariaLabel="Filter by status"
          value={searchParams.get("status") ?? ""}
          onChange={(value) => updateSearch("status", value)}
        >
          <option value="">All statuses</option>
          {FEEDBACK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_META[status as FeedbackStatus].label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          ariaLabel="Filter by severity"
          value={searchParams.get("severity") ?? ""}
          onChange={(value) => updateSearch("severity", value)}
        >
          <option value="">All severities</option>
          {SEVERITY_LEVELS.map((severity) => (
            <option key={severity} value={severity}>
              {SEVERITY_META[severity as SeverityLevel].label}
            </option>
          ))}
        </FilterSelect>
      </div>

      <div id="issue-filters-footer" className="mt-2 flex flex-wrap items-start gap-2 border-t border-border/25 pt-2">
        <details className="group min-w-0 flex-1" open={additionalFilterCount > 0 || undefined}>
          <summary className="tg-action-button inline-flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 text-caption font-semibold text-muted hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
            <span>More filters</span>
            {additionalFilterCount > 0 ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary-light px-1.5 py-0.5 tabular-nums text-primary">
                {additionalFilterCount}
              </span>
            ) : null}
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-3 grid gap-3 border-t border-border/25 pt-3 xl:grid-cols-2">
            <FilterCluster id="issue-filters-details" legend="Issue details" className="[&>div]:xl:grid-cols-2">
              <FilterSelect
                ariaLabel="Filter by label"
                value={searchParams.get("labels") ?? ""}
                onChange={(value) => updateSearch("labels", value)}
              >
                <option value="">All labels</option>
                {FEEDBACK_LABELS.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                ariaLabel="Filter by release regression"
                value={searchParams.get("releaseRegression") === "true" ? "true" : ""}
                onChange={(value) => updateSearch("releaseRegression", value)}
              >
                <option value="">All release signals</option>
                <option value="true">{copy.issues.releaseRegressionFilter}</option>
              </FilterSelect>
              <FilterSelect
                ariaLabel="Filter by type"
                value={searchParams.get("issueType") ?? ""}
                onChange={(value) => updateSearch("issueType", value)}
              >
                <option value="">All types</option>
                {ISSUE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ISSUE_TYPE_META[type].label}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                ariaLabel={copy.issues.attentionFilterLabel}
                value={searchParams.get("attention") ?? ""}
                onChange={(value) => updateSearch("attention", value)}
              >
                <option value="">{copy.issues.allAttention}</option>
                {ATTENTION_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </FilterSelect>
            </FilterCluster>

            <FilterCluster id="issue-filters-people-time" legend="People and dates" className="[&>div]:xl:grid-cols-2">
              <FilterSelect
                ariaLabel="Filter by reporter"
                value={searchParams.get("requesterIdentity") ?? ""}
                onChange={(value) => updateSearch("requesterIdentity", value)}
              >
                <option value="">All reporters</option>
                <option value="identified">Identified</option>
                <option value="anonymous">Anonymous</option>
              </FilterSelect>
              <FilterSelect
                ariaLabel="Filter by assignee"
                value={searchParams.get("ownerId") ?? ""}
                onChange={(value) => updateSearch("ownerId", value)}
              >
                <option value="">All assignees</option>
                {ownerOptions.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </FilterSelect>
              <DateFilterField
                label="From"
                ariaLabel="Reported from date"
                value={searchParams.get("fromDate") ?? ""}
                onChange={(value) => updateSearch("fromDate", value)}
              />
              <DateFilterField
                label="To"
                ariaLabel="Reported to date"
                value={searchParams.get("toDate") ?? ""}
                onChange={(value) => updateSearch("toDate", value)}
              />
            </FilterCluster>
          </div>
        </details>

        <div className="w-full sm:w-48">
          <FilterSelect
            ariaLabel="Sort issues"
            value={`${searchParams.get("sortBy") === "severity" ? "severity" : "reported"}:${searchParams.get("sortDir") === "asc" ? "asc" : "desc"}`}
            onChange={(value) => {
              const [sortKey, sortDir] = value.split(":") as [IssueSortKey, IssueSortDir];
              updateSort(sortKey, sortDir);
            }}
          >
            <option value="reported:desc">Newest reported</option>
            <option value="reported:asc">Oldest reported</option>
            <option value="severity:desc">Highest severity</option>
            <option value="severity:asc">Lowest severity</option>
          </FilterSelect>
        </div>
        <FilterReset show={showReset && hasActiveFilters} onReset={clearFilters} label={resetLabel} />
      </div>
    </section>
  );
}

function DateFilterField({
  label,
  ariaLabel,
  value,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-caption text-muted/75">{label}</span>
      <FilterDate ariaLabel={ariaLabel} value={value} onChange={onChange} />
    </label>
  );
}

const COLUMN_FILTER_KEYS = {
  issue: ["query", "labels", "issueType", "requesterIdentity", "releaseRegression"],
  severity: ["severity"],
  owner: ["ownerId"],
  status: ["status"],
  followup: ["attention", "fromDate", "toDate"],
} as const;

type IssueFilterColumn = keyof typeof COLUMN_FILTER_KEYS;

function IssueColumnFilterFields({
  column,
  searchParams,
  ownerOptions,
  updateSearch,
  updateSort,
  clearColumn,
}: Pick<IssueFiltersProps, "searchParams" | "ownerOptions" | "updateSearch" | "updateSort"> & {
  column: IssueFilterColumn;
  clearColumn: () => void;
}) {
  const active = COLUMN_FILTER_KEYS[column].some((key) => Boolean(searchParams.get(key)));
  return (
    <div className="grid gap-3">
      {column === "issue" ? (
        <div className="grid gap-2">
          <DebouncedFilterSearch
            value={searchParams.get("query") ?? ""}
            onCommit={(value) => updateSearch("query", value)}
          />
          <FilterSelect ariaLabel="Filter by type" value={searchParams.get("issueType") ?? ""} onChange={(value) => updateSearch("issueType", value)}>
            <option value="">All types</option>
            {ISSUE_TYPES.map((type) => (
              <option key={type} value={type}>{ISSUE_TYPE_META[type].label}</option>
            ))}
          </FilterSelect>
          <FilterSelect ariaLabel="Filter by label" value={searchParams.get("labels") ?? ""} onChange={(value) => updateSearch("labels", value)}>
            <option value="">All labels</option>
            {FEEDBACK_LABELS.map((label) => (
              <option key={label} value={label}>{label}</option>
            ))}
          </FilterSelect>
          <FilterSelect ariaLabel="Filter by reporter" value={searchParams.get("requesterIdentity") ?? ""} onChange={(value) => updateSearch("requesterIdentity", value)}>
            <option value="">All reporters</option>
            <option value="identified">Identified</option>
            <option value="anonymous">Anonymous</option>
          </FilterSelect>
          <FilterSelect ariaLabel="Filter by release regression" value={searchParams.get("releaseRegression") === "true" ? "true" : ""} onChange={(value) => updateSearch("releaseRegression", value)}>
            <option value="">All release signals</option>
            <option value="true">{copy.issues.releaseRegressionFilter}</option>
          </FilterSelect>
        </div>
      ) : null}
      {column === "severity" ? (
        <FilterSelect ariaLabel="Filter by severity" value={searchParams.get("severity") ?? ""} onChange={(value) => updateSearch("severity", value)}>
          <option value="">All severities</option>
          {SEVERITY_LEVELS.map((severity) => (
            <option key={severity} value={severity}>{SEVERITY_META[severity].label}</option>
          ))}
        </FilterSelect>
      ) : null}
      {column === "owner" ? (
        <FilterSelect ariaLabel="Filter by assignee" value={searchParams.get("ownerId") ?? ""} onChange={(value) => updateSearch("ownerId", value)}>
          <option value="">All assignees</option>
          {ownerOptions.map((owner) => (
            <option key={owner.id} value={owner.id}>{owner.name}</option>
          ))}
        </FilterSelect>
      ) : null}
      {column === "status" ? (
        <FilterSelect ariaLabel="Filter by status" value={searchParams.get("status") ?? ""} onChange={(value) => updateSearch("status", value)}>
          <option value="">All statuses</option>
          {FEEDBACK_STATUSES.map((status) => (
            <option key={status} value={status}>{STATUS_META[status].label}</option>
          ))}
        </FilterSelect>
      ) : null}
      {column === "followup" ? (
        <div className="grid gap-2">
          <FilterSelect ariaLabel={copy.issues.attentionFilterLabel} value={searchParams.get("attention") ?? ""} onChange={(value) => updateSearch("attention", value)}>
            <option value="">{copy.issues.allAttention}</option>
            {ATTENTION_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>{filter.label}</option>
            ))}
          </FilterSelect>
          <DateFilterField label="Reported from" ariaLabel="Reported from date" value={searchParams.get("fromDate") ?? ""} onChange={(value) => updateSearch("fromDate", value)} />
          <DateFilterField label="Reported to" ariaLabel="Reported to date" value={searchParams.get("toDate") ?? ""} onChange={(value) => updateSearch("toDate", value)} />
        </div>
      ) : null}
      {column === "severity" || column === "followup" ? (
        <FilterSelect
          ariaLabel="Sort issues"
          value={`${searchParams.get("sortBy") === "severity" ? "severity" : "reported"}:${searchParams.get("sortDir") === "asc" ? "asc" : "desc"}`}
          onChange={(value) => {
            const [sortKey, sortDir] = value.split(":") as [IssueSortKey, IssueSortDir];
            updateSort(sortKey, sortDir);
          }}
        >
          <option value="reported:desc">Newest reported</option>
          <option value="reported:asc">Oldest reported</option>
          <option value="severity:desc">Highest severity</option>
          <option value="severity:asc">Lowest severity</option>
        </FilterSelect>
      ) : null}
      <FilterReset show={active} label="Clear filters" onReset={clearColumn} />
    </div>
  );
}

export function SavedViewsPanel({
  id,
  views,
  isLoading,
  isError,
  organizationId,
  nameDraft,
  nameError = false,
  canSave,
  isSaving,
  deletingViewId,
  onNameDraftChange,
  onSave,
  onApply,
  onDelete,
  onRetry,
  className,
}: {
  id: string;
  views: SavedIssueViewSummary[];
  isLoading: boolean;
  isError: boolean;
  organizationId?: string | null;
  nameDraft: string;
  nameError?: boolean;
  canSave: boolean;
  isSaving: boolean;
  deletingViewId: string | null;
  onNameDraftChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onApply: (view: SavedIssueViewSummary) => void;
  onDelete: (view: SavedIssueViewSummary) => void | Promise<void>;
  onRetry: () => void;
  className?: string;
}) {
  /* Deleting a view is one click on a small target beside "apply"; the inline
     confirm keeps a slip from silently destroying a shared shortcut. */
  const [confirmingViewId, setConfirmingViewId] = useState<string | null>(null);
  return (
    <section id={id} data-header-filter-root="true" className={cn("tg-panel tg-panel-reveal space-y-3 p-3", className)}>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave();
        }}
      >
        <label className="grid gap-1" htmlFor={`${id}-name`}>
          <span className="text-caption font-medium text-foreground">{copy.issues.savedViews}</span>
          <input
            id={`${id}-name`}
            className="tg-soft-input min-h-11 w-full rounded-lg border px-2.5 text-caption text-foreground outline-none transition-colors placeholder:text-muted/70 hover:border-border focus:border-primary focus:bg-surface"
            placeholder={copy.issues.savedViewNamePlaceholder}
            value={nameDraft}
            disabled={!organizationId || isSaving}
            onChange={(event) => onNameDraftChange(event.target.value)}
            aria-invalid={Boolean(nameError || (organizationId && nameDraft.trim().length > 0 && nameDraft.trim().length < 2))}
            aria-describedby={nameError || (organizationId && nameDraft.trim().length > 0 && nameDraft.trim().length < 2) ? `${id}-name-error` : undefined}
          />
        </label>
        {nameError || (organizationId && nameDraft.trim().length > 0 && nameDraft.trim().length < 2) ? (
          <p id={`${id}-name-error`} className="text-caption text-danger-700" role="alert">
            {copy.issues.savedViewNameTooShort}
          </p>
        ) : null}
        {!organizationId ? <p className="text-caption text-muted">{copy.issues.savedViewMissingOrg}</p> : null}
        <Button type="submit" tone="secondary" className="min-h-11 rounded-lg px-3 text-caption" disabled={!canSave || isSaving}>
          {isSaving ? copy.issues.savedViewSaving : copy.issues.savedViewSave}
        </Button>
      </form>

      {organizationId ? (
        <div id={`${id}-list`} className="border-t border-border/35 pt-2">
          {isLoading ? (
            <p className="px-1 py-2 text-caption text-muted">{copy.issues.savedViewLoading}</p>
          ) : isError ? (
            <div className="flex items-center justify-between gap-2 px-1 py-2">
              <p className="text-caption text-muted">{copy.issues.savedViewLoadFailed}</p>
              <button
                type="button"
                onClick={onRetry}
                className="tg-copy-button min-h-11 rounded px-2 text-caption font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
              >
                {copy.issues.retry}
              </button>
            </div>
          ) : views.length > 0 ? (
            <div className="grid gap-1">
              {views.map((view) => (
                <div key={view.id} className="saved-view-row flex items-center gap-1 rounded-lg border border-border/35 bg-surface-muted/30 p-1">
                  <button
                    type="button"
                    aria-label={copy.issues.applySavedView(view.name)}
                    onClick={() => onApply(view)}
                    className="min-h-11 min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span className="block truncate text-label font-medium text-foreground">{view.name}</span>
                  </button>
                  {confirmingViewId === view.id ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Confirm delete: ${view.name}`}
                        disabled={deletingViewId !== null}
                        onClick={() => {
                          setConfirmingViewId(null);
                          void onDelete(view);
                        }}
                        className="min-h-11 rounded-full bg-danger-50 px-3 text-caption font-semibold text-danger-700 transition-colors hover:bg-danger-100 focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        aria-label={`Keep view: ${view.name}`}
                        onClick={() => setConfirmingViewId(null)}
                        className="min-h-11 rounded-full px-3 text-caption font-medium text-muted transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`${copy.issues.savedViewDelete}: ${view.name}`}
                      title={copy.issues.savedViewDelete}
                      disabled={deletingViewId !== null}
                      onClick={() => setConfirmingViewId(view.id)}
                      className="tg-tool-button flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-danger-50 hover:text-danger-700 focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="px-1 py-2 text-caption text-muted">{copy.issues.savedViewEmpty}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function DuplicateGroupSignal({ item }: { item: FeedbackListItem }) {
  if (item.duplicateOf) {
    return (
      <span
        className="duplicate-signal inline-flex max-w-full items-center rounded-full border border-border/45 bg-surface-muted/60 px-2 py-0.5 text-caption font-medium text-muted"
        title={`Duplicate of #${item.duplicateOf.ticketNumber}: ${item.duplicateOf.title}`}
      >
        Duplicate of #{item.duplicateOf.ticketNumber}
      </span>
    );
  }

  if (item.duplicateCount > 0) {
    const reportLabel = item.duplicateCount === 1 ? "duplicate report" : "duplicate reports";

    return (
      <span
        className="duplicate-signal inline-flex max-w-full items-center rounded-full border border-primary/20 bg-primary-light/60 px-2 py-0.5 text-caption font-medium text-primary"
        title={`${item.duplicateCount} ${reportLabel}`}
      >
        {item.duplicateCount} {reportLabel}
      </span>
    );
  }

  return null;
}

function fixedReleaseLabel(signal: NonNullable<FeedbackListItem["releaseSignal"]>) {
  return [
    signal.fixedRelease.appVersion,
    signal.fixedRelease.buildNumber ? `build ${signal.fixedRelease.buildNumber}` : null,
    signal.fixedRelease.releaseChannel,
  ].filter(Boolean).join(" · ");
}

function ReleaseSignal({ item }: { item: FeedbackListItem }) {
  if (item.releaseSignal?.kind !== "regression") {
    return null;
  }

  const fixedRelease = fixedReleaseLabel(item.releaseSignal);

  return (
    <span
      className="release-signal inline-flex max-w-full items-center rounded-full border border-danger-200 bg-danger-50 px-2 py-0.5 text-caption font-medium text-danger-700"
      title={`Previously fixed by #${item.releaseSignal.fixedIssue.ticketNumber}: ${fixedRelease}`}
    >
      Regression
    </span>
  );
}

function LockedIssueSignal({ item }: { item: FeedbackListItem }) {
  if (!item.isOverageLocked) {
    return null;
  }

  return (
    <span
      className="locked-issue-signal inline-flex max-w-full items-center gap-1 rounded-full border border-warning/25 bg-warning-50 px-2 py-0.5 text-caption font-medium text-warning-700"
      title={copy.issues.lockedIssueTitle}
    >
      <LockKeyhole className="size-3" />
      {copy.issues.lockedIssue}
    </span>
  );
}

function hasIssueSignal(item: FeedbackListItem) {
  return Boolean(
      item.isOverageLocked ||
      item.duplicateOf ||
      item.duplicateCount > 0 ||
      item.releaseSignal ||
      impactSummary(item),
  );
}

function OwnerSignal({ item }: { item: FeedbackListItem }) {
  return (
    <span className={cn("owner-signal block max-w-32 truncate text-label", item.owner ? "text-foreground" : "text-muted")}>
      {item.owner?.name ?? copy.common.unassigned}
    </span>
  );
}

function impactSummary(item: FeedbackListItem) {
  const impact = item.customerImpactSummary;
  if (!impact) return null;
  if (
    !impact.revenueAtRisk
    && impact.affectedUsers === null
    && impact.affectedAccounts === null
    && !impact.summary
    && !impact.churnRisk
  ) return null;

  const primary = impact.revenueAtRisk
    ? `${impact.revenueAtRisk} at risk`
    : impact.affectedUsers !== null
      ? `${impact.affectedUsers.toLocaleString()} user${impact.affectedUsers === 1 ? "" : "s"}`
      : impact.affectedAccounts !== null
        ? `${impact.affectedAccounts.toLocaleString()} account${impact.affectedAccounts === 1 ? "" : "s"}`
        : impact.summary ?? "Not quantified";
  const secondary = impact.churnRisk ? `${impact.churnRisk} churn risk` : impact.summary ?? "Impact captured";
  return { primary, secondary };
}

function ImpactSignal({ item }: { item: FeedbackListItem }) {
  const impact = impactSummary(item);
  if (!impact) return null;

  return (
    <span
      className="issue-impact inline-flex max-w-full items-center gap-1 rounded-full border border-warning/25 bg-warning-50 px-2 py-0.5 text-caption text-warning-700"
      title={impact.secondary}
    >
      <span className="font-medium">Impact</span>
      <span className="truncate">{impact.primary}</span>
    </span>
  );
}

function ReporterFollowUpState({ item }: { item: FeedbackListItem }) {
  if (item.requesterLoop?.failedCount) {
    return <span className="text-label font-medium text-danger-700">Delivery failed</span>;
  }
  if (item.requesterLoop?.updateDue) {
    return <span className="text-label font-medium text-danger-700">Reply due</span>;
  }
  if (item.requesterLoop?.lastRequesterUpdateAt) {
    return <span className="text-caption text-muted">Updated {formatRelativeDate(item.requesterLoop.lastRequesterUpdateAt)}</span>;
  }
  if (item.requesterLoop?.canEmailRequester ?? Boolean(item.reporterEmail)) {
    return <span className="text-label text-muted">No update sent</span>;
  }
  return <span className="text-label text-muted">No reply channel</span>;
}

function IssueStatus({ item }: { item: FeedbackListItem }) {
  return (
    <span className="issue-status flex flex-wrap items-center gap-1.5">
      <StatusChip status={item.status} />
      {item.convertedToBacklog ? <Badge>Backlog</Badge> : null}
    </span>
  );
}

function IssueMobileCard({
  item,
  showProduct,
  onOpen,
  selected,
  selectionDisabled,
  onSelectedChange,
}: {
  item: FeedbackListItem;
  showProduct: boolean;
  onOpen: () => void;
  selected: boolean;
  selectionDisabled?: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  const showIssueSignal = hasIssueSignal(item);

  return (
    <article
      className={cn(
        "tg-mobile-card tg-card flex w-full items-start gap-3 px-4 py-4 transition-colors",
        selected ? "bg-primary-light/60" : "hover:bg-surface-muted/35",
      )}
    >
      <label className={cn("flex size-11 shrink-0 items-center justify-center", selectionDisabled ? "cursor-not-allowed" : "cursor-pointer")}>
        <input
          type="checkbox"
          aria-label={copy.issues.selectIssue(item.ticketNumber)}
          className="size-4 rounded border-border text-primary focus-visible:outline-2 focus-visible:outline-primary"
          checked={selected}
          disabled={selectionDisabled}
          onChange={(event) => onSelectedChange(event.target.checked)}
        />
      </label>
      <button
        type="button"
        data-tg-primary-target="true"
        aria-label={`Open issue ${item.ticketNumber}: ${item.title}`}
        onClick={onOpen}
        className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-primary active:scale-[0.99]"
      >
        <span className="block text-label font-semibold text-foreground">{item.title}</span>
        <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <SeverityIndicator severity={item.severity} />
          <span className="text-caption tabular-nums text-muted">#{item.ticketNumber}</span>
          {showProduct ? <span className="text-caption text-muted">{item.project.name}</span> : null}
        </span>
        {showIssueSignal ? (
          <span className="mt-2 flex flex-wrap items-center gap-1">
            <LockedIssueSignal item={item} />
            <ReleaseSignal item={item} />
            <DuplicateGroupSignal item={item} />
            <ImpactSignal item={item} />
          </span>
        ) : null}
        <span className="mt-4 grid grid-cols-2 gap-4 border-t border-border/25 pt-3">
          <span className="min-w-0">
            <span className="block text-caption font-medium uppercase text-muted">Owner</span>
            <span className="mt-1 block">
              <OwnerSignal item={item} />
            </span>
          </span>
          <span className="min-w-0">
            <span className="block text-caption font-medium uppercase text-muted">Status</span>
            <span className="mt-1 block">
              <IssueStatus item={item} />
            </span>
          </span>
          <span className="col-span-2 min-w-0">
            <span className="block text-caption font-medium uppercase text-muted">Follow-up</span>
            <span className="mt-1 block">
              <ReporterFollowUpState item={item} />
            </span>
          </span>
        </span>
      </button>
    </article>
  );
}

type IssuesPageProps = {
  organizationId?: string | null;
  canOpenProductSetup?: boolean;
};

type IssuesToastAction = "saved-view-save" | `saved-view-delete:${string}` | "export" | "bulk";
type BulkOperation = "status" | "owner" | "add-label" | "remove-label";
type BulkMutation = { status: string; statusNote: { body: string; visibility: "internal"; clientRequestId: string } } | { ownerId: string | null } | { labels: string[] };
type BulkRequestItem = { feedbackId: string; expectedUpdatedAt: string; mutation: BulkMutation };
type BulkAction = {
  operation: BulkOperation;
  status?: FeedbackStatus;
  note?: string;
  ownerId?: string | null;
  label?: IssueLabel;
};
type BulkSucceededItem = {
  feedbackId: string;
  updatedAt: string;
  before: { status: string; ownerId: string | null; labels: string[] };
};
type BulkResultState = {
  operation: BulkOperation | "undo";
  action: BulkAction | null;
  requested: BulkRequestItem[];
  succeeded: BulkSucceededItem[];
  failed: Array<{ feedbackId: string; code: string; message: string }>;
};

const COMMAND_PANEL_CONTROLS: Record<string, string> = {
  "command-saved-views": "issues-command-saved-views-panel",
  "command-filters": "issue-filters",
};

type IssuesTenantOperation = {
  organizationId: string | null | undefined;
  generation: number;
};

function issuesToastScope(organizationId: string | null | undefined, action: IssuesToastAction) {
  return `issues:${organizationId ?? "no-organization"}:${action}`;
}

export function IssuesPage({ organizationId, canOpenProductSetup = false }: IssuesPageProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const normalizedSearch = useMemo(() => buildSearchParams(searchParams), [searchParams]);
  const normalizedSearchKey = normalizedSearch.toString();
  const { toasts, addToast, dismissToast, dismissAllToasts } = useToast();
  const tenantOperationRef = useRef<IssuesTenantOperation>({ organizationId, generation: 0 });
  if (tenantOperationRef.current.organizationId !== organizationId) {
    tenantOperationRef.current = {
      organizationId,
      generation: tenantOperationRef.current.generation + 1,
    };
  }
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const exportInFlightRef = useRef(false);
  const [openHeaderFilter, setOpenHeaderFilter] = useState<string | null>(null);
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<FeedbackStatus>("triaged");
  const [bulkNote, setBulkNote] = useState("");
  const [bulkOperation, setBulkOperation] = useState<BulkOperation>("status");
  const [bulkOwnerId, setBulkOwnerId] = useState("");
  const [bulkLabel, setBulkLabel] = useState<IssueLabel>(FEEDBACK_LABELS[0]);
  const [bulkResult, setBulkResult] = useState<BulkResultState | null>(null);
  const [bulkApplying, setBulkApplying] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const commandToolsRef = useRef<HTMLElement>(null);
  const bulkInFlightRef = useRef(false);

  const captureTenantOperation = (): IssuesTenantOperation => ({ ...tenantOperationRef.current });
  const isCurrentTenantOperation = (operation: IssuesTenantOperation) =>
    tenantOperationRef.current.organizationId === operation.organizationId
    && tenantOperationRef.current.generation === operation.generation;

  const addIssuesToast = (
    action: IssuesToastAction,
    type: "success" | "error" | "info",
    message: string,
    operation = captureTenantOperation(),
  ) => {
    if (!isCurrentTenantOperation(operation)) return;
    addToast(type, message, issuesToastScope(operation.organizationId, action));
  };

  const projectsQuery = useQuery({
    queryKey: ["projects", organizationId],
    queryFn: () => api.getProjects(),
  });

  useEffect(() => {
    const project = projectsQuery.data?.projects[0];
    if (project && searchParams.get("projectKey") !== project.key) {
      const next = new URLSearchParams(searchParams);
      next.set("projectKey", project.key);
      setSearchParams(next, { replace: true });
    }
  }, [projectsQuery.data, searchParams, setSearchParams]);

  const feedbackListQuery = useQuery({
    queryKey: ["feedback-list", organizationId, normalizedSearchKey],
    queryFn: () => api.getFeedbackList(normalizedSearch),
  });
  const feedbackListState = classifyAdminQueryState(
    feedbackListQuery,
    (response) => response.items.length === 0,
  );
  const [issueQueueAnnouncement, setIssueQueueAnnouncement] = useState("");
  const previousFeedbackListState = useRef(feedbackListState.kind);

  const hasActiveFilters = useMemo(() => FILTER_KEYS.some((key) => key !== "projectKey" && !!searchParams.get(key)), [searchParams]);
  
  const updateSearch = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.set("page", "1");
    setSearchParams(next);
  };
  const updateIssueSort = (sortKey: IssueSortKey, sortDir: IssueSortDir) => {
    const next = new URLSearchParams(searchParams);
    next.set("sortBy", sortKey);
    next.set("sortDir", sortDir);
    next.set("page", "1");
    setSearchParams(next);
  };

  const restoreCommandTriggerFocus = useCallback((menuKey: string | null) => {
    const controls = menuKey ? COMMAND_PANEL_CONTROLS[menuKey] : undefined;
    if (!controls) return;
    window.requestAnimationFrame(() => {
      commandToolsRef.current
        ?.querySelector<HTMLButtonElement>(`button[aria-controls="${controls}"]`)
        ?.focus();
    });
  }, []);

  const closeHeaderFilter = (restoreFocus = false) => {
    const closingMenu = openHeaderFilter;
    setOpenHeaderFilter(null);
    if (restoreFocus) restoreCommandTriggerFocus(closingMenu);
  };

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    for (const key of FILTER_KEYS) {
      if (key !== "projectKey") next.delete(key);
    }
    next.set("page", "1");
    setSearchParams(next);
    closeHeaderFilter(true);
  };

  const clearReleaseFilter = () => {
    const next = new URLSearchParams(searchParams);
    for (const key of RELEASE_FILTER_KEYS) {
      next.delete(key);
    }
    next.set("page", "1");
    setSearchParams(next);
  };

  const clearTrackedEventFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("trackedEventName");
    next.set("page", "1");
    setSearchParams(next);
  };

  const clearReleaseRegressionFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("releaseRegression");
    next.set("page", "1");
    setSearchParams(next);
  };

  const toggleHeaderFilter = (menuKey: string) => {
    if (openHeaderFilter === menuKey) {
      setOpenHeaderFilter(null);
      restoreCommandTriggerFocus(menuKey);
      return;
    }
    setOpenHeaderFilter(menuKey);
  };

  const openIssue = useCallback(
    (id: string) => {
      const next = new URLSearchParams(normalizedSearch);
      navigate(`/issues/${id}?${next.toString()}`);
    },
    [navigate, normalizedSearch],
  );

  const feedbackPermissionDenied = feedbackListQuery.isError
    && feedbackListQuery.error instanceof ApiError
    && feedbackListQuery.error.status === 403;
  const items = feedbackPermissionDenied ? [] : feedbackListQuery.data?.items ?? [];
  const hasVisibleIssueRows = feedbackListState.kind === "success-data"
    || feedbackListState.kind === "refreshing"
    || (!feedbackPermissionDenied && feedbackListState.kind === "stale" && items.length > 0);
  const total = feedbackPermissionDenied ? undefined : feedbackListQuery.data?.pagination.total;
  const selectableIssueIds = useMemo(() => items.filter((item) => !item.isOverageLocked).map((item) => item.id), [items]);
  const selectedIssueIdSet = useMemo(() => new Set(selectedIssueIds), [selectedIssueIds]);
  const selectedIssueCount = selectedIssueIds.length;
  const visibleSelectedIssueCount = selectableIssueIds.filter((id) => selectedIssueIdSet.has(id)).length;
  const allVisibleSelected = selectableIssueIds.length > 0 && selectableIssueIds.every((id) => selectedIssueIdSet.has(id));
  const someVisibleSelected = visibleSelectedIssueCount > 0 && !allVisibleSelected;
  const queryFilterActive = !!searchParams.get("query");
  const projectFilterActive = !!searchParams.get("projectKey");
  const releaseFilterActive = Boolean(
    searchParams.get("releaseId") ||
      searchParams.get("appEnvironment") ||
      searchParams.get("appVersion") ||
      searchParams.get("buildNumber") ||
      searchParams.get("releaseChannel"),
  );
  const severityFilterActive = !!searchParams.get("severity");
  const statusFilterActive = !!searchParams.get("status");
  const issueTypeFilterActive = !!searchParams.get("issueType");
  const ownerFilterActive = !!searchParams.get("ownerId");
  const requesterFilterActive = !!searchParams.get("requesterIdentity");
  const labelFilterActive = selectedLabels(searchParams).length > 0;
  const customerContextFilterActive = Boolean(
    searchParams.get("accountId") ||
      searchParams.get("accountName") ||
      searchParams.get("planName") ||
      searchParams.get("planTier") ||
      searchParams.get("customerSegment") ||
      searchParams.get("customerCohort"),
  );
  const trackedEventFilter = searchParams.get("trackedEventName")?.trim() ?? "";
  const attentionFilter = searchParams.get("attention") as SavedIssueViewFilters["attention"] | null;
  const trackedEventFilterActive = trackedEventFilter.length > 0;
  const releaseRegressionFilterActive = searchParams.get("releaseRegression") === "true";
  const hasFiltersBeyondRegression = FILTER_KEYS.some(
    (key) => key !== "projectKey" && key !== "releaseRegression" && Boolean(searchParams.get(key)),
  );
  const dateFilterActive = !!searchParams.get("fromDate") || !!searchParams.get("toDate");
  const selectedProjectName =
    projectsQuery.data?.projects.find((project) => project.key === searchParams.get("projectKey"))?.name
    ?? projectsQuery.data?.projects[0]?.name
    ?? searchParams.get("projectKey")
    ?? null;
  const activeStructuredFilterCount = [
    queryFilterActive,
    releaseFilterActive,
    severityFilterActive,
    statusFilterActive,
    issueTypeFilterActive,
    ownerFilterActive,
    requesterFilterActive,
    labelFilterActive,
    customerContextFilterActive,
    trackedEventFilterActive,
    attentionFilter,
    releaseRegressionFilterActive,
    dateFilterActive,
  ].filter(Boolean).length;
  const ownerOptions = feedbackListQuery.data?.assignableUsers ?? [];

  useEffect(() => {
    const recovered = previousFeedbackListState.current === "stale"
      && (feedbackListState.kind === "success-data" || feedbackListState.kind === "success-empty");
    setIssueQueueAnnouncement(recovered ? copy.issues.liveDataRestored : "");
    previousFeedbackListState.current = feedbackListState.kind;
  }, [feedbackListState.kind]);

  useEffect(() => {
    dismissAllToasts();
    exportInFlightRef.current = false;
    bulkInFlightRef.current = false;
    setExporting(false);
    setExportProgress("");
    setSelectedIssueIds([]);
    setBulkApplying(false);
    setBulkResult(null);
    setBulkNote("");
  }, [dismissAllToasts, organizationId]);

  useEffect(() => {
    if (selectedIssueIds.length === 0) setBulkNote("");
  }, [selectedIssueIds]);

  useEffect(() => {
    const visibleIds = new Set(selectableIssueIds);
    setSelectedIssueIds((current) => {
      const next = current.filter((id) => visibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [selectableIssueIds]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;

      const isNext = event.key === "j" || event.key === "ArrowDown";
      const isPrev = event.key === "k" || event.key === "ArrowUp";
      if (!isNext && !isPrev) return;

      const rows = Array.from(tableRef.current?.querySelectorAll<HTMLTableRowElement>("tbody tr[tabindex]") ?? []);
      if (rows.length === 0) return;

      event.preventDefault();
      const activeIndex = rows.findIndex((row) => row === document.activeElement);
      const nextIndex = activeIndex === -1 ? 0 : Math.min(Math.max(activeIndex + (isNext ? 1 : -1), 0), rows.length - 1);
      rows[nextIndex]?.focus();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!openHeaderFilter) return;

    function onPointerDown(event: PointerEvent) {
      if (
        event.target instanceof Element
        && (
          event.target.closest("[data-header-filter-root='true']")
          || commandToolsRef.current?.contains(event.target)
        )
      ) return;
      closeHeaderFilter(false);
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [openHeaderFilter]);

  useEffect(() => {
    if (!openHeaderFilter?.startsWith("command-")) return;

    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const closingMenu = openHeaderFilter;
      setOpenHeaderFilter(null);
      restoreCommandTriggerFocus(closingMenu);
    }

    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [openHeaderFilter, restoreCommandTriggerFocus]);

  const handleExport = async () => {
    const operation = captureTenantOperation();
    if (exportInFlightRef.current) return;
    if (items.length === 0) {
      addIssuesToast("export", "info", copy.issues.exportEmpty, operation);
      return;
    }
    exportInFlightRef.current = true;
    setExporting(true);
    try {
      const exportedCount = await exportIssuesToCSV(
        items.map((item) => item.id),
        (done, exportTotal) => {
          if (isCurrentTenantOperation(operation)) {
            setExportProgress(copy.issues.exporting(done, exportTotal));
          }
        },
      );
      addIssuesToast("export", "success", copy.issues.exported(exportedCount, hasActiveFilters), operation);
    } catch {
      addIssuesToast("export", "error", copy.issues.exportFailed, operation);
    } finally {
      if (isCurrentTenantOperation(operation)) {
        exportInFlightRef.current = false;
        setExporting(false);
        setExportProgress("");
      }
    }
  };

  const toggleIssueSelection = (issueId: string, selected: boolean) => {
    setSelectedIssueIds((current) => {
      if (selected) {
        return current.includes(issueId) ? current : [...current, issueId];
      }

      return current.filter((id) => id !== issueId);
    });
  };

  const toggleVisibleSelection = (selected: boolean) => {
    const visibleSelectableIds = new Set(selectableIssueIds);
    setSelectedIssueIds((current) => {
      if (selected) {
        return [...new Set([...current, ...selectableIssueIds])];
      }

      return current.filter((id) => !visibleSelectableIds.has(id));
    });
  };

  const currentBulkAction = (): BulkAction => ({
    operation: bulkOperation,
    status: bulkOperation === "status" ? bulkStatus : undefined,
    note: bulkOperation === "status" ? bulkNote.trim() : undefined,
    ownerId: bulkOperation === "owner" ? bulkOwnerId || null : undefined,
    label: bulkOperation === "add-label" || bulkOperation === "remove-label" ? bulkLabel : undefined,
  });

  const mutationForIssue = (item: FeedbackListItem, action: BulkAction): BulkMutation => {
    if (action.operation === "status") return { status: action.status ?? "triaged", statusNote: { body: action.note ?? "", visibility: "internal", clientRequestId: crypto.randomUUID() } };
    if (action.operation === "owner") return { ownerId: action.ownerId ?? null };
    const labels = new Set(item.labels);
    const label = action.label ?? FEEDBACK_LABELS[0];
    if (action.operation === "add-label") labels.add(label);
    else labels.delete(label);
    return { labels: [...labels] };
  };

  const runBulkMutation = async (
    requested: BulkRequestItem[],
    resultOperation: BulkResultState["operation"],
    action: BulkAction | null,
  ) => {
    if (requested.length === 0 || bulkInFlightRef.current) return;
    const operation = captureTenantOperation();
    bulkInFlightRef.current = true;
    setBulkApplying(true);
    try {
      const result = await api.bulkUpdateFeedback({ items: requested });
      if (!isCurrentTenantOperation(operation)) return;
      const failedIds = new Set(result.failed.map((item) => item.feedbackId));
      setSelectedIssueIds((current) => current.filter((id) => failedIds.has(id)));
      setBulkResult({ operation: resultOperation, action, requested, ...result });
      await feedbackListQuery.refetch();
      if (!isCurrentTenantOperation(operation)) return;
    } catch {
      if (isCurrentTenantOperation(operation)) {
        if (resultOperation === "status") {
          setBulkResult({ operation: resultOperation, action, requested, succeeded: [], failed: requested.map((item) => ({
            feedbackId: item.feedbackId, code: "feedback.result_unknown", message: "Save result not confirmed. Retry to check this exact update without duplicating its note.",
          })) });
        }
        await feedbackListQuery.refetch();
        addIssuesToast("bulk", "error", copy.issues.bulkFailed, operation);
      }
    } finally {
      if (isCurrentTenantOperation(operation)) {
        bulkInFlightRef.current = false;
        setBulkApplying(false);
      }
    }
  };

  const applyBulkOperation = async () => {
    if (bulkOperation === "status" && (!bulkNote.trim() || bulkResult?.failed.some((item) => item.code === "feedback.result_unknown"))) return;
    const selected = new Set(selectedIssueIds);
    const action = currentBulkAction();
    const requested = items
      .filter((item) => selected.has(item.id) && !item.isOverageLocked)
      .map((item) => ({
        feedbackId: item.id,
        expectedUpdatedAt: new Date(item.updatedAt).toISOString(),
        mutation: mutationForIssue(item, action),
      }));
    await runBulkMutation(requested, action.operation, action);
  };

  const retryBulkFailures = async () => {
    if (!bulkResult || !bulkResult.action || bulkResult.failed.length === 0) return;
    const operation = captureTenantOperation();
    const failedIds = new Set(bulkResult.failed.map((item) => item.feedbackId));
    const refreshed = await feedbackListQuery.refetch();
    if (!isCurrentTenantOperation(operation)) return;
    const refreshedById = new Map((refreshed.data?.items ?? []).map((item) => [item.id, item]));
    const requested = bulkResult.requested.flatMap((item) => {
      if (!failedIds.has(item.feedbackId)) return [];
      const fresh = refreshedById.get(item.feedbackId);
      if (bulkResult.operation === "status" && bulkResult.failed.some((failure) => failure.feedbackId === item.feedbackId && failure.code === "feedback.result_unknown")) return [item];
      return fresh && !fresh.isOverageLocked
        ? [{
            feedbackId: item.feedbackId,
            expectedUpdatedAt: new Date(fresh.updatedAt).toISOString(),
            mutation: bulkResult.action!.operation === "status" ? item.mutation : mutationForIssue(fresh, bulkResult.action!),
          }]
        : [];
    });
    await runBulkMutation(requested, bulkResult.operation, bulkResult.action);
  };

  const undoableBulkItems = bulkResult?.succeeded.filter((item) => bulkResult.operation !== "status"
    || Boolean(bulkResult.action?.status && FEEDBACK_STATUS_TRANSITIONS[bulkResult.action.status as FeedbackStatus]?.includes(item.before.status as FeedbackStatus))) ?? [];

  const undoBulkSuccesses = async () => {
    if (!bulkResult || bulkResult.operation === "undo" || undoableBulkItems.length === 0) return;
    const requested = undoableBulkItems.map((item) => ({
      feedbackId: item.feedbackId,
      expectedUpdatedAt: item.updatedAt,
      mutation: bulkResult.operation === "status"
        ? { status: item.before.status, statusNote: { body: "Reverted the previous bulk status change.", visibility: "internal" as const, clientRequestId: crypto.randomUUID() } }
        : bulkResult.operation === "owner"
          ? { ownerId: item.before.ownerId }
          : { labels: item.before.labels },
    }));
    await runBulkMutation(requested, "undo", null);
  };

  const columnFilter = (column: IssueFilterColumn, label: string) => (
    <HeaderFilterMenu
      menuKey={`column-${column}`}
      openMenu={openHeaderFilter}
      onToggle={toggleHeaderFilter}
      label={label}
      icon={column === "issue" ? <Search className="size-4" /> : <Filter className="size-4" />}
      active={COLUMN_FILTER_KEYS[column].some((key) => Boolean(searchParams.get(key)))}
    >
      <IssueColumnFilterFields
        column={column}
        searchParams={searchParams}
        ownerOptions={ownerOptions}
        updateSearch={updateSearch}
        updateSort={updateIssueSort}
        clearColumn={() => {
          const next = new URLSearchParams(searchParams);
          COLUMN_FILTER_KEYS[column].forEach((key) => next.delete(key));
          next.set("page", "1");
          setSearchParams(next);
        }}
      />
    </HeaderFilterMenu>
  );
  const emptyIssueState = (
    <ListEmptyState
      icon={<Inbox className="size-5" />}
      title={hasActiveFilters ? copy.issues.emptyFilteredTitle : copy.issues.emptyTitle}
      body={hasActiveFilters ? copy.issues.emptyFilteredBody : copy.issues.emptyBody}
      action={hasActiveFilters ? <Button tone="secondary" onClick={clearFilters}>{copy.issues.clearFilters}</Button> : undefined}
    />
  );

  return (
    <div id="issues-page" ref={tableRef} className="space-y-5">
      <p className="sr-only" aria-live="polite">{issueQueueAnnouncement}</p>
      <header id="issues-header" className="flex items-center justify-between gap-4 px-1 py-1">
        <div className="min-w-0">
          <h1 id="issues-page-title" className="break-words text-display text-foreground">
            {selectedProjectName ?? "Project"} – Issues{total != null ? <span> (<MotionNumber value={total} />)</span> : null}
          </h1>
          <p id="issues-keyboard-hint" className="sr-only">
            {copy.issues.keyboardHint}
          </p>
        </div>
        <Button
          tone="ghost"
          className="min-h-11 shrink-0 gap-2 rounded-md px-3 text-label"
          aria-label={exporting ? exportProgress || "Exporting" : "Export"}
          title="Export"
          onClick={() => void handleExport()}
          disabled={exporting}
        >
          <Download className="size-4" aria-hidden="true" />
          <span>{exporting ? exportProgress || "Exporting" : "Export"}</span>
        </Button>
      </header>

      {releaseFilterActive ? (
        <section id="issues-release-filter-banner" className="tg-panel flex flex-wrap items-center justify-between gap-3 p-3">
          <p className="text-caption text-muted">
            <span className="font-semibold text-foreground">{copy.issues.releaseFilterLabel}</span>
            <span className="ml-2">{copy.issues.releaseFilterDescription(selectedProjectName)}</span>
          </p>
          <Button tone="ghost" className="h-8 rounded-full px-3 text-caption" onClick={clearReleaseFilter}>
            {copy.issues.clearReleaseFilter}
          </Button>
        </section>
      ) : null}

      {trackedEventFilterActive ? (
        <section id="issues-tracked-event-filter-banner" className="tg-panel flex flex-wrap items-center justify-between gap-3 p-3">
          <p className="text-caption text-muted">
            <span className="font-semibold text-foreground">Tracked event</span>
            <span className="ml-2 font-mono text-foreground">{trackedEventFilter}</span>
          </p>
          <Button tone="ghost" className="h-8 rounded-full px-3 text-caption" onClick={clearTrackedEventFilter}>
            Clear event
          </Button>
        </section>
      ) : null}

      {attentionFilter ? (
        <section id="issues-attention-filter-banner" className="tg-panel flex flex-wrap items-center justify-between gap-3 p-3">
          <p className="text-caption text-muted">
            <span className="font-semibold text-foreground">Needs attention</span>
            <span className="ml-2 text-foreground">{attentionFilter.replaceAll("_", " ")}</span>
          </p>
          <Button
            tone="ghost"
            className="h-8 rounded-full px-3 text-caption"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete("attention");
              next.set("page", "1");
              setSearchParams(next);
            }}
          >
            Clear attention
          </Button>
        </section>
      ) : null}

      {customerContextFilterActive ? (
        <section id="issues-customer-context-filter-banner" className="tg-panel flex flex-wrap items-center justify-between gap-3 p-3">
          <p className="text-caption text-muted">
            <span className="font-semibold text-foreground">{copy.issues.customerContextFilterLabel}</span>
            <span className="ml-2">{copy.issues.customerContextFilterDescription}</span>
          </p>
          <Button
            tone="ghost"
            className="h-8 rounded-full px-3 text-caption"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete("accountId");
              next.delete("accountName");
              next.delete("planName");
              next.delete("planTier");
              next.delete("customerSegment");
              next.delete("customerCohort");
              next.set("page", "1");
              setSearchParams(next);
            }}
          >
            {copy.issues.clearCustomerContext}
          </Button>
        </section>
      ) : null}

      {releaseRegressionFilterActive ? (
        <section id="issues-release-regression-filter-banner" className="tg-panel flex flex-wrap items-center justify-between gap-3 p-3">
          <p className="text-caption text-muted">
            <span className="font-semibold text-foreground">{copy.issues.releaseRegressionFilter}</span>
            <span className="ml-2">{copy.issues.releaseRegressionFilterDescription}</span>
          </p>
          <Button tone="ghost" className="h-8 rounded-full px-3 text-caption" onClick={clearReleaseRegressionFilter}>
            {copy.issues.clearReleaseRegressionFilter}
          </Button>
        </section>
      ) : null}

      {selectedIssueCount > 0 ? (
        <section id="issues-bulk-actions" className="tg-panel flex flex-wrap items-center justify-between gap-2 p-3">
          <div className="flex items-center gap-2">
            <p className="text-label font-semibold text-foreground">{copy.issues.bulkSelected(selectedIssueCount)}</p>
            <button
              type="button"
              className="tg-action-button rounded-md px-2 py-1 text-caption font-medium text-muted hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
              disabled={bulkApplying}
              onClick={() => setSelectedIssueIds([])}
            >
              Clear
            </button>
          </div>
          <div className="grid w-full min-w-0 gap-2 sm:w-auto sm:grid-cols-[auto_auto_auto] sm:items-end">
            <label className="flex items-center gap-2 text-caption font-medium text-muted">
              <span>Action</span>
              <select
                aria-label="Bulk issue action"
                className="tg-soft-input h-11 min-w-32 rounded-lg border px-2 text-caption text-foreground outline-none transition-colors hover:border-border focus:border-primary focus:bg-surface sm:h-9"
                value={bulkOperation}
                disabled={bulkApplying}
                onChange={(event) => setBulkOperation(event.target.value as BulkOperation)}
              >
                <option value="status">Change status</option>
                <option value="owner">Assign owner</option>
                <option value="add-label">Add label</option>
                <option value="remove-label">Remove label</option>
              </select>
            </label>
            {bulkOperation === "status" ? (
              <label className="flex items-center gap-2 text-caption font-medium text-muted">
                <span>{copy.issues.bulkStatusLabel}</span>
                <select
                  aria-label="Bulk status"
                  className="tg-soft-input h-11 min-w-32 rounded-lg border px-2 text-caption text-foreground outline-none transition-colors hover:border-border focus:border-primary focus:bg-surface sm:h-9"
                  value={bulkStatus}
                  disabled={bulkApplying}
                  onChange={(event) => setBulkStatus(event.target.value as FeedbackStatus)}
                >
                  {BULK_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_META[status].label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {bulkOperation === "owner" ? (
              <label className="flex items-center gap-2 text-caption font-medium text-muted">
                <span>Owner</span>
                <select
                  aria-label="Bulk owner"
                  className="tg-soft-input h-11 min-w-36 rounded-lg border px-2 text-caption text-foreground outline-none transition-colors hover:border-border focus:border-primary focus:bg-surface sm:h-9"
                  value={bulkOwnerId}
                  disabled={bulkApplying}
                  onChange={(event) => setBulkOwnerId(event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {ownerOptions.map((owner) => (
                    <option key={owner.id} value={owner.id}>{owner.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {bulkOperation === "add-label" || bulkOperation === "remove-label" ? (
              <label className="flex items-center gap-2 text-caption font-medium text-muted">
                <span>Label</span>
                <select
                  aria-label="Bulk label"
                  className="tg-soft-input h-11 min-w-32 rounded-lg border px-2 text-caption text-foreground outline-none transition-colors hover:border-border focus:border-primary focus:bg-surface sm:h-9"
                  value={bulkLabel}
                  disabled={bulkApplying}
                  onChange={(event) => setBulkLabel(event.target.value as IssueLabel)}
                >
                  {FEEDBACK_LABELS.map((label) => <option key={label} value={label}>{label}</option>)}
                </select>
              </label>
            ) : null}
            {bulkOperation !== "status" ? (
            <Button tone="secondary" className="h-11 rounded-lg px-3 text-caption sm:h-9" onClick={() => void applyBulkOperation()} disabled={bulkApplying}>
              {bulkApplying ? copy.issues.bulkApplying : copy.issues.bulkApply}
            </Button>
            ) : null}
          </div>
          {bulkOperation === "status" ? <div className="w-full border-t border-border/30 pt-3">
            <label htmlFor="bulk-status-note" className="text-label font-medium text-foreground">Internal note for selected tickets (required)</label>
            <Textarea id="bulk-status-note" aria-label="Bulk status note" className="mt-2" rows={2} maxLength={3000} required
              value={bulkNote} onChange={(event) => setBulkNote(event.target.value)} disabled={bulkApplying}
              placeholder="Explain the decision that applies to every selected ticket." />
            <p className="mt-2 text-caption text-muted">Saved privately on each ticket with its status change. Customer replies are sent from individual tickets.</p>
            <Button tone="secondary" className="mt-3 h-11 w-full rounded-lg px-3 text-caption sm:h-9 sm:w-auto" onClick={() => void applyBulkOperation()} disabled={bulkApplying || (bulkOperation === "status" && (!bulkNote.trim() || Boolean(bulkResult?.failed.some((item) => item.code === "feedback.result_unknown"))))}>
              {bulkApplying ? copy.issues.bulkApplying : copy.issues.bulkApply}
            </Button>
          </div> : null}
        </section>
      ) : null}

      {bulkResult ? (
        <section id="issues-bulk-result" aria-live="polite" className="tg-panel grid gap-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {bulkResult.failed.length > 0 ? <AlertTriangle className="size-4 shrink-0 text-warning-700" aria-hidden="true" /> : <CheckCircle2 className="size-4 shrink-0 text-success-700" aria-hidden="true" />}
              <p className="text-label font-semibold text-foreground">
                {bulkResult.failed.some((item) => item.code === "feedback.result_unknown") ? `${bulkResult.failed.length} results not confirmed` : `${bulkResult.succeeded.length} succeeded, ${bulkResult.failed.length} failed`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {bulkResult.failed.length > 0 ? (
                <Button tone="secondary" className="h-11 rounded-lg px-3 text-caption sm:h-9" disabled={bulkApplying} onClick={() => void retryBulkFailures()}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Retry failed
                </Button>
              ) : null}
              {bulkResult.operation !== "undo" && undoableBulkItems.length > 0 ? (
                <Button tone="ghost" className="h-11 rounded-lg px-3 text-caption sm:h-9" disabled={bulkApplying} onClick={() => void undoBulkSuccesses()}>
                  <Undo2 className="size-4" aria-hidden="true" />
                  {undoableBulkItems.length === bulkResult.succeeded.length ? "Undo successes" : `Undo ${undoableBulkItems.length} reversible changes`}
                </Button>
              ) : null}
              <Button tone="ghost" className="h-11 rounded-lg px-3 text-caption sm:h-9" disabled={bulkApplying} onClick={() => setBulkResult(null)}>
                Dismiss
              </Button>
            </div>
          </div>
          {bulkResult.failed.length > 0 ? (
            <ul id="issues-bulk-failures" className="grid gap-1.5 text-caption text-muted sm:grid-cols-2">
              {bulkResult.failed.map((failure) => {
                const ticket = items.find((item) => item.id === failure.feedbackId);
                return (
                  <li key={failure.feedbackId} className="rounded-lg border border-border/35 bg-surface-muted/35 px-3 py-2">
                    <span className="font-semibold text-foreground">{ticket ? `#${ticket.ticketNumber}` : "Selected issue"}</span>
                    <span className="ml-1">{failure.message}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}

      <TableShell id="issue-queue-table">
        <div id="issues-mobile-filter-controls" className="min-[1180px]:hidden">
          <section ref={commandToolsRef} aria-label="Issue filters" className="flex justify-end border-b border-border/25 px-3 py-1">
          <Button
            tone="ghost"
            className={cn("min-h-11 min-w-11 gap-2 rounded-md px-3 text-label", (activeStructuredFilterCount > 0 || openHeaderFilter === "command-filters") && "bg-primary-light text-primary")}
            aria-label={activeStructuredFilterCount > 0 ? `Filters, ${activeStructuredFilterCount} active` : "Filters"}
            title="Filters"
            aria-expanded={openHeaderFilter === "command-filters"}
            aria-controls="issue-filters"
            onClick={() => toggleHeaderFilter("command-filters")}
          >
            <Filter className="size-4" aria-hidden="true" />
            <span className="hidden min-[360px]:inline">Filters</span>
            {activeStructuredFilterCount > 0 ? <span className="tabular-nums">{activeStructuredFilterCount}</span> : null}
          </Button>
          </section>
      {openHeaderFilter === "command-filters" ? (
        <IssueFilters
          searchParams={searchParams}
          projects={projectsQuery.data?.projects ?? []}
          ownerOptions={ownerOptions}
          hasActiveFilters={hasActiveFilters}
          showReset={releaseRegressionFilterActive ? hasFiltersBeyondRegression : hasActiveFilters}
          resetLabel={releaseRegressionFilterActive ? "Clear all filters" : "Reset"}
          updateSearch={updateSearch}
          updateSort={updateIssueSort}
          clearFilters={clearFilters}
        />
      ) : null}

        </div>
        {feedbackListState.kind === "refreshing" ? (
          <p id="issues-list-refreshing" role="status" className="border-b border-border/25 px-4 py-2 text-caption text-muted">
            {copy.issues.refreshing}
          </p>
        ) : null}
        {!feedbackPermissionDenied && feedbackListState.kind === "stale" ? (
          <ListStaleState
            id="issues-list-stale-state"
            message={copy.query.staleData("issues", formatFullDate(new Date(feedbackListQuery.dataUpdatedAt)))}
            retryLabel={copy.issues.retry}
            onRetry={() => void feedbackListQuery.refetch()}
          />
        ) : null}
        {feedbackPermissionDenied ? (
          <section id="issues-list-permission" role="alert" className="px-5 py-8">
            <h2 className="text-title text-foreground">{copy.issues.permissionTitle}</h2>
            <p className="mt-2 max-w-xl text-body text-muted">{copy.issues.permissionBody}</p>
          </section>
        ) : feedbackListState.kind === "loading" || feedbackListState.kind === "idle" ? (
          <div className="p-5">
            <ListLoadingState rows={10} />
          </div>
        ) : feedbackListState.kind === "error" ? (
          <ListErrorState message={copy.issues.loadFailed} onRetry={() => void feedbackListQuery.refetch()} />
        ) : hasVisibleIssueRows || feedbackListState.kind === "success-empty" ? (
          <section id="issue-list-content">
            <div className="hidden min-[1180px]:block" data-table-contract="issues">
              <div>
                <Table className="w-full table-fixed">
                  <thead className="bg-transparent text-left">
                    <tr className="border-b border-border/25">
                      <TableSelectionHeader
                        checked={allVisibleSelected}
                        indeterminate={someVisibleSelected}
                        ariaLabel={copy.issues.selectAllPage}
                        disabled={selectableIssueIds.length === 0 || bulkApplying}
                        onCheckedChange={toggleVisibleSelection}
                      />
                      <Th className={cn("px-2", tableColumnClass("essential"))} action={columnFilter("issue", "Filter issue details")}>
                        Issue
                      </Th>
                      <Th className="w-32 px-2" action={columnFilter("severity", "Filter by severity")}>
                        Severity
                      </Th>
                      {!projectFilterActive ? <Th className="w-32 px-2">Product</Th> : null}
                      <Th className="w-36 px-2" action={columnFilter("owner", "Filter by owner")}>
                        Owner
                      </Th>
                      <Th className="w-32 px-2" action={columnFilter("status", "Filter by status")}>
                        Status
                      </Th>
                      <Th className="w-36 px-2" action={columnFilter("followup", "Filter follow-up")}>
                        Follow-up
                      </Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/25 bg-surface">
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={projectFilterActive ? 6 : 7}>{emptyIssueState}</td>
                      </tr>
                    ) : null}
                    {items.map((item) => (
                      <RowButton
                        key={item.id}
                        onActivate={() => openIssue(item.id)}
                        ariaLabel={`Open issue ${item.ticketNumber}: ${item.title}`}
                        selection={{
                          checked: selectedIssueIdSet.has(item.id),
                          disabled: bulkApplying || item.isOverageLocked,
                          ariaLabel: copy.issues.selectIssue(item.ticketNumber),
                          onCheckedChange: (selected) => toggleIssueSelection(item.id, selected),
                        }}
                      >
                        <Td className="max-w-md px-2 py-2">
                          <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
                            <button
                              type="button"
                              aria-label={`Open issue ${item.ticketNumber}: ${item.title}`}
                              onClick={() => openIssue(item.id)}
                              className="min-w-0 truncate text-left text-label font-semibold text-foreground transition-colors group-hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                            >
                              {item.title}
                            </button>
                            <span className="shrink-0 text-caption tabular-nums text-muted">#{item.ticketNumber}</span>
                            {hasIssueSignal(item) ? (
                              <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                                <LockedIssueSignal item={item} />
                                <ReleaseSignal item={item} />
                                <DuplicateGroupSignal item={item} />
                                <ImpactSignal item={item} />
                              </span>
                            ) : null}
                          </div>
                        </Td>
                        <Td className="px-2 py-2">
                          <SeverityIndicator severity={item.severity} />
                        </Td>
                        {!projectFilterActive ? (
                          <Td className="px-2 py-2">
                            <span className="block truncate text-label text-foreground">{item.project.name}</span>
                          </Td>
                        ) : null}
                        <Td className="px-2 py-2">
                          <OwnerSignal item={item} />
                        </Td>
                        <Td className="px-2 py-2">
                          <IssueStatus item={item} />
                        </Td>
                        <Td className="px-2 py-2">
                          <ReporterFollowUpState item={item} />
                        </Td>
                      </RowButton>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>

            <div className="grid gap-3 min-[1180px]:hidden">
              {items.length === 0 ? emptyIssueState : null}
              {items.map((item) => (
                <IssueMobileCard
                  key={item.id}
                  item={item}
                  showProduct={!projectFilterActive}
                  selected={selectedIssueIdSet.has(item.id)}
                  selectionDisabled={bulkApplying || item.isOverageLocked}
                  onSelectedChange={(selected) => toggleIssueSelection(item.id, selected)}
                  onOpen={() => openIssue(item.id)}
                />
              ))}
            </div>
          </section>
        ) : feedbackListState.kind === "stale" ? null : hasActiveFilters ? (
          <ListEmptyState
            icon={<Inbox className="size-5" />}
            title={copy.issues.emptyFilteredTitle}
            body={copy.issues.emptyFilteredBody}
            action={releaseRegressionFilterActive
              ? hasFiltersBeyondRegression && openHeaderFilter !== "command-filters"
                ? (
                  <Button tone="secondary" onClick={clearFilters}>
                    Clear all filters
                  </Button>
                )
                : undefined
              : (
                <Button tone="secondary" onClick={clearFilters}>
                  {copy.issues.clearFilters}
                </Button>
              )}
          />
        ) : (
          <ListEmptyState
            icon={<CheckCircle2 className="size-5 text-success-700" />}
            title={copy.issues.emptyTitle}
            body={copy.issues.emptyBody}
            action={canOpenProductSetup ? (
              <Button tone="secondary" onClick={() => navigate("/projects")}>Open product setup</Button>
            ) : undefined}
          />
        )}
        <Pagination
          page={feedbackListQuery.data?.pagination.page ?? 1}
          pageCount={feedbackListQuery.data?.pagination.pageCount ?? 1}
          total={total}
          pageSize={PAGE_SIZE}
          hideWhenSinglePage
          onPage={(page) => {
            const next = new URLSearchParams(searchParams);
            next.set("page", String(page));
            setSearchParams(next);
          }}
        />
      </TableShell>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
