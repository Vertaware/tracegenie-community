import { useEffect,useLayoutEffect,useRef,useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";

import { PageHeader } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { useAdminFormExitGuard } from "../../components/guards/AdminFormExitGuard";
import { Input } from "../../components/ui/Input";
import { MutationRecovery,mutationRecoveryEntry } from "../../components/ui/MutationRecovery";
import { Select } from "../../components/ui/Select";
import { api } from "../../lib/api";
import { copy } from "../../lib/copy";

const inviteMemberSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  orgRole: z.enum(["ADMIN", "MEMBER"]),
  projectIds: z.array(z.string()),
  projectRole: z.enum(["PROJECT_ADMIN", "TRIAGER", "VIEWER"]),
});

type InviteMemberValues = z.infer<typeof inviteMemberSchema>;
type InviteMemberMutation = {
  organizationId: string;
  organizationGeneration: number;
  values: InviteMemberValues;
};

type InviteMemberPageProps = {
  organizationId?: string | null;
  organizationName?: string | null;
};

const EMPTY_INVITE_VALUES: InviteMemberValues = {
  email: "",
  orgRole: "MEMBER",
  projectIds: [],
  projectRole: "TRIAGER",
};

export function InviteMemberPage({ organizationId, organizationName }: InviteMemberPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const organizationRef = useRef({ organizationId, generation: 0 });
  const actionLockRef = useRef<symbol | null>(null);
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const projectsQuery = useQuery({
    queryKey: ["projects", organizationId],
    queryFn: () => api.getProjects(organizationId ?? null),
    enabled: Boolean(organizationId),
  });
  const form = useForm<InviteMemberValues>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: EMPTY_INVITE_VALUES,
  });
  const organizationRoleField = form.register("orgRole");
  const selectedProjectIds = form.watch("projectIds");
  const organizationRole = form.watch("orgRole");
  const projectRole = form.watch("projectRole");
  const projects = projectsQuery.data?.projects ?? [];
  const filteredProjects = projects.filter((project) => project.name.toLowerCase().includes(projectSearch.trim().toLowerCase()));
  const selectedProjectNames = projects
    .filter((project) => selectedProjectIds.includes(project.id))
    .map((project) => project.name);
  const projectRoleLabel = projectRole === "PROJECT_ADMIN"
    ? "Product administrator"
    : projectRole === "VIEWER"
      ? "Read-only viewer"
      : "Triager";
  const organizationLabel = organizationName?.trim() || "this organization";
  const organizationMessageSuffix = organizationName?.trim() ? ` for ${organizationName.trim()}` : "";

  const mutation = useMutation({
    mutationFn: ({ organizationId: submittedOrganizationId, values }: InviteMemberMutation) => api.createInvite(submittedOrganizationId, {
        email: values.email,
        orgRole: values.orgRole,
        ...(values.orgRole === "MEMBER" && values.projectIds.length > 0
          ? {
              projectIds: values.projectIds,
              projectRole: values.projectRole,
            }
          : {}),
      }),
    onSuccess: (result, submitted) => {
      if (
        organizationRef.current.organizationId !== submitted.organizationId
        || organizationRef.current.generation !== submitted.organizationGeneration
      ) {
        return;
      }
      setAcceptUrl(result.invite.acceptUrl ?? null);
      void queryClient.invalidateQueries({ queryKey: ["users", submitted.organizationId] });
      form.reset(submitted.values);
    },
  });

  useLayoutEffect(() => {
    if (organizationRef.current.organizationId !== organizationId) {
      organizationRef.current = {
        organizationId,
        generation: organizationRef.current.generation + 1,
      };
    }
  }, [organizationId]);

  useEffect(() => {
    actionLockRef.current = null;
    setAcceptUrl(null);
    setProjectSearch("");
    form.reset(EMPTY_INVITE_VALUES);
    mutation.reset();
  }, [organizationId]);

  const runInviteMutation = (submitted: InviteMemberMutation) => {
    if (actionLockRef.current !== null) {
      return;
    }
    const lock = Symbol("invite-member");
    actionLockRef.current = lock;
    mutation.mutate(submitted, {
      onSettled: () => {
        if (actionLockRef.current === lock) {
          actionLockRef.current = null;
        }
      },
    });
  };

  const mutationRecovery = mutationRecoveryEntry(mutation, {
    id: "invite-member",
    message: (submitted) => `Couldn't send the invite to ${submitted?.values.email ?? form.getValues("email")}${organizationMessageSuffix}.`,
    successMessage: (_data, submitted) => `Invite sent to ${submitted?.values.email ?? form.getValues("email")}${organizationMessageSuffix}.`,
    retryLabel: "Retry sending invite",
    retry: runInviteMutation,
  });
  useAdminFormExitGuard({
    id: `invite-member-${organizationId ?? "none"}`,
    isDirty: form.formState.isDirty,
    isMutationPending: mutation.isPending,
    onDiscard: () => {
      form.reset(EMPTY_INVITE_VALUES);
      setProjectSearch("");
      setAcceptUrl(null);
    },
  });

  return (
    <div id="invite-member-page" className="space-y-5">
      <PageHeader back={<button
        type="button"
        onClick={() => navigate("/users")}
        className="inline-flex min-h-10 items-center gap-1.5 rounded text-label font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
      >
        <ArrowLeft className="size-4" />
        {copy.nav.team}
      </button>}>
        <section id="invite-member-header" className="px-1 py-1">
          <h1 className="text-display text-foreground">Invite member</h1>
          <p className="mt-0.5 max-w-2xl text-body text-muted">Send an invite to {organizationLabel} so the member can set their own password.</p>
        </section>
      </PageHeader>

      <MutationRecovery id="invite-member-mutation-recovery" entries={[mutationRecovery]} />

      <section id="invite-member-form-section" className="border-t border-border pt-5">
        <h2 className="text-title text-foreground">Invite details</h2>
        <form
          id="invite-member-form"
          className="mt-4 grid gap-4 lg:grid-cols-2"
          onSubmit={form.handleSubmit((values) => {
            if (!organizationId) {
              return;
            }
            runInviteMutation({
              organizationId,
              organizationGeneration: organizationRef.current.generation,
              values,
            });
          })}
        >
          <div>
            <label htmlFor="invite-member-email" className="mb-1.5 block text-label font-medium text-foreground">
              Email
            </label>
            <Input id="invite-member-email" type="email" {...form.register("email")} />
            {form.formState.errors.email ? (
              <p className="mt-1 text-caption text-danger-700">{form.formState.errors.email.message}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="invite-member-role" className="mb-1.5 block text-label font-medium text-foreground">
              Organization role
            </label>
            <Select
              id="invite-member-role"
              {...organizationRoleField}
              onChange={(event) => {
                void organizationRoleField.onChange(event);
                if (event.target.value === "ADMIN") {
                  form.setValue("projectIds", [], { shouldDirty: true, shouldValidate: true });
                }
              }}
            >
              <option value="MEMBER">Member: product access</option>
              <option value="ADMIN">Administrator: manage organization</option>
            </Select>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label id="invite-member-projects-label" className="block text-label font-medium text-foreground">
                Product access
              </label>
              <span className="tg-badge text-caption text-muted">
                {organizationRole === "ADMIN" ? "All products" : `${selectedProjectIds.length} selected`}
              </span>
            </div>
            <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <Input
                id="invite-member-project-search"
                className="col-span-2 sm:col-span-1"
                value={projectSearch}
                placeholder="Search products"
                disabled={projectsQuery.isLoading || !organizationId || organizationRole === "ADMIN"}
                onChange={(event) => setProjectSearch(event.target.value)}
              />
              <button
                id="invite-member-select-visible-projects"
                type="button"
                className="tg-action-button h-9 rounded-lg px-3 text-label text-primary transition-colors hover:bg-primary-light"
                disabled={organizationRole === "ADMIN" || filteredProjects.length === 0}
                onClick={() => {
                  const nextProjectIds = Array.from(new Set([...selectedProjectIds, ...filteredProjects.map((project) => project.id)]));
                  form.setValue("projectIds", nextProjectIds, { shouldDirty: true, shouldValidate: true });
                }}
              >
                Select visible
              </button>
              <button
                id="invite-member-clear-projects"
                type="button"
                className="tg-action-button h-9 rounded-lg px-3 text-label text-muted transition-colors hover:bg-surface-muted/55 hover:text-foreground"
                disabled={organizationRole === "ADMIN" || selectedProjectIds.length === 0}
                onClick={() => form.setValue("projectIds", [], { shouldDirty: true, shouldValidate: true })}
              >
                Clear
              </button>
            </div>
            <div
              id="invite-member-projects"
              role="group"
              aria-labelledby="invite-member-projects-label"
              className="max-h-56 overflow-auto rounded-xl border border-border bg-surface px-3 py-2"
            >
              {filteredProjects.length === 0 ? (
                <p className="py-2 text-caption text-muted">{projectsQuery.isLoading ? "Loading products." : "No matching products."}</p>
              ) : null}
              {filteredProjects.map((project) => (
                <label key={project.id} className="tg-choice-row flex items-center gap-3 border-t border-border/25 py-2 text-label text-foreground first:border-t-0">
                  <input
                    type="checkbox"
                    value={project.id}
                    disabled={projectsQuery.isLoading || !organizationId || organizationRole === "ADMIN"}
                    className="size-4 rounded border-border text-primary focus:ring-primary"
                    {...form.register("projectIds")}
                  />
                  <span className="min-w-0 truncate">{project.name}</span>
                </label>
              ))}
            </div>
            {projectsQuery.isError ? (
              <p className="mt-1 text-caption text-danger-700">Could not load products for this organization.</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="invite-member-project-role" className="mb-1.5 block text-label font-medium text-foreground">
              Product role
            </label>
            <Select
              id="invite-member-project-role"
              disabled={organizationRole === "ADMIN" || selectedProjectIds.length === 0}
              {...form.register("projectRole")}
            >
              <option value="TRIAGER">Triager: manage issues</option>
              <option value="VIEWER">Viewer: read-only product access</option>
              <option value="PROJECT_ADMIN">Product administrator: manage product</option>
            </Select>
            {organizationRole === "ADMIN" ? (
              <p className="mt-1 text-caption text-muted">Administrators automatically access all products.</p>
            ) : selectedProjectIds.length === 0 ? (
              <p className="mt-1 text-caption text-muted">Select one or more products to choose a product role.</p>
            ) : (
              <p className="mt-1 text-caption text-muted">This role applies to all selected products.</p>
            )}
          </div>
          <section
            id="invite-member-effective-access"
            aria-labelledby="invite-member-effective-access-title"
            aria-live="polite"
            className="border-t border-border/35 pt-4 lg:col-span-2"
          >
            <h3 id="invite-member-effective-access-title" className="text-label font-semibold text-foreground">
              Effective access
            </h3>
            {organizationRole === "ADMIN" ? (
              <p className="mt-1 text-caption leading-relaxed text-muted">
                Administrators can manage this organization and access all current and future products. Product selections do not restrict administrator access.
              </p>
            ) : selectedProjectNames.length === 0 ? (
              <p className="mt-1 text-caption leading-relaxed text-muted">
                This member will have no product access. Select one or more products to grant access.
              </p>
            ) : (
              <p className="mt-1 text-caption leading-relaxed text-muted">
                This member will have {projectRoleLabel.toLowerCase()} access to {selectedProjectNames.join(", ")}.
              </p>
            )}
          </section>
          <div className="flex flex-wrap gap-2 lg:col-span-2">
            <Button type="submit" disabled={mutation.isPending || !organizationId}>
              {mutation.isPending ? "Sending invite..." : "Send invite"}
            </Button>
            <Button type="button" tone="secondary" onClick={() => navigate("/users")}>
              Cancel
            </Button>
          </div>
        </form>
        {acceptUrl ? (
          <div id="invite-member-fallback-url" className="tg-panel-reveal mt-5 border-t border-border/35 pt-4">
            <p className="text-label text-foreground">Invite link</p>
            <p id="invite-member-accept-url" className="mt-1 break-all text-caption text-muted">{acceptUrl}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
