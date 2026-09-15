import { useState,type ReactNode } from "react";
import { Check,Clipboard } from "lucide-react";

type WidgetInstallationGuideProps = {
  idPrefix: string;
  projectKey: string;
  appName: string;
  apiBaseUrl: string;
  allowedOrigins: string[];
  frameworkLabel: string;
  integrationLabel: string;
  frontendSnippet: string;
  backendSnippet: string;
  children: ReactNode;
};

function buildAgentPrompt({
  projectKey, appName, apiBaseUrl, allowedOrigins, frameworkLabel,
  integrationLabel, frontendSnippet, backendSnippet,
}: WidgetInstallationGuideProps) {
  return `Install the TraceGenie feedback widget in this application.

Product: ${JSON.stringify(appName)}
Project key: ${JSON.stringify(projectKey)}
TraceGenie API base URL: ${JSON.stringify(apiBaseUrl)}
Configured website origins: ${allowedOrigins.length ? allowedOrigins.map((origin) => JSON.stringify(origin)).join(", ") : "None yet. Ask me for the exact website origin and have me add it in Product settings before verification."}
Selected installation: ${integrationLabel} / ${frameworkLabel}

1. Inspect the existing frontend, backend, routing, and authentication. Adapt the reference snippets below to this codebase; do not replace existing layouts or assume example imports, users, or environment values exist. Reuse an existing TraceGenie installation if present and initialize the widget only once in the shared layout. For a script embed, configure window.TraceGenieSettings before loading the script. For the React component, use @tracegenie/widget and its getWidgetSessionToken callback.

2. Implement POST /api/tracegenie/widget-session on this application's server. Call ${apiBaseUrl}/api/projects/server/${encodeURIComponent(projectKey)}/widget-session with a JSON body containing clientSecret from the server-side TRACEGENIE_PROJECT_SECRET environment variable and the validated website origin. Return the token to the browser. Preserve upstream error statuses, handle failures, and avoid logging tokens or secrets. Validate the exact origin against the configured origins and use the application's existing authentication and request protections. Do not bypass authentication or broaden CORS. If this is a static-only site, explain the server or serverless endpoint needed before proceeding.

3. The project secret is intentionally absent from this prompt. Use the existing server-side secret configuration. If missing, add an empty configuration placeholder and tell me where to supply it through my secret manager. Never put the secret in frontend code, public environment variables, source control, or this conversation.

4. Connect the frontend to that endpoint using the project key and API URL above. Use the application's actual environment and version; only include user identity or product context already available and permitted by its privacy settings. Preserve the configured report and consent behavior.

Frontend reference (adapt to the existing application):

${frontendSnippet}

Backend reference (adapt to the existing server and apply the protections above):

${backendSnippet}

5. Run the relevant build and checks. Verify the widget loads once, the token endpoint works for the configured origin, and the secret is absent from browser assets. Do not deploy or submit a live report automatically. Tell me how to open the widget, send one real test report, and return to TraceGenie to verify it arrived. Do not claim installation is verified from a build or internal install check alone.

Finish with the files changed, checks actually run, and any configuration or verification steps I still need to complete.`;
}

export function WidgetInstallationGuide(props: WidgetInstallationGuideProps) {
  const [view, setView] = useState<"code" | "agent">("code");
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const prompt = buildAgentPrompt(props);
  const copied = copiedPrompt === prompt;

  async function copyPrompt() {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(prompt);
    } catch {
      setCopiedPrompt(null);
      setCopyError(true);
    }
  }

  return (
    <div id={`${props.idPrefix}-installation-guide`} className="mt-4 min-w-0">
      <fieldset className="mb-4">
        <legend className="sr-only">Installation instructions</legend>
        <div className="inline-flex rounded-lg border border-border/60 bg-surface-muted/50 p-1">
          <label className={`relative inline-flex min-h-11 cursor-pointer items-center rounded-md px-4 text-label font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${view === "code" ? "bg-surface text-foreground shadow-soft" : "text-muted hover:text-foreground"}`}>
            <input className="sr-only" type="radio" name={`${props.idPrefix}-instruction-view`} value="code" checked={view === "code"} onChange={() => setView("code")} />
            Code
          </label>
          <label className={`relative inline-flex min-h-11 cursor-pointer items-center rounded-md px-4 text-label font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${view === "agent" ? "bg-surface text-foreground shadow-soft" : "text-muted hover:text-foreground"}`}>
            <input className="sr-only" type="radio" name={`${props.idPrefix}-instruction-view`} value="agent" checked={view === "agent"} onChange={() => setView("agent")} />
            AI agent
          </label>
        </div>
      </fieldset>

      {view === "code" ? props.children : (
        <section id={`${props.idPrefix}-agent-instructions`} className="min-w-0" aria-labelledby={`${props.idPrefix}-agent-title`}>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 id={`${props.idPrefix}-agent-title`} className="text-label font-semibold text-foreground">
                Install with your coding agent
              </h3>
              <p className="mt-1 text-caption leading-relaxed text-muted">
                Copy this prompt into Codex, Claude Code, Cursor, or another coding agent in your project.
              </p>
            </div>
            <button type="button" onClick={() => void copyPrompt()} data-copied={copied ? "true" : "false"} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-border/60 bg-surface px-3 text-caption font-semibold text-foreground hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              {copied ? <Check className="size-4" aria-hidden="true" /> : <Clipboard className="size-4" aria-hidden="true" />}
              {copied ? "Copied" : "Copy prompt"}
            </button>
          </div>
          <pre id={`${props.idPrefix}-agent-prompt`} tabIndex={0} aria-label="AI agent installation prompt" className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-code p-4 text-caption leading-relaxed text-code-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <code>{prompt}</code>
          </pre>
          <p className="mt-2 text-caption leading-relaxed text-muted">
            Includes your selected framework, product details, and both installation steps. Your project secret is not included; configure it separately on your server.
          </p>
          <p className="sr-only" role="status">
            {copied ? "Installation prompt copied." : ""}
          </p>
          {copyError ? (
            <p className="mt-2 text-caption text-danger-700" role="alert">
              Copying is unavailable. Select the prompt above and copy it manually.
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
