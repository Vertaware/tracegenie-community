import React from "react";
import { createRoot } from "react-dom/client";

import "../src/styles/index.css";
import { ReporterPortalPage } from "../src/features/reporter/ReporterPortalPage";
import { ApiError, api } from "../src/lib/api";

const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "ready";
const bridgeToken = "proof-bridge-token-with-opaque-content";
if (state === "offline") {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
}
window.history.replaceState({}, "", `${window.location.pathname}?state=${state}#bridge=${bridgeToken}`);

const ticket = {
  id: "proof-ticket",
  ticketNumber: 742,
  title: "Checkout confirmation never appears",
  description: "Payment completes, but the confirmation page remains busy.",
  status: "triaged",
  requesterNotificationsEnabled: true,
  project: { name: "Acme Checkout", organizationName: "Acme Incorporated" },
  comments: [],
  attachments: [],
  statusHistory: [{ id: "history-1", fromStatus: "open", toStatus: "triaged", createdAt: "2026-07-15T14:00:00.000Z" }],
  notificationHistory: [],
};

Object.assign(api, {
  getReporterBridge: async () => {
    if (state === "expired") throw new ApiError(410, "This report link has expired. Request a new access code from the reporter portal.", "reporter.bridge_expired");
    return { bridge: { ticketNumber: 742, organizationName: "Acme Incorporated", projectName: "Acme Checkout" } };
  },
  requestReporterOtp: async () => ({ ok: true }),
  verifyReporterOtp: async () => ({ token: "proof-reporter-session" }),
  getReporterTickets: async () => ({ tickets: [ticket] }),
  downloadReporterDsarExport: async () => new Blob(),
  requestReporterDsarDeletion: async () => ({ request: {} }),
  addReporterComment: async (_token: string, _ticketId: string, body: string) => ({ comment: { id: "proof-comment", body, createdAt: new Date().toISOString() } }),
  updateReporterNotifications: async () => ({ ticket }),
  uploadReporterAttachment: async () => ({ attachment: {} }),
  markReporterStillHappening: async () => ({ ticket }),
  confirmReporterFixed: async () => ({ ticket }),
});

declare global {
  interface Window {
    __reporterBridgeProof: { state: string; bridgeToken: string };
  }
}
window.__reporterBridgeProof = { state, bridgeToken };

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ReporterPortalPage />
  </React.StrictMode>,
);
