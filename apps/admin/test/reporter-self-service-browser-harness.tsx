import React from "react";
import { createRoot } from "react-dom/client";

import "../src/styles/index.css";
import { ReporterPortalPage } from "../src/features/reporter/ReporterPortalPage";
import { reporterSelfServiceApi } from "../src/features/reporter/reporterSelfServiceApi";
import { api } from "../src/lib/api";

const ticket = {
  id: "proof-ticket",
  ticketNumber: 842,
  title: "Checkout confirmation never appears",
  description: "Payment completes, but the confirmation page remains busy.",
  status: "triaged",
  isOverageLocked: false,
  requesterNotificationsEnabled: true,
  resolutionFeedback: null,
  project: { name: "Acme Checkout", organizationName: "Acme Incorporated" },
  comments: [],
  attachments: [],
  statusHistory: [{ id: "history-1", fromStatus: "new", toStatus: "triaged", createdAt: "2026-07-15T14:00:00.000Z" }],
  notificationHistory: [],
};

Object.assign(api, {
  requestReporterOtp: async () => ({ ok: true, retryAfterSeconds: 60, expiresInSeconds: 600 }),
  verifyReporterOtp: async () => ({ token: "proof-reporter-session" }),
  getReporterTickets: async () => ({ tickets: [ticket] }),
  markReporterStillHappening: async () => ({ ticket }),
  confirmReporterFixed: async () => ({ ticket }),
});

Object.assign(reporterSelfServiceApi, {
  getPrivacyStatus: async () => ({ exports: [], deletions: [] }),
  addComment: async (_token: string, _ticketId: string, body: string) => ({
    comment: { id: "proof-comment", body, createdAt: "2026-07-15T16:00:00.000Z" },
  }),
  updateFollow: async (_token: string, _ticketId: string, enabled: boolean) => ({
    ticket: { ...ticket, requesterNotificationsEnabled: enabled },
  }),
  uploadAttachment: async () => ({
    attachment: {
      id: "proof-attachment",
      kind: "file",
      fileName: "checkout-proof.png",
      mimeType: "image/png",
      byteSize: 2048,
      expiresAt: "2026-08-14T16:00:00.000Z",
      downloadStatus: "ready",
      createdAt: "2026-07-15T16:00:00.000Z",
    },
  }),
  requestExport: async () => ({
    request: {
      id: "proof-export",
      status: "completed",
      requestedAt: "2026-07-15T16:00:00.000Z",
      completedAt: "2026-07-15T16:01:00.000Z",
      expiresAt: "2026-07-22T16:01:00.000Z",
      downloadStatus: "ready",
    },
  }),
  requestDeletion: async () => ({
    request: {
      id: "proof-deletion",
      status: "pending",
      requestedAt: "2026-07-15T16:00:00.000Z",
    },
  }),
  downloadAttachment: async () => new Blob(["proof"], { type: "image/png" }),
  downloadExport: async () => new Blob(["{}"], { type: "application/json" }),
});

window.confirm = () => true;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ReporterPortalPage />
  </React.StrictMode>,
);
