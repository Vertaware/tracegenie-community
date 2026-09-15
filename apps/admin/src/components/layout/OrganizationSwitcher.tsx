import { useEffect,useId,useMemo,useRef,useState } from "react";
import { ChevronUp } from "lucide-react";

export type OrganizationOption = {
  id: string;
  name: string;
  slug?: string;
  status?: "ACTIVE" | "READ_ONLY" | "SUSPENDED";
};

export type OrganizationDirectoryState = "loading" | "refreshing" | "stale" | "error" | "ready";

type OrganizationResultGroup = {
  key: string;
  label: string;
  duplicate: boolean;
  organizations: OrganizationOption[];
};

const ORGANIZATION_RECENTS_KEY = "tracegenie.recentOrganizationIds";
const ORGANIZATION_RECENT_LIMIT = 5;
const ORGANIZATION_RESULT_BATCH_SIZE = 20;

function readRecentOrganizationIds() {
  try {
    const value = window.localStorage.getItem(ORGANIZATION_RECENTS_KEY);
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function recordRecentOrganization(organizationId: string) {
  const recent = [organizationId, ...readRecentOrganizationIds().filter((id) => id !== organizationId)].slice(0, 12);
  try {
    window.localStorage.setItem(ORGANIZATION_RECENTS_KEY, JSON.stringify(recent));
  } catch {
    // Recency is optional; storage failures must not block organization changes.
  }
}

function normalizeSearchValue(value: string) {
  return value.normalize("NFKD").toLocaleLowerCase();
}

function statusLabel(status: OrganizationOption["status"]) {
  if (status === "READ_ONLY") return "Read-only";
  if (status === "SUSPENDED") return "Suspended";
  return "Active";
}

function secondaryIdentity(organization: OrganizationOption) {
  if (organization.slug) return organization.slug;
  return `ID ${organization.id.length > 10 ? `${organization.id.slice(0, 8)}...` : organization.id}`;
}

function searchRank(organization: OrganizationOption, query: string) {
  const fields = [organization.name, organization.slug ?? "", organization.id].map(normalizeSearchValue);
  if (fields.some((field) => field === query)) return 0;
  if (fields.some((field) => field.startsWith(query))) return 1;
  if (fields.some((field) => field.includes(query))) return 2;
  return Number.MAX_SAFE_INTEGER;
}

function safeDomId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function isUnavailable(organization: OrganizationOption) {
  return organization.status === "SUSPENDED";
}

function OrganizationResultOption({
  active,
  current,
  duplicate,
  id,
  onActivate,
  onSelect,
  organization,
}: {
  active: boolean;
  current: boolean;
  duplicate: boolean;
  id: string;
  onActivate: () => void;
  onSelect: () => void;
  organization: OrganizationOption;
}) {
  const unavailable = isUnavailable(organization);
  const organizationStatus = statusLabel(organization.status);
  const organizationIdentity = secondaryIdentity(organization);
  const accessibleName = [
    duplicate ? organizationIdentity : organization.name,
    duplicate ? `ID ${organization.id}` : organizationIdentity,
    organizationStatus,
    current ? "current organization" : "",
    unavailable ? "unavailable" : "",
  ].filter(Boolean).join(", ");

  return (
    <div
      id={id}
      role="option"
      aria-label={accessibleName}
      aria-selected={current}
      aria-disabled={unavailable || undefined}
      className={`group flex min-h-11 items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors ${
        unavailable
          ? "cursor-not-allowed text-muted opacity-55"
          : active
            ? "cursor-pointer bg-primary-light text-foreground"
            : "cursor-pointer text-foreground hover:bg-surface-muted/55"
      }`}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onActivate}
      onClick={() => {
        if (!unavailable) onSelect();
      }}
    >
      <div className="min-w-0 flex-1">
        {!duplicate ? (
          <p className="truncate text-label font-medium text-foreground" title={organization.name}>
            {organization.name}
          </p>
        ) : null}
        <p className="truncate text-caption font-normal text-muted" title={`${organizationIdentity} · ${organizationStatus}`}>
          {organizationIdentity}
          <span aria-hidden="true"> · </span>
          {organizationStatus}
        </p>
      </div>
      {current ? (
        <span className="shrink-0 text-caption font-medium text-primary">
          Current
        </span>
      ) : null}
    </div>
  );
}

export function OrganizationSwitcher({
  id,
  organizations,
  organizationsState,
  currentOrganizationId,
  mobile = false,
  onOrganizationChange,
  onOrganizationsRetry,
}: {
  id: string;
  organizations: OrganizationOption[];
  organizationsState: OrganizationDirectoryState;
  currentOrganizationId?: string;
  mobile?: boolean;
  onOrganizationChange?: (organizationId: string) => void;
  onOrganizationsRetry?: () => void;
}) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [resultLimit, setResultLimit] = useState(ORGANIZATION_RESULT_BATCH_SIZE);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recentIds = useMemo(() => readRecentOrganizationIds(), [currentOrganizationId, isOpen]);
  const currentOrganization = organizations.find((organization) => organization.id === currentOrganizationId);
  const normalizedQuery = normalizeSearchValue(query.trim());
  const rankedOrganizations = useMemo(() => {
    if (!normalizedQuery) return [];
    const recentRank = new Map(recentIds.map((organizationId, index) => [organizationId, index]));
    return organizations
      .map((organization) => ({
        organization,
        rank: searchRank(organization, normalizedQuery),
      }))
      .filter((result) => result.rank < Number.MAX_SAFE_INTEGER)
      .sort((left, right) => (
        left.rank - right.rank
        || (recentRank.get(left.organization.id) ?? Number.MAX_SAFE_INTEGER)
          - (recentRank.get(right.organization.id) ?? Number.MAX_SAFE_INTEGER)
        || left.organization.name.localeCompare(right.organization.name)
        || secondaryIdentity(left.organization).localeCompare(secondaryIdentity(right.organization))
        || left.organization.id.localeCompare(right.organization.id)
      ))
      .map((result) => result.organization);
  }, [normalizedQuery, organizations, recentIds]);
  const recentOrganizations = useMemo(() => (
    recentIds
      .map((organizationId) => organizations.find((organization) => organization.id === organizationId))
      .filter((organization): organization is OrganizationOption => Boolean(organization))
      .filter((organization) => organization.id !== currentOrganizationId)
      .slice(0, ORGANIZATION_RECENT_LIMIT)
  ), [currentOrganizationId, organizations, recentIds]);
  const mountedOrganizations = normalizedQuery
    ? rankedOrganizations.slice(0, resultLimit)
    : recentOrganizations;
  const resultGroups = useMemo(() => {
    const resultSet = normalizedQuery ? rankedOrganizations : recentOrganizations;
    const nameCounts = new Map<string, number>();
    resultSet.forEach((organization) => {
      const normalizedName = normalizeSearchValue(organization.name);
      nameCounts.set(normalizedName, (nameCounts.get(normalizedName) ?? 0) + 1);
    });
    const groups = new Map<string, OrganizationResultGroup>();
    mountedOrganizations.forEach((organization) => {
      const normalizedName = normalizeSearchValue(organization.name);
      const duplicate = (nameCounts.get(normalizedName) ?? 0) > 1;
      const key = duplicate ? `name:${normalizedName}` : `id:${organization.id}`;
      const group = groups.get(key);
      if (group) {
        group.organizations.push(organization);
      } else {
        groups.set(key, {
          key,
          label: organization.name,
          duplicate,
          organizations: [organization],
        });
      }
    });
    return Array.from(groups.values());
  }, [mountedOrganizations, normalizedQuery, rankedOrganizations, recentOrganizations]);
  const groupedOrganizations = resultGroups.flatMap((group) => group.organizations);
  const activeOrganization = groupedOrganizations[activeIndex];
  const hasListbox = groupedOrganizations.length > 0;

  useEffect(() => {
    const firstAvailableIndex = groupedOrganizations.findIndex((organization) => !isUnavailable(organization));
    setActiveIndex(Math.max(firstAvailableIndex, 0));
  }, [query, resultLimit, recentIds, organizations]);

  function resetSwitcherState() {
    setIsOpen(false);
    setQuery("");
    setResultLimit(ORGANIZATION_RESULT_BATCH_SIZE);
  }

  useEffect(() => {
    if (!isOpen) return undefined;
    function dismissOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        resetSwitcherState();
      }
    }
    document.addEventListener("pointerdown", dismissOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", dismissOnOutsidePointer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setActiveIndex(0);
    inputRef.current?.focus();
  }, [isOpen]);

  function closeSwitcher(restoreFocus: boolean) {
    resetSwitcherState();
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }

  function moveActiveOption(direction: 1 | -1) {
    if (groupedOrganizations.length === 0) return;
    for (let offset = 1; offset <= groupedOrganizations.length; offset += 1) {
      const candidateIndex = (activeIndex + direction * offset + groupedOrganizations.length) % groupedOrganizations.length;
      if (groupedOrganizations[candidateIndex] && !isUnavailable(groupedOrganizations[candidateIndex])) {
        setActiveIndex(candidateIndex);
        window.requestAnimationFrame(() => {
          document
            .getElementById(`${id}-option-${safeDomId(groupedOrganizations[candidateIndex].id)}`)
            ?.scrollIntoView?.({ block: "nearest" });
        });
        return;
      }
    }
  }

  function selectOrganization(organization: OrganizationOption) {
    if (isUnavailable(organization)) return;
    if (organization.id === currentOrganizationId) {
      closeSwitcher(true);
      return;
    }
    closeSwitcher(true);
    onOrganizationChange?.(organization.id);
  }

  if (organizationsState === "loading" && organizations.length === 0) {
    return (
      <div id={id} className="min-h-11 rounded-lg border border-border/45 bg-surface-muted/35 px-3 py-2" role="status" aria-live="polite">
        <p className="text-label font-medium text-foreground">
          Loading organizations...
        </p>
        <p className="text-caption font-normal text-muted">
          Your current workspace will appear here.
        </p>
      </div>
    );
  }

  if (organizationsState === "error" && organizations.length === 0) {
    return (
      <div id={id} className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2" role="alert">
        <p className="text-label font-medium text-danger-700">
          Couldn't load organizations.
        </p>
        <button
          type="button"
          onClick={onOrganizationsRetry}
          className="mt-1 inline-flex min-h-10 items-center rounded-md text-caption font-semibold text-danger-700 underline decoration-danger-300 underline-offset-4 focus-visible:outline-2 focus-visible:outline-danger-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div id={id} className="min-h-11 rounded-lg border border-border/45 bg-surface-muted/35 px-3 py-2" role="status" aria-live="polite">
        <p className="text-label font-medium text-foreground">
          No organizations available.
        </p>
        <p className="text-caption font-normal text-muted">
          Create an organization to begin.
        </p>
      </div>
    );
  }

  const currentName = currentOrganization?.name ?? "Select organization";
  const currentStatus = currentOrganization ? statusLabel(currentOrganization.status) : null;
  const currentIdentity = currentOrganization ? secondaryIdentity(currentOrganization) : null;

  return (
    <div ref={rootRef} id={id} className="relative">
      <button
        ref={triggerRef}
        id={`${id}-trigger`}
        type="button"
        data-tg-primary-target="true"
        aria-label={`Switch organization. Current organization: ${currentName}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen && hasListbox ? listboxId : undefined}
        onClick={() => {
          if (isOpen) {
            closeSwitcher(false);
            return;
          }
          setIsOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !isOpen) {
            event.preventDefault();
            setIsOpen(true);
          } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            setQuery(event.key);
            setResultLimit(ORGANIZATION_RESULT_BATCH_SIZE);
            setIsOpen(true);
          }
        }}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border/45 bg-surface px-3 py-2 text-left text-foreground transition-colors hover:bg-surface-muted/55 focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-caption font-normal text-muted">
            Current organization
          </span>
          <span className="block truncate text-label font-semibold" title={currentName}>
            {currentName}
          </span>
        </span>
        <ChevronUp className={`size-4 shrink-0 text-muted transition-transform ${isOpen ? "" : "rotate-180"}`} aria-hidden="true" />
      </button>
      <p className="sr-only" aria-live="polite">
        {isOpen ? `Organization search opened. Current organization is ${currentName}.` : ""}
      </p>
      {organizationsState === "refreshing" ? (
        <p className="mt-1 text-caption font-normal text-muted" role="status" aria-live="polite">
          Refreshing organizations...
        </p>
      ) : null}
      {organizationsState === "stale" ? (
        <div className="mt-1 flex items-center justify-between gap-2 text-caption text-warning-700" role="alert">
          <p>
            Directory may be out of date.
          </p>
          <button
            type="button"
            onClick={onOrganizationsRetry}
            className="min-h-10 shrink-0 font-semibold underline decoration-warning-300 underline-offset-4 focus-visible:outline-2 focus-visible:outline-warning-700"
          >
            Retry
          </button>
        </div>
      ) : null}
      {isOpen ? (
        <div
          id={`${id}-surface`}
          role="search"
          aria-label="Switch organization"
          data-mobile={mobile ? "true" : "false"}
          className="mt-2 w-full overflow-hidden rounded-lg border border-border/45 bg-surface data-[mobile=false]:absolute data-[mobile=false]:left-0 data-[mobile=false]:z-50 data-[mobile=false]:w-[min(24rem,calc(100vw-2rem))] data-[mobile=false]:shadow-overlay"
        >
          <div className="border-b border-border/35 px-3 py-2.5">
            <p className="truncate text-label font-semibold text-foreground" title={currentName}>
              {currentName}
            </p>
            {currentIdentity && currentStatus ? (
              <p className="truncate text-caption font-normal text-muted" title={`${currentIdentity} · ${currentStatus}`}>
                {currentIdentity}
                <span aria-hidden="true"> · </span>
                {currentStatus}
              </p>
            ) : null}
          </div>
          <div className="p-2">
            <label htmlFor={inputId} className="sr-only">
              Search organizations
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={hasListbox ? listboxId : undefined}
              aria-activedescendant={activeOrganization ? `${id}-option-${safeDomId(activeOrganization.id)}` : undefined}
              value={query}
              placeholder="Search by name, slug, or ID"
              onChange={(event) => {
                setQuery(event.target.value);
                setResultLimit(ORGANIZATION_RESULT_BATCH_SIZE);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeSwitcher(true);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveActiveOption(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveActiveOption(-1);
                } else if (event.key === "Enter" && activeOrganization) {
                  event.preventDefault();
                  selectOrganization(activeOrganization);
                }
              }}
              className="w-full rounded-md border border-border/45 bg-background px-3 py-2.5 text-label text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-primary"
            />
          </div>
          <div className="border-t border-border/30 px-2 pb-2">
            {normalizedQuery ? (
              <p className="px-1 pb-1 pt-2 text-caption font-semibold text-muted">
                Matching organizations
              </p>
            ) : (
              <p className="px-1 pb-1 pt-2 text-caption font-semibold text-muted">
                Recent organizations
              </p>
            )}
            {groupedOrganizations.length > 0 ? (
              <ul
                id={listboxId}
                role="listbox"
                aria-label={normalizedQuery ? "Organization search results" : "Recent organizations"}
                className="max-h-[min(18rem,48vh)] overflow-y-auto"
              >
                {resultGroups.map((group) => (
                  <li key={group.key} role="presentation" className="organization-result-group">
                    {group.duplicate ? (
                      <div
                        role="group"
                        aria-labelledby={`${id}-group-${safeDomId(group.organizations[0].id)}`}
                        className="border-t border-border/25 first:border-t-0"
                      >
                        <p
                          id={`${id}-group-${safeDomId(group.organizations[0].id)}`}
                          className="truncate px-3 pb-1 pt-2 text-caption font-semibold text-foreground"
                          title={group.label}
                        >
                          {group.label}
                        </p>
                        <div className="space-y-0.5 pb-1">
                          {group.organizations.map((organization) => {
                            const optionIndex = groupedOrganizations.findIndex((candidate) => candidate.id === organization.id);
                            return (
                              <OrganizationResultOption
                                key={organization.id}
                                id={`${id}-option-${safeDomId(organization.id)}`}
                                active={optionIndex === activeIndex}
                                current={organization.id === currentOrganizationId}
                                duplicate
                                organization={organization}
                                onActivate={() => setActiveIndex(optionIndex)}
                                onSelect={() => selectOrganization(organization)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <OrganizationResultOption
                        id={`${id}-option-${safeDomId(group.organizations[0].id)}`}
                        active={groupedOrganizations[activeIndex]?.id === group.organizations[0].id}
                        current={group.organizations[0].id === currentOrganizationId}
                        duplicate={false}
                        organization={group.organizations[0]}
                        onActivate={() => setActiveIndex(groupedOrganizations.findIndex((candidate) => candidate.id === group.organizations[0].id))}
                        onSelect={() => selectOrganization(group.organizations[0])}
                      />
                    )}
                  </li>
                ))}
              </ul>
            ) : normalizedQuery ? (
              <div className="px-3 py-4" role="status" aria-live="polite">
                <p className="text-label font-medium text-foreground">
                  No organizations match “{query.trim()}”.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setResultLimit(ORGANIZATION_RESULT_BATCH_SIZE);
                    inputRef.current?.focus();
                  }}
                  className="mt-2 inline-flex min-h-10 items-center text-caption font-semibold text-primary underline decoration-primary/30 underline-offset-4 focus-visible:outline-2 focus-visible:outline-primary"
                >
                  Clear search
                </button>
              </div>
            ) : (
              <p className="px-3 py-4 text-caption font-normal text-muted">
                Search by organization name, slug, or ID.
              </p>
            )}
            {normalizedQuery && rankedOrganizations.length > 0 ? (
              <div className="flex items-center justify-between gap-3 border-t border-border/30 px-3 pt-2">
                <p className="text-caption font-normal text-muted">
                  Showing {groupedOrganizations.length.toLocaleString()} of {rankedOrganizations.length.toLocaleString()} organizations.
                </p>
                {groupedOrganizations.length < rankedOrganizations.length ? (
                  <button
                    type="button"
                    onClick={() => setResultLimit((limit) => limit + ORGANIZATION_RESULT_BATCH_SIZE)}
                    className="min-h-10 shrink-0 text-caption font-semibold text-primary focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    Show {Math.min(ORGANIZATION_RESULT_BATCH_SIZE, rankedOrganizations.length - groupedOrganizations.length)} more organizations
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
