import { useQuery } from "@tanstack/react-query";
import { emailSettingsInputSchema,type EmailSettingsInput,type EmailSettingsView } from "@tracegenie/shared";
import { CheckCircle2,Mail,RefreshCw } from "lucide-react";
import { useRef,useState,type FormEvent } from "react";
import { Link,useSearchParams,useParams } from "react-router-dom";

import { useAdminFormExitGuard } from "../../components/guards/AdminFormExitGuard";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Input } from "../../components/ui/Input";
import { api,ApiError } from "../../lib/api";
import { ProductSettingsHeader } from "../projects/ProductWorkspaceHeader";

function initialDraft(settings: EmailSettingsView): EmailSettingsInput {
  return {
    revision: settings.revision,
    provider: settings.source === "settings" ? settings.provider : "resend",
    host: settings.host, port: settings.port, secure: settings.secure, user: settings.user,
    fromName: settings.fromName, fromEmail: settings.fromEmail, replyTo: settings.replyTo,
  };
}

const labelClass = "mb-1.5 block text-label font-semibold text-foreground";
const selectClass = "tg-soft-input h-11 w-full rounded-lg border px-3 text-body text-foreground focus:outline-2 focus:outline-primary";

function EmailSettingsForm({ initial, adminEmail, reload }: {
  initial: EmailSettingsView;
  adminEmail: string;
  reload: () => void;
}) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() => initialDraft(initial));
  const [replacing, setReplacing] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const busy = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft(saved));
  const sameAccount = saved.source === "settings" && saved.provider === draft.provider
    && (draft.provider === "resend" || (saved.host === draft.host && saved.user === draft.user));
  const credentialSaved = sameAccount && saved.hasCredential;

  useAdminFormExitGuard({
    id: "installation-email-settings", isDirty: dirty, isMutationPending: pending,
    onDiscard: () => { setDraft(initialDraft(saved)); setReplacing(false); },
  });

  function change<K extends keyof EmailSettingsInput>(key: K, value: EmailSettingsInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage(null);
    setError(null);
  }

  function accept(settings: EmailSettingsView) {
    setSaved(settings);
    setDraft(initialDraft(settings));
    setReplacing(false);
    setConflict(false);
  }

  async function submit(test: boolean) {
    if (busy.current || !formRef.current?.reportValidity()) return;
    const parsed = emailSettingsInputSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your email settings.");
      return;
    }
    busy.current = true;
    setPending(true);
    setMessage(null);
    setError(null);
    let didSave = false;
    try {
      let current = saved;
      if (dirty || saved.source !== "settings") {
        const result = await api.saveEmailSettings(parsed.data);
        current = result.settings;
        accept(current);
        didSave = true;
      }
      if (test) {
        const result = await api.testEmailSettings(current.revision);
        accept(result.settings);
        setMessage(`Test email sent to ${result.recipient}. Check your inbox and spam folder.`);
      } else {
        setMessage("Email settings saved. New messages will use this configuration immediately.");
      }
    } catch (cause) {
      setConflict(cause instanceof ApiError && cause.status === 409);
      setError(`${didSave ? "Settings saved. " : ""}${cause instanceof Error ? cause.message : "Could not save email settings. Try again."}`);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function resetToEnvironment() {
    if (busy.current || !saved.revision) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.resetEmailSettings(saved.revision);
      accept(result.settings);
      setMessage("Server email settings are active again.");
    } catch (cause) {
      setConflict(cause instanceof ApiError && cause.status === 409);
      setError(cause instanceof Error ? cause.message : "Could not restore server settings.");
    } finally {
      busy.current = false;
      setPending(false);
      setConfirmReset(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(true);
  }

  return (
    <div id="email-settings-content" className="max-w-3xl space-y-4">
      <section id="email-settings-status" className="tg-panel flex items-start gap-3 p-4" aria-label="Current email configuration">
        <Mail className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-label font-semibold text-foreground">
            {saved.source === "settings" ? `${saved.provider === "resend" ? "Resend" : "SMTP"} configured` : saved.configured ? "Using server email settings" : "Email is not configured"}
          </h2>
          <p className="mt-1 text-caption text-muted">
            {saved.source === "settings"
              ? saved.lastTestAt ? `Last test accepted on ${new Date(saved.lastTestAt).toLocaleString()}.` : "Send a test email to check delivery."
              : "Save a provider below to use it for notifications, report updates and access codes."}
          </p>
        </div>
      </section>

      {!saved.canSave ? (
        <p id="email-settings-key-unavailable" className="rounded-xl bg-warning-50 p-4 text-label text-warning-800" role="alert">
          The server encryption key is missing. Run npm run setup, or configure EMAIL_SETTINGS_ENCRYPTION_KEY on the server, then restart the API and worker.
        </p>
      ) : null}

      <form id="email-settings-form" ref={formRef} onSubmit={onSubmit} className="tg-card p-5 sm:p-6">
        <fieldset disabled={pending || !saved.canSave} className="space-y-5">
          <legend className="sr-only">Email provider and sender</legend>
          <div id="email-provider-field">
            <label htmlFor="email-provider" className={labelClass}>Email provider</label>
            <select id="email-provider" value={draft.provider} className={selectClass} onChange={(event) => {
              const provider = event.target.value as EmailSettingsInput["provider"];
              setDraft((current) => ({ ...current, provider, credential: undefined }));
              setReplacing(false);
              setError(null);
              setMessage(null);
            }}>
              <option value="resend">Resend</option>
              <option value="smtp">Other SMTP (advanced)</option>
            </select>
            {draft.provider === "resend" ? (
              <p id="resend-setup-help" className="mt-2 text-caption text-muted">
                Use your own Resend API key and a verified sending domain. <a className="tg-inline-link" href="https://resend.com/domains" target="_blank" rel="noreferrer">Manage domains in Resend</a>
              </p>
            ) : null}
          </div>

          {draft.provider === "smtp" ? (
            <section id="email-smtp-settings" className="space-y-4 rounded-xl border border-border p-4" aria-labelledby="email-smtp-heading">
              <h2 id="email-smtp-heading" className="text-label font-semibold">SMTP connection</h2>
              <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
                <div>
                  <label htmlFor="email-host" className={labelClass}>SMTP host</label>
                  <Input id="email-host" value={draft.host} required maxLength={320} autoComplete="off" placeholder="smtp.example.com" onChange={(event) => change("host", event.target.value)} />
                </div>
                <div>
                  <label htmlFor="email-port" className={labelClass}>Port</label>
                  <Input id="email-port" type="number" min={1} max={65535} required value={draft.port || ""} onChange={(event) => change("port", Number(event.target.value))} />
                </div>
              </div>
              <div>
                <label htmlFor="email-security" className={labelClass}>Connection security</label>
                <select id="email-security" className={selectClass} value={draft.secure ? "tls" : "starttls"} onChange={(event) => change("secure", event.target.value === "tls")}>
                  <option value="tls">TLS (usually port 465)</option>
                  <option value="starttls">STARTTLS (usually port 587)</option>
                </select>
              </div>
              <div>
                <label htmlFor="email-user" className={labelClass}>SMTP username</label>
                <Input id="email-user" value={draft.user} maxLength={320} autoComplete="off" onChange={(event) => change("user", event.target.value)} />
                <p className="mt-1 text-caption text-muted">Leave blank only if your mail server does not require authentication.</p>
              </div>
            </section>
          ) : null}

          {draft.provider === "resend" || draft.user ? (
            <div id="email-credential-field">
              <label htmlFor="email-credential" className={labelClass}>{draft.provider === "resend" ? "Resend API key" : "SMTP password"}</label>
              <div className="flex items-center gap-2">
                {credentialSaved && !replacing ? (
                  <Input id="email-credential" type="password" value="saved-credential" readOnly aria-describedby="email-credential-help" />
                ) : (
                  <Input id="email-credential" type="password" value={draft.credential ?? ""} autoComplete="new-password" maxLength={2048} required={!credentialSaved} placeholder={draft.provider === "resend" ? "re_…" : "SMTP password"} aria-describedby="email-credential-help" onChange={(event) => change("credential", event.target.value)} />
                )}
                {credentialSaved ? (
                  <Button tone="secondary" onClick={() => { setReplacing(!replacing); change("credential", undefined); }}>
                    {replacing ? "Cancel" : "Replace"}
                  </Button>
                ) : null}
              </div>
              <p id="email-credential-help" className="mt-1.5 text-caption text-muted">
                {credentialSaved && !replacing ? "Credential saved. Its value is never returned to the browser." : "Stored encrypted on your server."}
              </p>
            </div>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <div id="email-sender-name-field">
              <label htmlFor="email-from-name" className={labelClass}>Sender name</label>
              <Input id="email-from-name" value={draft.fromName} required maxLength={100} autoComplete="organization" onChange={(event) => change("fromName", event.target.value)} />
            </div>
            <div id="email-sender-address-field">
              <label htmlFor="email-from-address" className={labelClass}>Sender email</label>
              <Input id="email-from-address" type="email" value={draft.fromEmail} required maxLength={320} placeholder="notifications@yourdomain.com" onChange={(event) => change("fromEmail", event.target.value)} />
            </div>
          </div>
          <div id="email-reply-to-field">
            <label htmlFor="email-reply-to" className={labelClass}>Reply-to email (optional)</label>
            <Input id="email-reply-to" type="email" value={draft.replyTo} maxLength={320} placeholder="support@yourdomain.com" onChange={(event) => change("replyTo", event.target.value)} />
            <p className="mt-1.5 text-caption text-muted">Use a mailbox your team monitors. If blank, replies go to the sender address.</p>
          </div>

          <div id="email-settings-actions" className="border-t border-border pt-5">
            <p className="mb-3 break-words text-caption text-muted">The test email will be sent to {adminEmail}.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={conflict} className="min-h-11 gap-2">
                <Mail className="size-4" aria-hidden="true" />
                {pending ? "Working…" : "Save and send test email"}
              </Button>
              <Button tone="secondary" disabled={conflict || (!dirty && saved.source === "settings")} onClick={() => void submit(false)} className="min-h-11">Save settings</Button>
            </div>
          </div>
        </fieldset>
      </form>

      {message ? (
        <div id="email-settings-success" className="flex items-start gap-2 rounded-xl bg-success-50 p-4 text-label text-success-700" role="status">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{message}</p>
        </div>
      ) : null}
      {error ? (
        <div id="email-settings-error" className="rounded-xl bg-danger-50 p-4 text-label text-danger-700" role="alert">
          <p>{error}</p>
          {conflict ? (
            <Button tone="secondary" onClick={reload} className="mt-3 gap-2">
              <RefreshCw className="size-4" aria-hidden="true" />
              Reload saved settings
            </Button>
          ) : null}
        </div>
      ) : null}
      {saved.source === "settings" ? (
        <div id="email-settings-server-fallback" className="px-1">
          <Button tone="ghost" disabled={pending} onClick={() => setConfirmReset(true)}>Use server settings instead</Button>
        </div>
      ) : null}
      <ConfirmDialog isOpen={confirmReset} title="Use server email settings?" description="This removes the provider and credential saved here and restores the server’s email configuration. Unsaved changes will be discarded." confirmText="Use server settings" confirmTone="secondary" isPending={pending} onConfirm={() => void resetToEnvironment()} onCancel={() => setConfirmReset(false)} />
    </div>
  );
}

export function EmailSettingsPage({ adminEmail, organizationId }: { adminEmail: string; organizationId?: string | null }) {
  const [searchParams] = useSearchParams();
  const { projectKey } = useParams<{ projectKey: string }>();
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: ["installation-email-settings", organizationId, projectKey, generation],
    queryFn: async () => {
      const [email, projects] = await Promise.all([api.getEmailSettings(), api.getProjects(organizationId)]);
      const project = projects.projects.find((item) => item.key === projectKey);
      if (!project) throw new Error("This project was not found.");
      return { settings: email.settings, projectName: project.name };
    },
    retry: false, gcTime: 0, refetchOnWindowFocus: false,
  });

  return (
    <section id="installation-email-settings-page" className="space-y-5">
      <ProductSettingsHeader projectPath={`/projects/${encodeURIComponent(projectKey ?? "")}`} projectName={query.data?.projectName} label="Email" description="Connect your email provider for notifications, report updates and access codes" />
      {query.isPending ? (
        <p className="tg-panel p-5 text-body text-muted" role="status">Loading email settings…</p>
      ) : query.isError ? (
        <div id="email-settings-load-error" className="tg-panel p-5" role="alert">
          <p className="text-body text-danger-700">{query.error.message}</p>
          <Button tone="secondary" className="mt-3" onClick={() => void query.refetch()}>Retry</Button>
        </div>
      ) : (
        <EmailSettingsForm key={generation} initial={query.data.settings} adminEmail={adminEmail} reload={() => setGeneration((value) => value + 1)} />
      )}
      {searchParams.get("setup") === "1" ? (
        <div id="setup-next-step" className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-label text-muted">Email can also be configured later in Settings.</p>
          <Link className="tg-inline-link font-semibold" to="/projects/community/settings/installation">Continue to widget installation →</Link>
        </div>
      ) : null}
    </section>
  );
}
