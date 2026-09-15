import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectInstallDiagnosticsResponse, ProjectSummary } from "@tracegenie/shared";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ProjectFormPage } from "../src/features/projects/ProjectFormPage";
import { api, ApiError } from "../src/lib/api";
import "../src/styles/index.css";

const section = new URLSearchParams(window.location.search).get("section") ?? "overview";
const state = new URLSearchParams(window.location.search).get("state") ?? "detail";
const proofState = new URLSearchParams(window.location.search).get("proof") ?? "needs-proof";
const privacyState = new URLSearchParams(window.location.search).get("privacy") ?? "ready";

const product: ProjectSummary = {
  id: "project-checkout",
  key: "checkout",
  name: "Checkout",
  description: "Customer checkout and payment confirmation.",
  defaultEnvironment: "production",
  allowedOrigins: ["https://app.example.test", "https://staging.example.test"],
  notificationEmails: ["alerts@example.test", "oncall@example.test"],
  requesterEmailProductName: "Checkout",
  isActive: true,
  clientSecretConfigured: true,
  widgetSecretRotatedAt: "2026-07-14T15:30:00.000Z",
  widgetConfig: {
    allowScreenshot: true,
    allowPointSelection: true,
    allowConsoleCapture: true,
    allowClientErrorContext: true,
    allowNetworkSummary: false,
    appearance: {
      launcherPresentation: "icon-text",
      launcherIcon: "bug",
      launcherLabel: "Report a problem",
      launcherPosition: "bottom-right",
      launcherOffsetX: 24,
      launcherOffsetY: 24,
      modalTitle: "Tell us what went wrong",
      keyboardShortcut: "mod+shift+b",
    },
    notificationBranding: {
      brandName: "Northstar Support",
      logoUrl: "",
      primaryColor: "#2563eb",
      accentColor: "#344760",
      emailFooterText: "Northstar product support",
    },
    privacy: privacyState === "blocked" ? {
      privacyOwnerEmail: "",
      privacyUrl: "",
      retentionDays: null,
      attachmentRetentionDays: null,
      redactionMode: "standard",
      mcpEvidenceSharing: "raw_allowed",
      suppressSelectedText: false,
      customRedactionTerms: ["private-account-secret"],
    } : {
      privacyOwnerEmail: "privacy@example.test",
      privacyUrl: "https://example.test/privacy",
      retentionDays: 365,
      attachmentRetentionDays: 30,
      redactionMode: "technical_metadata",
      mcpEvidenceSharing: "metadata_only",
      suppressSelectedText: true,
      customRedactionTerms: ["private-account-secret"],
    },
    surveyPrompt: {
      enabled: true,
      type: "csat",
      question: "How was this checkout experience?",
    },
  },
  createdAt: "2026-07-01T12:00:00.000Z",
  updatedAt: "2026-07-14T15:30:00.000Z",
  organization: { id: "organization-proof", name: "Northstar" },
};

function activationDiagnostics(): ProjectInstallDiagnosticsResponse {
  const verifiedAt = "2026-07-15T15:30:00.000Z";
  const base: ProjectInstallDiagnosticsResponse = {
    projectKey: product.key,
    projectName: product.name,
    status: privacyState === "blocked" || proofState === "blocked" ? "action_required" : proofState === "ready" ? "ready" : "verification_needed",
    checkedAt: verifiedAt,
    testOrigin: product.allowedOrigins[0] ?? null,
    testedOrigin: proofState === "ready" ? product.allowedOrigins[0] ?? null : null,
    lastWidgetLoadedAt: verifiedAt,
    lastWidgetSessionIssuedAt: verifiedAt,
    firstReportReceivedAt: verifiedAt,
    firstReportId: "feedback-104",
    firstReportTicketNumber: 104,
    screenshotProofReceivedAt: proofState === "ready" ? verifiedAt : null,
    notificationProofRecordedAt: verifiedAt,
    privacyReadiness: privacyState === "blocked" ? {
      status: "action_required",
      enforced: true,
      owner: null,
      policyUrl: null,
      issueRetentionDays: null,
      attachmentRetentionDays: null,
      collectorRedactionReady: false,
      selectedTextSuppressed: false,
      mcpEvidencePolicy: "raw_allowed",
      blockers: [
        { id: "privacy_owner", label: "Privacy owner", detail: "Assign the email address responsible for this product's evidence policy." },
        { id: "privacy_url", label: "Privacy link", detail: "Add the public privacy policy reporters see before sending." },
        { id: "issue_retention", label: "Issue retention", detail: "Set an automatic issue-retention period." },
        { id: "attachment_retention", label: "Attachment retention", detail: "Set an automatic expiry for captured screenshots." },
        { id: "collector_redaction", label: "Collector redaction", detail: "Use Technical metadata or Strict redaction for enabled collectors." },
        { id: "selected_text", label: "Selected text", detail: "Suppress selected page text while point selection is enabled." },
        { id: "mcp_evidence", label: "MCP evidence", detail: "Default AI and MCP access to metadata only for captured evidence." },
      ],
    } : {
      status: "ready",
      enforced: true,
      owner: "privacy@example.test",
      policyUrl: "https://example.test/privacy",
      issueRetentionDays: 365,
      attachmentRetentionDays: 30,
      collectorRedactionReady: true,
      selectedTextSuppressed: true,
      mcpEvidencePolicy: "metadata_only",
      blockers: [],
    },
    proofs: [
      { id: "origin", label: "Allowed origin", status: proofState === "blocked" ? "failed" : proofState === "ready" ? "verified" : "configured", detail: proofState === "blocked" ? "The observed origin is no longer allowed." : proofState === "ready" ? "The production origin was observed on a real report and remains allowed." : "The production origin matches this product's configuration; runtime proof still requires a real report.", evidenceAt: proofState === "ready" ? verifiedAt : null, scheduledDeletionAt: null, action: proofState === "ready" ? null : { label: proofState === "blocked" ? "Repair origin" : "Send test report", href: proofState === "blocked" ? "/projects/checkout?section=install#project-allowed-origins-section" : "/projects/checkout?section=install#widget-install-check-controls" } },
      { id: "session", label: "Token and session", status: proofState === "needs-proof" ? "stale" : "verified", detail: proofState === "needs-proof" ? "The last production session proof is older than 30 days." : "A production widget session was issued after the widget loaded.", evidenceAt: proofState === "needs-proof" ? "2026-05-01T10:00:00.000Z" : verifiedAt, scheduledDeletionAt: null, action: proofState === "needs-proof" ? { label: "Verify session", href: "/projects/checkout?section=install#widget-snippet-details" } : null },
      { id: "first_report", label: "First report", status: "verified", detail: "Report #1042 reached this product through the intake path.", evidenceAt: verifiedAt, scheduledDeletionAt: "2027-07-15T15:30:00.000Z", action: null },
      { id: "attachment", label: "Attachment path", status: proofState === "ready" ? "verified" : "missing", detail: proofState === "ready" ? "checkout.png was stored and linked to a report for this product." : "No screenshot is linked to a report for this product.", evidenceAt: proofState === "ready" ? verifiedAt : null, scheduledDeletionAt: proofState === "ready" ? "2026-08-14T15:30:00.000Z" : null, action: proofState === "ready" ? null : { label: "Send report with screenshot", href: "/projects/checkout?section=install#widget-install-check-controls" } },
      { id: "notification", label: "Notification event", status: "verified", detail: "An internal new-issue notification event was created for this product.", evidenceAt: verifiedAt, scheduledDeletionAt: null, action: null },
      { id: "provider", label: "Provider connection", status: proofState === "ready" ? "verified" : "manual", detail: proofState === "ready" ? "GITHUB connection Checkout Engineering completed an authenticated operation." : "No active provider connection is scoped to this product or organization.", evidenceAt: proofState === "ready" ? verifiedAt : null, scheduledDeletionAt: null, action: proofState === "ready" ? null : { label: "Connect provider", href: "/integrations?view=connections" } },
    ],
  };
  return base;
}

Object.assign(api, {
  getProjects: async () => {
    if (state === "error") throw new ApiError(503, "Unavailable", "service.unavailable");
    if (state === "empty") return { projects: [] };
    return { projects: [product] };
  },
  getAnalytics: async () => ({
    byProject: [{ projectId: product.id, projectKey: product.key, projectName: product.name, count: 24 }],
  }),
  getProjectInstallDiagnostics: async () => activationDiagnostics(),
  submitProjectInstallTestReport: async () => ({
    feedback: { id: "install-proof", ticketNumber: 1042, status: "OPEN", isOverageLocked: false, createdAt: "2026-07-15T15:30:00.000Z" },
    installDiagnostics: activationDiagnostics(),
  }),
  getProjectEngineeringContext: async () => ({
    project: { id: product.id, key: product.key, name: product.name },
    engineeringContext: {
      repositoryUrl: "https://github.com/example/checkout",
      defaultBranch: "main",
      worktreePath: "/workspace/checkout",
      installCommand: "npm ci",
      testCommand: "npm test -- checkout",
      buildCommand: "npm run build",
      autoFixPolicy: "SUGGEST_ONLY",
      reviewerPolicy: "HUMAN_REVIEW_REQUIRED",
      requesterNotificationPolicy: "EXPLICIT_ONLY",
      notes: "apps/web/src/checkout/** @checkout-team\napps/api/src/modules/payments/** @payments-team",
      createdAt: "2026-07-01T12:00:00.000Z",
      updatedAt: "2026-07-14T15:30:00.000Z",
    },
  }),
});

const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    mutations: { retry: false },
  },
});
const root = document.getElementById("root");
if (!root) throw new Error("Product sections harness root is missing.");

createRoot(root).render(
  <main id="product-sections-browser-harness" className="min-h-screen overflow-x-clip bg-surface px-4 py-6 md:px-8 md:py-8">
    <section id="product-sections-proof-surface" className="mx-auto w-full max-w-7xl">
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/projects/checkout?section=${encodeURIComponent(section)}`]}>
          <Routes>
            <Route path="/projects" element={<p>Products restored</p>} />
            <Route path="/projects/:projectKey" element={<ProjectFormPage organizationId="organization-proof" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </section>
  </main>,
);
