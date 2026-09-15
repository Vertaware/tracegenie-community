import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FeedbackWidget, type FeedbackWidgetProps } from "../src/components/FeedbackWidget";

const widgetCss = readFileSync(path.resolve(process.cwd(), "src/styles/widget.css"), "utf8");
const nativeScrollIntoView = HTMLElement.prototype.scrollIntoView;

const baseProps: FeedbackWidgetProps = {
  apiBaseUrl: "http://127.0.0.1:4000",
  projectKey: "tracegenie-demo",
  appName: "TraceGenie Demo",
  appEnvironment: "local",
  appVersion: "test",
  currentUser: {
    id: "user-primary",
  },
  fetchProjectConfig: false,
};

function opaqueDraftScope(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function canonicalApiScope(apiBaseUrl: string) {
  const url = new URL(apiBaseUrl, window.location.origin);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

type DraftScopeOverrides = Partial<Pick<FeedbackWidgetProps, "apiBaseUrl" | "projectKey" | "currentUser">>;

function draftScopeKey(overrides: DraftScopeOverrides = {}) {
  const apiBaseUrl = overrides.apiBaseUrl ?? baseProps.apiBaseUrl;
  const projectKey = overrides.projectKey ?? baseProps.projectKey;
  const currentUser = "currentUser" in overrides ? overrides.currentUser : baseProps.currentUser;
  const identityMarker = currentUser?.id
    ? `id:${currentUser.id.trim()}`
    : currentUser?.email
      ? `email:${currentUser.email.trim().toLowerCase()}`
      : currentUser
        ? `name:${currentUser.name?.trim() ?? "unknown"}`
        : "anonymous";
  const identityScope = currentUser ? `user:${opaqueDraftScope(identityMarker)}` : "anonymous-session";
  const scope = opaqueDraftScope(
    `${window.location.origin}|${canonicalApiScope(apiBaseUrl)}|${projectKey}|${identityScope}`,
  );
  return `tracegenie:widget-draft:${scope}`;
}

function draftStorage(overrides: DraftScopeOverrides = {}) {
  const currentUser = "currentUser" in overrides ? overrides.currentUser : baseProps.currentUser;
  return currentUser ? window.localStorage : window.sessionStorage;
}

function draftRecordKey(writerId = "writer-test", overrides: DraftScopeOverrides = {}) {
  return `${draftScopeKey(overrides)}:writer:${encodeURIComponent(writerId)}`;
}

function draftRecordKeys(overrides: DraftScopeOverrides = {}) {
  const storage = draftStorage(overrides);
  const prefix = `${draftScopeKey(overrides)}:writer:`;
  return Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(prefix)));
}

function readDraftRecord(writerId = "writer-test", overrides: DraftScopeOverrides = {}) {
  return JSON.parse(draftStorage(overrides).getItem(draftRecordKey(writerId, overrides)) ?? "null");
}

function readLatestDraft(overrides: DraftScopeOverrides = {}) {
  const storage = draftStorage(overrides);
  return draftRecordKeys(overrides)
    .map((key) => JSON.parse(storage.getItem(key) ?? "null"))
    .filter(Boolean)
    .sort((left, right) => right.savedAt - left.savedAt || right.revision - left.revision)[0] ?? null;
}

function legacyDraftKey(projectKey = baseProps.projectKey) {
  return `tracegenie:widget-draft:v1:${encodeURIComponent(window.location.origin)}:${encodeURIComponent(projectKey)}`;
}

function storedDraft(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    savedAt: Date.now(),
    writerId: "writer-test",
    revision: 1,
    form: {
      title: "Stored checkout issue",
      description: "The stored description remains available.",
      issueType: "bug",
      severity: "medium",
      stepsToReproduce: "Open checkout",
      expectedResult: "Checkout loads",
      actualResult: "Checkout stalls",
    },
    advancedOpen: true,
    ...overrides,
  };
}

function pristineDraftForm(overrides: Partial<ReturnType<typeof storedDraft>["form"]> = {}) {
  return {
    title: "",
    description: "",
    issueType: "bug",
    severity: "medium",
    stepsToReproduce: "",
    expectedResult: "",
    actualResult: "",
    ...overrides,
  };
}

async function openIncludedDisclosure(user: ReturnType<typeof userEvent.setup>) {
  const disclosure = screen.getByLabelText("What's included with your report");
  if (!disclosure.hasAttribute("open")) {
    await user.click(within(disclosure).getByText("What's included?"));
  }
  return disclosure;
}

function seedDraft(
  draftOverrides: Record<string, unknown> = {},
  scopeOverrides: DraftScopeOverrides = {},
  writerId = "writer-test",
) {
  const draft = storedDraft({ writerId, ...draftOverrides });
  draftStorage(scopeOverrides).setItem(draftRecordKey(writerId, scopeOverrides), JSON.stringify(draft));
  return draft;
}

function renderWidget(overrides: Partial<FeedbackWidgetProps> = {}) {
  return render(
    <FeedbackWidget
      {...baseProps}
      {...overrides}
      widgetConfig={{ autoCaptureScreenshot: false, ...overrides.widgetConfig }}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
  if (nativeScrollIntoView) {
    HTMLElement.prototype.scrollIntoView = nativeScrollIntoView;
  } else {
    delete (HTMLElement.prototype as { scrollIntoView?: typeof HTMLElement.prototype.scrollIntoView }).scrollIntoView;
  }
});

test("uses viewport insets, a single primary sheet scroller, and a 44px close target", () => {
  expect(widgetCss).toContain("--tgw-safe-area-bottom: env(safe-area-inset-bottom, 0px);");
  expect(widgetCss).toMatch(/@media \(max-width: 360px\)\s*\{\s*\.tgw-shortcut-hint\s*\{\s*display: none;/);
  expect(widgetCss).toContain("--tgw-viewport-height: 100svh;");
  expect(widgetCss).toContain("--tgw-viewport-height: 100dvh;");
  expect(widgetCss).toContain("bottom: var(--tgw-launcher-inset-bottom);");
  expect(widgetCss).toContain("overflow-y: auto;");
  expect(widgetCss).toMatch(/\.tgw-body\s*\{[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;[\s\S]*?touch-action: pan-y;/);
  expect(widgetCss).toMatch(/\.tgw-header\s*\{[\s\S]*?flex: 0 0 auto;/);
  expect(widgetCss).toMatch(/\.tgw-footer\s*\{[\s\S]*?flex: 0 0 auto;/);
  expect(widgetCss).toMatch(/@media \(hover: none\), \(pointer: coarse\)\s*\{\s*\.tgw-shortcut-hint\s*\{\s*display: none;/);
  expect(widgetCss).toMatch(/\.tgw-sheet-content\[hidden\]\s*\{\s*display: none;/);
  expect(widgetCss).toMatch(/\.tgw-icon-button\s*\{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  expect(widgetCss).toMatch(/\.tgw-segment\s*\{[\s\S]*?min-height: 44px;/);
  expect(widgetCss).toMatch(/\.tgw-text-button\s*\{[\s\S]*?min-height: 44px;/);
  expect(widgetCss).toMatch(/\.tgw-button-secondary\s*\{[\s\S]*?min-height: 44px;/);
  expect(widgetCss).toMatch(/\.tgw-button-primary\s*\{[\s\S]*?min-height: 44px;/);
  expect(widgetCss).toMatch(/\.tgw-evidence-action\s*\{[\s\S]*?min-height: 44px;[\s\S]*?min-width: 44px;/);
  expect(widgetCss).toContain("@media (max-height: 560px), (orientation: landscape) and (max-width: 900px)");
  expect(widgetCss).toContain("@media (prefers-reduced-motion: reduce)");
  expect(widgetCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.tgw-icon-button,[\s\S]*?transition: none;/);
});

test("compact mode renders a narrower explicit sheet without hiding the report workflow", async () => {
  const user = userEvent.setup();
  renderWidget({ widgetConfig: { appearance: { compactMode: true } } });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));

  const sheet = screen.getByRole("dialog");
  expect(sheet).toHaveAttribute("data-compact", "true");
  expect(sheet).toHaveClass("tgw-sheet--compact");
  expect(screen.getByLabelText("Title")).toBeInTheDocument();
  expect(screen.getByLabelText("What happened?")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /add detail/i })).toBeInTheDocument();
  expect(widgetCss).toMatch(/\.tgw-sheet--compact\s*\{[\s\S]*?width: min\(420px/);
  expect(widgetCss).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.tgw-sheet--compact\s*\{[\s\S]*?max-height: min\(78dvh, 680px\)/);
  expect(widgetCss).not.toMatch(/\.tgw-scrim\s*\{[^}]*backdrop-filter/);
  expect(widgetCss).not.toMatch(/\.tgw-sheet\s*\{[^}]*backdrop-filter/);
});

test("keeps optional reporter identity out of drafts and submissions without consent", async () => {
  const user = userEvent.setup();
  const hostIdentity = { name: "Prefilled Private Name", email: "private@example.test" };
  let submittedPayload: Record<string, unknown> | null = null;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, options) => {
    submittedPayload = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({
      feedback: {
        id: "feedback-anonymous",
        ticketNumber: 41,
        responseExpectation: "The team will follow up when there is an update.",
        trackingUrl: null,
      },
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  });
  renderWidget({
    currentUser: hostIdentity,
    widgetConfig: { reporterIdentity: { enabled: true } },
  });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.click(screen.getByText("Get updates"));
  const name = screen.getByLabelText(/Name/);
  const email = screen.getByLabelText(/Email/);
  await user.clear(name);
  await user.type(name, "Draft Secret Name");
  await user.clear(email);
  await user.type(email, "draft-secret@example.test");
  await user.type(screen.getByLabelText("Title"), "Anonymous report");
  await user.type(screen.getByLabelText("What happened?"), "The report should remain anonymous without consent.");
  expect(screen.getByRole("button", { name: "Send report" })).toBeDisabled();

  await waitFor(() => expect(readLatestDraft({ currentUser: hostIdentity })).toBeTruthy());
  const stored = JSON.stringify(readLatestDraft({ currentUser: hostIdentity }));
  expect(stored).not.toContain("Draft Secret Name");
  expect(stored).not.toContain("draft-secret@example.test");

  await user.clear(name);
  await user.clear(email);
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  expect(submittedPayload?.currentUser).toBeUndefined();
  expect(submittedPayload?.reporterIdentityConsent).toBeUndefined();
});

test("retries consented identity exactly and renders a bounded useful receipt", async () => {
  const user = userEvent.setup();
  const payloads: Array<Record<string, any>> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, options) => {
    payloads.push(JSON.parse(String(options?.body)));
    if (payloads.length === 1) {
      return new Response(JSON.stringify({ error: { message: "uncertain commit" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      feedback: {
        id: "feedback-consented",
        ticketNumber: 742,
        responseExpectation: "Expect an update within two business days.",
        trackingUrl: "https://app.traceitgenie.com/reporter",
      },
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  });
  renderWidget({
    currentUser: undefined,
    widgetConfig: {
      reporterIdentity: {
        enabled: true,
        responseExpectation: "Expect an update within two business days.",
      },
    },
  });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Consented report");
  await user.type(screen.getByLabelText("What happened?"), "The reporter wants a response about this issue.");
  await user.click(screen.getByText("Get updates"));
  await user.type(screen.getByLabelText(/Name/), "Mina Patel");
  await user.type(screen.getByLabelText(/Email/), "mina@example.test");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(async () => { expect(await screen.findByText("TraceGenie could not accept the report right now. Your report is still here. Retry in a moment.")).toBeVisible(); });
  await user.click(screen.getByRole("button", { name: "Retry" }));

  await waitFor(async () => { expect(await screen.findByText("Ticket #742")).toBeVisible(); });
  await waitFor(async () => { expect(screen.getByText("Expect an update within two business days.")).toBeVisible(); });
  expect(screen.getByRole("link", { name: "Track this report" })).toHaveAttribute("href", "https://app.traceitgenie.com/reporter");
  await waitFor(async () => { expect(screen.getByRole("button", { name: "Done" })).toBeVisible(); });
  expect(payloads).toHaveLength(2);
  expect(payloads[0]?.currentUser).toEqual({ name: "Mina Patel", email: "mina@example.test" });
  expect(payloads[0]?.reporterIdentityConsent?.granted).toBe(true);
  expect(payloads[1]?.currentUser).toEqual(payloads[0]?.currentUser);
  expect(payloads[1]?.reporterIdentityConsent).toEqual(payloads[0]?.reporterIdentityConsent);
  expect(payloads[1]?.clientSubmissionId).toBe(payloads[0]?.clientSubmissionId);
});

test("shows a truthful capacity-locked receipt without implying normal processing", async () => {
  const user = userEvent.setup();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    feedback: {
      id: "feedback-capacity-locked",
      ticketNumber: 51,
      isOverageLocked: true,
      processingState: "capacity_locked",
      responseExpectation: "Saved safely. Processing is paused until the organization adds issue capacity. No report data was lost.",
      trackingUrl: "https://app.traceitgenie.com/reporter",
    },
  }), { status: 201, headers: { "Content-Type": "application/json" } }));
  renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Capacity boundary report");
  await user.type(screen.getByLabelText("What happened?"), "This report crosses the included monthly issue capacity boundary.");
  await user.click(screen.getByRole("button", { name: "Send report" }));

  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report saved" })).toBeVisible(); });
  expect(screen.getByRole("status")).toHaveTextContent("Processing paused");
  await waitFor(async () => { expect(screen.getByText("Saved safely. Processing is paused until the organization adds issue capacity. No report data was lost.")).toBeVisible(); });
  expect(screen.queryByRole("heading", { name: "Report sent" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Track this report" })).toHaveAttribute("href", "https://app.traceitgenie.com/reporter");
});

test("progressively discloses recipient, privacy, retention, and enabled collectors", async () => {
  const user = userEvent.setup();
  renderWidget({
    appName: "Acme Checkout",
    widgetConfig: {
      allowScreenshot: true,
      allowPointSelection: true,
      allowConsoleCapture: true,
      allowClientErrorContext: true,
      allowNetworkSummary: true,
      notificationBranding: {
        brandName: "Acme Support",
        primaryColor: "#2563eb",
        accentColor: "#344760",
      },
      privacy: {
        privacyUrl: "https://acme.example/privacy",
        retentionDays: 180,
        attachmentRetentionDays: 30,
        redactionMode: "standard",
        mcpEvidenceSharing: "raw_allowed",
        suppressSelectedText: false,
        customRedactionTerms: [],
      },
    },
  });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));

  const disclosure = screen.getByLabelText("What's included with your report");
  expect(disclosure).not.toHaveAttribute("open");
  await waitFor(async () => { expect(within(disclosure).getByText("What's included?")).toBeVisible(); });
  await waitFor(async () => { expect(screen.getByLabelText("Report evidence")).toBeVisible(); });
  await waitFor(async () => { expect(screen.getByRole("button", { name: "Add screenshot" })).toBeVisible(); });
  await waitFor(async () => { expect(screen.getByRole("button", { name: "Attach image" })).toBeVisible(); });
  expect(within(disclosure).getByText("Sent to Acme Support for Acme Checkout.")).not.toBeVisible();
  expect(widgetCss).toMatch(/\.tgw-included-summary svg\s*\{[\s\S]*?transform: rotate\(0deg\);/);
  expect(widgetCss).toMatch(/\.tgw-included\[open\] \.tgw-included-summary svg\s*\{\s*transform: rotate\(90deg\);/);

  await user.click(within(disclosure).getByText("What's included?"));

  await waitFor(async () => { expect(within(disclosure).getByText("Sent to Acme Support for Acme Checkout.")).toBeVisible(); });
  await waitFor(async () => { expect(within(disclosure).getByText("Reports retained for 180 days; attachments for 30 days.")).toBeVisible(); });
  expect(within(disclosure).getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "https://acme.example/privacy");
  expect(within(disclosure).getByLabelText("Enabled collectors")).toHaveTextContent("Page URL, title, and browserIncluded");
  expect(within(disclosure).getByLabelText("Enabled collectors")).toHaveTextContent("App release and environmentIncluded");
  expect(within(disclosure).getByLabelText("Enabled collectors")).toHaveTextContent("Reporter identityIncluded");
  await waitFor(async () => { expect(within(disclosure).getByText("Add a screenshot or image if it helps explain the issue.")).toBeVisible(); });
  expect(within(disclosure).queryByText("Selected text")).not.toBeInTheDocument();
  await waitFor(async () => { expect(within(disclosure).getByText("Console log")).toBeVisible(); });
  await waitFor(async () => { expect(within(disclosure).getByText("Client error context")).toBeVisible(); });
  await waitFor(async () => { expect(within(disclosure).getByText("Network summary")).toBeVisible(); });
  expect(within(disclosure).getAllByText(/None detected|No entries captured|No requests captured/)).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Send report" })).toBeEnabled();
});

test("uses the fetched project name and keeps attached evidence removable in the compact disclosure", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    key: baseProps.projectKey,
    name: "Checkout Portal",
    organizationName: "Acme Incorporated",
    defaultEnvironment: "production",
    widgetConfig: {
      notificationBranding: { brandName: "Acme Product Operations" },
      privacy: {
        privacyUrl: "https://acme.example/privacy",
        retentionDays: null,
        attachmentRetentionDays: null,
      },
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
  const user = userEvent.setup();
  renderWidget({ fetchProjectConfig: true });

  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
    `${baseProps.apiBaseUrl}/api/projects/public/${baseProps.projectKey}/widget-config`,
    expect.anything(),
  ));
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await openIncludedDisclosure(user);
  await waitFor(async () => { expect(screen.getByText("Sent to Acme Incorporated for Checkout Portal.")).toBeVisible(); });
  expect(screen.queryByText("Sent to Acme Product Operations for Checkout Portal.")).not.toBeInTheDocument();
  await waitFor(async () => { expect(screen.getByText("Report retention follows the recipient's policy; attachment retention follows the recipient's policy.")).toBeVisible(); });

  await user.upload(screen.getByLabelText("Attach image"), new File(["proof"], "checkout-proof.png", { type: "image/png" }));
  await waitFor(async () => { expect(await screen.findByText("Image evidence")).toBeVisible(); });
  await waitFor(async () => { expect(screen.getByText(/checkout-proof\.png/)).toBeVisible(); });
  await waitFor(async () => { expect(screen.getByRole("button", { name: "Remove attached image" })).toBeVisible(); });
  await user.click(screen.getByRole("button", { name: "Crop or redact image" }));
  await waitFor(async () => { expect(screen.getByRole("region", { name: "Screenshot privacy editor" })).toBeVisible(); });
  await waitFor(async () => { expect(screen.getByRole("button", { name: "Add redaction" })).toBeVisible(); });
  await user.click(within(screen.getByRole("region", { name: "Screenshot privacy editor" })).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("region", { name: "Screenshot privacy editor" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Remove attached image" }));
  await waitFor(async () => { expect(screen.getByText("Screenshot removed.")).toBeVisible(); });
});

test("renders an active product survey as a compact independent response with a durable retry key", async () => {
  const surveyRequests: Array<{ url: string; body?: Record<string, unknown> }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    surveyRequests.push({ url, body });
    if (url.endsWith("/widget-config")) {
      return new Response(JSON.stringify({
        key: baseProps.projectKey,
        name: "Checkout Portal",
        organizationName: "Acme Incorporated",
        defaultEnvironment: "production",
        widgetConfig: {},
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/surveys/active")) {
      return new Response(JSON.stringify({
        campaign: {
          id: "campaign-1",
          name: "Checkout NPS",
          status: "active",
          type: "nps",
          question: "Would you recommend checkout?",
          answerKind: "score",
          scaleMin: 0,
          scaleMax: 10,
          options: [],
          audience: { segments: [], roles: [], featureKeys: [], funnelSteps: [] },
          contextRequirements: { required: [] },
          consentRequired: true,
          consentLabel: "I agree to share this with the product team.",
          privacyUrl: "https://example.test/privacy",
          retentionDays: 30,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/surveys/campaign-1/responses")) {
      return new Response(JSON.stringify({
        response: {
          expiresAt: "2026-08-14T00:00:00.000Z",
          provenance: { missing: ["release.version"] },
        },
        idempotent: false,
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  const user = userEvent.setup();
  renderWidget({ fetchProjectConfig: true, productContext: { customer: { segment: "enterprise" } } });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await screen.findByText("Would you recommend checkout?");
  await user.click(screen.getByRole("radio", { name: "8" }));
  await user.click(screen.getByLabelText("I agree to share this with the product team."));
  await user.click(screen.getByRole("button", { name: "Send feedback" }));

  await waitFor(async () => { expect(await screen.findByText("Feedback recorded. It does not create a report.")).toBeVisible(); });
  const responseRequest = surveyRequests.find((request) => request.url.endsWith("/surveys/campaign-1/responses"));
  expect(responseRequest?.body).toMatchObject({
    score: 8,
    consentGranted: true,
    productContext: { customer: { segment: "enterprise" } },
  });
  expect(responseRequest?.body?.clientSubmissionId).toEqual(expect.any(String));
  expect(screen.queryByRole("button", { name: "Send report" })).toBeEnabled();
  await waitFor(async () => { expect(screen.getByText("Context not supplied: release.version.")).toBeVisible(); });
});

test("opens the native image picker from a focusable Attach image button with Enter and Space", async () => {
  const user = userEvent.setup();
  const inputClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
  renderWidget({ widgetConfig: { allowScreenshot: true } });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await openIncludedDisclosure(user);
  const attachButton = screen.getByRole("button", { name: "Attach image" });
  attachButton.focus();

  await user.keyboard("{Enter}");
  await user.keyboard(" ");
  await user.click(attachButton);

  expect(attachButton).toHaveFocus();
  expect(inputClick).toHaveBeenCalledTimes(3);

  inputClick.mockRestore();
  await user.upload(
    screen.getByLabelText("Attach image"),
    new File(["keyboard-proof"], "keyboard-proof.png", { type: "image/png" }),
  );
  await waitFor(async () => { expect(await screen.findByText("Image evidence")).toBeVisible(); });
  await waitFor(() => expect(screen.getByRole("button", { name: "Crop or redact image" })).toHaveFocus());
});

const dismissalMethods = ["Cancel", "Close", "scrim", "Escape", "shortcut"] as const;

async function dismissWidget(method: (typeof dismissalMethods)[number], user: ReturnType<typeof userEvent.setup>) {
  if (method === "Cancel" || method === "Close") {
    await user.click(screen.getByRole("button", { name: method }));
    return;
  }
  if (method === "scrim") {
    fireEvent.click(document.querySelector<HTMLElement>(".tgw-scrim")!);
    return;
  }
  if (method === "shortcut") {
    fireEvent.keyDown(window, { key: "b", metaKey: true, shiftKey: true });
    return;
  }
  await user.keyboard("{Escape}");
}

test.each(dismissalMethods)("pristine %s dismissal closes immediately", async (method) => {
  const user = userEvent.setup();
  renderWidget();
  const launcher = screen.getByRole("button", { name: "Report a Bug" });

  await user.click(launcher);
  await dismissWidget(method, user);

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(launcher).toHaveFocus();
});

test.each(["title", "survey"] as const)("whitespace-only %s input remains semantically pristine", async (source) => {
  const surveyQuestion = "Why did you leave checkout?";
  const user = userEvent.setup();
  renderWidget(source === "survey" ? {
    widgetConfig: {
      surveyPrompt: { enabled: true, type: "abandonment", question: surveyQuestion },
    },
  } : {});
  const launcher = screen.getByRole("button", { name: "Report a Bug" });
  await user.click(launcher);
  await user.type(screen.getByLabelText(source === "title" ? "Title" : surveyQuestion), "   ");
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(launcher).toHaveFocus();
});

test.each(dismissalMethods)("dirty %s dismissal offers Keep editing and restores its trigger", async (method) => {
  const user = userEvent.setup();
  renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  const title = screen.getByLabelText("Title");
  await user.type(title, "Checkout cannot submit");
  const trigger = method === "Cancel" || method === "Close"
    ? screen.getByRole("button", { name: method })
    : title;

  await dismissWidget(method, user);

  await waitFor(async () => { expect(screen.getByRole("alertdialog", { name: "Discard report?" })).toBeVisible(); });
  expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
  expect(title).toHaveValue("Checkout cannot submit");
  await user.click(screen.getByRole("button", { name: "Keep editing" }));

  await waitFor(async () => { expect(screen.getByRole("dialog")).toBeVisible(); });
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("Escape from discard confirmation keeps editing and restores focus", async () => {
  const user = userEvent.setup();
  renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Focus must return");
  const close = screen.getByRole("button", { name: "Close" });
  await user.click(close);
  await waitFor(async () => { expect(screen.getByRole("alertdialog", { name: "Discard report?" })).toBeVisible(); });

  await user.keyboard("{Escape}");

  await waitFor(async () => { expect(screen.getByRole("dialog")).toBeVisible(); });
  expect(close).toHaveFocus();
});

test("discard confirmation traps Tab and Shift+Tab inside its two actions", async () => {
  const user = userEvent.setup();
  renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Keep alert focus contained");
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  const keepEditing = screen.getByRole("button", { name: "Keep editing" });
  const discard = screen.getByRole("button", { name: "Discard draft" });
  expect(keepEditing).toHaveFocus();
  await user.keyboard("{Shift>}{Tab}{/Shift}");
  expect(discard).toHaveFocus();
  await user.keyboard("{Tab}");
  expect(keepEditing).toHaveFocus();
});

test.each(["severity", "survey", "attachment"] as const)("treats %s-only reports as dirty", async (source) => {
  const user = userEvent.setup();
  renderWidget(source === "survey" ? {
    widgetConfig: {
      surveyPrompt: { enabled: true, type: "csat", question: "How was checkout?" },
    },
  } : {});
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));

  if (source === "severity") {
    await user.click(screen.getByRole("button", { name: "Low" }));
  } else if (source === "survey") {
    await user.click(screen.getByRole("radio", { name: "4" }));
  } else {
    await user.upload(screen.getByLabelText("Attach image"), new File(["image"], "evidence.png", { type: "image/png" }));
  }

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(async () => { expect(screen.getByRole("alertdialog", { name: "Discard report?" })).toBeVisible(); });
});

test.each(["form", "survey", "attachment"] as const)("treats destructive removal of restored %s data as dirty", async (source) => {
  const surveyQuestion = "Why did you leave checkout?";
  seedDraft({
    form: pristineDraftForm(source === "form" ? { title: "Restored title" } : {}),
    advancedOpen: false,
    ...(source === "survey"
      ? { surveyResponse: { type: "abandonment", question: surveyQuestion, answer: "The total changed" } }
      : {}),
    ...(source === "attachment"
      ? { attachment: { name: "restored.png", type: "image/png", size: 1200, source: "upload" } }
      : {}),
  });
  const user = userEvent.setup();
  renderWidget(source === "survey" ? {
    widgetConfig: {
      surveyPrompt: { enabled: true, type: "abandonment", question: surveyQuestion },
    },
  } : {});
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));

  if (source === "form") {
    await user.clear(screen.getByLabelText("Title"));
  } else if (source === "survey") {
    await user.clear(screen.getByLabelText(surveyQuestion));
  } else {
    await user.click(screen.getByRole("button", { name: "Remove previous attachment" }));
  }

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(async () => { expect(screen.getByRole("alertdialog", { name: "Discard report?" })).toBeVisible(); });
});

test("Discard draft clears current text and attachment revisions before closing", async () => {
  const user = userEvent.setup();
  const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL");
  renderWidget();
  const launcher = screen.getByRole("button", { name: "Report a Bug" });
  await user.click(launcher);
  await user.type(screen.getByLabelText("Title"), "Discard this report");
  await user.upload(screen.getByLabelText("Attach image"), new File(["image"], "discard.png", { type: "image/png" }));
  await waitFor(() => expect(readLatestDraft()).toMatchObject({
    form: { title: "Discard this report" },
    attachment: { name: "discard.png" },
  }));

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Discard draft" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(launcher).toHaveFocus();
  expect(draftRecordKeys()).toHaveLength(0);
  await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalled());

  await user.click(launcher);
  expect(screen.getByLabelText("Title")).toHaveValue("");
  expect(screen.queryByText(/Previous (image|screenshot):/)).not.toBeInTheDocument();
});

test("Discard draft preserves unrelated writer records", async () => {
  const user = userEvent.setup();
  renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Current writer report");
  await waitFor(() => expect(readLatestDraft()).toMatchObject({ form: { title: "Current writer report" } }));
  const unrelated = seedDraft({
    savedAt: Date.now() - 60_000,
    form: { ...storedDraft().form, title: "Unrelated writer report" },
  }, {}, "writer-unrelated");

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Discard draft" }));

  expect(draftRecordKeys()).toEqual([draftRecordKey("writer-unrelated")]);
  expect(readDraftRecord("writer-unrelated")).toEqual(unrelated);
});

test("Discard draft preserves a newer revision from the same restored writer", async () => {
  const restored = seedDraft({
    form: pristineDraftForm({ title: "Restored writer report" }),
    advancedOpen: false,
  });
  const user = userEvent.setup();
  renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), " edited here");
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  const newerRevision = {
    ...restored,
    savedAt: restored.savedAt + 1,
    revision: restored.revision + 1,
    form: pristineDraftForm({ title: "Newer same-writer report" }),
  };
  window.localStorage.setItem(draftRecordKey("writer-test"), JSON.stringify(newerRevision));
  await user.click(screen.getByRole("button", { name: "Discard draft" }));

  expect(readDraftRecord("writer-test")).toEqual(newerRevision);
  expect(readLatestDraft()).toMatchObject({
    writerId: "writer-test",
    revision: newerRevision.revision,
    form: { title: "Newer same-writer report" },
  });
});

test("restores a bounded draft on reopen and remount with matching survey state", async () => {
  const user = userEvent.setup();
  const widgetConfig = {
    surveyPrompt: {
      enabled: true,
      type: "nps" as const,
      question: "Would you recommend this checkout?",
    },
  };

  const mountedWidget = renderWidget({ widgetConfig });

  const launcher = screen.getByRole("button", { name: "Report a Bug" });
  launcher.focus();
  fireEvent.keyDown(window, { key: "b", metaKey: true, shiftKey: true });
  expect(screen.getByRole("dialog")).toBeTruthy();
  const brandMark = document.querySelector<HTMLImageElement>(".tgw-brand-mark img");
  expect(brandMark).toBeInTheDocument();
  expect(brandMark?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
  expect(brandMark).toHaveAttribute("width", "18");
  expect(brandMark).toHaveAttribute("height", "18");

  const title = screen.getByLabelText("Title");
  const description = screen.getByLabelText("What happened?");
  await user.type(title, "Checkout total is wrong");
  await user.type(description, "Removing a coupon leaves the wrong total.");
  await user.click(screen.getByRole("button", { name: "Add detail" }));
  await user.type(screen.getByLabelText("Steps to reproduce"), "Apply a coupon, then remove it.");
  await user.click(screen.getByRole("radio", { name: "8" }));
  expect(title).toHaveValue("Checkout total is wrong");
  expect(description).toHaveValue("Removing a coupon leaves the wrong total.");
  await waitFor(() => expect(readLatestDraft()).toMatchObject({
    form: {
      title: "Checkout total is wrong",
      description: "Removing a coupon leaves the wrong total.",
      stepsToReproduce: "Apply a coupon, then remove it.",
    },
    advancedOpen: true,
    surveyResponse: { score: 8 },
  }));

  const surveyChoice = screen.getByRole("radio", { name: "8" });
  await user.keyboard("{Escape}");
  await waitFor(async () => { expect(screen.getByRole("alertdialog", { name: "Discard report?" })).toBeVisible(); });
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  await waitFor(async () => { expect(screen.getByRole("dialog")).toBeVisible(); });
  expect(surveyChoice).toHaveFocus();

  const persisted = readLatestDraft();
  expect(persisted).toMatchObject({
    version: 1,
    form: {
      title: "Checkout total is wrong",
      description: "Removing a coupon leaves the wrong total.",
      stepsToReproduce: "Apply a coupon, then remove it.",
    },
    advancedOpen: true,
    surveyResponse: {
      type: "nps",
      question: "Would you recommend this checkout?",
      score: 8,
    },
  });

  mountedWidget.unmount();
  renderWidget({ widgetConfig });
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));

  expect(screen.getByLabelText("Title")).toHaveValue("Checkout total is wrong");
  expect(screen.getByLabelText("What happened?")).toHaveValue("Removing a coupon leaves the wrong total.");
  expect(screen.getByLabelText("Steps to reproduce")).toHaveValue("Apply a coupon, then remove it.");
  expect(screen.getByRole("radio", { name: "8" })).toHaveAttribute("aria-checked", "true");
});

test("isolates drafts by canonical API tenant, project, and current user id", async () => {
  const user = userEvent.setup();
  seedDraft();

  const canonicalWidget = renderWidget({ apiBaseUrl: `${baseProps.apiBaseUrl}/` });
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("Stored checkout issue");
  canonicalWidget.unmount();

  const tenantWidget = renderWidget({ apiBaseUrl: "https://api.other.example/v1" });
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("");
  tenantWidget.unmount();

  const projectWidget = renderWidget({ projectKey: "another-project" });
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("");
  projectWidget.unmount();

  renderWidget({ currentUser: { id: "user-secondary" } });
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("");
});

test("preserves an authenticated draft across profile changes and browser sessions", async () => {
  const user = userEvent.setup();
  const currentUser = { id: "stable-user", name: "Original Name", role: "member" };
  const view = renderWidget({ currentUser });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Durable authenticated draft");
  await user.type(screen.getByLabelText("What happened?"), "This survives non-identity profile changes.");
  await waitFor(() => expect(readLatestDraft({ currentUser })).toMatchObject({
    form: { title: "Durable authenticated draft" },
  }));

  const renamedUser = { id: "stable-user", name: "Renamed User", role: "admin" };
  view.rerender(
    <FeedbackWidget
      {...baseProps}
      currentUser={renamedUser}
    />,
  );
  await waitFor(async () => { expect(screen.getByRole("dialog")).toBeVisible(); });
  expect(screen.getByLabelText("Title")).toHaveValue("Durable authenticated draft");

  await waitFor(() => expect(readLatestDraft({ currentUser: renamedUser })).toMatchObject({
    form: { title: "Durable authenticated draft" },
  }));
  view.unmount();
  window.sessionStorage.clear();
  renderWidget({ currentUser: renamedUser });
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("Durable authenticated draft");

  cleanup();
  const expiredKeys = draftRecordKeys({ currentUser: renamedUser });
  for (const key of expiredKeys) {
    const draft = JSON.parse(window.localStorage.getItem(key) ?? "null");
    window.localStorage.setItem(key, JSON.stringify({ ...draft, savedAt: Date.now() - (24 * 60 * 60 * 1000) }));
  }
  window.sessionStorage.clear();
  renderWidget({ currentUser: renamedUser });
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("");
  for (const key of expiredKeys) expect(window.localStorage.getItem(key)).toBeNull();
  expect(draftRecordKeys({ currentUser: renamedUser })).toHaveLength(1);
  expect(readLatestDraft({ currentUser: renamedUser })).toMatchObject({ form: { title: "" } });
});

test("migrates an email-scoped draft when the same identity gains a stable id", async () => {
  const user = userEvent.setup();
  const emailUser = { email: "person@example.com", name: "Person" };
  const view = renderWidget({ currentUser: emailUser });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Email identity draft");
  await waitFor(() => expect(readLatestDraft({ currentUser: emailUser })).toMatchObject({
    form: { title: "Email identity draft" },
  }));

  const idUser = { id: "person-123", email: "person@example.com", name: "Person" };
  view.rerender(<FeedbackWidget {...baseProps} currentUser={idUser} />);

  await waitFor(async () => { expect(screen.getByRole("dialog")).toBeVisible(); });
  expect(screen.getByLabelText("Title")).toHaveValue("Email identity draft");
  expect(draftRecordKeys({ currentUser: emailUser })).toHaveLength(0);
  expect(readLatestDraft({ currentUser: idUser })).toMatchObject({ form: { title: "Email identity draft" } });
});

test("discovers an email-scoped draft after remounting with an enriched id", async () => {
  const user = userEvent.setup();
  const emailUser = { email: "remount@example.com" };
  seedDraft({}, { currentUser: emailUser });
  const idUser = { id: "remount-123", email: "remount@example.com" };

  renderWidget({ currentUser: idUser });
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));

  expect(screen.getByLabelText("Title")).toHaveValue("Stored checkout issue");
  expect(draftRecordKeys({ currentUser: emailUser })).toHaveLength(0);
  expect(readLatestDraft({ currentUser: idUser })).toMatchObject({ form: { title: "Stored checkout issue" } });
});

test("pending email-to-id enrichment cleans the migrated submitted revision", async () => {
  const user = userEvent.setup();
  let resolveFetch: ((response: Response) => void) | undefined;
  const response = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(() => response);
  const emailUser = { email: "pending@example.com" };
  const idUser = { id: "pending-123", email: "pending@example.com" };
  seedDraft({}, { currentUser: emailUser });
  const view = renderWidget({ currentUser: emailUser });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("Stored checkout issue");
  await user.click(screen.getByRole("button", { name: "Send report" }));
  view.rerender(<FeedbackWidget {...baseProps} currentUser={idUser} />);
  await waitFor(() => expect(draftRecordKeys({ currentUser: emailUser })).toHaveLength(0));

  resolveFetch?.(new Response(JSON.stringify({ feedback: { id: "feedback-enriched" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  expect(draftRecordKeys({ currentUser: emailUser })).toHaveLength(0);
  expect(draftRecordKeys({ currentUser: idUser })).toHaveLength(0);
});

test("keeps anonymous drafts in session storage only", async () => {
  const user = userEvent.setup();
  renderWidget({ currentUser: undefined });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Anonymous session draft");
  await user.type(screen.getByLabelText("What happened?"), "This must not become durable local data.");
  await waitFor(() => expect(readLatestDraft({ currentUser: undefined })).toMatchObject({
    form: { title: "Anonymous session draft" },
  }));

  expect(readLatestDraft({ currentUser: undefined })).toMatchObject({
    form: { title: "Anonymous session draft" },
  });
  expect(Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)))
    .not.toContainEqual(expect.stringContaining(draftScopeKey({ currentUser: undefined })));

  cleanup();
  window.sessionStorage.clear();
  renderWidget({ currentUser: undefined });
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("");
});

test("does not persist drafts for name-only unstable identities", async () => {
  const user = userEvent.setup();
  renderWidget({ currentUser: { name: "Shared display name" } });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Must remain memory only");
  await user.keyboard("{Escape}");
  await waitFor(async () => { expect(screen.getByRole("alertdialog", { name: "Discard report?" })).toBeVisible(); });
  await user.click(screen.getByRole("button", { name: "Discard draft" }));

  expect(draftRecordKeys({ currentUser: { name: "Shared display name" } })).toHaveLength(0);
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
});

test("sweeps expired records outside the current authenticated identity scope", () => {
  const expiredUser = { id: "expired-user" };
  seedDraft({ savedAt: Date.now() - (24 * 60 * 60 * 1000) }, { currentUser: expiredUser });
  expect(draftRecordKeys({ currentUser: expiredUser })).toHaveLength(1);

  renderWidget({ currentUser: { id: "active-user" } });

  expect(draftRecordKeys({ currentUser: expiredUser })).toHaveLength(0);
});

test("closes and isolates live project, tenant, and identity scope changes", async () => {
  const user = userEvent.setup();
  const view = renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Project A draft");
  await user.type(screen.getByLabelText("What happened?"), "Only project A may restore this.");
  view.rerender(
    <FeedbackWidget
      {...baseProps}
      projectKey="project-b"
    />,
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(draftRecordKeys()).toHaveLength(1);
  expect(draftRecordKeys({ projectKey: "project-b" })).toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("");
  await user.type(screen.getByLabelText("Title"), "Tenant A draft");
  await user.type(screen.getByLabelText("What happened?"), "Only tenant A may restore this.");
  view.rerender(
    <FeedbackWidget
      {...baseProps}
      apiBaseUrl="https://api.second.example/v1"
      projectKey="project-b"
    />,
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(draftRecordKeys({ projectKey: "project-b" })).toHaveLength(1);
  expect(draftRecordKeys({ apiBaseUrl: "https://api.second.example/v1", projectKey: "project-b" })).toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("");
  await user.type(screen.getByLabelText("Title"), "Old identity draft");
  await user.type(screen.getByLabelText("What happened?"), "This must be deleted on sign-out.");
  await waitFor(() => {
    expect(draftRecordKeys({ apiBaseUrl: "https://api.second.example/v1", projectKey: "project-b" })).toHaveLength(1);
  });
  view.rerender(
    <FeedbackWidget
      {...baseProps}
      apiBaseUrl="https://api.second.example/v1"
      currentUser={{ id: "user-secondary" }}
      projectKey="project-b"
    />,
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(draftRecordKeys({ apiBaseUrl: "https://api.second.example/v1", projectKey: "project-b" })).toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("");
  expect(screen.getByLabelText("What happened?")).toHaveValue("");
});

test("lets explicit open title and type win over a matching stored draft", async () => {
  seedDraft();

  renderWidget({
    openRequest: {
      id: 1,
      title: "Explicit host title",
      issueType: "enhancement",
    },
  });

  await waitFor(async () => { expect(await screen.findByRole("dialog")).toBeVisible(); });
  expect(screen.getByLabelText("Title")).toHaveValue("Explicit host title");
  expect(screen.getByLabelText("Type")).toHaveValue("enhancement");
  expect(screen.getByLabelText("What happened?")).toHaveValue("The stored description remains available.");
});

test("cleans malformed, expired, and future-dated drafts instead of restoring them", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem(draftRecordKey(), "{not-json");

  const malformedWidget = renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("");
  expect(window.localStorage.getItem(draftRecordKey())).toBeNull();

  malformedWidget.unmount();
  seedDraft({ unexpectedToken: "must-be-rejected" });
  const strictWidget = renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("");
  expect(window.localStorage.getItem(draftRecordKey())).toBeNull();

  strictWidget.unmount();
  seedDraft({ savedAt: Date.now() - (24 * 60 * 60 * 1000) });
  renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("");
  expect(window.localStorage.getItem(draftRecordKey())).toBeNull();

  cleanup();
  seedDraft({ savedAt: Date.now() + (6 * 60 * 1000) });
  renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("");
  expect(window.localStorage.getItem(draftRecordKey())).toBeNull();
});

test("preserves future-version records without restoring them and cleans legacy v1 keys", async () => {
  const user = userEvent.setup();
  seedDraft({ version: 2 });
  window.localStorage.setItem(legacyDraftKey(), JSON.stringify(storedDraft()));

  renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));

  expect(screen.getByLabelText("Title")).toHaveValue("");
  expect(window.localStorage.getItem(draftRecordKey())).not.toBeNull();
  expect(window.localStorage.getItem(legacyDraftKey())).toBeNull();
});

test("raw-migrates future-version email records without deleting them", async () => {
  const user = userEvent.setup();
  const emailUser = { email: "future@example.com" };
  const idUser = { id: "future-123", email: "future@example.com" };
  const futureDraft = storedDraft({ version: 2, writerId: "future-writer" });
  window.localStorage.setItem(draftRecordKey("future-writer", { currentUser: emailUser }), JSON.stringify(futureDraft));

  renderWidget({ currentUser: idUser });
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));

  expect(window.localStorage.getItem(draftRecordKey("future-writer", { currentUser: emailUser }))).toBeNull();
  expect(window.localStorage.getItem(draftRecordKey("future-writer", { currentUser: idUser }))).toBe(JSON.stringify(futureDraft));
});

test("does not restore a survey response when the configured prompt changes", async () => {
  const user = userEvent.setup();
  seedDraft({
    surveyResponse: {
      type: "nps",
      question: "Old recommendation question",
      score: 9,
    },
  });

  renderWidget({
    widgetConfig: {
      surveyPrompt: {
        enabled: true,
        type: "nps",
        question: "New recommendation question",
      },
    },
  });
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));

  await waitFor(async () => { expect(screen.getByText("New recommendation question")).toBeVisible(); });
  expect(screen.getByRole("radio", { name: "9" })).toHaveAttribute("aria-checked", "false");
});

test("persists only safe allowlisted values and truthful attachment metadata", async () => {
  const user = userEvent.setup();
  const privateUser = {
    id: "identity-123",
    email: "private@example.com",
  };
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:secret-preview-url");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

  const mountedWidget = renderWidget({
    currentUser: privateUser,
    widgetSessionToken: "secret-widget-token",
    routeName: "private-route",
    extraContext: {
      contextSecret: "secret-host-context",
      selectedTextSuggestion: {
        text: "secret selected text",
      },
      consoleEntries: ["secret console value"],
      networkEntries: ["secret network value"],
      clientError: "secret client error",
    },
  });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Attachment is incorrect");
  await user.type(screen.getByLabelText("What happened?"), "The attached image shows the incorrect state.");
  const file = new File(["secret-file-bytes"], "checkout-state.png", { type: "image/png" });
  await user.upload(screen.getByLabelText("Attach image"), file);
  await waitFor(() => expect(readLatestDraft({ currentUser: privateUser })).toMatchObject({
    form: { title: "Attachment is incorrect" },
    attachment: { name: "checkout-state.png" },
  }));
  const parsedDraft = readLatestDraft({ currentUser: privateUser });
  const rawDraft = JSON.stringify(parsedDraft);
  expect(Object.keys(parsedDraft).sort()).toEqual(["advancedOpen", "attachment", "evidenceConsent", "form", "revision", "savedAt", "version", "writerId"]);
  expect(parsedDraft.evidenceConsent).toEqual({
    includeConsole: true,
    includeClientError: true,
    includeNetwork: true,
    includeSelectedText: true,
  });
  expect(Object.keys(parsedDraft.form).sort()).toEqual([
    "actualResult",
    "description",
    "expectedResult",
    "issueType",
    "severity",
    "stepsToReproduce",
    "title",
  ]);
  expect(parsedDraft.attachment).toEqual({
    name: "checkout-state.png",
    type: "image/png",
    size: file.size,
    source: "upload",
    checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(rawDraft).not.toContain("secret-file-bytes");
  expect(rawDraft).not.toContain("secret-preview-url");
  expect(rawDraft).not.toContain("secret-widget-token");
  expect(rawDraft).not.toContain("private@example.com");
  expect(rawDraft).not.toContain("secret-host-context");
  expect(rawDraft).not.toContain("secret selected text");
  expect(rawDraft).not.toContain("secret console value");
  expect(rawDraft).not.toContain("secret network value");
  expect(rawDraft).not.toContain("secret client error");
  expect(rawDraft).not.toContain("private-route");
  expect(rawDraft).not.toContain("uploadToken");

  mountedWidget.unmount();
  renderWidget({ currentUser: privateUser });
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await openIncludedDisclosure(user);
  await waitFor(async () => { expect(screen.getByText(/Previous image: checkout-state\.png .* Reattach to send\./)).toBeVisible(); });
  expect(screen.getByRole("button", { name: "Reattach image" })).toBeInTheDocument();
  expect(screen.queryByAltText("Screenshot preview")).not.toBeInTheDocument();

  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ feedback: { id: "feedback-attachment" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(async () => { expect(await screen.findByText("Reattach the previous image or remove it before sending this report.")).toBeVisible(); });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("rewrites and submits configuration-disabled fields with safe defaults", async () => {
  const user = userEvent.setup();
  seedDraft({
    savedAt: Date.now() - 1_000,
    form: {
      title: "Stored checkout issue",
      description: "The stored description remains available.",
      issueType: "enhancement",
      severity: "critical",
      stepsToReproduce: "Sensitive disabled steps",
      expectedResult: "Sensitive disabled expectation",
      actualResult: "Sensitive disabled result",
    },
    advancedOpen: true,
    attachment: {
      name: "disabled-evidence.png",
      type: "image/png",
      size: 42,
      source: "upload",
    },
  });
  seedDraft({
    savedAt: Date.now() - 500,
    form: {
      title: "Second stored issue",
      description: "A second writer must be sanitized independently.",
      issueType: "ux",
      severity: "high",
      stepsToReproduce: "Second sensitive steps",
      expectedResult: "Second sensitive expectation",
      actualResult: "Second sensitive result",
    },
    advancedOpen: true,
    attachment: {
      name: "second-disabled-evidence.png",
      type: "image/png",
      size: 84,
      source: "upload",
    },
  }, {}, "writer-second");
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ feedback: { id: "feedback-disabled-fields" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  renderWidget({
    widgetConfig: {
      allowScreenshot: false,
      fields: {
        issueType: { enabled: false, required: false },
        severity: { enabled: false, required: false },
        stepsToReproduce: { enabled: false, required: false },
        expectedResult: { enabled: false, required: false },
        actualResult: { enabled: false, required: false },
      },
    },
  });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.queryByRole("button", { name: "Add detail" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Type")).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "How much does this block you?" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Attach image" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Steps to reproduce")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Expected result")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Actual result")).not.toBeInTheDocument();
  await waitFor(() => expect(readLatestDraft()).toMatchObject({
    form: {
      title: "Second stored issue",
      description: "A second writer must be sanitized independently.",
      issueType: "bug",
      severity: "medium",
    },
    advancedOpen: false,
  }));
  const rewrittenDraft = readLatestDraft();
  expect(rewrittenDraft.form).not.toHaveProperty("stepsToReproduce");
  expect(rewrittenDraft.form).not.toHaveProperty("expectedResult");
  expect(rewrittenDraft.form).not.toHaveProperty("actualResult");
  expect(rewrittenDraft).not.toHaveProperty("attachment");
  for (const key of draftRecordKeys()) {
    const record = JSON.parse(window.localStorage.getItem(key) ?? "null");
    expect(record.form.issueType).toBe("bug");
    expect(record.form.severity).toBe("medium");
    expect(record.form).not.toHaveProperty("stepsToReproduce");
    expect(record.form).not.toHaveProperty("expectedResult");
    expect(record.form).not.toHaveProperty("actualResult");
    expect(record).not.toHaveProperty("attachment");
  }
  await user.click(screen.getByRole("button", { name: "Send report" }));

  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  const submittedPayload = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
  expect(submittedPayload.issueType).toBe("bug");
  expect(submittedPayload.severity).toBe("medium");
  expect(submittedPayload).not.toHaveProperty("stepsToReproduce");
  expect(submittedPayload).not.toHaveProperty("expectedResult");
  expect(submittedPayload).not.toHaveProperty("actualResult");
  expect(submittedPayload.attachmentTokens).toEqual([]);
});

test("tolerates blocked storage reads and writes", async () => {
  const user = userEvent.setup();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });

  renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Storage is blocked");
  await user.keyboard("{Escape}");
  await waitFor(async () => { expect(screen.getByRole("alertdialog", { name: "Discard report?" })).toBeVisible(); });
  await user.click(screen.getByRole("button", { name: "Discard draft" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("blocked sanitization writes never prevent opening a report", async () => {
  const user = userEvent.setup();
  seedDraft();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });

  renderWidget({
    widgetConfig: {
      fields: {
        stepsToReproduce: { enabled: false, required: false },
        expectedResult: { enabled: false, required: false },
        actualResult: { enabled: false, required: false },
      },
    },
  });
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));

  await waitFor(async () => { expect(screen.getByRole("dialog")).toBeVisible(); });
  expect(screen.getByLabelText("Title")).toHaveValue("Stored checkout issue");
});

test("clears the draft after accepted submission and survives a throwing host callback", async () => {
  const user = userEvent.setup();
  const onError = vi.fn();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ feedback: { id: "feedback-1" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));

  renderWidget({
    onSubmitted: () => {
      throw new Error("host callback failed");
    },
    onError,
  });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Checkout fails");
  await user.type(screen.getByLabelText("What happened?"), "The submit button never completes.");
  await waitFor(() => expect(readLatestDraft()).toMatchObject({
    form: {
      title: "Checkout fails",
      description: "The submit button never completes.",
    },
  }));
  const [submittedRecordKey] = draftRecordKeys();
  await user.click(screen.getByRole("button", { name: "Send report" }));

  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  expect(window.localStorage.getItem(submittedRecordKey)).toBeNull();
  expect(draftRecordKeys()).toHaveLength(0);
  await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "host callback failed" })));
  expect(screen.queryByText("host callback failed")).not.toBeInTheDocument();
  fireEvent.click(document.querySelector<HTMLElement>(".tgw-scrim")!);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

test("successful submission removes both the submitted copy and unchanged restored source", async () => {
  const user = userEvent.setup();
  seedDraft();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ feedback: { id: "feedback-restored" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("Stored checkout issue");
  await user.click(screen.getByRole("button", { name: "Send report" }));

  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  expect(draftRecordKeys()).toHaveLength(0);
});

test("edits made during a delayed submission persist and survive success cleanup", async () => {
  const user = userEvent.setup();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pending-draft");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  let resolveFetch: ((response: Response) => void) | undefined;
  const response = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(() => response);
  renderWidget({
    widgetConfig: {
      surveyPrompt: {
        enabled: true,
        type: "nps",
        question: "Would you recommend this flow?",
      },
    },
  });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Submitted title");
  await user.type(screen.getByLabelText("What happened?"), "Submitted description");
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await user.clear(screen.getByLabelText("Title"));
  await user.type(screen.getByLabelText("Title"), "Draft edited while pending");
  await user.click(screen.getByRole("button", { name: "Add detail" }));
  await user.type(screen.getByLabelText("Steps to reproduce"), "Added while request is pending");
  await user.click(screen.getByRole("radio", { name: "9" }));
  const pendingFile = new File(["pending-image"], "pending.png", { type: "image/png" });
  await user.upload(screen.getByLabelText("Attach image"), pendingFile);
  await waitFor(() => expect(readLatestDraft()).toMatchObject({
    form: {
      title: "Draft edited while pending",
      stepsToReproduce: "Added while request is pending",
    },
    advancedOpen: true,
    surveyResponse: { score: 9 },
    attachment: { name: "pending.png", source: "upload" },
  }));

  resolveFetch?.(new Response(JSON.stringify({ feedback: { id: "feedback-delayed" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  expect(readLatestDraft()).toMatchObject({
    form: { title: "Draft edited while pending" },
    advancedOpen: true,
    surveyResponse: { score: 9 },
    attachment: { name: "pending.png" },
  });
});

test("successful submission preserves a newer concurrent writer revision", async () => {
  const user = userEvent.setup();
  let resolveFetch: ((response: Response) => void) | undefined;
  const response = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => response);

  renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Submitted draft");
  await user.type(screen.getByLabelText("What happened?"), "The request remains pending while another tab edits.");
  await waitFor(() => expect(readLatestDraft()).toMatchObject({
    form: {
      title: "Submitted draft",
      description: "The request remains pending while another tab edits.",
    },
  }));
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

  const [submittedRecordKey] = draftRecordKeys();
  const submittedDraft = JSON.parse(window.localStorage.getItem(submittedRecordKey) ?? "null");
  const concurrentDraft = storedDraft({
    writerId: "writer-other-tab",
    revision: submittedDraft.revision + 1,
    savedAt: submittedDraft.savedAt + 1,
    form: {
      ...submittedDraft.form,
      title: "Newer concurrent draft",
    },
  });
  window.localStorage.setItem(draftRecordKey("writer-other-tab"), JSON.stringify(concurrentDraft));
  resolveFetch?.(new Response(JSON.stringify({ feedback: { id: "feedback-concurrent" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));

  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  expect(window.localStorage.getItem(submittedRecordKey)).toBeNull();
  expect(readDraftRecord("writer-other-tab")).toMatchObject({
    writerId: "writer-other-tab",
    revision: concurrentDraft.revision,
    form: {
      title: "Newer concurrent draft",
    },
  });
});

test("keeps independent per-writer records from overwriting each other", async () => {
  const user = userEvent.setup();
  const firstView = renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "First writer draft");
  await user.type(screen.getByLabelText("What happened?"), "The first mounted writer owns this record.");
  await waitFor(() => expect(readLatestDraft()).toMatchObject({ form: { title: "First writer draft" } }));
  const [firstWriterKey] = draftRecordKeys();
  const firstWriterDraft = window.localStorage.getItem(firstWriterKey);
  firstView.unmount();

  renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.clear(screen.getByLabelText("Title"));
  await user.type(screen.getByLabelText("Title"), "Second writer draft");
  await waitFor(() => {
    expect(draftRecordKeys()).toHaveLength(2);
    expect(readLatestDraft()).toMatchObject({ form: { title: "Second writer draft" } });
  });

  expect(window.localStorage.getItem(firstWriterKey)).toBe(firstWriterDraft);
  expect(draftRecordKeys().filter((key) => key !== firstWriterKey)).toHaveLength(1);
  expect(readLatestDraft()).toMatchObject({ form: { title: "Second writer draft" } });
});

test("preserves an offline report and exposes Retry without sending a request", async () => {
  const user = userEvent.setup();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Checkout is unavailable");
  await user.type(screen.getByLabelText("What happened?"), "The payment step stopped responding.");

  await waitFor(async () => { expect(screen.getByText("You are offline. Your report stays here until you reconnect and retry.")).toBeVisible(); });
  await user.click(screen.getByRole("button", { name: "Retry" }));

  await waitFor(async () => { expect(await screen.findByText("You are offline. Your report is saved on this device. Reconnect and retry.")).toBeVisible(); });
  expect(screen.getByLabelText("Title")).toHaveValue("Checkout is unavailable");
  expect(screen.getByLabelText("What happened?")).toHaveValue("The payment step stopped responding.");
  expect(readLatestDraft()).toMatchObject({ form: { title: "Checkout is unavailable" } });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("names a connection failure and retries the preserved report once", async () => {
  const user = userEvent.setup();
  let online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const fetchSpy = vi.spyOn(globalThis, "fetch")
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(new Response(JSON.stringify({ feedback: { id: "feedback-retried" } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }));
  renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Checkout retry report");
  await user.type(screen.getByLabelText("What happened?"), "The first request lost its connection.");
  const submissionAlert = screen.getByRole("alert");
  expect(submissionAlert).toBeEmptyDOMElement();
  await user.click(screen.getByRole("button", { name: "Send report" }));

  await waitFor(async () => { expect(await screen.findByText("TraceGenie could not be reached. Your report is still here. Check your connection and retry.")).toBeVisible(); });
  expect(submissionAlert).toHaveTextContent("TraceGenie could not be reached.");
  expect(screen.getByLabelText("Title")).toHaveValue("Checkout retry report");

  online = false;
  fireEvent(window, new Event("offline"));
  await waitFor(async () => { expect(await screen.findByText("You are offline. Your report is saved on this device. Reconnect and retry.")).toBeVisible(); });
  online = true;
  fireEvent(window, new Event("online"));
  await waitFor(async () => { expect(await screen.findByText("Connection restored. Your report is ready to retry.")).toBeVisible(); });
  online = false;
  fireEvent(window, new Event("offline"));
  await waitFor(async () => { expect(await screen.findByText("You are offline. Your report is saved on this device. Reconnect and retry.")).toBeVisible(); });
  online = true;
  fireEvent(window, new Event("online"));
  await user.click(screen.getByRole("button", { name: "Retry" }));

  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  const submittedPayloads = fetchSpy.mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
  expect(submittedPayloads[0].clientSubmissionId).toMatch(/^tg-widget:/);
  expect(submittedPayloads[1].clientSubmissionId).toBe(submittedPayloads[0].clientSubmissionId);
});

test("reuses a completed screenshot upload when retrying the same logical report", async () => {
  const user = userEvent.setup();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retry-evidence");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.stubGlobal("Image", class MockImage {
    width = 1;
    height = 1;
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.(new Event("load")));
    }
  });

  const feedbackPayloads: Array<Record<string, unknown>> = [];
  let uploadRequests = 0;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    const url = String(input);
    if (url.endsWith("/api/public/uploads")) {
      uploadRequests += 1;
      return new Response(JSON.stringify({
        uploadToken: "upload-token-retry",
        attachment: {
          id: "attachment-retry",
          fileName: "retry-evidence.png",
          mimeType: "image/png",
          byteSize: 8,
        },
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    feedbackPayloads.push(JSON.parse(String(options?.body)));
    if (feedbackPayloads.length === 1) {
      return new Response(JSON.stringify({ error: { message: "temporary failure" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ feedback: { id: "feedback-with-evidence" } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  });
  renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Screenshot retry report");
  await user.type(screen.getByLabelText("What happened?"), "The evidence must not upload twice.");
  await user.upload(
    screen.getByLabelText("Attach image"),
    new File(["evidence"], "retry-evidence.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Send report" }));

  await waitFor(async () => { expect(await screen.findByText("TraceGenie could not accept the report right now. Your report is still here. Retry in a moment.")).toBeVisible(); });
  await user.click(screen.getByRole("button", { name: "Retry" }));

  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  expect(uploadRequests).toBe(1);
  expect(feedbackPayloads).toHaveLength(2);
  expect(feedbackPayloads[0]?.clientSubmissionId).toBe(feedbackPayloads[1]?.clientSubmissionId);
  expect(feedbackPayloads[0]?.attachmentTokens).toEqual(["upload-token-retry"]);
  expect(feedbackPayloads[1]?.attachmentTokens).toEqual(["upload-token-retry"]);
  expect(fetchSpy).toHaveBeenCalledTimes(3);
});

test("rotates the submission identity for identical consecutive reports", async () => {
  const user = userEvent.setup();
  const payloads: Array<Record<string, unknown>> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, options) => {
    payloads.push(JSON.parse(String(options?.body)));
    return new Response(JSON.stringify({ feedback: { id: `feedback-${payloads.length}` } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  });
  renderWidget();

  for (let report = 0; report < 2; report += 1) {
    await user.click(screen.getByRole("button", { name: "Report a Bug" }));
    await user.type(screen.getByLabelText("Title"), "Identical checkout report");
    await user.type(screen.getByLabelText("What happened?"), "The same wording can describe a later occurrence.");
    await user.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
    await user.click(screen.getByRole("button", { name: "Done" }));
  }

  expect(payloads).toHaveLength(2);
  expect(payloads[0]?.clientSubmissionId).toMatch(/^tg-widget:/);
  expect(payloads[1]?.clientSubmissionId).toMatch(/^tg-widget:/);
  expect(payloads[1]?.clientSubmissionId).not.toBe(payloads[0]?.clientSubmissionId);
});

test("restores the same submission identity after an uncertain response and reload", async () => {
  const user = userEvent.setup();
  const payloads: Array<Record<string, unknown>> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, options) => {
    payloads.push(JSON.parse(String(options?.body)));
    if (payloads.length === 1) {
      return new Response(JSON.stringify({ error: { message: "uncertain commit" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ feedback: { id: "feedback-restored-retry" } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  });
  const firstView = renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Reload-safe retry");
  await user.type(screen.getByLabelText("What happened?"), "The server may have committed before the response was lost.");
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(async () => { expect(await screen.findByText("TraceGenie could not accept the report right now. Your report is still here. Retry in a moment.")).toBeVisible(); });
  expect(readLatestDraft()).toMatchObject({ submissionId: payloads[0]?.clientSubmissionId });
  expect(readLatestDraft().submissionSnapshot).toMatch(/^[a-f0-9]{64}$/);

  firstView.unmount();
  renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(screen.getByLabelText("Title")).toHaveValue("Reload-safe retry");
  await user.click(screen.getByRole("button", { name: "Send report" }));

  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  expect(payloads).toHaveLength(2);
  expect(payloads[1]?.clientSubmissionId).toBe(payloads[0]?.clientSubmissionId);
});

test("restores retry identity and telemetry opt-outs without persisting private point evidence", async () => {
  const user = userEvent.setup();
  const sensitiveLabel = "Private customer account 8675309";
  const selectedTextHost = document.createElement("p");
  selectedTextHost.textContent = "Private selected support transcript";
  document.body.append(selectedTextHost);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(selectedTextHost);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const target = document.createElement("button");
  target.textContent = sensitiveLabel;
  target.getBoundingClientRect = () => ({
    x: 20,
    y: 20,
    left: 20,
    top: 20,
    right: 180,
    bottom: 60,
    width: 160,
    height: 40,
    toJSON: () => ({}),
  });
  document.body.append(target);
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => [target]),
  });
  const payloads: Array<Record<string, any>> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    if (String(input).includes("external.test")) {
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    payloads.push(JSON.parse(String(options?.body)));
    return new Response(JSON.stringify(payloads.length === 1
      ? { error: { message: "uncertain commit" } }
      : { feedback: { id: "feedback-private-retry" } }), {
      status: payloads.length === 1 ? 503 : 201,
      headers: { "Content-Type": "application/json" },
    });
  });
  const firstView = renderWidget({
    widgetConfig: {
      allowPointSelection: true,
      allowConsoleCapture: true,
      allowClientErrorContext: true,
      allowNetworkSummary: true,
    },
  });
  console.log("captured console evidence");
  window.dispatchEvent(new ErrorEvent("error", { message: "captured client failure" }));
  await window.fetch("https://external.test/private-path?secret=value");

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await openIncludedDisclosure(user);
  await user.type(screen.getByLabelText("Title"), "Sensitive selection retry");
  await user.type(screen.getByLabelText("What happened?"), "The selected account row failed to open.");
  await user.click(screen.getByRole("button", { name: "Point to issue" }));
  fireEvent.click(target, { clientX: 40, clientY: 40 });
  await openIncludedDisclosure(user);
  await waitFor(async () => { expect(await screen.findByText(`Selected element: ${sensitiveLabel}`)).toBeVisible(); });
  await user.click(screen.getByRole("button", { name: "Remove selected text" }));
  await user.click(within(screen.getByText(/Console log \(/).closest(".tgw-included-row")!).getByRole("button", { name: "Remove" }));
  await user.click(within(screen.getByText(/Client error:/).closest(".tgw-included-row")!).getByRole("button", { name: "Remove" }));
  await user.click(within(screen.getByText(/Network summary \(/).closest(".tgw-included-row")!).getByRole("button", { name: "Remove" }));
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(async () => { expect(await screen.findByText("TraceGenie could not accept the report right now. Your report is still here. Retry in a moment.")).toBeVisible(); });

  expect(readLatestDraft()).toMatchObject({
    submissionId: payloads[0]?.clientSubmissionId,
    pointSelectionDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    evidenceConsent: {
      includeConsole: false,
      includeClientError: false,
      includeNetwork: false,
      includeSelectedText: false,
    },
  });
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      expect(storage.getItem(storage.key(index) ?? "")).not.toContain(sensitiveLabel);
    }
  }

  firstView.unmount();
  renderWidget({
    widgetConfig: {
      allowPointSelection: true,
      allowConsoleCapture: true,
      allowClientErrorContext: true,
      allowNetworkSummary: true,
    },
  });
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await openIncludedDisclosure(user);
  await waitFor(async () => { expect(screen.getByText("Previous point selection is unavailable after reload. Select it again to include it.")).toBeVisible(); });
  await user.click(screen.getByRole("button", { name: "Send report" }));

  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  expect(payloads).toHaveLength(2);
  expect(new Set(payloads.map((payload) => payload.clientSubmissionId)).size).toBe(1);
  expect(payloads[1]?.clientSubmissionId).toBe(payloads[0]?.clientSubmissionId);
  expect(JSON.stringify(payloads[1])).not.toContain(sensitiveLabel);
  expect(payloads[1]?.extraContext).toMatchObject({
    pointSelectionDigest: payloads[0]?.extraContext?.pointSelectionDigest,
    pointSelectionRecovery: {
      rawEvidenceAvailable: false,
      reason: "unavailable_after_reload",
    },
    consentSnapshot: {
      pointSelection: { included: false },
      console: { included: false },
      clientError: { included: false },
      network: { included: false },
      selectedText: { included: false },
    },
  });
  expect(payloads[1]?.extraContext?.pointSelection).toBeUndefined();
  expect(payloads[1]?.extraContext?.selectedElement).toBeUndefined();
  expect(payloads[1]?.consoleEntries).toBeUndefined();
  expect(payloads[1]?.clientErrorContext).toBeUndefined();
  expect(payloads[1]?.extraContext?.networkEntries).toBeUndefined();
  expect(payloads[1]?.extraContext?.selectedTextSuggestion).toBeUndefined();
  Reflect.deleteProperty(document, "elementsFromPoint");
  selection?.removeAllRanges();
  selectedTextHost.remove();
  target.remove();
});

test("rotates a restored submission identity when the failed report was edited before reload", async () => {
  const user = userEvent.setup();
  const payloads: Array<Record<string, unknown>> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, options) => {
    payloads.push(JSON.parse(String(options?.body)));
    return new Response(JSON.stringify(payloads.length === 1
      ? { error: { message: "uncertain commit" } }
      : { feedback: { id: "feedback-edited-retry" } }), {
      status: payloads.length === 1 ? 503 : 201,
      headers: { "Content-Type": "application/json" },
    });
  });
  const firstView = renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Original failed report");
  await user.type(screen.getByLabelText("What happened?"), "This wording was sent with the original key.");
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(async () => { expect(await screen.findByText("TraceGenie could not accept the report right now. Your report is still here. Retry in a moment.")).toBeVisible(); });
  const originalId = payloads[0]?.clientSubmissionId;

  await user.clear(screen.getByLabelText("Title"));
  await user.type(screen.getByLabelText("Title"), "Edited failed report");
  await waitFor(() => expect(readLatestDraft()).toMatchObject({
    submissionId: originalId,
    form: { title: "Edited failed report" },
  }));
  firstView.unmount();

  renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.click(screen.getByRole("button", { name: "Send report" }));

  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  expect(payloads[1]?.clientSubmissionId).not.toBe(originalId);
});

test("replacing evidence with identical metadata invalidates the cached upload and submission", async () => {
  const user = userEvent.setup();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:replacement-evidence");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.stubGlobal("Image", class MockImage {
    width = 1;
    height = 1;
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.(new Event("load")));
    }
  });
  const payloads: Array<Record<string, unknown>> = [];
  let uploadCount = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    if (String(input).endsWith("/api/public/uploads")) {
      uploadCount += 1;
      return new Response(JSON.stringify({
        uploadToken: `replacement-token-${uploadCount}`,
        attachment: {
          id: `replacement-${uploadCount}`,
          fileName: "same-name.png",
          mimeType: "image/png",
          byteSize: 4,
        },
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    payloads.push(JSON.parse(String(options?.body)));
    return new Response(JSON.stringify(payloads.length === 1
      ? { error: { message: "temporary failure" } }
      : { feedback: { id: "feedback-replaced-evidence" } }), {
      status: payloads.length === 1 ? 503 : 201,
      headers: { "Content-Type": "application/json" },
    });
  });
  const firstView = renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Replacement evidence");
  await user.type(screen.getByLabelText("What happened?"), "The replacement must be uploaded even when metadata is identical.");
  await user.upload(screen.getByLabelText("Attach image"), new File(["AAAA"], "same-name.png", { type: "image/png" }));
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(async () => { expect(await screen.findByText("TraceGenie could not accept the report right now. Your report is still here. Retry in a moment.")).toBeVisible(); });

  firstView.unmount();
  renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.upload(screen.getByLabelText("Reattach image"), new File(["BBBB"], "same-name.png", { type: "image/png" }));
  await user.click(screen.getByRole("button", { name: "Send report" }));

  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  expect(uploadCount).toBe(2);
  expect(payloads).toHaveLength(2);
  expect(payloads[1]?.clientSubmissionId).not.toBe(payloads[0]?.clientSubmissionId);
  expect(payloads[0]?.attachmentTokens).toEqual(["replacement-token-1"]);
  expect(payloads[1]?.attachmentTokens).toEqual(["replacement-token-2"]);
});

test("reuses the upload identity when the first upload response is lost", async () => {
  const user = userEvent.setup();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:upload-timeout-evidence");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.stubGlobal("Image", class MockImage {
    width = 1;
    height = 1;
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.(new Event("load")));
    }
  });
  const uploadIds: string[] = [];
  let uploadCount = 0;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    if (String(input).endsWith("/api/public/uploads")) {
      uploadCount += 1;
      const formData = options?.body as FormData;
      uploadIds.push(String(formData.get("clientUploadId")));
      if (uploadCount === 1) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({
        uploadToken: "upload-timeout-token",
        attachment: {
          id: "upload-timeout-attachment",
          fileName: "upload-timeout.png",
          mimeType: "image/png",
          byteSize: 8,
        },
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ feedback: { id: "feedback-upload-timeout" } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  });
  renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Upload response timeout");
  await user.type(screen.getByLabelText("What happened?"), "The upload may exist even when its first response is lost.");
  await user.upload(screen.getByLabelText("Attach image"), new File(["evidence"], "upload-timeout.png", { type: "image/png" }));
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(async () => { expect(await screen.findByText("TraceGenie could not be reached. Your report is still here. Check your connection and retry.")).toBeVisible(); });
  await user.click(screen.getByRole("button", { name: "Retry" }));

  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  expect(uploadIds).toHaveLength(2);
  expect(uploadIds[0]).toMatch(/^tg-widget-upload:/);
  expect(uploadIds[1]).toBe(uploadIds[0]);
  expect(fetchSpy).toHaveBeenCalledTimes(3);
});

test("reload plus identical reattachment recovers upload and submission identities without persisting secrets", async () => {
  const user = userEvent.setup();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:reload-reattach-evidence");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.stubGlobal("Image", class MockImage {
    width = 1;
    height = 1;
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.(new Event("load")));
    }
  });
  const uploadIds: string[] = [];
  const submissionIds: unknown[] = [];
  let feedbackCount = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    if (String(input).endsWith("/api/public/uploads")) {
      const formData = options?.body as FormData;
      uploadIds.push(String(formData.get("clientUploadId")));
      return new Response(JSON.stringify({
        uploadToken: "server-only-recovered-token",
        attachment: {
          id: "reload-reattach-attachment",
          fileName: "reload-reattach.png",
          mimeType: "image/png",
          byteSize: 19,
        },
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    feedbackCount += 1;
    const payload = JSON.parse(String(options?.body));
    submissionIds.push(payload.clientSubmissionId);
    return new Response(JSON.stringify(feedbackCount === 1
      ? { error: { message: "response lost after commit" } }
      : { feedback: { id: "reload-reattach-feedback" } }), {
      status: feedbackCount === 1 ? 503 : 201,
      headers: { "Content-Type": "application/json" },
    });
  });
  const evidence = new File(["same-evidence-bytes"], "reload-reattach.png", { type: "image/png" });
  const firstView = renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Reload reattachment recovery");
  await user.type(screen.getByLabelText("What happened?"), "The committed report must recover after a lost response.");
  await user.upload(screen.getByLabelText("Attach image"), evidence);
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(async () => { expect(await screen.findByText("TraceGenie could not accept the report right now. Your report is still here. Retry in a moment.")).toBeVisible(); });
  const failedDraft = readLatestDraft();
  expect(failedDraft).toMatchObject({
    submissionId: submissionIds[0],
    attachment: {
      clientUploadId: uploadIds[0],
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
  });
  expect(JSON.stringify(failedDraft)).not.toContain("server-only-recovered-token");
  expect(JSON.stringify(failedDraft)).not.toContain("same-evidence-bytes");
  firstView.unmount();

  renderWidget();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.upload(screen.getByLabelText("Reattach image"), evidence);
  await user.click(screen.getByRole("button", { name: "Send report" }));

  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  expect(uploadIds).toHaveLength(2);
  expect(uploadIds[1]).toBe(uploadIds[0]);
  expect(submissionIds).toHaveLength(2);
  expect(submissionIds[1]).toBe(submissionIds[0]);
});

test("scrolls a retry banner into the visible report body", async () => {
  const user = userEvent.setup();
  const scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
  renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Visible retry report");
  await user.type(screen.getByLabelText("What happened?"), "The failed action must remain visible near its recovery control.");
  await user.click(screen.getByRole("button", { name: "Send report" }));

  await waitFor(async () => { expect(await screen.findByText("TraceGenie could not be reached. Your report is still here. Check your connection and retry.")).toBeVisible(); });
  await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" }));
});

test("names a server failure without replacing the report fields", async () => {
  const user = userEvent.setup();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    error: { message: "internal upstream detail" },
  }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  }));
  renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Server retry report");
  await user.type(screen.getByLabelText("What happened?"), "The service could not accept the report.");
  await user.click(screen.getByRole("button", { name: "Send report" }));

  await waitFor(async () => { expect(await screen.findByText("TraceGenie could not accept the report right now. Your report is still here. Retry in a moment.")).toBeVisible(); });
  expect(screen.queryByText("internal upstream detail")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Title")).toHaveValue("Server retry report");
  await waitFor(async () => { expect(screen.getByRole("button", { name: "Retry" })).toBeVisible(); });
});

test("turns a bounded request timeout into a retryable preserved report", async () => {
  const user = userEvent.setup();
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Timeout retry report");
  await user.type(screen.getByLabelText("What happened?"), "The request did not finish before its deadline.");
  const realSetTimeout = window.setTimeout.bind(window);
  vi.spyOn(window, "setTimeout").mockImplementation((callback, delay, ...args) => {
    if (delay === 15_000) {
      queueMicrotask(() => typeof callback === "function" && callback());
      return 1;
    }
    return realSetTimeout(callback, delay, ...args);
  });
  fireEvent.click(screen.getByRole("button", { name: "Send report" }));

  await waitFor(async () => { expect(await screen.findByText("The connection timed out. Your report is still here. Retry when you are ready.")).toBeVisible(); });
  expect(screen.getByLabelText("Title")).toHaveValue("Timeout retry report");
  await waitFor(async () => { expect(screen.getByRole("button", { name: "Retry" })).toBeVisible(); });
});

test("guards an in-flight report from duplicate submit actions", async () => {
  const user = userEvent.setup();
  let resolveFetch: ((response: Response) => void) | undefined;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  }));
  renderWidget();

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.type(screen.getByLabelText("Title"), "Only submit once");
  await user.type(screen.getByLabelText("What happened?"), "Rapid actions must create only one request.");
  const sendButton = screen.getByRole("button", { name: "Send report" });
  fireEvent.click(sendButton);
  fireEvent.click(sendButton);

  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  resolveFetch?.(new Response(JSON.stringify({ feedback: { id: "feedback-single" } }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  }));
  await waitFor(async () => { expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible(); });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("focuses the sheet for launcher and programmatic opens, traps Tab, and restores its trigger", async () => {
  const user = userEvent.setup();
  const view = renderWidget();
  const launcher = screen.getByRole("button", { name: "Report a Bug" });

  await user.click(launcher);
  const title = screen.getByLabelText("Title");
  expect(title).toHaveFocus();

  screen.getByRole("button", { name: "Close" }).focus();
  await user.keyboard("{Shift>}{Tab}{/Shift}");
  expect(screen.getByRole("button", { name: "Send report" })).toHaveFocus();
  await user.keyboard("{Tab}");
  expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  await user.keyboard("{Tab}");
  expect(title).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(launcher).toHaveFocus();

  const trigger = document.createElement("button");
  trigger.textContent = "Open report programmatically";
  document.body.append(trigger);
  trigger.focus();
  view.rerender(
    <FeedbackWidget
      {...baseProps}
      openRequest={{ id: 1 }}
    />,
  );

  expect(await screen.findByLabelText("Title")).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
  trigger.remove();
});

test("keeps Escape available to cancel picking without closing the sheet", async () => {
  const user = userEvent.setup();
  renderWidget({ widgetConfig: { allowPointSelection: true } });

  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await user.click(screen.getByRole("button", { name: "Point to issue" }));
  await waitFor(async () => { expect(screen.getByText("Click the issue on the page • Esc to cancel")).toBeVisible(); });

  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(async () => { expect(screen.getByRole("dialog")).toBeVisible(); });
  expect(screen.queryByText("Click the issue on the page • Esc to cancel")).not.toBeInTheDocument();
});

test("reference-counts host body scroll locks and restores the exact inline value", async () => {
  const user = userEvent.setup();
  document.body.style.setProperty("overflow", "scroll", "important");
  const firstView = renderWidget();
  const secondView = renderWidget();
  const [firstLauncher, secondLauncher] = screen.getAllByRole("button", { name: "Report a Bug" });

  await user.click(firstLauncher);
  expect(document.body.style.getPropertyValue("overflow")).toBe("hidden");
  expect(document.body.style.getPropertyPriority("overflow")).toBe("important");

  await user.click(secondLauncher);
  firstView.unmount();
  expect(document.body.style.getPropertyValue("overflow")).toBe("hidden");
  secondView.unmount();
  expect(document.body.style.getPropertyValue("overflow")).toBe("scroll");
  expect(document.body.style.getPropertyPriority("overflow")).toBe("important");
  document.body.style.removeProperty("overflow");
});
