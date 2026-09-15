import React from "react";
import { createRoot } from "react-dom/client";

import "../src/styles/index.css";
import { ReporterPortalPage } from "../src/features/reporter/ReporterPortalPage";
import { api } from "../src/lib/api";

const state = new URLSearchParams(window.location.search).get("state") ?? "awaiting";
const respondedAt = "2026-07-15T14:35:00.000Z";

function proofTicket() {
  const resolutionFeedback = state === "confirmed"
    ? { state: "confirmed_fixed", respondedAt }
    : state === "reopened"
      ? { state: "still_happening", respondedAt }
      : { state: "awaiting_confirmation", respondedAt: null };
  return {
    id: "close-loop-proof",
    ticketNumber: 742,
    title: "Checkout confirmation never appears",
    description: "Payment completes, but the confirmation page remains busy.",
    status: state === "confirmed" ? "closed" : state === "reopened" ? "in_progress" : "fixed",
    requesterNotificationsEnabled: true,
    resolutionFeedback,
    project: { name: "Acme Checkout", organizationName: "Acme Incorporated" },
    comments: state === "reopened"
      ? [{ id: "comment-reopened", body: "The issue still reproduces after refreshing.", createdAt: respondedAt }]
      : [],
    attachments: [],
    statusHistory: [{
      id: "history-fixed",
      fromStatus: "in_progress",
      toStatus: "fixed",
      createdAt: "2026-07-15T14:30:00.000Z",
    }],
    notificationHistory: [{
      id: "notification-fixed",
      eventType: "status_change_requester",
      status: "sent",
      triggerStatus: "fixed",
      subject: "Your report was fixed",
      skipReason: null,
      createdAt: "2026-07-15T14:31:00.000Z",
      sentAt: "2026-07-15T14:31:05.000Z",
    }],
  };
}

Object.assign(api, {
  requestReporterOtp: async () => ({ ok: true }),
  verifyReporterOtp: async () => ({ token: "proof-reporter-session" }),
  getReporterTickets: async () => ({ tickets: [proofTicket()] }),
  downloadReporterDsarExport: async () => new Blob(),
  requestReporterDsarDeletion: async () => ({ request: {} }),
  addReporterComment: async (_token: string, _ticketId: string, body: string) => ({
    comment: { id: "proof-comment", body, createdAt: respondedAt },
  }),
  updateReporterNotifications: async () => ({ ticket: proofTicket() }),
  uploadReporterAttachment: async () => ({ attachment: {} }),
  markReporterStillHappening: async () => ({
    ticket: { ...proofTicket(), status: "in_progress", resolutionFeedback: { state: "still_happening", respondedAt } },
  }),
  confirmReporterFixed: async () => {
    if (state === "error") throw new Error("Connection interrupted. Try again.");
    return {
      ticket: { ...proofTicket(), status: "closed", resolutionFeedback: { state: "confirmed_fixed", respondedAt } },
    };
  },
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ReporterPortalPage />
  </React.StrictMode>,
);
