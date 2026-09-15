import type { FeedbackDetailResponse } from "@tracegenie/shared";
import { afterEach, expect, test, vi } from "vitest";

import { exportIssuesToCSV } from "../src/lib/export-issues";
import { api } from "../src/lib/api";
import { copy } from "../src/lib/copy";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function feedbackDetail(id: string, ticketNumber: number): FeedbackDetailResponse {
  return {
    feedback: {
      id,
      ticketNumber,
      project: { id: "project-1", key: "checkout", name: "Checkout" },
      status: "triaged",
      issueType: "bug",
      severity: "high",
      title: `Issue ${ticketNumber}`,
      description: "Checkout cannot be completed.",
      labels: ["payments"],
      route: { url: "https://app.example.test/checkout" },
      release: { appName: "Checkout", appEnvironment: "production", appVersion: "2026.7.11" },
      releaseSignal: null,
      browser: { userAgent: "test", viewportWidth: 1440, viewportHeight: 900 },
      reporter: { email: "reporter@example.test", name: "Reporter" },
      subscribers: [],
      requesterNotificationsEnabled: true,
      duplicateCandidates: [],
      duplicateOf: null,
      duplicates: [],
      duplicateCommentConsolidation: { totalCount: 0, omittedCount: 0, comments: [] },
      duplicateGroup: null,
      convertedToBacklog: false,
      externalTicketRef: null,
      externalRefs: [],
      engineeringLifecycle: null,
      attachments: [],
      comments: [],
      owner: null,
      statusHistory: [],
      triageHistory: [],
      auditHistory: [],
      notificationHistory: [],
      createdAt: "2026-07-11T12:00:00.000Z",
      updatedAt: "2026-07-11T12:00:00.000Z",
    },
    assignableUsers: [],
  };
}

test("issue export copy states page scope and exact completed count", () => {
  expect(copy.issues.export(false)).toBe("Download page CSV");
  expect(copy.issues.export(true)).toBe("Download filtered page CSV");
  expect(copy.issues.exporting(20, 42)).toBe("Preparing CSV 20/42...");
  expect(copy.issues.exported(42, true)).toBe(
    "CSV prepared for 42 issues from the filtered page; download started.",
  );
  expect(copy.issues.exported(1, true)).toBe(
    "CSV prepared for 1 issue from the filtered page; download started.",
  );
});

test("issue export resolves only after the current page IDs are fetched and download click starts", async () => {
  vi.useFakeTimers();
  const getFeedbackDetail = vi.spyOn(api, "getFeedbackDetail").mockImplementation(async (id) => (
    (() => {
      const detail = feedbackDetail(id, id === "issue-1" ? 101 : 102);
      if (id === "issue-1") {
        detail.feedback.comments = [{ id: "latest", body: "Latest note", visibility: "internal", createdAt: detail.feedback.createdAt, updatedAt: detail.feedback.updatedAt, author: null }];
        detail.feedback.commentsOmittedCount = 100;
      }
      return detail;
    })()
  ));
  const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:issues-export");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const progress = vi.fn();

  const exportResult = exportIssuesToCSV(["issue-1", "issue-2"], progress);
  await vi.runAllTimersAsync();
  const count = await exportResult;

  expect(count).toBe(2);
  expect(getFeedbackDetail.mock.calls.map(([id]) => id)).toEqual(["issue-1", "issue-2"]);
  expect(progress.mock.calls).toEqual([[0, 2], [2, 2]]);
  expect(click).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
  const blob = createObjectURL.mock.calls[0]![0] as Blob;
  const csv = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
  const [header, first, second] = csv.split("\n").map((row) => row.split(","));
  const commentsColumn = header!.indexOf("Comments");
  expect(first![commentsColumn]).toBe("101");
  expect(second![commentsColumn]).toBe("0");
});
