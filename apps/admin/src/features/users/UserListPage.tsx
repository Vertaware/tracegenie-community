import { useEffect,useMemo,useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Filter,Plus,Search,Users } from "lucide-react";

import { PageHeader,PageBackLink } from "../../components/ui/PageHeader";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import {
FilterReset,
FilterSearch,
FilterSelect,
HeaderFilterMenu,
ListEmptyState,
ListErrorState,
ListFilterEmptyState,
ListLoadingState,
RowButton,
Table,
TableDetailAction,
TableShell,
Td,
Th,
} from "../../components/ui/DataTable";
import { Pagination } from "../../components/ui/Pagination";
import { api } from "../../lib/api";
import type { AdminUserSummary } from "../../lib/api";
import { copy } from "../../lib/copy";

type SortKey = "name" | "lastLogin" | "role" | "status";
type SortDir = "asc" | "desc";
type MobileSortValue =
  | "name:asc"
  | "name:desc"
  | "lastLogin:desc"
  | "lastLogin:asc"
  | "role:asc"
  | "role:desc"
  | "status:asc"
  | "status:desc";

const MOBILE_SORTS: Record<MobileSortValue, { sortKey: SortKey; sortDir: SortDir }> = {
  "name:asc": { sortKey: "name", sortDir: "asc" },
  "name:desc": { sortKey: "name", sortDir: "desc" },
  "lastLogin:desc": { sortKey: "lastLogin", sortDir: "desc" },
  "lastLogin:asc": { sortKey: "lastLogin", sortDir: "asc" },
  "role:asc": { sortKey: "role", sortDir: "asc" },
  "role:desc": { sortKey: "role", sortDir: "desc" },
  "status:asc": { sortKey: "status", sortDir: "asc" },
  "status:desc": { sortKey: "status", sortDir: "desc" },
};

const PAGE_SIZE = 10;

type OrganizationRole = NonNullable<AdminUserSummary["organizationRole"]>;

function organizationRoleLabel(role: AdminUserSummary["organizationRole"]) {
  return role ?? "NONE";
}

function effectiveScopeLabel(scope: AdminUserSummary["effectiveAccess"]["scope"]) {
  const labels: Record<AdminUserSummary["effectiveAccess"]["scope"], string> = {
    NONE: "None",
    PLATFORM: "Platform",
    MULTI_ORGANIZATION: "Multiple organizations",
    ALL_PROJECTS: "All products",
    SELECTED_PROJECTS: "Selected products",
    NO_PROJECTS: "No products",
  };
  return labels[scope];
}

function UserAccessSummary({ user }: { user: AdminUserSummary }) {
  const directAssignmentCount = user.projectMemberships.filter((membership) => membership.status !== "DISABLED").length;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label={`Access for ${user.name}`}>
      <Badge tone={user.effectiveAccess.scope === "NONE" || user.effectiveAccess.scope === "NO_PROJECTS" ? "neutral" : "primary"}>
        {effectiveScopeLabel(user.effectiveAccess.scope)}
      </Badge>
      {directAssignmentCount > 0 ? (
        <span className="text-caption text-muted">
          {directAssignmentCount} direct assignment{directAssignmentCount === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}

function UserMobileCard({
  user,
  onOpen,
}: {
  user: AdminUserSummary;
  onOpen: () => void;
}) {
  return (
    <article className="tg-mobile-card tg-card group relative w-full px-4 py-4 text-left transition-colors hover:bg-surface-muted/35">
      <button
        type="button"
        aria-label={`Open ${user.name}`}
        onClick={onOpen}
        className="absolute inset-0 z-10 rounded-[inherit] focus-visible:outline-2 focus-visible:outline-primary active:scale-[0.99]"
      >
        <span className="sr-only">Open {user.name}</span>
      </button>
      <div className="pointer-events-none relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words text-label font-semibold text-foreground">{user.name}</p>
            <p className="mt-1 break-all text-caption text-muted">{user.email}</p>
          </div>
          <div className="shrink-0">
            <Badge tone={user.isActive ? "primary" : "neutral"}>
              {user.isActive ? copy.common.active : copy.common.disabled}
            </Badge>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-caption text-muted">
          <span>Organization role</span>
          <Badge tone={user.organizationRole === "OWNER" ? "primary" : "neutral"}>
            {organizationRoleLabel(user.organizationRole)}
          </Badge>
          <span>{user.lastLoginAt ? `Last sign-in ${new Date(user.lastLoginAt).toLocaleDateString()}` : `Last sign-in ${copy.common.never.toLowerCase()}`}</span>
        </div>
        <div className="mt-3 border-t border-border/35 pt-3">
          <UserAccessSummary user={user} />
        </div>
      </div>
    </article>
  );
}

type UserListPageProps = {
  organizationId?: string | null;
  organizationName?: string | null;
};

export function UserListPage({ organizationId, organizationName }: UserListPageProps) {
  const navigate = useNavigate();

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [nameFilter, setNameFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | OrganizationRole>("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "disabled">("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [openHeaderFilter, setOpenHeaderFilter] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ["users", organizationId],
    queryFn: () => api.getUsers(organizationId),
  });

  const rawUsers = usersQuery.data?.data ?? [];
  const actor = usersQuery.data?.actor;
  const canInviteMembers = Boolean(actor?.capabilities.canInviteMembers);
  const canManageTeam = Boolean(actor?.capabilities.canManageTeam);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  function selectMobileSort(value: string) {
    const nextSort = MOBILE_SORTS[value as MobileSortValue];
    if (!nextSort) return;
    setSortKey(nextSort.sortKey);
    setSortDir(nextSort.sortDir);
    setPage(1);
  }

  const users = useMemo(() => {
    let list = [...rawUsers];
    if (nameFilter) {
      const query = nameFilter.toLowerCase();
      list = list.filter((user) => user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query));
    }
    if (roleFilter) list = list.filter((user) => user.organizationRole === roleFilter);
    if (statusFilter) list = list.filter((user) => (statusFilter === "active" ? user.isActive : !user.isActive));
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      if (sortKey === "role") cmp = organizationRoleLabel(a.organizationRole).localeCompare(organizationRoleLabel(b.organizationRole));
      if (sortKey === "status") cmp = Number(b.isActive) - Number(a.isActive);
      if (sortKey === "lastLogin") {
        if (!a.lastLoginAt && !b.lastLoginAt) return 0;
        if (!a.lastLoginAt) return 1;
        if (!b.lastLoginAt) return -1;
        const aTime = new Date(a.lastLoginAt).getTime();
        const bTime = new Date(b.lastLoginAt).getTime();
        cmp = aTime - bTime;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [rawUsers, nameFilter, roleFilter, statusFilter, sortKey, sortDir]);

  const hasFilters = Boolean(nameFilter || roleFilter || statusFilter);
  const activeFilterCount = [Boolean(nameFilter), Boolean(roleFilter), Boolean(statusFilter)].filter(Boolean).length;
  const nameFilterActive = Boolean(nameFilter);
  const roleFilterActive = Boolean(roleFilter);
  const statusFilterActive = Boolean(statusFilter);
  const pageCount = Math.max(1, Math.ceil(users.length / PAGE_SIZE));
  const pagedUsers = users.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const sort = { sortKey, sortDir };

  function resetFilters() {
    setNameFilter("");
    setRoleFilter("");
    setStatusFilter("");
    setPage(1);
    setOpenHeaderFilter(null);
  }

  function toggleHeaderFilter(menuKey: string) {
    setOpenHeaderFilter((current) => (current === menuKey ? null : menuKey));
  }

  useEffect(() => {
    if (!openHeaderFilter) return;

    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest("[data-header-filter-root='true']")) return;
      setOpenHeaderFilter(null);
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [openHeaderFilter]);

  return (
    <div id="user-list-page" className="space-y-5">
      <PageHeader back={<PageBackLink to="/settings">All organization settings</PageBackLink>}>
        <section id="user-list-header" className="flex flex-wrap items-end justify-between gap-4 px-1 py-1">
          <div>
            <h1 className="text-display text-foreground">{copy.team.title}</h1>
            <p className="mt-0.5 text-body text-muted">
              {organizationName
                ? `${canManageTeam ? "Manage" : "Review"} roles and product access for ${organizationName}.`
                : canManageTeam ? copy.team.subtitle : "Review team roles and product access."}
            </p>
          </div>
          {canInviteMembers ? (
            <Button className="w-full gap-2 rounded-full sm:w-auto" onClick={() => navigate("/users/new")}>
              <Plus className="size-4" />
              {copy.team.add}
            </Button>
          ) : null}
        </section>
      </PageHeader>

      {rawUsers.length > 0 ? (
        <div id="user-list-filter-groups" className="contents">
          <section id="user-list-mobile-filters" className="space-y-3 min-[1024px]:hidden">
            <div className="tg-card p-3">
              <div className="grid gap-2">
                <FilterSearch
                  value={nameFilter}
                  onChange={(value) => {
                    setNameFilter(value);
                    setPage(1);
                  }}
                  placeholder="Search name or email"
                />
                <label id="user-list-mobile-sort" className="grid gap-1">
                  <span className="text-caption font-medium text-foreground">Sort by</span>
                  <FilterSelect
                    ariaLabel="Sort by"
                    value={`${sortKey}:${sortDir}`}
                    onChange={selectMobileSort}
                  >
                    <option value="name:asc">Name A-Z</option>
                    <option value="name:desc">Name Z-A</option>
                    <option value="lastLogin:desc">Last sign-in newest</option>
                    <option value="lastLogin:asc">Last sign-in oldest</option>
                    <option value="role:asc">Role A-Z</option>
                    <option value="role:desc">Role Z-A</option>
                    <option value="status:asc">Active first</option>
                    <option value="status:desc">Disabled first</option>
                  </FilterSelect>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    tone="secondary"
                    className="gap-2 rounded-full"
                    onClick={() => setMobileFiltersOpen((current) => !current)}
                    aria-expanded={mobileFiltersOpen}
                  >
                    <Filter className="size-4" />
                    {mobileFiltersOpen ? copy.common.hideFilters : copy.common.filters}
                    {activeFilterCount > 0 ? (
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary-light px-1.5 py-0.5 text-caption font-semibold text-primary">
                        {activeFilterCount}
                      </span>
                    ) : null}
                  </Button>
                  {hasFilters ? (
                    <FilterReset
                      show={hasFilters}
                      onReset={resetFilters}
                    />
                  ) : null}
                </div>
              </div>
            </div>

            {mobileFiltersOpen ? (
              <section className="tg-panel tg-panel-reveal p-3">
                <div className="grid gap-2">
                  <FilterSelect
                    ariaLabel="Filter by role"
                    value={roleFilter}
                    onChange={(value) => {
                      setRoleFilter(value as "" | OrganizationRole);
                      setPage(1);
                    }}
                  >
                    <option value="">All roles</option>
                    <option value="OWNER">OWNER</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="MEMBER">MEMBER</option>
                  </FilterSelect>
                  <FilterSelect
                    ariaLabel="Filter by status"
                    value={statusFilter}
                    onChange={(value) => {
                      setStatusFilter(value as "" | "active" | "disabled");
                      setPage(1);
                    }}
                  >
                    <option value="">All status</option>
                    <option value="active">{copy.common.active}</option>
                    <option value="disabled">{copy.common.disabled}</option>
                  </FilterSelect>
                </div>
              </section>
            ) : null}
          </section>

        </div>
      ) : null}

      <TableShell id="user-list-table">
        {usersQuery.isLoading ? (
          <div className="p-5">
            <ListLoadingState rows={4} />
          </div>
        ) : usersQuery.isError ? (
          <ListErrorState message="Couldn't load the team." onRetry={() => void usersQuery.refetch()} />
        ) : rawUsers.length === 0 ? (
          <ListEmptyState
            icon={<Users className="size-5" />}
            title={copy.team.emptyTitle}
            body={copy.team.emptyBody}
            action={canInviteMembers ? (
              <Button className="gap-2" onClick={() => navigate("/users/new")}>
                <Plus className="size-4" />
                {copy.team.add}
              </Button>
            ) : undefined}
          />
        ) : (
          <div id="user-list-results" className="contents">
            <div className="hidden min-[1024px]:block" data-table-contract="users">
              <Table className="w-full table-fixed">
                <thead className="bg-transparent text-left">
                  <tr className="border-b border-border/25">
                    <Th
                      className="w-[23%]"
                      sortable
                      col="name"
                      sort={sort}
                      onSort={toggleSort}
                      action={
                        <HeaderFilterMenu
                          menuKey="name"
                          openMenu={openHeaderFilter}
                          onToggle={toggleHeaderFilter}
                          label="Search team"
                          icon={<Search className="size-4" />}
                          active={nameFilterActive}
                        >
                          <FilterSearch
                            value={nameFilter}
                            onChange={(value) => {
                              setNameFilter(value);
                              setPage(1);
                            }}
                            placeholder="Search name or email"
                          />
                          <div className="flex justify-end">
                            <FilterReset show={nameFilterActive} onReset={() => setNameFilter("")} />
                          </div>
                        </HeaderFilterMenu>
                      }
                    >
                      Name
                    </Th>
                    <Th
                      className="w-[14%]"
                      sortable
                      col="role"
                      sort={sort}
                      onSort={toggleSort}
                      action={
                        <HeaderFilterMenu
                          menuKey="role"
                          openMenu={openHeaderFilter}
                          onToggle={toggleHeaderFilter}
                          label="Filter by role"
                          icon={<Filter className="size-4" />}
                          active={roleFilterActive}
                        >
                          <FilterSelect
                            ariaLabel="Filter by role"
                            value={roleFilter}
                            onChange={(value) => {
                              setRoleFilter(value as "" | OrganizationRole);
                              setPage(1);
                            }}
                          >
                            <option value="">All roles</option>
                            <option value="OWNER">OWNER</option>
                            <option value="ADMIN">ADMIN</option>
                            <option value="MEMBER">MEMBER</option>
                          </FilterSelect>
                          <div className="flex justify-end">
                            <FilterReset show={roleFilterActive} onReset={() => setRoleFilter("")} />
                          </div>
                        </HeaderFilterMenu>
                      }
                    >
                      Organization role
                    </Th>
                    <Th className="w-[32%]">Effective access</Th>
                    <Th className="w-[13%]" sortable col="lastLogin" sort={sort} onSort={toggleSort}>
                      Last sign-in
                    </Th>
                    <Th
                      className="w-[10%]"
                      sortable
                      col="status"
                      sort={sort}
                      onSort={toggleSort}
                      action={
                        <HeaderFilterMenu
                          menuKey="status"
                          openMenu={openHeaderFilter}
                          onToggle={toggleHeaderFilter}
                          label="Filter by status"
                          icon={<Filter className="size-4" />}
                          active={statusFilterActive}
                        >
                          <FilterSelect
                            ariaLabel="Filter by status"
                            value={statusFilter}
                            onChange={(value) => {
                              setStatusFilter(value as "" | "active" | "disabled");
                              setPage(1);
                            }}
                          >
                            <option value="">All status</option>
                            <option value="active">{copy.common.active}</option>
                            <option value="disabled">{copy.common.disabled}</option>
                          </FilterSelect>
                          <div className="flex justify-end">
                            <FilterReset show={statusFilterActive} onReset={() => setStatusFilter("")} />
                          </div>
                        </HeaderFilterMenu>
                      }
                    >
                      Status
                    </Th>
                    <Th className="w-12"><span className="sr-only">Open</span></Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/25">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <ListFilterEmptyState
                          title="No team members match these filters"
                          body="Clear the current filters to return to the full team list."
                          actionLabel="Clear team filters"
                          onAction={resetFilters}
                        />
                      </td>
                    </tr>
                  ) : (
                    pagedUsers.map((user) => (
                      <RowButton key={user.id} onActivate={() => navigate(`/users/${user.id}`, { state: { returnTo: "/users" } })} ariaLabel={`Open ${user.name}`} activationControl>
                        <Td className="text-label font-medium text-foreground transition-colors group-hover:text-primary">
                          <span className="block break-words">{user.name}</span>
                          <span className="mt-1 block break-all text-caption font-normal text-muted">{user.email}</span>
                        </Td>
                        <Td>
                          <Badge tone={user.organizationRole === "OWNER" ? "primary" : "neutral"}>
                            {organizationRoleLabel(user.organizationRole)}
                          </Badge>
                        </Td>
                        <Td className="align-top">
                          <UserAccessSummary user={user} />
                        </Td>
                        <Td className="text-label text-muted">
                          {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : copy.common.never}
                        </Td>
                        <Td>
                          <Badge tone={user.isActive ? "primary" : "neutral"}>
                            {user.isActive ? copy.common.active : copy.common.disabled}
                          </Badge>
                        </Td>
                        <Td className="px-2 text-right">
                          <TableDetailAction label={`Open ${user.name}`} onClick={() => navigate(`/users/${user.id}`, { state: { returnTo: "/users" } })} />
                        </Td>
                      </RowButton>
                    ))
                  )}
                </tbody>
              </Table>
            </div>
            <div className="grid gap-3 min-[1024px]:hidden">
              {users.length === 0 ? (
                <ListFilterEmptyState
                  title="No team members match these filters"
                  body="Clear the current filters to return to the full team list."
                  actionLabel="Clear team filters"
                  onAction={resetFilters}
                />
              ) : (
                pagedUsers.map((user) => (
                  <UserMobileCard
                    key={user.id}
                    user={user}
                    onOpen={() => navigate(`/users/${user.id}`, { state: { returnTo: "/users" } })}
                  />
                ))
              )}
            </div>
            <Pagination page={page} pageCount={pageCount} total={users.length} pageSize={PAGE_SIZE} onPage={setPage} />
          </div>
        )}
      </TableShell>
    </div>
  );
}
