import { ApiError } from "../../lib/api";
import { getApiBaseUrl } from "../../lib/env";

export type ReporterPrivacyRequest = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed" | "pending" | "rejected";
  requestedAt: string;
  completedAt?: string | null;
  failedAt?: string | null;
  resolvedAt?: string | null;
  expiresAt?: string | null;
  downloadStatus?: "unavailable" | "ready" | "expired";
  failure?: { code: string; message: string } | null;
};

export type ReporterPrivacyStatus = {
  exports: ReporterPrivacyRequest[];
  deletions: ReporterPrivacyRequest[];
};

type RequestOptions = {
  method?: string;
  body?: BodyInit | Record<string, unknown>;
};

async function reporterRequest<T>(token: string, path: string, options: RequestOptions = {}) {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  let body = options.body as BodyInit | undefined;
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
    credentials: "include",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.message ?? "Request failed.",
      payload?.error?.code,
      payload?.error?.details,
    );
  }
  return payload as T;
}

async function reporterBlobRequest(token: string, path: string) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(response.status, payload?.error?.message ?? "Download failed.", payload?.error?.code);
  }
  return response.blob();
}

export const reporterSelfServiceApi = {
  getPrivacyStatus(token: string) {
    return reporterRequest<ReporterPrivacyStatus>(token, "/api/reporter/dsar/requests");
  },
  requestExport(token: string) {
    return reporterRequest<{ request: ReporterPrivacyRequest }>(token, "/api/reporter/dsar/export-requests", { method: "POST" });
  },
  downloadExport(token: string, requestId: string) {
    return reporterBlobRequest(token, `/api/reporter/dsar/export-requests/${encodeURIComponent(requestId)}/download`);
  },
  requestDeletion(token: string) {
    return reporterRequest<{ request: ReporterPrivacyRequest }>(token, "/api/reporter/dsar/deletion-requests", { method: "POST" });
  },
  addComment(token: string, feedbackId: string, body: string, clientRequestId: string) {
    return reporterRequest<{ comment: { id: string; body: string; createdAt: string } }>(
      token,
      `/api/reporter/tickets/${encodeURIComponent(feedbackId)}/comments`,
      { method: "POST", body: { body, clientRequestId } },
    );
  },
  updateFollow(token: string, feedbackId: string, enabled: boolean, clientRequestId: string) {
    return reporterRequest<{ ticket: unknown }>(
      token,
      `/api/reporter/tickets/${encodeURIComponent(feedbackId)}/notifications`,
      { method: "PATCH", body: { enabled, clientRequestId } },
    );
  },
  uploadAttachment(token: string, feedbackId: string, file: File, clientRequestId: string) {
    const body = new FormData();
    body.append("file", file);
    body.append("clientRequestId", clientRequestId);
    return reporterRequest<{ attachment: unknown }>(
      token,
      `/api/reporter/tickets/${encodeURIComponent(feedbackId)}/attachments`,
      { method: "POST", body },
    );
  },
  downloadAttachment(token: string, feedbackId: string, attachmentId: string) {
    return reporterBlobRequest(
      token,
      `/api/reporter/tickets/${encodeURIComponent(feedbackId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
    );
  },
};
