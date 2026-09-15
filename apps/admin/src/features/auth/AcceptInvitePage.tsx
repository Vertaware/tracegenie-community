import { useEffect,useMemo,useRef,useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye,EyeOff } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link,useNavigate } from "react-router-dom";
import { z } from "zod";

import type { AdminSession } from "@tracegenie/shared";

import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { api,type InviteTrustContext } from "../../lib/api";
import { AuthShell } from "./AuthShell";

const acceptInviteSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100, "Name must be 100 characters or fewer."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

type AcceptInviteFormValues = z.infer<typeof acceptInviteSchema>;

type AcceptInvitePageProps = {
  onAccepted: (session: AdminSession) => void;
};

const organizationRoleLabels: Record<NonNullable<InviteTrustContext["organizationRole"]>, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  MEMBER: "Member",
};

const productRoleLabels: Record<InviteTrustContext["products"][number]["productRole"], string> = {
  PROJECT_ADMIN: "Product administrator",
  TRIAGER: "Triager",
  VIEWER: "Viewer",
};

const terminalInviteErrorCodes = [
  "invites.not_found",
  "invites.already_accepted",
  "invites.expired",
  "invites.project_org_mismatch",
  "invites.revoked",
  "project.read_only",
  "org.unavailable",
] as const;

type TerminalInviteErrorCode = typeof terminalInviteErrorCodes[number];

function getTerminalInviteErrorCode(caught: unknown): TerminalInviteErrorCode | null {
  const code = (
    caught
    && typeof caught === "object"
    && "code" in caught
    && typeof caught.code === "string"
  ) ? caught.code : null;
  return terminalInviteErrorCodes.find((terminalCode) => terminalCode === code) ?? null;
}

function getTerminalInviteRecovery(code: TerminalInviteErrorCode | null) {
  if (code === "invites.already_accepted") {
    return "Sign in with the account that accepted this invite.";
  }
  if (code === "project.read_only") {
    return "Ask the project administrator to restore write access, then open this invite again.";
  }
  if (code === "org.unavailable") {
    return "Contact an organization administrator about access.";
  }
  return "Ask an administrator for a new invite.";
}

function formatInviteExpiry(value: string) {
  const expiry = new Date(value);
  if (Number.isNaN(expiry.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(expiry);
}

export function AcceptInvitePage({ onAccepted }: AcceptInvitePageProps) {
  const navigate = useNavigate();
  const token = useMemo(() => new URLSearchParams(window.location.search).get("token")?.trim() ?? "", []);
  const tokenIsValid = token.length >= 20;
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [inviteContext, setInviteContext] = useState<InviteTrustContext | null>(null);
  const [contextStatus, setContextStatus] = useState<"idle" | "loading" | "success" | "error">(
    tokenIsValid ? "loading" : "idle",
  );
  const [contextTerminal, setContextTerminal] = useState(false);
  const [contextTerminalCode, setContextTerminalCode] = useState<TerminalInviteErrorCode | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextAttempt, setContextAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const form = useForm<AcceptInviteFormValues>({
    resolver: zodResolver(acceptInviteSchema),
    defaultValues: {
      name: "",
      password: "",
    },
  });

  useEffect(() => {
    if (!tokenIsValid) return;

    let active = true;
    setInviteContext(null);
    setContextError(null);
    setContextTerminal(false);
    setContextTerminalCode(null);
    setContextStatus("loading");

    void api.getInviteContext(token)
      .then(({ context }) => {
        if (!active) return;
        setInviteContext(context);
        setContextStatus("success");
      })
      .catch((caught: unknown) => {
        if (!active) return;
        const terminalCode = getTerminalInviteErrorCode(caught);
        setContextError(caught instanceof Error ? caught.message : "Could not verify this invite.");
        setContextTerminal(Boolean(terminalCode));
        setContextTerminalCode(terminalCode);
        setContextStatus("error");
      });

    return () => {
      active = false;
    };
  }, [contextAttempt, token, tokenIsValid]);

  const contextReady = contextStatus === "success" && inviteContext !== null;

  useEffect(() => {
    if (contextStatus === "error" && contextTerminal) {
      document.getElementById("accept-invite-context-error")?.focus();
    } else if (error && !submitting && contextReady) {
      document.getElementById("accept-invite-name")?.focus();
    }
  }, [contextReady, contextStatus, contextTerminal, error, submitting]);

  async function submit(values: AcceptInviteFormValues) {
    if (!tokenIsValid || !contextReady || submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const session = await api.acceptInvite({
        token,
        name: values.name,
        password: values.password,
      });
      onAccepted(session);
      navigate("/", { replace: true });
    } catch (caught) {
      const terminalCode = getTerminalInviteErrorCode(caught);
      if (terminalCode) {
        setInviteContext(null);
        setContextError(caught instanceof Error ? caught.message : "This invite is no longer available.");
        setContextTerminal(true);
        setContextTerminalCode(terminalCode);
        setContextStatus("error");
        form.reset();
      } else {
        setError(caught instanceof Error ? caught.message : "Could not accept this invite.");
      }
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      idPrefix="accept-invite"
      title="Accept your invite"
      description="Review your access, then set your name and password."
      width="wide"
      trustDescription={contextReady
        ? "Access is limited to the organization and products shown in your invite."
        : "A valid invite shows the organization and product access you will receive."}
      footer={(
        <p id="accept-invite-sign-in-link">
          Already have access?{" "}
          <Link className="tg-inline-link font-semibold text-foreground" to="/login">
            Sign in
          </Link>
        </p>
      )}
    >
      <div id="accept-invite-content">
        {!tokenIsValid ? (
          <p
            id="accept-invite-token-error"
            className="tg-message-banner mt-4 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-label text-danger-700"
            role="alert"
          >
            This invite link is invalid or incomplete. Ask an administrator for a new invite.
          </p>
        ) : null}
        {contextStatus === "loading" ? (
          <div
            id="accept-invite-context-loading"
            className="mt-5 border-y border-border/50 py-4"
            role="status"
            aria-live="polite"
          >
            <p className="text-label font-medium text-foreground">Loading invite details...</p>
            <p className="mt-1 text-caption text-muted">Verifying the organization and access you were offered.</p>
          </div>
        ) : null}
        {contextStatus === "error" ? (
          <div
            id="accept-invite-context-error"
            className="mt-5 border-y border-danger-200 bg-danger-50/45 py-4"
            role="alert"
            tabIndex={-1}
          >
            <p className="text-label font-semibold text-danger-700">
              {contextTerminal ? "Invite unavailable." : "Could not load invite details."}
            </p>
            <p className="mt-1 text-caption text-danger-700">{contextError}</p>
            {contextTerminal ? (
              <p id="accept-invite-recovery-guidance" className="mt-2 text-caption text-danger-700">
                {getTerminalInviteRecovery(contextTerminalCode)}
              </p>
            ) : (
              <Button
                type="button"
                tone="secondary"
                className="mt-3 h-11"
                onClick={() => setContextAttempt((attempt) => attempt + 1)}
              >
                Retry
              </Button>
            )}
          </div>
        ) : null}
        {inviteContext ? (
          <section
            id="accept-invite-context"
            className="mt-5 border-y border-border/50 py-4"
            aria-labelledby="accept-invite-context-title"
          >
            <h2 id="accept-invite-context-title" className="text-label font-semibold text-foreground">
              Invite details
            </h2>
            <p className="mt-1 text-caption text-muted">
              {inviteContext.inviter.displayName} invited you to {inviteContext.organization.displayName}.
            </p>
            <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-caption">
              <dt className="text-muted">Organization role</dt>
              <dd className="text-right font-semibold text-foreground">
                {inviteContext.organizationRole ? organizationRoleLabels[inviteContext.organizationRole] : "None"}
              </dd>
              <dt className="text-muted">Expires</dt>
              <dd className="text-right font-semibold text-foreground">
                <time dateTime={inviteContext.expiresAt}>{formatInviteExpiry(inviteContext.expiresAt)}</time>
              </dd>
            </dl>
            <div id="accept-invite-product-access" className="mt-4 border-t border-border/35 pt-3">
              <h3 className="text-caption font-semibold text-foreground">Product access</h3>
              {inviteContext.effectiveAccess.productScope === "ALL" ? (
                <p className="mt-1 text-caption text-muted">All current and future products</p>
              ) : inviteContext.effectiveAccess.productScope === "NONE" ? (
                <p className="mt-1 text-caption text-muted">No product access</p>
              ) : (
                <ul className="mt-2 divide-y divide-border/35" aria-label="Products and roles">
                  {inviteContext.products.map((product, index) => (
                    <li
                      key={`${product.name}-${product.productRole}-${index}`}
                      className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0"
                    >
                      <span className="min-w-0 text-label font-medium text-foreground">{product.name}</span>
                      <span className="shrink-0 text-caption text-muted">{productRoleLabels[product.productRole]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div id="accept-invite-effective-access" className="mt-4 border-t border-border/35 pt-3">
              <h3 className="text-caption font-semibold text-foreground">Effective access</h3>
              <p className="mt-1 text-caption leading-relaxed text-muted">{inviteContext.effectiveAccess.summary}</p>
            </div>
          </section>
        ) : null}
        {error ? (
          <p
            id="accept-invite-server-error"
            className="tg-message-banner mt-4 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-label text-danger-700"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {tokenIsValid && !contextTerminal ? (
          <form id="accept-invite-form" className="mt-6 space-y-4" noValidate onSubmit={form.handleSubmit(submit)}>
            <div id="accept-invite-name-field">
              <label htmlFor="accept-invite-name" className="mb-1.5 block text-label font-medium text-foreground">
                Name
              </label>
              <Input
                id="accept-invite-name"
                {...form.register("name")}
                autoComplete="name"
                aria-invalid={form.formState.errors.name ? "true" : undefined}
                aria-describedby={form.formState.errors.name ? "accept-invite-name-error" : undefined}
                disabled={submitting || !tokenIsValid}
              />
              {form.formState.errors.name?.message ? (
                <p id="accept-invite-name-error" className="mt-1 text-caption text-danger-700" role="alert">
                  {form.formState.errors.name.message}
                </p>
              ) : null}
            </div>
            <div id="accept-invite-password-field">
              <label htmlFor="accept-invite-password" className="mb-1.5 block text-label font-medium text-foreground">
                Password
              </label>
              <div className="relative">
                <Input
                  id="accept-invite-password"
                  {...form.register("password")}
                  className="pr-11"
                  type={passwordVisible ? "text" : "password"}
                  autoComplete="new-password"
                  aria-invalid={form.formState.errors.password ? "true" : undefined}
                  aria-describedby={form.formState.errors.password
                    ? "accept-invite-password-requirement accept-invite-password-error"
                    : "accept-invite-password-requirement"}
                  disabled={submitting || !tokenIsValid}
                />
                <Button
                  type="button"
                  tone="ghost"
                  className="absolute right-0 top-0 w-11 px-0"
                  aria-label={passwordVisible ? "Hide password" : "Show password"}
                  aria-pressed={passwordVisible}
                  title={passwordVisible ? "Hide password" : "Show password"}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                  disabled={submitting || !tokenIsValid}
                >
                  {passwordVisible ? (
                    <EyeOff aria-hidden="true" size={17} />
                  ) : (
                    <Eye aria-hidden="true" size={17} />
                  )}
                </Button>
              </div>
              <p id="accept-invite-password-requirement" className="mt-1 text-caption text-muted">
                Use at least 8 characters.
              </p>
              {form.formState.errors.password?.message ? (
                <p id="accept-invite-password-error" className="mt-1 text-caption text-danger-700" role="alert">
                  {form.formState.errors.password.message}
                </p>
              ) : null}
            </div>
            <Button type="submit" className="h-11 w-full" disabled={submitting || !tokenIsValid || !contextReady}>
              {submitting ? "Accepting invite..." : "Accept invite"}
            </Button>
          </form>
        ) : null}
      </div>
    </AuthShell>
  );
}
