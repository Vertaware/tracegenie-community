import { useEffect,useRef,useState } from "react";
import type { ProjectInstallDiagnosticsResponse } from "@tracegenie/shared";
import { Check,Clipboard } from "lucide-react";

import { api } from "../../lib/api";
import { copy } from "../../lib/copy";
import { getApiBaseUrl } from "../../lib/env";
import { activationSummary,ProjectActivationProofs } from "./ProjectActivationProofs";
import { WidgetInstallationGuide } from "./WidgetInstallationGuide";

type WidgetSnippetProps = {
  projectKey: string;
  appName: string;
  allowedOrigins?: string[];
  apiBaseUrl?: string;
  hostedFeedbackUrl?: string | null;
  organizationId?: string | null;
  onDiagnosticsChange?: (diagnostics: ProjectInstallDiagnosticsResponse) => void;
};

export type IntegrationMode = "react" | "script";

export type Framework =
  | "html"
  | "react"
  | "nextjs"
  | "vue"
  | "angular"
  | "svelte"
  | "php"
  | "django"
  | "rails"
  | "express"
  | "dotnet"
  | "go";

export const FRAMEWORK_LABELS: Record<Framework, string> = {
  html: "HTML",
  react: "React",
  nextjs: "Next.js",
  vue: "Vue.js",
  angular: "Angular",
  svelte: "Svelte",
  php: "PHP / Laravel",
  django: "Python / Django",
  rails: "Ruby on Rails",
  express: "Express / Node",
  dotnet: "ASP.NET / C#",
  go: "Go",
};

export const FRAMEWORK_ORDER: Framework[] = [
  "html", "react", "nextjs", "vue", "angular", "svelte",
  "php", "django", "rails", "express", "dotnet", "go",
];

const DEFAULT_API_BASE = getApiBaseUrl();

export function getReactSnippet(projectKey: string, appName: string, apiBaseUrl: string) {
  return `import { FeedbackWidget } from "@tracegenie/widget";

async function getTraceGenieWidgetSessionToken() {
  const response = await fetch("/api/tracegenie/widget-session", {
    method: "POST",
    credentials: "include",
  });
  const payload = await response.json();
  return payload.token;
}

<FeedbackWidget
    projectKey="${projectKey}"
    appName="${appName}"
    apiBaseUrl="${apiBaseUrl}"
    appEnvironment="production"
    appVersion="1.0.0"
    getWidgetSessionToken={getTraceGenieWidgetSessionToken}
    // Optional: identify who submitted the report.
    // currentUser={{ id: user.id, email: user.email, name: user.name }}
    // Optional: attach product context for triage.
    // productContext={{ account: { id: account.id }, customer: { cohort: user.cohort }, plan: { tier: plan.tier }, revenue: { mrr: account.mrr, currency: "USD" }, experiments: { checkout_copy: "variant-b" } }}
/>`;
}

export function getFrontendSnippet(framework: Framework, projectKey: string, appName: string, apiBaseUrl: string): string {
  const settingsBlock = `window.TraceGenieSettings = {
  projectKey: "${projectKey}",
  appName: "${appName}",
  appEnvironment: "production",
  sessionTokenEndpoint: "/api/tracegenie/widget-session",
  // Optional: productContext: { account: { id: "acct_123" }, customer: { cohort: "2026-q3-beta" }, plan: { tier: "pro" }, revenue: { mrr: 12000, currency: "USD" }, experiments: { checkout_copy: "variant-b" } },`;

  const scriptTag = `<script src="${apiBaseUrl}/widget/embed.js" async></script>`;

  switch (framework) {
    case "html":
      return `<!-- Add before </body> -->
<script>
  ${settingsBlock}
  // Optional: pass logged-in user info
  // user: { id: "u1", email: "user@example.com", name: "Jane Doe" }
};
</script>
${scriptTag}`;

    case "react":
      return `// In your App.tsx or layout component
useEffect(() => {
  window.TraceGenieSettings = {
    projectKey: "${projectKey}",
    appName: "${appName}",
    appEnvironment: "production",
    sessionTokenEndpoint: "/api/tracegenie/widget-session",
    user: currentUser ? {
      id: currentUser.id,
      email: currentUser.email,
      name: currentUser.name,
    } : undefined,
  };
}, [currentUser]);

// In your index.html <head> or via Helmet:
// ${scriptTag}`;

    case "nextjs":
      return `// app/layout.tsx (App Router) or _app.tsx (Pages Router)
import Script from "next/script";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Script id="tracegenie-settings" strategy="beforeInteractive">
          {\`
            window.TraceGenieSettings = {
              projectKey: "${projectKey}",
              appName: "${appName}",
              appEnvironment: process.env.NODE_ENV,
              sessionTokenEndpoint: "/api/tracegenie/widget-session",
            };
          \`}
        </Script>
        <Script
          src="${apiBaseUrl}/widget/embed.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}`;

    case "vue":
      return `<!-- In your App.vue or main layout -->
<script setup>
import { onMounted, watch } from "vue";
import { useAuthStore } from "./stores/auth";

const auth = useAuthStore();

onMounted(() => {
  window.TraceGenieSettings = {
    projectKey: "${projectKey}",
    appName: "${appName}",
    appEnvironment: "production",
    sessionTokenEndpoint: "/api/tracegenie/widget-session",
    user: auth.user ? {
      id: auth.user.id,
      email: auth.user.email,
      name: auth.user.name,
    } : undefined,
  };

  const script = document.createElement("script");
  script.src = "${apiBaseUrl}/widget/embed.js";
  script.async = true;
  document.body.appendChild(script);
});

watch(() => auth.user, (newUser) => {
  if (window.TraceGenieSettings) {
    window.TraceGenieSettings.user = newUser
      ? { id: newUser.id, email: newUser.email, name: newUser.name }
      : undefined;
  }
});
</script>`;

    case "angular":
      return `// In angular.json, add to "scripts":
// "${apiBaseUrl}/widget/embed.js"

// In your app.component.ts
import { Component, OnInit } from "@angular/core";
import { AuthService } from "./auth.service";

@Component({ selector: "app-root", templateUrl: "./app.component.html" })
export class AppComponent implements OnInit {
  constructor(private auth: AuthService) {}

  ngOnInit() {
    (window as any).TraceGenieSettings = {
      projectKey: "${projectKey}",
      appName: "${appName}",
      appEnvironment: "production",
      sessionTokenEndpoint: "/api/tracegenie/widget-session",
      user: this.auth.currentUser
        ? {
            id: this.auth.currentUser.id,
            email: this.auth.currentUser.email,
            name: this.auth.currentUser.name,
          }
        : undefined,
    };
  }
}`;

    case "svelte":
      return `<!-- In your +layout.svelte (SvelteKit) or App.svelte -->
<script>
  import { onMount } from "svelte";
  import { user } from "$lib/stores/auth";

  onMount(() => {
    window.TraceGenieSettings = {
      projectKey: "${projectKey}",
      appName: "${appName}",
      appEnvironment: "production",
      sessionTokenEndpoint: "/api/tracegenie/widget-session",
      user: $user ? {
        id: $user.id,
        email: $user.email,
        name: $user.name,
      } : undefined,
    };

    const script = document.createElement("script");
    script.src = "${apiBaseUrl}/widget/embed.js";
    script.async = true;
    document.body.appendChild(script);
  });
</script>`;

    case "php":
      return `<!-- In your Blade/PHP layout -->
<script>
  window.TraceGenieSettings = {
    projectKey: "${projectKey}",
    appName: "${appName}",
    appEnvironment: "production",
    sessionTokenEndpoint: "/api/tracegenie/widget-session",
    <?php if (auth()->check()): ?>
    user: {
      id: "<?= auth()->user()->id ?>",
      email: "<?= auth()->user()->email ?>",
      name: "<?= auth()->user()->name ?>",
    },
    <?php endif; ?>
  };
</script>
${scriptTag}`;

    case "django":
      return `{# In your base.html template #}
<script>
  window.TraceGenieSettings = {
    projectKey: "${projectKey}",
    appName: "${appName}",
    appEnvironment: "production",
    sessionTokenEndpoint: "/api/tracegenie/widget-session",
    {% if user.is_authenticated %}
    user: {
      id: "{{ user.pk }}",
      email: "{{ user.email }}",
      name: "{{ user.get_full_name }}",
    },
    {% endif %}
  };
</script>
${scriptTag}`;

    case "rails":
      return `<%# In your application layout (application.html.erb) %>
<script>
  window.TraceGenieSettings = {
    projectKey: "${projectKey}",
    appName: "${appName}",
    appEnvironment: "<%= Rails.env %>",
    sessionTokenEndpoint: "/api/tracegenie/widget-session",
    <% if current_user %>
    user: {
      id: "<%= current_user.id %>",
      email: "<%= current_user.email %>",
      name: "<%= current_user.name %>",
    },
    <% end %>
  };
</script>
${scriptTag}`;

    case "express":
      return `<!-- In your EJS/Pug/Handlebars layout -->
<script>
  window.TraceGenieSettings = {
    projectKey: "${projectKey}",
    appName: "${appName}",
    appEnvironment: "<%= process.env.NODE_ENV %>",
    sessionTokenEndpoint: "/api/tracegenie/widget-session",
    <% if (user) { %>
    user: {
      id: "<%= user.id %>",
      email: "<%= user.email %>",
      name: "<%= user.name %>",
    },
    <% } %>
  };
</script>
${scriptTag}`;

    case "dotnet":
      return `@* In your _Layout.cshtml *@
<script>
  window.TraceGenieSettings = {
    projectKey: "${projectKey}",
    appName: "${appName}",
    appEnvironment: "@(Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"))",
    sessionTokenEndpoint: "/api/tracegenie/widget-session",
    @if (User.Identity?.IsAuthenticated == true)
    {
      <text>
      user: {
        id: "@User.FindFirst("sub")?.Value",
        email: "@User.FindFirst("email")?.Value",
        name: "@User.Identity.Name",
      },
      </text>
    }
  };
</script>
${scriptTag}`;

    case "go":
      return `{{/* In your Go HTML template */}}
<script>
  window.TraceGenieSettings = {
    projectKey: "${projectKey}",
    appName: "${appName}",
    appEnvironment: "production",
    sessionTokenEndpoint: "/api/tracegenie/widget-session",
    {{if .User}}
    user: {
      id: "{{.User.ID}}",
      email: "{{.User.Email}}",
      name: "{{.User.Name}}",
    },
    {{end}}
  };
</script>
${scriptTag}`;

    default:
      return "";
  }
}

export function getBackendSnippet(framework: Framework, projectKey: string, apiBaseUrl: string): string {
  const apiUrl = `${apiBaseUrl}/api/projects/server/${projectKey}/widget-session`;
  const note = "// Store PROJECT_SECRET in environment variables — never expose it client-side.";

  switch (framework) {
    case "html":
      return `${note}
// Create a server-side endpoint that your frontend calls to obtain a session token.
// The endpoint should POST to:
//   ${apiUrl}
// with JSON body:
//   { clientSecret: process.env.TRACEGENIE_PROJECT_SECRET, origin: request.headers.origin }
// and return the { token } to the browser. Only allow calls from your app origin.`;

    case "nextjs":
      return `${note}
// app/api/tracegenie/widget-session/route.ts
export async function POST(request: Request) {
  const response = await fetch("${apiUrl}", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientSecret: process.env.TRACEGENIE_PROJECT_SECRET,
      origin: request.headers.get("origin"),
    }),
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}`;

    case "react":
    case "express":
      return `${note}
// server endpoint: POST /api/tracegenie/widget-session
app.post("/api/tracegenie/widget-session", async (req, res) => {
  const origin = req.headers.origin;
  const response = await fetch("${apiUrl}", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientSecret: process.env.TRACEGENIE_PROJECT_SECRET,
      origin,
    }),
  });
  const data = await response.json();
  res.json(data);
});`;

    case "vue":
    case "angular":
    case "svelte":
      return `${note}
// Create a backend endpoint in your API layer (Express / Fastify / Hono / etc.)
// POST /api/tracegenie/widget-session
app.post("/api/tracegenie/widget-session", async (req, res) => {
  const origin = req.headers.origin;
  const response = await fetch("${apiUrl}", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientSecret: process.env.TRACEGENIE_PROJECT_SECRET,
      origin,
    }),
  });
  const data = await response.json();
  res.json(data);
});`;

    case "php":
      return `<?php
${note}
// routes/api.php (Laravel)
Route::post("/tracegenie/widget-session", function () {
    $response = Http::post("${apiUrl}", [
        "clientSecret" => env("TRACEGENIE_PROJECT_SECRET"),
        "origin" => request()->headers->get("origin"),
    ]);
    return $response->json();
});`;

    case "django":
      return `${note}
# views.py
import requests
from django.http import JsonResponse
from django.conf import settings

def tracegenie_widget_session(request):
    response = requests.post(
        "${apiUrl}",
        json={
            "clientSecret": settings.TRACEGENIE_PROJECT_SECRET,
            "origin": request.headers.get("origin"),
        },
    )
    return JsonResponse(response.json())

# urls.py
# path("api/tracegenie/widget-session", views.tracegenie_widget_session)`;

    case "rails":
      return `${note}
# app/controllers/tracegenie_controller.rb
class TracegenieController < ApplicationController
  def widget_session
    response = Net::HTTP.post(
      URI("${apiUrl}"),
      {
        clientSecret: ENV["TRACEGENIE_PROJECT_SECRET"],
        origin: request.headers["Origin"]
      }.to_json,
      "Content-Type" => "application/json"
    )
    render json: JSON.parse(response.body)
  end
end

# config/routes.rb
# post "api/tracegenie/widget-session", to: "tracegenie#widget_session"`;

    case "dotnet":
      return `${note}
// Controllers/TraceGenieController.cs
[ApiController]
[Route("api/tracegenie")]
public class TraceGenieController : ControllerBase
{
    private readonly HttpClient _http;

    public TraceGenieController(IHttpClientFactory factory)
    {
        _http = factory.CreateClient();
    }

    [HttpPost("widget-session")]
    public async Task<IActionResult> WidgetSession()
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "${apiUrl}");
        request.Content = JsonContent.Create(new
        {
            clientSecret = Environment.GetEnvironmentVariable("TRACEGENIE_PROJECT_SECRET"),
            origin = Request.Headers.Origin.ToString()
        });
        var response = await _http.SendAsync(request);
        var json = await response.Content.ReadAsStringAsync();
        return Content(json, "application/json");
    }
}`;

    case "go":
      return `${note}
// handler.go
func tracegenieWidgetSession(w http.ResponseWriter, r *http.Request) {
    payload := strings.NewReader(fmt.Sprintf(
        \`{"clientSecret":%q,"origin":%q}\`,
        os.Getenv("TRACEGENIE_PROJECT_SECRET"),
        r.Header.Get("Origin"),
    ))
    req, _ := http.NewRequest("POST", "${apiUrl}", payload)
    req.Header.Set("Content-Type", "application/json")
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        http.Error(w, "upstream error", 502)
        return
    }
    defer resp.Body.Close()
    w.Header().Set("Content-Type", "application/json")
    io.Copy(w, resp.Body)
}

// router
// mux.HandleFunc("POST /api/tracegenie/widget-session", tracegenieWidgetSession)`;

    default:
      return "";
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Not in secure context
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      data-copied={copied ? "true" : "false"}
      className="tg-copy-button absolute right-3 top-3 flex items-center gap-1.5 rounded-md bg-brand-700/80 px-2.5 py-1 text-caption font-medium text-brand-100 transition-colors hover:bg-brand-600"
    >
      {copied ? <Check className="size-3" /> : <Clipboard className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function WidgetSnippet({ projectKey, appName, allowedOrigins = [], apiBaseUrl = DEFAULT_API_BASE, hostedFeedbackUrl = null, organizationId = null, onDiagnosticsChange }: WidgetSnippetProps) {
  const [mode, setMode] = useState<IntegrationMode>("script");
  const [framework, setFramework] = useState<Framework>("html");
  const [reactCopied, setReactCopied] = useState(false);
  const [hostedCopied, setHostedCopied] = useState(false);
  const [installDiagnostics, setInstallDiagnostics] = useState<ProjectInstallDiagnosticsResponse | null>(null);
  const [installCheckOrigin, setInstallCheckOrigin] = useState(allowedOrigins[0] ?? "");
  const [installCheckLoading, setInstallCheckLoading] = useState(false);
  const [installProofLoading, setInstallProofLoading] = useState(false);
  const [installProofTicketNumber, setInstallProofTicketNumber] = useState<number | null>(null);
  const [installCheckError, setInstallCheckError] = useState("");
  const installRequestGeneration = useRef(0);
  const onDiagnosticsChangeRef = useRef(onDiagnosticsChange);
  onDiagnosticsChangeRef.current = onDiagnosticsChange;

  const reactSnippet = getReactSnippet(projectKey, appName, apiBaseUrl);
  const frontendSnippet = getFrontendSnippet(framework, projectKey, appName, apiBaseUrl);
  const snippetFramework = mode === "react" ? "react" : framework;
  const backendSnippet = getBackendSnippet(snippetFramework, projectKey, apiBaseUrl);
  const defaultInstallOrigin = allowedOrigins[0] ?? "";

  useEffect(() => {
    const nextOrigin = defaultInstallOrigin;
    setInstallCheckOrigin(nextOrigin);
    setInstallDiagnostics(null);
    setInstallProofTicketNumber(null);
    setInstallCheckError("");
    const generation = ++installRequestGeneration.current;
    setInstallCheckLoading(true);
    void api.getProjectInstallDiagnostics(projectKey, nextOrigin, organizationId)
      .then((result) => {
        if (installRequestGeneration.current === generation) {
          setInstallDiagnostics(result);
          onDiagnosticsChangeRef.current?.(result);
        }
      })
      .catch(() => {
        if (installRequestGeneration.current === generation) setInstallCheckError(copy.projects.installCheckFailed);
      })
      .finally(() => {
        if (installRequestGeneration.current === generation) setInstallCheckLoading(false);
      });
    return () => {
      installRequestGeneration.current += 1;
    };
  }, [defaultInstallOrigin, organizationId, projectKey]);

  async function copyReactSnippet() {
    try {
      await navigator.clipboard.writeText(reactSnippet);
      setReactCopied(true);
      setTimeout(() => setReactCopied(false), 2000);
    } catch {
      // Fallback
    }
  }

  async function copyHostedFeedbackUrl() {
    if (!hostedFeedbackUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(hostedFeedbackUrl);
      setHostedCopied(true);
      setTimeout(() => setHostedCopied(false), 2000);
    } catch {
      // Fallback
    }
  }

  async function runInstallCheck() {
    const generation = ++installRequestGeneration.current;
    const submittedOrigin = installCheckOrigin.trim();
    setInstallCheckLoading(true);
    setInstallCheckError("");
    try {
      const result = await api.getProjectInstallDiagnostics(projectKey, submittedOrigin, organizationId);
      if (installRequestGeneration.current === generation) {
        setInstallDiagnostics(result);
        onDiagnosticsChangeRef.current?.(result);
      }
    } catch {
      if (installRequestGeneration.current === generation) setInstallCheckError(copy.projects.installCheckFailed);
    } finally {
      if (installRequestGeneration.current === generation) setInstallCheckLoading(false);
    }
  }

  async function submitInstallTestReport() {
    const generation = ++installRequestGeneration.current;
    const submittedOrigin = installCheckOrigin.trim();
    setInstallProofLoading(true);
    setInstallCheckError("");
    setInstallProofTicketNumber(null);
    try {
      const result = await api.submitProjectInstallTestReport(projectKey, submittedOrigin, organizationId);
      if (installRequestGeneration.current !== generation) return;
      setInstallDiagnostics(result.installDiagnostics);
      onDiagnosticsChangeRef.current?.(result.installDiagnostics);
      setInstallProofTicketNumber(result.feedback.ticketNumber);
    } catch {
      if (installRequestGeneration.current === generation) setInstallCheckError(copy.projects.installCheckFailed);
    } finally {
      if (installRequestGeneration.current === generation) setInstallProofLoading(false);
    }
  }

  return (
    <section id="widget-snippet-card" className="px-1 pt-1">
      <div id="widget-snippet-details" className="tg-card overflow-hidden p-0">
        <div className="px-5 py-4">
          <h2 className="text-title text-foreground">
            Install widget
          </h2>
          <p className="mt-1 text-caption text-muted">
            Add the frontend snippet and the backend session-token endpoint. Keep the project secret on your server.
          </p>
        </div>

        <div id="widget-snippet-content" className="border-t border-border/30 px-5 py-5">
          <ol id="widget-install-steps" className="grid overflow-hidden rounded-lg border border-border/40 bg-surface sm:grid-cols-3" aria-label="Widget installation steps">
            <li className="grid min-h-20 grid-cols-[auto_minmax(0,1fr)] gap-2 border-b border-border/30 px-3 py-3 sm:border-b-0 sm:border-r">
              <span className="flex size-6 items-center justify-center rounded-full bg-surface-muted text-caption font-semibold text-foreground" aria-hidden="true">1</span>
              <span className="min-w-0">
                <span className="block text-caption font-semibold text-foreground">Allow website</span>
                <span className="mt-0.5 block text-caption leading-snug text-muted">Choose where the widget can run.</span>
              </span>
            </li>
            <li className="grid min-h-20 grid-cols-[auto_minmax(0,1fr)] gap-2 border-b border-border/30 px-3 py-3 sm:border-b-0 sm:border-r">
              <span className="flex size-6 items-center justify-center rounded-full bg-surface-muted text-caption font-semibold text-foreground" aria-hidden="true">2</span>
              <span className="min-w-0">
                <span className="block text-caption font-semibold text-foreground">Add widget</span>
                <span className="mt-0.5 block text-caption leading-snug text-muted">Install the client snippet and keep the secret on your server.</span>
              </span>
            </li>
            <li className="grid min-h-20 grid-cols-[auto_minmax(0,1fr)] gap-2 px-3 py-3">
              <span className="flex size-6 items-center justify-center rounded-full bg-surface-muted text-caption font-semibold text-foreground" aria-hidden="true">3</span>
              <span className="min-w-0">
                <span className="block text-caption font-semibold text-foreground">Verify</span>
                <span className="mt-0.5 block text-caption leading-snug text-muted">Create a real test report.</span>
              </span>
            </li>
          </ol>

          <div id="widget-install-method" className="mt-5 grid gap-4 md:grid-cols-2">
            <label htmlFor="widget-snippet-mode" className="space-y-1 text-label text-foreground">
              <span className="block font-medium">Install method</span>
              <select
                id="widget-snippet-mode"
                className="tg-soft-input h-9 w-full rounded-lg border px-3 text-body text-foreground outline-none focus:border-primary focus:ring-3 focus:ring-primary/15"
                value={mode}
                onChange={(event) => setMode(event.target.value as IntegrationMode)}
              >
                <option value="script">Script embed, recommended</option>
                <option value="react">React component</option>
              </select>
            </label>
            {mode === "script" ? (
              <label htmlFor="widget-snippet-framework" className="space-y-1 text-label text-foreground">
                <span className="block font-medium">Framework</span>
                <select
                  id="widget-snippet-framework"
                  className="tg-soft-input h-9 w-full rounded-lg border px-3 text-body text-foreground outline-none focus:border-primary focus:ring-3 focus:ring-primary/15"
                  value={framework}
                  onChange={(event) => setFramework(event.target.value as Framework)}
                >
                  {FRAMEWORK_ORDER.map((fw) => (
                    <option key={fw} value={fw}>{FRAMEWORK_LABELS[fw]}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {hostedFeedbackUrl ? (
            <details id="widget-hosted-feedback-fallback" className="mt-4 border-t border-border/30 pt-3">
              <summary className="tg-disclosure-summary cursor-pointer list-none text-caption font-medium text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
                Need a hosted feedback page instead?
              </summary>
              <div id="widget-hosted-feedback-copy" className="mt-3 rounded-lg bg-surface-muted/35 p-3">
                <p className="text-caption leading-relaxed text-muted">
                  Use this reduced-context fallback only when the widget cannot be embedded.
                </p>
                <div id="widget-hosted-feedback-url-row" className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="widget-hosted-feedback-url"
                    className="tg-soft-input h-9 min-w-0 flex-1 rounded-lg border px-3 font-mono text-caption text-foreground outline-none focus:border-primary focus:ring-3 focus:ring-primary/15"
                    readOnly
                    value={hostedFeedbackUrl}
                  />
                  <button
                    id="widget-hosted-feedback-copy-button"
                    type="button"
                    onClick={() => void copyHostedFeedbackUrl()}
                    data-copied={hostedCopied ? "true" : "false"}
                    className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-border/45 bg-surface px-3 text-caption font-semibold text-foreground transition-colors hover:bg-surface-muted/65"
                  >
                    {hostedCopied ? <Check className="size-3" /> : <Clipboard className="size-3" />}
                    {hostedCopied ? "Copied" : "Copy link"}
                  </button>
                  <a
                    id="widget-hosted-feedback-open"
                    href={hostedFeedbackUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-9 items-center justify-center rounded-md border border-border/45 bg-surface px-3 text-caption font-semibold text-foreground transition-colors hover:bg-surface-muted/65"
                  >
                    Open page
                  </a>
                </div>
              </div>
            </details>
          ) : null}

          <WidgetInstallationGuide
            idPrefix="widget"
            projectKey={projectKey}
            appName={appName}
            apiBaseUrl={apiBaseUrl}
            allowedOrigins={allowedOrigins}
            frameworkLabel={FRAMEWORK_LABELS[snippetFramework]}
            integrationLabel={mode === "react" ? "React component" : "Script embed"}
            frontendSnippet={mode === "react" ? reactSnippet : frontendSnippet}
            backendSnippet={backendSnippet}
          >
            {mode === "react" ? (
              <div id="widget-react-snippet" className="mt-4">
                <p className="mb-2 text-label font-semibold text-foreground">2. Add the React widget</p>
                <div className="relative">
                  <pre className="overflow-x-auto rounded-lg border border-border bg-code p-5 pr-20 text-body leading-6 text-code-text">
                    <code>{reactSnippet}</code>
                  </pre>
                  <button
                    type="button"
                    onClick={() => void copyReactSnippet()}
                    data-copied={reactCopied ? "true" : "false"}
                    className="tg-copy-button absolute right-3 top-3 flex items-center gap-1.5 rounded-md bg-brand-700/80 px-2.5 py-1 text-caption font-medium text-brand-100 transition-colors hover:bg-brand-600"
                  >
                    {reactCopied ? <Check className="size-3" /> : <Clipboard className="size-3" />}
                    {reactCopied ? "Copied" : "Copy snippet"}
                  </button>
                </div>
                <p className="mt-3 text-caption leading-5 text-muted">
                  Requires <code className="rounded bg-surface-muted px-1.5 py-0.5 text-caption font-medium text-foreground">@tracegenie/widget</code> as a dependency.
                </p>
              </div>
            ) : (
              <div id="widget-script-snippet" className="mt-4">
                <div>
                  <p className="mb-2 text-label font-semibold text-foreground">
                    2. Add the frontend widget
                  </p>
                  <div className="relative">
                    <pre className="overflow-x-auto rounded-lg border border-border bg-code p-5 pr-20 text-body leading-6 text-code-text">
                      <code>{frontendSnippet}</code>
                    </pre>
                    <CopyButton text={frontendSnippet} />
                  </div>
                </div>

              </div>
            )}

            <details id="widget-backend-snippet" className="mt-4 rounded-xl border border-border/35">
              <summary className="tg-disclosure-summary cursor-pointer list-none px-4 py-3 text-label font-medium text-foreground hover:bg-surface-muted/35 [&::-webkit-details-marker]:hidden">
                Backend session token, required for production
              </summary>
              <div className="border-t border-border/30 p-4">
                <p className="mb-3 text-caption text-muted">
                  Create this backend session-token endpoint on your server and store the widget secret in environment variables.
                </p>
                <div className="relative">
                  <pre className="overflow-x-auto rounded-lg border border-border bg-code p-5 pr-20 text-body leading-6 text-code-text">
                    <code>{backendSnippet}</code>
                  </pre>
                  <CopyButton text={backendSnippet} />
                </div>
              </div>
            </details>

          </WidgetInstallationGuide>

          <div id="widget-install-checklist" className="mt-5 rounded-lg border border-border/40 bg-surface px-4 py-4">
            <div id="widget-install-check-header" className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-label font-semibold text-foreground">3. Verify installation</p>
                <p className="mt-1 max-w-xl text-caption leading-relaxed text-muted">Check the selected origin, then create one real report through the production intake path.</p>
              </div>
              <div id="widget-install-check-controls" className="flex flex-wrap items-end gap-2">
                <label htmlFor="widget-install-check-origin" className="space-y-1 text-caption text-foreground">
                  <span className="block font-medium">Origin to test</span>
                  <input
                    id="widget-install-check-origin"
                    className="tg-soft-input h-9 w-64 max-w-full rounded-lg border px-3 text-body text-foreground outline-none focus:border-primary focus:ring-3 focus:ring-primary/15"
                    list="widget-install-check-origins"
                    value={installCheckOrigin}
                    onChange={(event) => setInstallCheckOrigin(event.target.value)}
                    placeholder="https://app.example.com"
                  />
                </label>
                <datalist id="widget-install-check-origins">
                  {allowedOrigins.map((origin) => (
                    <option key={origin} value={origin} />
                  ))}
                </datalist>
                <button
                  id="widget-install-check-button"
                  type="button"
                  onClick={() => void runInstallCheck()}
                  disabled={installCheckLoading || installProofLoading}
                  className="inline-flex min-h-9 items-center rounded-md border border-border/45 bg-surface px-3 text-caption font-semibold text-foreground transition-colors hover:bg-surface-muted/65 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {installCheckLoading ? copy.projects.installCheckRunning : copy.projects.installCheckRun}
                </button>
                <button
                  id="widget-install-proof-button"
                  type="button"
                  data-tg-primary-target="true"
                  onClick={() => void submitInstallTestReport()}
                  disabled={installCheckLoading || installProofLoading || !installCheckOrigin.trim()}
                  className="inline-flex min-h-11 items-center rounded-md border border-primary/35 bg-primary px-3 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-9"
                >
                  {installProofLoading ? copy.projects.installProofRunning : copy.projects.installProofRun}
                </button>
              </div>
            </div>
            {installProofTicketNumber ? (
              <p id="widget-install-proof-created" className="mt-3 text-caption text-success-700">
                {copy.projects.installProofCreated(installProofTicketNumber)}
              </p>
            ) : null}
            {installDiagnostics ? (
              <div id="widget-install-diagnostics" className="mt-4 border-t border-border/30 pt-4">
                <div id="widget-install-diagnostics-summary" className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-label font-medium text-foreground">{copy.projects.installCheckTitle}</p>
                    <p className="mt-1 text-caption text-muted">{activationSummary(installDiagnostics.status)}</p>
                  </div>
                  <p className="text-caption text-muted">
                    {installDiagnostics.testOrigin ? `Testing ${installDiagnostics.testOrigin}` : copy.projects.installCheckBody}
                  </p>
                </div>
                <div className="mt-3 overflow-hidden rounded-lg border border-border/30 bg-surface">
                  <ProjectActivationProofs diagnostics={installDiagnostics} id="widget-install-diagnostics-list" />
                </div>
              </div>
            ) : null}
            {installCheckError ? (
              <p id="widget-install-check-error" className="mt-3 text-caption text-danger-700">{installCheckError}</p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
