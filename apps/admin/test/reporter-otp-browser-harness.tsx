import React from "react";
import { createRoot } from "react-dom/client";

import "../src/styles/index.css";
import { ReporterPortalPage } from "../src/features/reporter/ReporterPortalPage";
import { reporterSelfServiceApi } from "../src/features/reporter/reporterSelfServiceApi";
import { ApiError, api } from "../src/lib/api";

const state = new URLSearchParams(window.location.search).get("state") ?? "email";
const multipleTickets = state === "tickets";
const bridgeToken = "proof-reporter-otp-bridge-capability";
window.history.replaceState({}, "", multipleTickets
  ? `${window.location.pathname}?state=tickets&view=all`
  : `${window.location.pathname}?state=${state}#bridge=${bridgeToken}`);

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

const previewTickets = [
  {
    ...ticket,
    isOverageLocked: false,
    comments: [
      { id: "comment-742-1", author: "team", body: "We reproduced the issue and are investigating the confirmation step. Your payment was received.", createdAt: "2026-09-14T09:00:00.000Z" },
      { id: "comment-742-2", author: "reporter", body: "Thanks. It happened in Chrome after I used a discount code.", createdAt: "2026-09-14T09:20:00.000Z" },
    ],
    statusHistory: [
      { id: "status-742-1", fromStatus: null, toStatus: "open", createdAt: "2026-09-13T14:00:00.000Z" },
      { id: "status-742-2", fromStatus: "open", toStatus: "triaged", createdAt: "2026-09-14T09:00:00.000Z" },
    ],
    resolutionFeedback: null,
  },
  {
    ...ticket,
    id: "proof-ticket-743",
    ticketNumber: 743,
    title: "Download invoice button does nothing",
    description: "Clicking Download invoice on my order did not download a PDF.",
    status: "fixed",
    isOverageLocked: false,
    comments: [
      { id: "comment-743-1", author: "team", body: "The invoice download has been fixed. Please try again and let us know whether it works for you.", createdAt: "2026-09-14T08:00:00.000Z" },
    ],
    statusHistory: [
      { id: "status-743-1", fromStatus: null, toStatus: "open", createdAt: "2026-09-12T11:00:00.000Z" },
      { id: "status-743-2", fromStatus: "in_progress", toStatus: "fixed", createdAt: "2026-09-14T08:00:00.000Z" },
    ],
    resolutionFeedback: { state: "awaiting_confirmation", respondedAt: null as string | null },
  },
  {
    ...ticket,
    id: "proof-ticket-744",
    ticketNumber: 744,
    title: "Delivery address changes were not saved",
    description: "After updating my delivery address, the previous address still appeared on my account.",
    status: "closed",
    isOverageLocked: false,
    comments: [
      { id: "comment-744-1", author: "team", body: "We corrected the address-saving issue. Please update your address once more.", createdAt: "2026-09-12T10:00:00.000Z" },
      { id: "comment-744-2", author: "reporter", body: "That worked. My new address is now saved correctly.", createdAt: "2026-09-12T10:40:00.000Z" },
    ],
    statusHistory: [
      { id: "status-744-1", fromStatus: null, toStatus: "open", createdAt: "2026-09-11T15:00:00.000Z" },
      { id: "status-744-2", fromStatus: "fixed", toStatus: "closed", createdAt: "2026-09-12T10:40:00.000Z" },
    ],
    resolutionFeedback: { state: "confirmed_fixed", respondedAt: "2026-09-12T10:40:00.000Z" },
  },
];

function previewTicket(ticketId: string) {
  const match = previewTickets.find((item) => item.id === ticketId);
  if (!match) throw new Error("Preview ticket not found.");
  return match;
}

Object.assign(api, {
  getReporterBridge: async () => ({
    bridge: { ticketNumber: 742, organizationName: "Acme Incorporated", projectName: "Acme Checkout" },
  }),
  requestReporterOtp: async () => {
    if (state === "delivery") throw new Error("Email delivery is temporarily unavailable.");
    if (state === "rate") throw new ApiError(429, "Too many requests.");
    return { ok: true };
  },
  verifyReporterOtp: async () => {
    if (state === "invalid") throw new ApiError(401, "The code is invalid or expired.", "reporter.invalid_otp");
    return { token: "proof-reporter-session" };
  },
  getReporterTickets: async () => {
    if (state === "loading") return new Promise(() => undefined);
    return { tickets: state === "empty" ? [] : multipleTickets ? structuredClone(previewTickets) : [ticket] };
  },
  getReporterTicket: async (_token: string, ticketId: string) => ({ ticket: structuredClone(previewTicket(ticketId)) }),
  downloadReporterDsarExport: async () => new Blob(),
  requestReporterDsarDeletion: async () => ({ request: {} }),
  addReporterComment: async (_token: string, _ticketId: string, body: string) => ({
    comment: { id: "proof-comment", body, createdAt: new Date().toISOString() },
  }),
  updateReporterNotifications: async () => ({ ticket }),
  uploadReporterAttachment: async () => ({ attachment: {} }),
  markReporterStillHappening: async (_token: string, ticketId: string) => {
    if (!multipleTickets) return { ticket };
    const item = previewTicket(ticketId);
    item.status = "in_progress";
    item.resolutionFeedback = { state: "still_happening", respondedAt: new Date().toISOString() };
    return { ticket: structuredClone(item) };
  },
  confirmReporterFixed: async (_token: string, ticketId: string) => {
    if (!multipleTickets) return { ticket };
    const item = previewTicket(ticketId);
    item.status = "closed";
    item.resolutionFeedback = { state: "confirmed_fixed", respondedAt: new Date().toISOString() };
    return { ticket: structuredClone(item) };
  },
});

if (multipleTickets) {
  Object.assign(reporterSelfServiceApi, {
    getPrivacyStatus: async () => ({ exports: [], deletions: [] }),
    requestExport: async () => ({ request: { id: "preview-export", status: "queued", requestedAt: new Date().toISOString() } }),
    requestDeletion: async () => ({ request: { id: "preview-deletion", status: "pending", requestedAt: new Date().toISOString() } }),
    downloadExport: async () => new Blob([JSON.stringify(previewTickets)], { type: "application/json" }),
    addComment: async (_token: string, ticketId: string, body: string) => {
      const comment = { id: crypto.randomUUID(), author: "reporter", body, createdAt: new Date().toISOString() };
      previewTicket(ticketId).comments.push(comment);
      return { comment };
    },
    updateFollow: async (_token: string, ticketId: string, enabled: boolean) => {
      const item = previewTicket(ticketId);
      item.requesterNotificationsEnabled = enabled;
      return { ticket: structuredClone(item) };
    },
    uploadAttachment: async () => { throw new Error("File uploads are unavailable in this sample preview."); },
    downloadAttachment: async () => { throw new Error("File downloads are unavailable in this sample preview."); },
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ReporterPortalPage />
  </React.StrictMode>,
);
