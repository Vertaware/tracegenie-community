import { format } from "date-fns";
import type { FeedbackDetailResponse } from "@tracegenie/shared";
import { api } from "./api";

type ExportRow = Record<string, string>;

function escapeCSV(value: string): string {
  const normalized = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (normalized.includes(",") || normalized.includes('"') || normalized.includes("\n")) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function buildCSV(rows: ExportRow[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCSV).join(","),
    ...rows.map((row) => headers.map((h) => escapeCSV(row[h] ?? "")).join(",")),
  ];
  return lines.join("\n");
}

function flattenDetail(detail: FeedbackDetailResponse): ExportRow {
  const fb = detail.feedback;
  return {
    "Ticket #": String(fb.ticketNumber),
    "Title": fb.title,
    "Description": fb.description,
    "Product": fb.project.name,
    "Product Key": fb.project.key,
    "Status": fb.status.replaceAll("_", " "),
    "Severity": fb.severity,
    "Type": fb.issueType,
    "Owner": fb.owner?.name ?? "Unassigned",
    "Owner Email": fb.owner?.email ?? "",
    "Labels": fb.labels.join(", "),
    "Reporter Name": fb.reporter.name ?? "",
    "Reporter Email": fb.reporter.email ?? "",
    "URL": fb.route.url,
    "Page Title": fb.route.pageTitle ?? "",
    "Referrer": fb.route.referrer ?? "",
    "Steps to Reproduce": fb.stepsToReproduce ?? "",
    "Expected Result": fb.expectedResult ?? "",
    "Actual Result": fb.actualResult ?? "",
    "Browser": `${fb.browser.browserName ?? ""} ${fb.browser.browserVersion ?? ""}`.trim(),
    "OS": `${fb.browser.osName ?? ""} ${fb.browser.osVersion ?? ""}`.trim(),
    "Platform": fb.browser.platform ?? "",
    "Viewport": `${fb.browser.viewportWidth}x${fb.browser.viewportHeight}`,
    "App Name": fb.release.appName,
    "App Version": fb.release.appVersion,
    "Environment": fb.release.appEnvironment,
    "Attachments": String(fb.attachments.length),
    "Comments": String(fb.comments.length + (fb.commentsOmittedCount ?? 0)),
    "Duplicate Of": fb.duplicateOf ? `#${fb.duplicateOf.ticketNumber}` : "",
    "Converted to Backlog": fb.convertedToBacklog ? "Yes" : "No",
    "External Ticket": fb.externalTicketRef ?? "",
    "Created": format(new Date(fb.createdAt), "yyyy-MM-dd HH:mm"),
    "Updated": format(new Date(fb.updatedAt), "yyyy-MM-dd HH:mm"),
  };
}

async function downloadFile(content: string, filename: string) {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.display = "none";
  document.body.appendChild(link);
  await new Promise<void>((resolve) => {
    // Yield once so the browser can register the synthetic download link.
    setTimeout(() => {
      link.click();
      resolve();
      setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(url);
      }, 1000);
    }, 0);
  });
}

export async function exportIssuesToCSV(
  feedbackIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const rows: ExportRow[] = [];
  const total = feedbackIds.length;
  onProgress?.(0, total);

  // Fetch details in batches of 5 to avoid hammering the API
  const batchSize = 5;
  for (let i = 0; i < total; i += batchSize) {
    const batch = feedbackIds.slice(i, i + batchSize);
    const details = await Promise.all(
      batch.map((id) => api.getFeedbackDetail(id)),
    );
    for (const detail of details) {
      rows.push(flattenDetail(detail));
    }
    onProgress?.(Math.min(i + batchSize, total), total);
  }

  const csv = buildCSV(rows);
  const timestamp = format(new Date(), "yyyy-MM-dd_HHmm");
  await downloadFile(csv, `tracegenie-issues-${timestamp}.csv`);
  return rows.length;
}
