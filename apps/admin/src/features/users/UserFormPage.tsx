import { useEffect,useRef,useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { useLocation,useNavigate,useParams } from "react-router-dom";
import { ArrowLeft,Eye,EyeOff } from "lucide-react";

import { PageHeader } from "../../components/ui/PageHeader";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { useAdminFormExitGuard } from "../../components/guards/AdminFormExitGuard";
import { Input } from "../../components/ui/Input";
import { MutationRecovery,mutationRecoveryEntry } from "../../components/ui/MutationRecovery";
import { Select } from "../../components/ui/Select";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { CommitBar } from "../../components/ui/CommitBar";
import { api } from "../../lib/api";
import type { AccessCapabilities,AdminUserSummary } from "../../lib/api";
import { copy } from "../../lib/copy";

const userFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  email: z.string().email("Enter a valid email address."),
  organizationRole: z.enum(["OWNER", "ADMIN", "MEMBER"]),
  password: z.string().refine(
    (value) => value.length === 0 || value.length >= 8,
    "Password must be at least 8 characters.",
  ),
});

type UserFormInput = z.input<typeof userFormSchema>;
type UserFormValues = z.output<typeof userFormSchema>;
type UserSaveMutation = {
  organizationId?: string | null;
  userId: string;
  isOwnProfile: boolean;
  values: UserFormValues;
};
type UserAccessMutation = {
  organizationId?: string | null;
  userId: string;
  userName: string;
  nextIsActive: boolean;
};

type UserFormPageProps = {
  organizationId?: string | null;
  organizationName?: string | null;
  currentUserId?: string | null;
};

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

function projectRoleLabel(role: AdminUserSummary["projectMemberships"][number]["role"]) {
  if (role === "PROJECT_ADMIN") return "Product administrator";
  if (role === "TRIAGER") return "Triager";
  return "Viewer";
}

function capabilityLabels(capabilities: AccessCapabilities) {
  if (capabilities.canManagePlatform) {
    return ["Manage the platform, organizations, teams, owners, and products"];
  }

  const labels: string[] = [];
  if (capabilities.canManageOrganization) labels.push("Manage organization settings");
  if (capabilities.canManageTeam && capabilities.canInviteMembers) labels.push("Manage the team and invite members");
  else if (capabilities.canManageTeam) labels.push("Manage the team");
  else if (capabilities.canInviteMembers) labels.push("Invite members");
  if (capabilities.canManageOwners) labels.push("Manage organization owners");

  if (capabilities.canManageProject) labels.push("Manage products and their feedback");
  else if (capabilities.canWriteProject || capabilities.canTriageProject) labels.push("View, edit, and triage product feedback");
  else if (capabilities.canViewProject) labels.push("View product feedback");

  return labels.length > 0 ? labels : ["No active capabilities"];
}

export function UserFormPage({ organizationId, organizationName, currentUserId }: UserFormPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const activeTargetRef = useRef({ id, organizationId });
  const actionLockRef = useRef<symbol | null>(null);
  const passwordErrorRef = useRef<HTMLParagraphElement | null>(null);
  const [accessTarget, setAccessTarget] = useState<UserAccessMutation | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const isSelfRoute = Boolean(currentUserId && id === currentUserId);

  activeTargetRef.current = { id, organizationId };

  const userQuery = useQuery({
    queryKey: ["user-detail", organizationId, id, isSelfRoute ? "self" : "managed"],
    queryFn: async () => {
      if (isSelfRoute) {
        const result = await api.getSelfProfile(organizationId);
        return { actor: null, user: result.data };
      }
      const result = await api.getUsers(organizationId);
      return {
        actor: result.actor,
        user: result.data.find((user) => user.id === id) ?? null,
      };
    },
    enabled: Boolean(id),
  });

  const existingUser = userQuery.data?.user;
  const actor = userQuery.data?.actor;
  const isOwnProfile = Boolean(isSelfRoute || (id && id === actor?.id));
  const canEditPassword = isOwnProfile;

  const form = useForm<UserFormInput, undefined, UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: {
      name: "",
      email: "",
      organizationRole: "MEMBER",
      password: "",
    },
  });

  useEffect(() => {
    if (existingUser) {
      form.reset({
        name: existingUser.name,
        email: existingUser.email,
        organizationRole: existingUser.organizationRole ?? "MEMBER",
        password: "",
      });
    }
  }, [existingUser, form]);

  const mutation = useMutation({
    mutationFn: (submitted: UserSaveMutation) => {
      const { values } = submitted;
      if (submitted.isOwnProfile) {
        const updatePayload: { organizationId?: string; name: string; password?: string } = {
          ...(submitted.organizationId ? { organizationId: submitted.organizationId } : {}),
          name: values.name,
        };
        if (values.password) {
          if (values.password.length < 8) throw new Error("Password must be at least 8 characters.");
          updatePayload.password = values.password;
        }
        return api.updateSelfProfile(updatePayload);
      }
      return api.updateUser(submitted.userId, {
        ...(submitted.organizationId ? { organizationId: submitted.organizationId } : {}),
        role: values.organizationRole === "ADMIN" ? "ADMIN" : "TRIAGER",
      });
    },
    onSuccess: (_, submitted) => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["user-detail"] });
      const activeTarget = activeTargetRef.current;
      const isCurrentTarget = activeTarget.organizationId === submitted.organizationId
        && activeTarget.id === submitted.userId;
      if (!isCurrentTarget) {
        return;
      }
      form.reset({ ...submitted.values, password: "" });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (submitted: UserAccessMutation) => api.updateUser(submitted.userId, {
      ...(submitted.organizationId ? { organizationId: submitted.organizationId } : {}),
      isActive: submitted.nextIsActive,
    }),
    onSuccess: (_, submitted) => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["user-detail"] });
      if (activeTargetRef.current.id === submitted.userId
        && activeTargetRef.current.organizationId === submitted.organizationId) {
        setAccessTarget(null);
      }
    },
    onError: (_error, submitted) => {
      if (activeTargetRef.current.id === submitted.userId
        && activeTargetRef.current.organizationId === submitted.organizationId) {
        setAccessTarget(null);
      }
    },
  });

  useEffect(() => {
    actionLockRef.current = null;
    setAccessTarget(null);
    mutation.reset();
    deactivateMutation.reset();
    if (!existingUser) {
      form.reset({
        name: "",
        email: "",
        organizationRole: "MEMBER",
        password: "",
      });
    }
  }, [id, organizationId]);

  const runUserSave = (submitted: UserSaveMutation) => {
    if (actionLockRef.current !== null) return;
    const lock = Symbol("user-save");
    actionLockRef.current = lock;
    mutation.mutate(submitted, {
      onSettled: () => {
        if (actionLockRef.current === lock) actionLockRef.current = null;
      },
    });
  };
  const runUserAccess = (submitted: UserAccessMutation) => {
    if (actionLockRef.current !== null) return;
    const lock = Symbol("user-access");
    actionLockRef.current = lock;
    deactivateMutation.mutate(submitted, {
      onSettled: () => {
        if (actionLockRef.current === lock) actionLockRef.current = null;
      },
    });
  };

  const fieldId = (name: string) => `user-form-${id ?? "unknown"}-${name}`;
  const isDirty = form.formState.isDirty;
  const isActive = Boolean(existingUser?.isActive);
  const canEditName = isOwnProfile;
  const canManageTarget = Boolean(
    !isOwnProfile
      && existingUser
      && actor?.capabilities.canManageTeam
      && (existingUser.organizationRole !== "OWNER" || actor.capabilities.canManageOwners),
  );
  const canEditOrganizationRole = Boolean(canManageTarget && organizationId && existingUser?.organizationRole);
  const submit = form.handleSubmit((values) => {
    if (!id) return;
    runUserSave({ organizationId, userId: id, isOwnProfile, values });
  });
  const userMutationBusy = mutation.isPending || deactivateMutation.isPending;

  useEffect(() => {
    if (form.formState.errors.password) {
      passwordErrorRef.current?.focus();
    }
  }, [form.formState.errors.password]);

  const discardUserChanges = () => {
    if (!existingUser) return;
    form.reset({
      name: existingUser.name,
      email: existingUser.email,
      organizationRole: existingUser.organizationRole ?? "MEMBER",
      password: "",
    });
  };
  useAdminFormExitGuard({
    id: `user-form-${id ?? "unknown"}-${organizationId ?? "none"}`,
    isDirty,
    isMutationPending: userMutationBusy,
    onDiscard: discardUserChanges,
  });
  const mutationRecoveryEntries = [
    mutationRecoveryEntry(mutation, {
      id: "user-save",
      message: (submitted) => `Couldn't save ${submitted?.values.name ?? existingUser?.name ?? "the member"}.`,
      successMessage: (_data, submitted) => `${submitted?.values.name ?? existingUser?.name ?? "Member"} saved.`,
      retryLabel: "Retry saving member",
      retry: runUserSave,
    }),
    mutationRecoveryEntry(deactivateMutation, {
      id: "user-deactivate",
      message: (submitted) => `Couldn't ${submitted?.nextIsActive ? "reactivate" : "deactivate"} ${submitted?.userName ?? existingUser?.name ?? "the member"}.`,
      successMessage: (_data, submitted) => `${submitted?.userName ?? existingUser?.name ?? "Member"} ${submitted?.nextIsActive ? "reactivated" : "deactivated"}.`,
      retryLabel: deactivateMutation.variables?.nextIsActive ? "Retry reactivation" : "Retry deactivation",
      retry: runUserAccess,
    }),
  ];

  const openDeactivateDialog = () => {
    if (!id || !canManageTarget || !existingUser?.isActive) return;
    setAccessTarget({
      organizationId,
      userId: id,
      userName: existingUser.name,
      nextIsActive: false,
    });
  };

  const reactivateUser = () => {
    if (!id || !canManageTarget || !existingUser || existingUser.isActive) return;
    runUserAccess({
      organizationId,
      userId: id,
      userName: existingUser.name,
      nextIsActive: true,
    });
  };
  const effectiveCapabilities = existingUser ? capabilityLabels(existingUser.effectiveAccess.capabilities) : [];
  const organizationLabel = organizationName ?? "this organization";
  const returnToTeam = location.state?.returnTo === "/users" || !isOwnProfile;

  return (
    <div id="user-form-page" className={`space-y-4 ${isDirty ? "pb-40 md:pb-24" : "pb-4"}`}>
      <PageHeader back={<button
        type="button"
        onClick={() => navigate(returnToTeam ? "/users" : "/home")}
        className="tg-inline-link inline-flex min-h-10 items-center gap-1.5 rounded text-label font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
      >
        <ArrowLeft className="size-4" />
        {returnToTeam ? "Back to team" : "Back to home"}
      </button>}>
        <section id="user-form-header" className="flex flex-wrap items-end justify-between gap-4 px-1 py-1">
          <div>
            <h1 className="flex items-center gap-3 text-display text-foreground">
              {existingUser?.name || "Member"}
              {existingUser ? (
                <Badge tone={existingUser.isActive ? "primary" : "neutral"}>
                  {existingUser.isActive ? copy.common.active : copy.common.disabled}
                </Badge>
              ) : null}
            </h1>
            <p className="mt-0.5 max-w-2xl text-body text-muted">
              {isOwnProfile
                ? `Profile details and password${organizationName ? ` for ${organizationName}` : ""}.`
                : `Profile details and access${organizationName ? ` for ${organizationName}` : ""}.`}
            </p>
          </div>
          {canManageTarget && existingUser?.isActive ? (
            <Button tone="danger" disabled={userMutationBusy} onClick={openDeactivateDialog}>
              Deactivate
            </Button>
          ) : null}
          {canManageTarget && existingUser && !existingUser.isActive ? (
            <Button disabled={userMutationBusy} onClick={reactivateUser}>
              Reactivate
            </Button>
          ) : null}
        </section>
      </PageHeader>

      <MutationRecovery id="user-form-mutation-recovery" entries={mutationRecoveryEntries} />

      {userQuery.isError ? (
        <section id="user-form-load-error" role="alert" className="border-t border-border pt-5">
          <h2 className="text-title text-foreground">{isSelfRoute ? "Couldn't load your profile" : "Couldn't load this member"}</h2>
          <p className="mt-1 max-w-2xl text-body text-muted">
            {isSelfRoute
              ? "Try again. Your profile details have not been changed."
              : "You may not have permission to view another team member in this organization."}
          </p>
          <Button tone="secondary" className="mt-4" onClick={() => void userQuery.refetch()}>
            Try again
          </Button>
        </section>
      ) : userQuery.isLoading ? (
        <p id="user-form-loading" role="status" className="border-t border-border pt-5 text-body text-muted">Loading member details.</p>
      ) : !existingUser ? (
        <section id="user-form-not-found" className="border-t border-border pt-5">
          <h2 className="text-title text-foreground">Member not found</h2>
          <p className="mt-1 text-body text-muted">This member is not available in {organizationLabel}.</p>
        </section>
      ) : (
        <div id="user-form-content" className="contents">
          <section id="user-form-profile" aria-labelledby="user-form-profile-title" className="border-t border-border pt-5">
        <h2 id="user-form-profile-title" className="text-title text-foreground">Profile</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <label htmlFor={fieldId("name")} className="mb-1.5 block text-label font-medium text-foreground">
              Full name
            </label>
            <Input id={fieldId("name")} {...form.register("name")} disabled={!canEditName} />
            {form.formState.errors.name ? (
              <p className="mt-1 text-caption text-danger-700">{form.formState.errors.name.message}</p>
            ) : !canEditName ? (
              <p className="mt-1 text-caption text-muted">Members manage their own profile name.</p>
            ) : null}
          </div>

          <div>
            <label htmlFor={fieldId("email")} className="mb-1.5 block text-label font-medium text-foreground">
              Email
            </label>
            <Input id={fieldId("email")} type="email" {...form.register("email")} disabled />
            {form.formState.errors.email ? (
              <p className="mt-1 text-caption text-danger-700">{form.formState.errors.email.message}</p>
            ) : (
              <p className="mt-1 text-caption text-muted">Email can't change after creation.</p>
            )}
          </div>

          {canEditPassword ? (
            <div id="user-form-password-field">
              <label htmlFor={fieldId("password")} className="mb-1.5 block text-label font-medium text-foreground">
                New password
              </label>
              <div className="relative">
                <Input
                  id={fieldId("password")}
                  type={isPasswordVisible ? "text" : "password"}
                  {...form.register("password")}
                  className="pr-10"
                  autoComplete="new-password"
                  aria-describedby={form.formState.errors.password ? `${fieldId("password")}-error` : `${fieldId("password")}-hint`}
                  aria-invalid={Boolean(form.formState.errors.password)}
                />
                <Button
                  type="button"
                  tone="ghost"
                  className="absolute right-0 top-0 h-9 w-9 rounded-lg px-0"
                  aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                  aria-pressed={isPasswordVisible}
                  onClick={() => setIsPasswordVisible((visible) => !visible)}
                >
                  {isPasswordVisible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                </Button>
              </div>
              {form.formState.errors.password ? (
                <p
                  id={`${fieldId("password")}-error`}
                  ref={passwordErrorRef}
                  tabIndex={-1}
                  role="alert"
                  className="mt-1 text-caption text-danger-700 focus-visible:outline-2 focus-visible:outline-danger-700"
                >
                  {form.formState.errors.password.message}
                </p>
              ) : (
                <p id={`${fieldId("password")}-hint`} className="mt-1 text-caption text-muted">
                  Leave blank to keep the current password.
                </p>
              )}
            </div>
          ) : (
            <div id="user-form-password-self-service-note" className="border-t border-border/35 pt-3 lg:border-t-0 lg:pt-0">
              <p className="text-label font-medium text-foreground">Password</p>
              <p className="mt-1 text-caption leading-relaxed text-muted">Only the member can change this password.</p>
            </div>
          )}
        </div>
          </section>

          <section id="user-form-access" aria-labelledby="user-form-access-title" className="border-t border-border pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="user-form-access-title" className="text-title text-foreground">Access in {organizationLabel}</h2>
            <p className="mt-1 text-caption text-muted">Organization role, effective product scope, and active capabilities.</p>
          </div>
          {existingUser ? (
            <Badge tone={existingUser.effectiveAccess.scope === "NONE" || existingUser.effectiveAccess.scope === "NO_PROJECTS" ? "neutral" : "primary"}>
              {effectiveScopeLabel(existingUser.effectiveAccess.scope)}
            </Badge>
          ) : null}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <p id={fieldId("organization-role-label")} className="mb-1.5 text-label font-medium text-foreground">
              Organization role
            </p>
            {existingUser?.organizationRole ? (
              <Select
                id={fieldId("organization-role")}
                aria-labelledby={fieldId("organization-role-label")}
                {...form.register("organizationRole")}
                disabled={!canEditOrganizationRole}
              >
                {existingUser.organizationRole === "OWNER" ? <option value="OWNER" disabled>OWNER: manage owners and organization</option> : null}
                <option value="ADMIN">ADMIN: manage organization and all products</option>
                <option value="MEMBER">MEMBER: access assigned products</option>
              </Select>
            ) : (
              <div id={fieldId("organization-role")} aria-labelledby={fieldId("organization-role-label")} className="flex h-9 items-center">
                <Badge tone="neutral">NONE</Badge>
              </div>
            )}
            {isOwnProfile ? (
              <p className="mt-1 text-caption text-muted">Your organization role is read-only here.</p>
            ) : existingUser?.organizationRole === "OWNER" && !actor?.capabilities.canManageOwners ? (
              <p className="mt-1 text-caption text-muted">Only an organization owner can change another owner's access.</p>
            ) : !canEditOrganizationRole ? (
              <p className="mt-1 text-caption text-muted">You can review this role but cannot change it.</p>
            ) : existingUser?.organizationRole === "OWNER" ? (
              <p className="mt-1 text-caption text-muted">Changing this role removes owner access.</p>
            ) : (
              <p className="mt-1 text-caption text-muted">ADMIN has all-product access; MEMBER access comes from product assignments.</p>
            )}
          </div>

          <div id="user-form-access-state">
            <p className="text-label font-medium text-foreground">Console access</p>
            <p className="mt-1 text-caption leading-relaxed text-muted">
              {isOwnProfile
                ? `Your access is ${isActive ? "active" : "disabled"} and cannot be changed here.`
                : canManageTarget
                  ? `Access is ${isActive ? "active" : "disabled"}. Use the ${isActive ? "Deactivate" : "Reactivate"} action above to change it.`
                  : `Access is ${isActive ? "active" : "disabled"}. You can review it but cannot change it.`}
            </p>
          </div>

          <div className="lg:col-span-2">
            <h3 className="text-label font-semibold text-foreground">Scoped products</h3>
            {existingUser?.projectMemberships.length ? (
              <div>
                {existingUser.effectiveAccess.allProjects ? (
                  <p className="mt-1 text-caption text-muted">Direct assignments shown below do not limit all-product access.</p>
                ) : null}
                <ul aria-label="Scoped products" className="mt-2 divide-y divide-border/35 border-y border-border/35">
                  {existingUser.projectMemberships.map((membership) => (
                    <li key={membership.project.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2 text-caption">
                      <span className="min-w-0 break-words font-medium text-foreground">{membership.project.name}</span>
                      <span className="text-muted">
                        {projectRoleLabel(membership.role)}{membership.status === "DISABLED" ? " - disabled" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-1 text-caption text-muted">
                {existingUser.effectiveAccess.allProjects
                  ? "Access comes from the organization or platform role; no individual product assignments."
                  : "No scoped products."}
              </p>
            )}
          </div>

          <div className="lg:col-span-2">
            <h3 className="text-label font-semibold text-foreground">Effective capabilities</h3>
            <ul aria-label="Effective capabilities" className="mt-2 grid gap-1 text-caption leading-relaxed text-muted sm:grid-cols-2">
              {effectiveCapabilities.map((capability) => <li key={capability}>{capability}</li>)}
            </ul>
          </div>
        </div>
          </section>
        </div>
      )}

      <CommitBar
        id="user-form-commit-bar"
        isVisible={isDirty}
        isPending={userMutationBusy}
        status="Unsaved changes"
        onDiscard={discardUserChanges}
        onSave={() => void submit()}
        saveLabel="Save changes"
      />

      <ConfirmDialog
        isOpen={Boolean(accessTarget)}
        title="Deactivate account"
        description={`${accessTarget?.userName ?? "This member"} will lose access to ${organizationName ?? "this organization"}. Their history is preserved.`}
        confirmText="Deactivate"
        confirmTone="danger"
        isPending={userMutationBusy}
        onConfirm={() => {
          if (accessTarget) runUserAccess(accessTarget);
        }}
        onCancel={() => setAccessTarget(null)}
      />
    </div>
  );
}
