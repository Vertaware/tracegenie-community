import React from "react";
import { createRoot } from "react-dom/client";

import "../src/styles/index.css";
import { ReporterPortalPage } from "../src/features/reporter/ReporterPortalPage";
import { api } from "../src/lib/api";

const lockedTicket = {
  id: "capacity-lock-proof",
  ticketNumber: 51,
  title: "Checkout confirmation never appears",
  description: "Payment completes, but the confirmation page remains busy.",
  status: "fixed",
  isOverageLocked: true,
  requesterNotificationsEnabled: true,
  resolutionFeedback: { state: "awaiting_confirmation", respondedAt: null },
  project: { name: "Acme Checkout", organizationName: "Acme Incorporated" },
  comments: [],
  attachments: [],
  statusHistory: [{
    id: "history-fixed",
    fromStatus: "in_progress",
    toStatus: "fixed",
    createdAt: "2026-07-15T14:30:00.000Z",
  }],
  notificationHistory: [],
};

Object.assign(api, {
  requestReporterOtp: async () => ({ ok: true }),
  verifyReporterOtp: async () => ({ token: "proof-reporter-session" }),
  getReporterTickets: async () => ({ tickets: [lockedTicket] }),
  downloadReporterDsarExport: async () => new Blob(),
  requestReporterDsarDeletion: async () => ({ request: {} }),
  updateReporterNotifications: async () => ({ ticket: lockedTicket }),
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ReporterPortalPage />
  </React.StrictMode>,
);
