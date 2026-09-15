import { useQuery } from "@tanstack/react-query";
import { useRef,useState,type FormEvent,type ReactNode } from "react";
import { AuthShell } from "./AuthShell";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { getApiBaseUrl } from "../../lib/env";

type Owner = { id: string; email: string; name: string; role: string; platformRole?: string };
export function InstallationEntry({ login, onComplete }: { login: ReactNode; onComplete: (user: Owner) => void }) {
  const status = useQuery({ queryKey: ["installation-status"], queryFn: async () => {
    const response = await fetch(`${getApiBaseUrl()}/api/installation/status`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not check installation status.");
    return await response.json() as { required: boolean };
  }, retry: false });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/installation/complete`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Could not complete setup. Check the fields and try again.");
      onComplete(result.user);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not connect. Try again."); }
    finally { busy.current = false; setPending(false); }
  }
  if (status.data?.required === false) return login;
  return (
    <AuthShell idPrefix="community-setup" title="Set up TraceGenie" description="Create your administrator account and name your project." variant="simple">
      <div id="community-setup-content" className="mt-6">
        {status.isPending ? <p role="status">Checking your installation…</p> : status.isError ? (
          <div id="setup-status-error" className="space-y-3">
            <p role="alert">Could not connect to this installation.</p>
            <Button onClick={() => void status.refetch()}>Retry</Button>
          </div>
        ) : (
          <form id="community-setup-form" className="space-y-4" onSubmit={submit}>
            <div id="setup-code-field">
              <label htmlFor="setup-token" className="mb-1.5 block text-label font-medium">Setup code</label>
              <Input id="setup-token" name="token" type="password" required minLength={32} maxLength={128} autoComplete="off" aria-describedby="setup-code-help" disabled={pending} />
              <p id="setup-code-help" className="mt-1 text-caption text-muted">Use the private code displayed in your installation terminal.</p>
            </div>
            <div id="setup-name-field">
              <label htmlFor="setup-name" className="mb-1.5 block text-label font-medium">Your name</label>
              <Input id="setup-name" name="name" required maxLength={100} autoComplete="name" disabled={pending} />
            </div>
            <div id="setup-email-field">
              <label htmlFor="setup-email" className="mb-1.5 block text-label font-medium">Email address</label>
              <Input id="setup-email" name="email" type="email" required maxLength={254} autoComplete="email" disabled={pending} />
            </div>
            <div id="setup-password-field">
              <label htmlFor="setup-password" className="mb-1.5 block text-label font-medium">Password</label>
              <Input id="setup-password" name="password" type="password" required minLength={12} maxLength={72} autoComplete="new-password" aria-describedby="setup-password-help" disabled={pending} />
              <p id="setup-password-help" className="mt-1 text-caption text-muted">Use at least 12 characters.</p>
            </div>
            <div id="setup-project-field">
              <label htmlFor="setup-project" className="mb-1.5 block text-label font-medium">Project name</label>
              <Input id="setup-project" name="projectName" required maxLength={100} placeholder="My application" disabled={pending} />
            </div>
            {error ? <p id="setup-error" role="alert" className="text-label text-danger-700">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={pending}>{pending ? "Creating your project…" : "Create project"}</Button>
            <p className="text-caption text-muted">Next, configure email and install your widget.</p>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
