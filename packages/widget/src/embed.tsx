/**
 * TraceGenie Widget — Standalone Browser Embed
 *
 * IIFE entry point that reads `window.TraceGenieSettings` and self-renders
 * the feedback widget without requiring the host app to use React.
 *
 * Isolation: the widget mounts inside a Shadow DOM root and its stylesheet
 * is attached to that root. Nothing is injected into the host document's
 * styles, and host CSS cannot restyle the widget.
 *
 * Usage (host app):
 *
 *   <script>
 *     window.TraceGenieSettings = {
 *       projectKey: "community",
 *       sessionTokenEndpoint: "/api/tracegenie/session",
 *       appName: "My App",
 *       user: { id: "u1", email: "user@example.com", name: "Riley" },
 *       productContext: { account: { id: "acct_123" }, plan: { tier: "pro" }, experiments: { checkout_copy: "variant-b" } }
 *     };
 *   </script>
 *   <script src="https://feedback.example.com/widget/embed.js" async></script>
 *
 * After load, hosts can update the reporter identity and report-adjacent
 * context without polling:
 *
 *   window.TraceGenie.identify({ id, email, name });
 *   window.TraceGenie.setContext({ account: { id: "acct_123" } });
 *   window.TraceGenie.setFlags({ checkout_v2: true });
 *   window.TraceGenie.setExperiments({ checkout_copy: "variant-b" });
 *   window.TraceGenie.track("checkout_step", { step: "payment" });
 *   window.TraceGenie.open({
 *     context: {
 *       surveyResponse: { type: "nps", score: 9 },
 *       externalRefs: [{ provider: "posthog", label: "Replay", url: "https://app.posthog.com/project/1/replay/abc" }],
 *       customerImpact: { affectedUsers: 42 },
 *     },
 *   });
 */

import { createRoot,type Root } from "react-dom/client";
import { createElement } from "react";
import {
feedbackEventTrailSchema,
issueTypeSchema,
productContextSchema,
type FeedbackEventTrail,
type ProductContext,
} from "@tracegenie/shared";
import { FeedbackWidget,type FeedbackWidgetProps } from "./components/FeedbackWidget";
// Import CSS as an inline string so it can be attached to the shadow root.
import widgetCss from "./styles/widget.css?inline";
import { requestWidgetSessionToken } from "./lib/sessionToken";
import { resolveEmbedOrigin } from "./lib/embedOrigin";

interface TraceGenieUser {
  id: string;
  email: string;
  name: string;
}

interface TraceGenieSettings {
  projectKey: string;
  appName: string;
  appEnvironment?: string;
  appVersion?: string;
  apiBaseUrl?: string;
  sessionTokenEndpoint?: string;
  widgetSessionToken?: string;
  theme?: "light" | "dark";
  debug?: boolean;
  user?: TraceGenieUser;
  productContext?: ProductContext;
  extraContext?: Record<string, unknown>;
  openRequest?: TraceGenieOpenRequest;
}

type TraceGenieIssueType = (typeof issueTypeSchema.options)[number];
type TraceGenieTrackedEvent = FeedbackEventTrail[number];
type TraceGenieEventProperties = NonNullable<TraceGenieTrackedEvent["properties"]>;
type TraceGenieEventPropertyScalar = string | number | boolean | null;
type TraceGenieFeatureFlags = NonNullable<ProductContext["featureFlags"]>;
type TraceGenieExperimentVariants = NonNullable<ProductContext["experiments"]>;

type TraceGenieOpenRequest = {
  id: number;
  title?: string;
  issueType?: TraceGenieIssueType;
  extraContext?: Record<string, unknown>;
};

type TraceGenieOpenOptions = {
  type?: TraceGenieIssueType;
  issueType?: TraceGenieIssueType;
  title?: string;
  context?: Record<string, unknown>;
};

interface TraceGenieApi {
  /** Set or clear the reporter identity after page load (e.g. on login/logout). */
  identify: (user: TraceGenieUser | undefined) => void;
  /** Merge new settings and re-render the widget. */
  update: (settings: Partial<TraceGenieSettings>) => void;
  /** Set or clear bounded product context for future reports. */
  setContext: (context: ProductContext | undefined) => void;
  /** Merge feature flags into product context for future reports. */
  setFlags: (flags: TraceGenieFeatureFlags | undefined) => void;
  /** Merge experiment variants into product context for future reports. */
  setExperiments: (experiments: TraceGenieExperimentVariants | undefined) => void;
  /** Store a bounded report-adjacent event trail on future reports. */
  track: (name: string, properties?: TraceGenieEventProperties) => void;
  /** Open the compact report panel with optional prefill and context. */
  open: (options?: TraceGenieOpenOptions) => void;
  /** Clear reporter identity, product context, and tracked event context. */
  reset: () => void;
}

declare global {
  interface Window {
    TraceGenieSettings?: TraceGenieSettings;
    TraceGenie?: TraceGenieApi;
  }
}

const DEFAULT_API_BASE = resolveEmbedOrigin(
  document.currentScript instanceof HTMLScriptElement ? document.currentScript.src : undefined,
  window.location.origin,
);
const MAX_TRACKED_EVENTS = 20;
const MAX_TRACKED_EVENT_PROPERTIES = 20;
const MAX_TRACKED_EVENT_KEY_LENGTH = 80;
const MAX_TRACKED_EVENT_STRING_LENGTH = 500;
const MAX_TRACKED_EVENT_ARRAY_ITEMS = 20;

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function trackedEventUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.href;
}

function sanitizeTrackedScalar(value: unknown): TraceGenieEventPropertyScalar | undefined {
  if (typeof value === "string") return value.trim().slice(0, MAX_TRACKED_EVENT_STRING_LENGTH);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || value === null) return value;
  return undefined;
}

function sanitizeTrackedValue(value: unknown): TraceGenieEventProperties[string] | undefined {
  if (Array.isArray(value)) {
    const values = value
      .slice(0, MAX_TRACKED_EVENT_ARRAY_ITEMS)
      .map(sanitizeTrackedScalar)
      .filter((item): item is TraceGenieEventPropertyScalar => item !== undefined);
    return values.length > 0 ? values : undefined;
  }
  return sanitizeTrackedScalar(value);
}

function sanitizeTrackedProperties(properties: TraceGenieEventProperties | undefined): TraceGenieEventProperties | undefined {
  const record = asRecord(properties);
  if (!record) return undefined;

  const sanitized: TraceGenieEventProperties = {};
  for (const [key, value] of Object.entries(record).slice(0, MAX_TRACKED_EVENT_PROPERTIES)) {
    const cleanKey = key.trim().slice(0, MAX_TRACKED_EVENT_KEY_LENGTH);
    const cleanValue = sanitizeTrackedValue(value);
    if (cleanKey && cleanValue !== undefined) {
      sanitized[cleanKey] = cleanValue;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function compactProductContext(context: Partial<ProductContext> | undefined): ProductContext | undefined {
  if (!context) {
    return undefined;
  }

  const compacted = Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  );

  return Object.keys(compacted).length > 0 ? compacted as ProductContext : undefined;
}

function parseProductContext(context: ProductContext | undefined, settings: TraceGenieSettings) {
  if (!context) {
    return undefined;
  }

  const result = productContextSchema.safeParse(context);
  if (result.success) {
    return result.data;
  }

  debugWarn(settings, "Ignored invalid product context.");
  return settings.productContext;
}

function attachWidgetStyles(shadow: ShadowRoot) {
  if ("adoptedStyleSheets" in shadow && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(widgetCss);
    shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
    return;
  }

  const style = document.createElement("style");
  style.textContent = widgetCss;
  shadow.appendChild(style);
}

function debugWarn(settings: TraceGenieSettings | undefined, message: string) {
  if (settings?.debug) {
    console.warn(`[TraceGenie] ${message}`);
  }
}

function buildProps(settings: TraceGenieSettings): FeedbackWidgetProps {
  const apiBaseUrl = settings.apiBaseUrl || DEFAULT_API_BASE;

  const props: FeedbackWidgetProps = {
    apiBaseUrl,
    projectKey: settings.projectKey,
    appName: settings.appName,
    appEnvironment: settings.appEnvironment ?? "production",
    appVersion: settings.appVersion ?? "unknown",
    currentUser: settings.user,
    extraContext: settings.extraContext,
    productContext: settings.productContext,
    openRequest: settings.openRequest,
    theme: settings.theme,
    fetchProjectConfig: true,
  };

  // If a session token endpoint is provided, wrap it into the async getter
  if (settings.sessionTokenEndpoint) {
    const endpoint = settings.sessionTokenEndpoint;
    props.getWidgetSessionToken = () => requestWidgetSessionToken(endpoint);
  } else if (settings.widgetSessionToken) {
    props.widgetSessionToken = settings.widgetSessionToken;
  }

  return props;
}

function mount(initialSettings: TraceGenieSettings) {
  let settings: TraceGenieSettings = { ...initialSettings };
  let openRequestId = 0;

  // Host container: zero-footprint node; everything visual lives in the shadow root.
  const container = document.createElement("div");
  container.id = "tracegenie-embed-root";
  for (const [name, value] of Object.entries({
    position: "fixed",
    display: "block",
    top: "0",
    left: "0",
    width: "0",
    height: "0",
    "min-width": "0",
    "min-height": "0",
    overflow: "visible",
    visibility: "visible",
    opacity: "1",
    "pointer-events": "auto",
    "z-index": "2147483647",
  })) {
    container.style.setProperty(name, value, "important");
  }
  document.body.appendChild(container);

  const shadow = container.attachShadow({ mode: "open" });
  attachWidgetStyles(shadow);

  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);

  const root: Root = createRoot(mountPoint);

  const render = () => {
    root.render(createElement(FeedbackWidget, buildProps(settings)));
  };

  const commit = (next: TraceGenieSettings) => {
    settings = next;
    window.TraceGenieSettings = settings;
    render();
  };

  render();

  // Explicit host API. Replaces settings polling: hosts call
  // TraceGenie.identify(user) when their auth state changes.
  window.TraceGenie = {
    identify(user) {
      commit({ ...settings, user });
    },
    update(next) {
      commit({ ...settings, ...next });
    },
    setContext(context) {
      commit({
        ...settings,
        productContext: parseProductContext(compactProductContext(context), settings),
      });
    },
    setFlags(flags) {
      const { featureFlags: _featureFlags, ...contextWithoutFlags } = settings.productContext ?? {};
      const nextContext = compactProductContext({
        ...contextWithoutFlags,
        ...(flags ? { featureFlags: flags } : {}),
      });
      commit({
        ...settings,
        productContext: parseProductContext(nextContext, settings),
      });
    },
    setExperiments(experiments) {
      const { experiments: _experiments, ...contextWithoutExperiments } = settings.productContext ?? {};
      const nextContext = compactProductContext({
        ...contextWithoutExperiments,
        ...(experiments ? { experiments } : {}),
      });
      commit({
        ...settings,
        productContext: parseProductContext(nextContext, settings),
      });
    },
    track(name, properties) {
      const eventName = typeof name === "string" ? name.trim() : "";
      if (!eventName) {
        debugWarn(settings, "Ignored track call without an event name.");
        return;
      }

      const extraContext = settings.extraContext ?? {};
      const previousEventsResult = feedbackEventTrailSchema.safeParse(extraContext.eventTrail);
      if (extraContext.eventTrail !== undefined && !previousEventsResult.success) {
        debugWarn(settings, "Ignored invalid tracked event trail.");
      }
      const previousEvents = previousEventsResult.success ? previousEventsResult.data : [];
      const event: TraceGenieTrackedEvent = {
        name: eventName.slice(0, 120),
        timestamp: new Date().toISOString(),
        url: trackedEventUrl(),
        properties: sanitizeTrackedProperties(properties),
      };
      commit({
        ...settings,
        extraContext: {
          ...extraContext,
          eventTrail: [...previousEvents, event].slice(-MAX_TRACKED_EVENTS),
        },
      });
    },
    open(options) {
      const rawType = options?.issueType ?? options?.type;
      const parsedType = issueTypeSchema.safeParse(rawType);
      const title = typeof options?.title === "string" && options.title.trim() ? options.title.trim().slice(0, 160) : undefined;
      commit({
        ...settings,
        openRequest: {
          id: ++openRequestId,
          title,
          issueType: parsedType.success ? parsedType.data : undefined,
          extraContext: asRecord(options?.context),
        },
      });
    },
    reset() {
      commit({
        ...settings,
        user: undefined,
        productContext: undefined,
        extraContext: undefined,
        openRequest: undefined,
      });
    },
  };
}

function init() {
  const settings = window.TraceGenieSettings;

  if (settings?.projectKey) {
    mount(settings);
    return;
  }

  // If settings aren't ready yet (SPA still loading), poll until they appear
  let attempts = 0;
  const maxAttempts = 50; // 10 seconds
  const poll = setInterval(() => {
    attempts++;
    const s = window.TraceGenieSettings;
    if (s?.projectKey) {
      clearInterval(poll);
      mount(s);
    } else if (attempts >= maxAttempts) {
      clearInterval(poll);
      debugWarn(window.TraceGenieSettings, "No window.TraceGenieSettings found after 10s. Widget not mounted.");
    }
  }, 200);
}

// Run when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
