import { useEffect, useMemo, useState } from "react";
import { FeedbackWidget } from "@tracegenie/widget";
import type { WidgetProjectConfig } from "@tracegenie/shared";
import traceGenieLogoUrl from "../../../../packages/shared/src/assets/tracegenie-logo.svg?inline";

import { getApiBaseUrl } from "./env";

const API_BASE_URL = getApiBaseUrl();

type RemoteProjectConfig = {
  defaultEnvironment: string;
  key: string;
  name: string;
  widgetConfig?: WidgetProjectConfig;
};

type ConfigState =
  | {
      status: "checking";
    }
  | {
      data: RemoteProjectConfig;
      status: "ready";
    }
  | {
      error: string;
      status: "failed";
    };

type TargetKey = "button" | "field" | "row";

function valueTone(status: "good" | "muted" | "warning" | "danger") {
  if (status === "good") return "text-primary";
  if (status === "warning") return "text-warning-700";
  if (status === "danger") return "text-danger-700";
  return "text-muted";
}

async function getPreviewWidgetSessionToken(projectKey: string, origin: string) {
  const response = await fetch(`${API_BASE_URL}/api/projects/admin/${projectKey}/widget-session`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ origin }),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Widget preview session failed.");
  }

  return String(payload.token);
}

async function getHostedWidgetSessionToken(projectKey: string, origin: string) {
  const response = await fetch(`${API_BASE_URL}/api/projects/public/${projectKey}/hosted-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ origin }),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Hosted feedback session failed.");
  }

  return String(payload.token);
}

export function App() {
  const [selectedTarget, setSelectedTarget] = useState<TargetKey>("button");
  const [configReload, setConfigReload] = useState(0);
  const [configState, setConfigState] = useState<ConfigState>({
    status: "checking",
  });

  const previewConfig = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode") === "feedback" ? "feedback" : "preview";
    return {
      appName: params.get("appName")?.trim() || "TraceGenie Demo",
      mode,
      projectKey: params.get("projectKey")?.trim() || "community",
    };
  }, []);

  const currentOrigin = useMemo(() => window.location.origin, []);
  const isHostedFeedback = previewConfig.mode === "feedback";

  useEffect(() => {
    let cancelled = false;

    setConfigState({
      status: "checking",
    });

    const configPath = isHostedFeedback ? "hosted-config" : "widget-config";

    fetch(`${API_BASE_URL}/api/projects/public/${previewConfig.projectKey}/${configPath}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            response.status === 403
              ? "This feedback page is not authorized for this product."
              : response.status === 404
                ? "This feedback page is no longer available."
                : "We could not load the feedback form.",
          );
        }

        return response.json() as Promise<RemoteProjectConfig>;
      })
      .then((data) => {
        if (!cancelled) {
          setConfigState({
            data,
            status: "ready",
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setConfigState({
            error: !navigator.onLine
              ? "You are offline. Reconnect and try again."
              : error instanceof Error ? error.message : "We could not load the feedback form.",
            status: "failed",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [configReload, isHostedFeedback, previewConfig.projectKey]);

  const projectName = configState.status === "ready" ? configState.data.name : previewConfig.appName;
  const environment = configState.status === "ready" ? configState.data.defaultEnvironment : "staging";
  const widgetConfig = configState.status === "ready" ? configState.data.widgetConfig : undefined;
  const hostedWidgetConfig = useMemo<WidgetProjectConfig | undefined>(() => {
    if (!widgetConfig) {
      return undefined;
    }

    if (!isHostedFeedback) {
      return widgetConfig;
    }

    return {
      ...widgetConfig,
      allowScreenshot: false,
      allowPointSelection: false,
      allowConsoleCapture: false,
      allowClientErrorContext: false,
      allowNetworkSummary: false,
      appearance: {
        ...widgetConfig?.appearance,
        launcherLabel: "Open feedback form",
        launcherPresentation: "text",
        modalTitle: "Send feedback",
      },
    };
  }, [isHostedFeedback, widgetConfig]);
  const launcherLabel = hostedWidgetConfig?.appearance?.launcherLabel?.trim() || "Report a Bug";
  const pointEnabled = Boolean(hostedWidgetConfig?.allowScreenshot && hostedWidgetConfig?.allowPointSelection);
  const screenshotEnabled = isHostedFeedback ? false : hostedWidgetConfig?.allowScreenshot !== false;
  const debugEnabled = isHostedFeedback ? false : hostedWidgetConfig?.allowConsoleCapture !== false || hostedWidgetConfig?.allowClientErrorContext !== false;
  const hostedFeedbackWidget = isHostedFeedback ? (
    <FeedbackWidget
      apiBaseUrl={API_BASE_URL}
      projectKey={previewConfig.projectKey}
      appName={projectName}
      appEnvironment={environment}
      appVersion="1.8.4"
      buildNumber="hosted-feedback-page"
      releaseChannel="hosted"
      routeName="hosted-feedback"
      widgetConfig={hostedWidgetConfig}
      fetchProjectConfig={false}
      currentUser={undefined}
      extraContext={{ intakeMode: "hosted_feedback" }}
      getWidgetSessionToken={() => getHostedWidgetSessionToken(previewConfig.projectKey, currentOrigin)}
    />
  ) : null;

  if (isHostedFeedback) {
    return (
      <div id="hosted-feedback-page" className="min-h-[100dvh] bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10">
        <main id="hosted-feedback-main" className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-3xl flex-col sm:min-h-[calc(100dvh-5rem)]">
          <header id="hosted-feedback-header" className="flex items-center justify-between border-b border-border pb-5">
            <img
              src={traceGenieLogoUrl}
              alt="TraceGenie"
              width="122"
              height="42"
              className="h-[42px] w-[122px]"
            />
            <span className="text-caption font-medium text-muted">Secure feedback</span>
          </header>

          <section id="hosted-feedback-experience" className="flex flex-1 flex-col justify-center py-10 sm:py-16">
            {configState.status === "checking" ? (
              <div id="hosted-feedback-loading" className="max-w-xl" role="status" aria-live="polite">
                <p className="text-caption font-semibold text-primary">Preparing feedback</p>
                <h1 className="mt-3 text-display text-foreground">Loading the secure form...</h1>
                <p className="mt-3 text-body text-muted">We are confirming the product and its privacy settings.</p>
              </div>
            ) : null}

            {configState.status === "failed" ? (
              <div id="hosted-feedback-error" className="max-w-xl" role="alert">
                <p className="text-caption font-semibold text-danger-700">Feedback unavailable</p>
                <h1 className="mt-3 text-display text-foreground">We could not open this form.</h1>
                <p className="mt-3 text-body text-muted">{configState.error}</p>
                <button
                  id="hosted-feedback-retry"
                  type="button"
                  onClick={() => setConfigReload((value) => value + 1)}
                  className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-foreground px-5 text-body font-medium text-white transition hover:opacity-90 focus:outline-none focus:ring-3 focus:ring-primary/20"
                >
                  Try again
                </button>
              </div>
            ) : null}

            {configState.status === "ready" ? (
              <div id="hosted-feedback-ready" className="max-w-xl">
                <p className="text-caption font-semibold text-primary">{projectName}</p>
                <h1 className="mt-3 text-display text-foreground">Tell us what happened.</h1>
                <p className="mt-3 max-w-lg text-body text-muted">
                  Share the problem, what you expected, and an optional contact email for updates. You can review everything before sending.
                </p>
                <button
                  id="hosted-feedback-open-form"
                  type="button"
                  onClick={openWidgetLauncher}
                  className="mt-7 inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-5 text-body font-medium text-white transition hover:bg-brand-700 focus:outline-none focus:ring-3 focus:ring-primary/20 active:scale-[0.98]"
                >
                  {launcherLabel}
                </button>
                <div id="hosted-feedback-trust" className="mt-8 border-l-2 border-border pl-4">
                  <p className="text-label font-medium text-foreground">Your report goes to {projectName}.</p>
                  <p className="mt-1 text-caption text-muted">Contact details are optional and are only stored after explicit consent.</p>
                </div>
              </div>
            ) : null}
          </section>

          <footer id="hosted-feedback-footer" className="border-t border-border pt-4 text-caption text-muted">
            Powered by TraceGenie · Do not include passwords, payment details, or other secrets.
          </footer>
        </main>
        {configState.status === "ready" ? hostedFeedbackWidget : null}
      </div>
    );
  }

  const readinessRows = [
    {
      label: "Config",
      value: configState.status === "ready" ? "Ready" : configState.status === "failed" ? configState.error : "Checking",
      tone: configState.status === "ready" ? "good" : configState.status === "failed" ? "danger" : "muted",
    },
    {
      label: "Origin",
      value: configState.status === "failed" ? "Blocked" : configState.status === "ready" ? "Allowed" : "Checking",
      tone: configState.status === "failed" ? "danger" : configState.status === "ready" ? "good" : "muted",
    },
    {
      label: "Screenshot",
      value: screenshotEnabled ? "On" : "Off",
      tone: screenshotEnabled ? "good" : "muted",
    },
    {
      label: "Point",
      value: pointEnabled ? "On" : "Off",
      tone: pointEnabled ? "good" : "warning",
    },
    {
      label: "Debug",
      value: debugEnabled ? "On" : "Off",
      tone: debugEnabled ? "good" : "muted",
    },
  ] as const;

  function openWidgetLauncher() {
    const launcher = document.querySelector<HTMLButtonElement>(".tgw-launcher, .tracegenie-widget-launcher");
    launcher?.click();
  }

  return (
    <div id="demo-host-page" className="min-h-[100dvh] bg-background px-4 py-5 text-foreground sm:px-6 lg:px-8">
      <main id="widget-preview-page" className="mx-auto max-w-[1180px]">
        <header id="widget-preview-header" className="flex flex-col gap-5 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div id="widget-preview-title-group" className="min-w-0">
            <img
              src={traceGenieLogoUrl}
              alt="TraceGenie"
              width="122"
              height="42"
              className="h-[42px] w-[122px]"
            />
            <h1 className="mt-6 text-display text-foreground">
              {isHostedFeedback ? "Send feedback" : "Test the widget"}
            </h1>
            <p className="mt-2 max-w-2xl text-body text-muted">
              {isHostedFeedback
                ? "Use this hosted page when the widget cannot be embedded yet."
                : "Open the widget, point at a target, and send a sample report for this project."}
            </p>
          </div>

          <div id="widget-preview-actions" className="flex flex-wrap gap-2">
            <button
              id="widget-preview-open-widget"
              type="button"
              onClick={openWidgetLauncher}
              className="inline-flex min-h-10 items-center justify-center rounded-full bg-brand-600 px-5 text-body font-medium text-white transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-brand-700 active:scale-[0.98]"
            >
              {isHostedFeedback ? launcherLabel : "Open widget"}
            </button>
          </div>
        </header>

        <section id="widget-preview-panel" className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div id="widget-preview-project-row" className="grid border-b border-border text-body sm:grid-cols-2 lg:grid-cols-4">
            <div id="widget-preview-project-name" className="border-b border-border p-4 sm:border-r lg:border-b-0">
              <p className="text-caption text-muted">Project</p>
              <p className="mt-1 truncate font-medium text-foreground">{projectName}</p>
            </div>
            <div id="widget-preview-project-key" className="border-b border-border p-4 lg:border-b-0 lg:border-r">
              <p className="text-caption text-muted">Project key</p>
              <p className="mt-1 truncate font-mono font-medium text-foreground">{previewConfig.projectKey}</p>
            </div>
            <div id="widget-preview-environment" className="border-b border-border p-4 sm:border-r lg:border-b-0">
              <p className="text-caption text-muted">Environment</p>
              <p className="mt-1 font-medium text-foreground">{environment}</p>
            </div>
            <div id="widget-preview-origin" className="p-4">
              <p className="text-caption text-muted">Origin</p>
              <p className="mt-1 truncate font-medium text-foreground">{currentOrigin}</p>
            </div>
          </div>

          <div id="widget-preview-readiness-row" className="grid border-b border-border text-body sm:grid-cols-5">
            {readinessRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:border-b-0 sm:border-r last:sm:border-r-0">
                <span className="text-muted">{row.label}</span>
                <span className={`font-semibold ${valueTone(row.tone)}`}>{row.value}</span>
              </div>
            ))}
          </div>

          {isHostedFeedback ? (
            <section id="hosted-feedback-context" className="min-w-0 px-5 py-5">
              <h2 className="text-title font-semibold text-foreground">Hosted fallback</h2>
              <p className="mt-1 max-w-2xl text-body text-muted">
                This page creates the same TraceGenie issue record as the embedded widget, with reduced technical context from the hosted page.
              </p>
            </section>
          ) : (
            <section id="widget-preview-targets" className="min-w-0">
              <div id="widget-preview-targets-header" className="border-b border-border px-5 py-4">
                <div className="min-w-0">
                  <h2 className="text-title font-semibold text-foreground">Try a target</h2>
                  <p className="mt-1 text-body text-muted">Select a row, field, or button before opening the widget.</p>
                </div>
              </div>

              <div id="widget-preview-target-list" className="divide-y divide-border">
                <button
                  id="widget-preview-target-row"
                  type="button"
                  onClick={() => setSelectedTarget("row")}
                  className={`grid w-full gap-3 px-5 py-5 text-left transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] sm:grid-cols-[minmax(0,1fr)_120px_90px] ${
                    selectedTarget === "row" ? "bg-brand-50" : "hover:bg-surface-muted/45"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-caption font-medium text-muted sm:hidden">Area</span>
                    <span className="mt-1 block font-medium text-foreground sm:mt-0">Widget install check</span>
                  </span>
                  <span>
                    <span className="block text-caption font-medium text-muted sm:hidden">Status</span>
                    <span className="mt-1 block text-foreground sm:mt-0">Review</span>
                  </span>
                  <span className="sm:text-right">
                    <span className="block text-caption font-medium text-muted sm:hidden">Count</span>
                    <span className="mt-1 block font-semibold text-foreground sm:mt-0">1</span>
                  </span>
                </button>

                <label
                  id="widget-preview-target-field"
                  className={`block px-5 py-5 transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                    selectedTarget === "field" ? "bg-brand-50" : ""
                  }`}
                >
                  <span className="block font-medium text-foreground">Release channel</span>
                  <input
                    id="widget-preview-release-channel"
                    type="text"
                    defaultValue="preview"
                    onFocus={() => setSelectedTarget("field")}
                    className="mt-3 h-11 w-full max-w-md rounded-lg border border-border-strong bg-surface px-3 text-body text-foreground outline-none transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] focus:border-primary focus:ring-3 focus:ring-primary/20"
                  />
                </label>

                <button
                  id="widget-preview-target-button"
                  type="button"
                  onClick={() => setSelectedTarget("button")}
                  className={`grid w-full gap-3 px-5 py-5 text-left transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${
                    selectedTarget === "button" ? "bg-brand-50" : "hover:bg-surface-muted/45"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground">Save settings button</span>
                    <span className="mt-1 block text-body text-muted">Use this to test action-level feedback.</span>
                  </span>
                  <span className="inline-flex min-h-10 w-max items-center rounded-full bg-foreground px-4 text-body font-medium text-white">
                    Save changes
                  </span>
                </button>
              </div>
            </section>
          )}
        </section>
      </main>

      <FeedbackWidget
        apiBaseUrl={API_BASE_URL}
        projectKey={previewConfig.projectKey}
        appName={projectName}
        appEnvironment={environment}
        appVersion="1.8.4"
        buildNumber="widget-preview-page"
        releaseChannel="preview"
        routeName="widget-preview"
        widgetConfig={hostedWidgetConfig}
        fetchProjectConfig={false}
        currentUser={{
          id: "tracegenie-admin",
          email: "admin@tracegenie.local",
          name: "TraceGenie Admin",
          role: "Project owner",
        }}
        extraContext={{
          configStatus: configState.status,
          currentOrigin,
          intakeMode: isHostedFeedback ? "hosted_feedback" : "widget_preview",
          selectedTarget,
          validationPage: true,
        }}
        getWidgetSessionToken={() => isHostedFeedback
          ? getHostedWidgetSessionToken(previewConfig.projectKey, currentOrigin)
          : getPreviewWidgetSessionToken(previewConfig.projectKey, currentOrigin)}
      />
    </div>
  );
}
