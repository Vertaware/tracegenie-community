import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FeedbackActivityResponse, FeedbackConversationResponse, FeedbackAiCodingTaskResponse, FeedbackDetailResponse, ProjectEngineeringContextResponse } from "@tracegenie/shared";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useLocation, useNavigate } from "react-router-dom";

import { IssueDetailPage } from "../src/features/issues/IssueDetailPage";
import { api, ApiError } from "../src/lib/api";
import { copy } from "../src/lib/copy";
import { AdminFormExitGuardProvider } from "../src/components/guards/AdminFormExitGuard";

const queryClients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  queryClients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

function feedbackDetail(feedbackId: string, status = "triaged"): FeedbackDetailResponse {
  const ticketNumber = feedbackId === "issue-b" ? 202 : 101;
  return {
    feedback: {
      id: feedbackId,
      ticketNumber,
      project: { id: "project-1", key: "checkout", name: "Checkout" },
      status,
      issueType: "bug",
      severity: "medium",
      title: `Issue ${ticketNumber}`,
      description: "Checkout cannot be completed.",
      isOverageLocked: false,
      stepsToReproduce: null,
      expectedResult: null,
      actualResult: null,
      labels: [],
      route: { url: "https://example.test/checkout" },
      release: {
        appName: "Checkout",
        appEnvironment: "test",
        appVersion: "1.0.0",
      },
      releaseSignal: null,
      browser: {
        userAgent: "test",
        viewportWidth: 1280,
        viewportHeight: 720,
      },
      reporter: { id: "reporter-1", email: "reporter@example.test", name: "Reporter" },
      subscribers: [],
      requesterNotificationsEnabled: true,
      clientTimestamp: "2026-07-11T12:00:00.000Z",
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
    assignableUsers: [
      { id: "owner-1", name: "Owner", email: "owner@example.test", role: "admin" },
    ],
  };
}

function activityResponse(
  items: FeedbackActivityResponse["items"] = [],
  page = 1,
  total = items.length,
): FeedbackActivityResponse {
  return {
    items,
    pagination: {
      page,
      pageSize: 30,
      total,
      pageCount: Math.max(1, Math.ceil(total / 30)),
      hasMore: page * 30 < total,
    },
  };
}

function strongFeedbackDetail(feedbackId: string, status = "triaged"): FeedbackDetailResponse {
  const detail = feedbackDetail(feedbackId, status);
  detail.feedback.stepsToReproduce = "Open checkout and select Pay now.";
  detail.feedback.actualResult = "The request fails with a visible error.";
  detail.feedback.consoleEntries = [{ level: "error", message: "Payment request failed" }];
  detail.feedback.owner = { id: "owner-1", name: "Owner" };
  return detail;
}

function lifecycleFeedbackDetail(
  lifecycle: NonNullable<FeedbackDetailResponse["feedback"]["engineeringLifecycle"]>,
): FeedbackDetailResponse {
  const detail = strongFeedbackDetail("issue-a");
  detail.feedback.engineeringLifecycle = lifecycle;
  return detail;
}

function overriddenFeedbackDetail(feedbackId: string): FeedbackDetailResponse {
  const detail = feedbackDetail(feedbackId);
  detail.feedback.owner = { id: "owner-1", name: "Owner" };
  detail.feedback.extraContext = {
    evidenceGateOverride: {
      reason: "Production impact requires immediate engineering investigation.",
      evidenceScore: 38,
      missing: ["screenshot", "console-error", "steps", "account", "repro-confidence"],
      createdAt: "2026-07-11T12:05:00.000Z",
    },
  };
  detail.feedback.updatedAt = "2026-07-11T12:05:00.000Z";
  return detail;
}

const engineeringContext: ProjectEngineeringContextResponse = {
  project: { id: "project-1", key: "checkout", name: "Checkout" },
  engineeringContext: {
    repositoryUrl: null,
    defaultBranch: null,
    worktreePath: null,
    installCommand: null,
    testCommand: null,
    buildCommand: null,
    autoFixPolicy: "SUGGEST_ONLY",
    reviewerPolicy: "NONE",
    requesterNotificationPolicy: "EXPLICIT_ONLY",
    notes: null,
    createdAt: null,
    updatedAt: null,
  },
};

function aiCodingTask(prompt = "Fix checkout with focused tests."): FeedbackAiCodingTaskResponse {
  return {
    prompt,
    preview: {
      ticket: {
        number: 101,
        title: "Checkout cannot be completed",
        severity: "medium",
        status: "triaged",
        url: "https://example.test/checkout",
        release: "Checkout / test / 1.0.0",
      },
      repository: {
        url: "https://github.com/example/checkout",
        worktreePath: "/work/checkout",
        defaultBranch: "main",
      },
      filesToInspect: ["apps/web/src/checkout.ts"],
      commands: { test: "npm test -- checkout", build: "npm run build" },
      expectedOutcome: ["Expected: checkout completes"],
      evidenceGaps: ["Screenshot or recording"],
      ownerHints: [{ file: "apps/web/src/checkout.ts", owners: ["@checkout"], pattern: "apps/web/**" }],
      reviewerPolicy: "HUMAN_REVIEW_REQUIRED",
    },
  };
}

function NavigationControl() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div>
      <span data-testid="issue-location">{location.pathname}{location.search}</span>
      <button type="button" onClick={() => navigate("/issues/issue-a")}>
        Open issue A
      </button>
      <button type="button" onClick={() => navigate("/issues/issue-b")}>
        Open issue B
      </button>
    </div>
  );
}

function renderIssue(initialEntry = "/issues/issue-a", prepare?: (client: QueryClient) => void) {
  if (!vi.isMockFunction(api.getFeedbackConversation)) {
    vi.spyOn(api, "getFeedbackConversation").mockResolvedValue({ items: [], pagination: { total: 0, pageSize: 20, nextCursor: null } });
  }
  if (!vi.isMockFunction(api.getFeedbackActivity)) {
    vi.spyOn(api, "getFeedbackActivity").mockResolvedValue(activityResponse());
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);
  prepare?.(queryClient);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <NavigationControl />
        <Routes>
          <Route path="/issues/:feedbackId" element={<IssueDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

async function openIssueSection(user: ReturnType<typeof userEvent.setup>, label: "Technical details" | "Ticket details and engineering" | "Activity history") {
  const summary = await screen.findByText(label, { selector: "summary" });
  if (!summary.closest("details")?.open) await user.click(summary);
}

async function closeIssueSections(user: ReturnType<typeof userEvent.setup>) {
  for (const label of ["Technical details", "Ticket details and engineering", "Activity history"]) {
    const summary = screen.getByText(label, { selector: "summary" });
    if (summary.closest("details")?.open) await user.click(summary);
  }
}

async function revealActivity() {
  const summary = await screen.findByText("Activity history", { selector: "summary" });
  if (!summary.closest("details")?.open) fireEvent.click(summary);
}

async function openTicketWorkflow(user: ReturnType<typeof userEvent.setup>) {
  await openIssueSection(user, "Ticket details and engineering");
}

async function openEngineeringDelivery(user: ReturnType<typeof userEvent.setup>) {
  await openTicketWorkflow(user);
  const disclosure = document.getElementById("issue-engineering-lifecycle-disclosure") as HTMLDetailsElement | null;
  if (disclosure && !disclosure.open) {
    await user.click(screen.getByText("Engineering delivery"));
  }
}

async function openEngineeringTools(user: ReturnType<typeof userEvent.setup>) {
  await openIssueSection(user, "Ticket details and engineering");
}

async function openCustomerUpdate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("radio", { name: "Customer reply" }));
}

function mockReads(strong = false) {
  if (!vi.isMockFunction(api.getFeedbackConversation)) vi.spyOn(api, "getFeedbackConversation").mockResolvedValue({ items: [], pagination: { total: 0, pageSize: 20, nextCursor: null } });
  vi.spyOn(api, "getFeedbackDetail").mockImplementation(async (feedbackId) => (
    strong ? strongFeedbackDetail(feedbackId) : feedbackDetail(feedbackId)
  ));
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("failed screenshot previews recover and do not follow the operator to another issue", async () => {
  const user = userEvent.setup();
  mockReads();
  vi.mocked(api.getFeedbackDetail).mockImplementation(async (id) => {
    const detail = feedbackDetail(id);
    detail.feedback.attachments = [{
      id: `attachment-${id}`, kind: "screenshot", fileName: `${id}.png`, mimeType: "image/png",
      byteSize: 1024, downloadUrl: `https://example.test/${id}.png`, createdAt: detail.feedback.createdAt,
    }];
    return detail;
  });
  renderIssue();
  fireEvent.error(await screen.findByRole("img", { name: "issue-a.png" }));
  expect(screen.getByText("Screenshot preview unavailable")).toBeVisible();
  expect(screen.getByRole("link", { name: "Open original attachment" })).toHaveAttribute("href", "https://example.test/issue-a.png");
  await user.click(screen.getByRole("button", { name: "Retry preview" }));
  expect(screen.getByRole("img", { name: "issue-a.png" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Open full screenshot" })).toHaveFocus();
  fireEvent.error(screen.getByRole("img", { name: "issue-a.png" }));
  await user.click(screen.getByRole("button", { name: "Open issue B" }));
  expect(await screen.findByRole("img", { name: "issue-b.png" })).toBeVisible();
  expect(screen.queryByText("Screenshot preview unavailable")).not.toBeInTheDocument();
  await openIssueSection(user, "Technical details");
  fireEvent.error(screen.getByRole("img", { name: "issue-b.png" }));
  expect(screen.getByText("Screenshot preview unavailable")).toBeVisible();
  expect(screen.getByRole("link", { name: "Open original attachment" })).toHaveAttribute("href", "https://example.test/issue-b.png");
});

test("the ticket presents the report, conversation and a single update form without competing navigation", async () => {
  mockReads();
  renderIssue();
  expect(await screen.findByRole("heading", { name: "Customer’s issue" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Conversation" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Update ticket" })).toBeVisible();
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  for (const name of ["View next action", "Add internal note", "Reply to customer", "Update status", "View conversation (0)"]) {
    expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  }
  expect(screen.getAllByLabelText("Status")).toHaveLength(1);
  expect(screen.getAllByLabelText("New note")).toHaveLength(1);
  for (const id of ["issue-panel-investigate", "issue-management-more", "issue-panel-activity"]) {
    expect(document.getElementById(id)).not.toHaveAttribute("open");
  }
  expect(screen.queryByText("Engineering blocked")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Cancel draft" })).not.toBeInTheDocument();
});

test("technical tools and history open independently while the report and draft remain available", async () => {
  const user = userEvent.setup();
  mockReads();
  renderIssue();
  await user.type(await screen.findByLabelText("New note"), "Investigation in progress.");
  await openIssueSection(user, "Technical details");
  expect(screen.getByText("Engineering blocked")).toBeVisible();
  expect(screen.getByRole("button", { name: copy.detail.askReporter })).toBeVisible();
  await openIssueSection(user, "Ticket details and engineering");
  expect(screen.getByLabelText("Assignee")).toBeVisible();
  await openIssueSection(user, "Activity history");
  expect(screen.getByRole("heading", { name: "Activity" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Customer’s issue" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Conversation" })).toBeVisible();
  expect(screen.getByLabelText("New note")).toHaveValue("Investigation in progress.");
  await closeIssueSections(user);
  expect(screen.getByLabelText("New note")).toHaveValue("Investigation in progress.");
});

test("duplicate merge and unmerge send stale-safe payloads and disclose copied data", async () => {
  const user = userEvent.setup();
  const candidateDetail = feedbackDetail("issue-a");
  candidateDetail.feedback.duplicateCandidates = [{
    feedbackId: "issue-canonical",
    ticketNumber: 88,
    title: "Canonical checkout failure",
    score: 0.92,
  }];
  vi.spyOn(api, "getFeedbackDetail").mockResolvedValue(candidateDetail);
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  const update = vi.spyOn(api, "updateFeedback").mockResolvedValue(candidateDetail);
  renderIssue();

  await openIssueSection(user, "Technical details");
  await user.click(await screen.findByRole("button", { name: copy.detail.markDuplicate }));
  expect(screen.getByText(/missing labels, subscribers, and external links are copied/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: copy.detail.confirmDuplicate }));
  await waitFor(() => expect(update).toHaveBeenCalledWith("issue-a", {
    status: "duplicate",
    duplicateOfId: "issue-canonical",
    expectedUpdatedAt: candidateDetail.feedback.updatedAt,
  }));

  cleanup();
  const duplicateDetail = feedbackDetail("issue-a", "duplicate");
  duplicateDetail.feedback.duplicateOf = {
    id: "issue-canonical",
    ticketNumber: 88,
    title: "Canonical checkout failure",
  };
  vi.mocked(api.getFeedbackDetail).mockResolvedValue(duplicateDetail);
  update.mockResolvedValue(duplicateDetail);
  renderIssue();

  await openIssueSection(user, "Technical details");
  await user.click(await screen.findByRole("button", { name: copy.detail.clearDuplicate }));
  expect(screen.getByText(/Details already copied to the canonical issue remain there/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: copy.detail.confirmClearDuplicate }));
  await waitFor(() => expect(update).toHaveBeenLastCalledWith("issue-a", {
    duplicateOfId: null,
    expectedUpdatedAt: duplicateDetail.feedback.updatedAt,
  }));
});

test("external reference edits use the current issue version", async () => {
  const user = userEvent.setup({ delay: null });
  const detail = feedbackDetail("issue-a");
  vi.spyOn(api, "getFeedbackDetail").mockResolvedValue(detail);
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  const update = vi.spyOn(api, "updateFeedback").mockResolvedValue(detail);
  renderIssue();

  await openIssueSection(user, "Ticket details and engineering");
  await user.click(await screen.findByRole("button", { name: "Add link" }));
  await user.type(screen.getByLabelText("External link label"), "GitHub issue");
  await user.type(screen.getByLabelText("External link URL"), "https://github.com/acme/checkout/issues/42");
  await user.click(screen.getByRole("button", { name: "Save links" }));

  await waitFor(() => expect(update).toHaveBeenCalledWith("issue-a", {
    externalRefs: [{
      provider: "github",
      label: "GitHub issue",
      url: "https://github.com/acme/checkout/issues/42",
    }],
    expectedUpdatedAt: detail.feedback.updatedAt,
  }));
});

test("stale issue edits reload fresh state instead of replaying an obsolete mutation", async () => {
  const user = userEvent.setup();
  const initial = feedbackDetail("issue-a");
  const fresh = feedbackDetail("issue-a");
  fresh.feedback.labels = ["ux"];
  fresh.feedback.updatedAt = "2026-07-11T12:05:00.000Z";
  const reads = vi.spyOn(api, "getFeedbackDetail")
    .mockResolvedValueOnce(initial)
    .mockResolvedValue(fresh);
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  const update = vi.spyOn(api, "updateFeedback").mockRejectedValue(
    new ApiError(409, "This issue changed after it was loaded.", "feedback.stale_update"),
  );
  renderIssue();

  await openIssueSection(user, "Ticket details and engineering");
  const labels = await screen.findByLabelText("Labels");
  await user.type(labels, "bug");
  await user.keyboard("{Enter}");

  expect(await screen.findByText(/changed before this update was saved/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Reload latest issue" }));
  await waitFor(() => expect(reads.mock.calls.length).toBeGreaterThanOrEqual(2));
  expect(update).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByLabelText("Labels")).toHaveValue("ux"));
});

test("failed evidence override stays blocked and retries the exact audited request", async () => {
  const user = userEvent.setup();
  mockReads();
  const override = vi.spyOn(api, "overrideFeedbackEvidenceGate")
    .mockRejectedValueOnce(new Error("override unavailable"))
    .mockResolvedValueOnce(overriddenFeedbackDetail("issue-a"));
  renderIssue();

  await screen.findByText("Issue 101");
  await openIssueSection(user, "Technical details");
  await user.click(screen.getByText("Override with audited reason"));
  await user.type(
    screen.getByLabelText("Why should engineering proceed now?"),
    "Production impact requires immediate engineering investigation.",
  );
  await user.click(screen.getByRole("button", { name: "Record override and proceed" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Engineering is still blocked");
  await openIssueSection(user, "Ticket details and engineering");
  expect(screen.queryByRole("button", { name: "Open AI coding task" })).not.toBeInTheDocument();
  await openEngineeringDelivery(user);
  expect(screen.getByRole("button", { name: "Enter lifecycle details" })).toBeDisabled();
  expect(override).toHaveBeenCalledWith("issue-a", {
    reason: "Production impact requires immediate engineering investigation.",
    expectedUpdatedAt: "2026-07-11T12:00:00.000Z",
  });

  await user.click(screen.getByRole("button", { name: "Retry evidence override" }));

  expect(await screen.findByText("Evidence override recorded for #101. Engineering can proceed.")).toBeVisible();
  await openIssueSection(user, "Technical details");
  expect(screen.getByText("Engineering gate overridden")).toBeVisible();
  await openEngineeringTools(user);
  expect(screen.getByRole("button", { name: "Open AI coding task" })).toBeEnabled();
  await openEngineeringDelivery(user);
  expect(screen.getByRole("button", { name: "Enter lifecycle details" })).toBeEnabled();
  expect(override).toHaveBeenCalledTimes(2);
  expect(override.mock.calls[1]).toEqual(override.mock.calls[0]);
}, 15000);

test("stale evidence override reloads latest evidence instead of retrying stale intent", async () => {
  const user = userEvent.setup();
  const getFeedbackDetail = vi.spyOn(api, "getFeedbackDetail").mockResolvedValue(feedbackDetail("issue-a"));
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  const override = vi.spyOn(api, "overrideFeedbackEvidenceGate").mockRejectedValue(
    new ApiError(409, "This report changed.", "feedback.evidence_override_stale"),
  );
  renderIssue();

  await screen.findByText("Issue 101");
  await openIssueSection(user, "Technical details");
  await user.click(screen.getByText("Override with audited reason"));
  await user.type(
    screen.getByLabelText("Why should engineering proceed now?"),
    "Production impact requires immediate engineering investigation.",
  );
  await user.click(screen.getByRole("button", { name: "Record override and proceed" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("changed while you reviewed its evidence");
  await user.click(screen.getByRole("button", { name: "Reload latest evidence" }));
  await waitFor(() => expect(getFeedbackDetail).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(override).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Why should engineering proceed now?")).toHaveValue(
    "Production impact requires immediate engineering investigation.",
  );
  await openIssueSection(user, "Ticket details and engineering");
  expect(screen.queryByRole("button", { name: "Open AI coding task" })).not.toBeInTheDocument();
});

test("strong evidence opens engineering without an override", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getFeedbackDetail").mockImplementation(async (feedbackId) => strongFeedbackDetail(feedbackId));
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  const createAiCodingTask = vi.spyOn(api, "createAiCodingTask").mockResolvedValue(aiCodingTask("Fix checkout."));
  renderIssue();

  await screen.findByText("Issue 101");
  await openIssueSection(user, "Technical details");
  expect(screen.getByText("Engineering gate open")).toBeVisible();
  await openEngineeringDelivery(user);
  expect(screen.getByRole("button", { name: "Enter lifecycle details" })).toBeEnabled();
  await openEngineeringTools(user);
  await user.click(screen.getByRole("button", { name: "Open AI coding task" }));
  await waitFor(() => expect(createAiCodingTask).toHaveBeenCalledWith("issue-a"));
  expect(await screen.findByText("AI coding task for #101")).toBeVisible();
  expect(screen.getByText("apps/web/src/checkout.ts")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Close preview" }));
  await waitFor(() => expect(screen.queryByText("AI coding task for #101")).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("button", { name: "Open AI coding task" })).toHaveFocus());
  await user.click(screen.getByRole("button", { name: "Open AI coding task" }));
  expect(await screen.findByText("AI coding task for #101")).toBeVisible();
  expect(createAiCodingTask).toHaveBeenCalledTimes(2);
});

test("AI coding task preview names missing engineering context without inventing values", async () => {
  const user = userEvent.setup();
  const task = aiCodingTask();
  task.preview.repository = { url: null, worktreePath: null, defaultBranch: null };
  task.preview.filesToInspect = [];
  task.preview.commands = { test: null, build: null };
  task.preview.ownerHints = [];
  task.preview.evidenceGaps = ["Validated files to inspect", "Repository URL", "Local worktree", "Test command", "Build command"];
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  mockReads(true);
  vi.spyOn(api, "createAiCodingTask").mockResolvedValue(task);
  renderIssue();

  await screen.findByText("Issue 101");
  await openEngineeringTools(user);
  await user.click(screen.getByRole("button", { name: "Open AI coding task" }));

  expect(await screen.findByText("No validated file hints are available.")).toBeVisible();
  expect(screen.getAllByText("Not configured").length).toBeGreaterThanOrEqual(3);
  expect(screen.getByText(/Validated files to inspect · Repository URL/)).toBeVisible();
  expect(screen.getByText("No validated owner mapping matches the current file hints.")).toBeVisible();
  expect(writeText).not.toHaveBeenCalled();
});

test("a customer reply and status save together and retry the exact intent without a second private note", async () => {
  const user = userEvent.setup();
  mockReads(true);
  const addComment = vi.spyOn(api, "addComment").mockResolvedValue({ comment: {} });
  const updateFeedback = vi.spyOn(api, "updateFeedback")
    .mockRejectedValueOnce(new Error("status unavailable"))
    .mockResolvedValueOnce(feedbackDetail("issue-a", "closed"));
  renderIssue();
  await screen.findByText("Issue 101");
  await openCustomerUpdate(user);
  await user.selectOptions(screen.getByLabelText("Status"), "closed");
  expect(screen.getByRole("button", { name: "Save status and send reply" })).toBeDisabled();
  await user.type(screen.getByLabelText("Reporter-visible message"), "The checkout fix is live.");
  await user.click(screen.getByRole("button", { name: "Save status and send reply" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't finish the customer reply and status change for #101.");
  expect(screen.getByLabelText("Reporter-visible message")).toHaveValue("The checkout fix is live.");
  expect(addComment).not.toHaveBeenCalled();
  expect(updateFeedback).toHaveBeenCalledWith("issue-a", expect.objectContaining({
    status: "closed", expectedUpdatedAt: feedbackDetail("issue-a").feedback.updatedAt,
    notifyRequester: true, publicSummary: "The checkout fix is live.",
    statusNote: { body: "The checkout fix is live.", visibility: "public", clientRequestId: expect.any(String) },
  }));
  await user.click(screen.getByRole("button", { name: "Retry saving customer reply and status change" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Customer reply and status change saved for #101.");
  expect(addComment).not.toHaveBeenCalled();
  expect(updateFeedback).toHaveBeenCalledTimes(2);
  expect(updateFeedback.mock.calls[1]).toEqual(updateFeedback.mock.calls[0]);
  expect(screen.getByLabelText("Reporter-visible message")).toHaveValue("");
});

test("requester send names recipients and retries the exact public intent", async () => {
  const user = userEvent.setup();
  mockReads();
  const addComment = vi.spyOn(api, "addComment")
    .mockRejectedValueOnce(new Error("delivery unavailable"))
    .mockResolvedValueOnce({ comment: {} });
  renderIssue();

  await screen.findByText("Issue 101");
  await openCustomerUpdate(user);
  expect(document.getElementById("issue-requester-message")).toHaveTextContent("Send customer reply");
  expect(document.getElementById("issue-requester-message")).toHaveTextContent("reporter@example.test");
  await user.type(screen.getByLabelText("Reporter-visible message"), "Can you confirm the last button you selected?");
  await user.click(screen.getByRole("button", { name: "Send customer reply" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't send the reporter update for #101.");
  expect(screen.getByLabelText("Reporter-visible message")).toHaveValue("Can you confirm the last button you selected?");
  expect(addComment).toHaveBeenCalledWith("issue-a", expect.objectContaining({
    body: "Can you confirm the last button you selected?",
    visibility: "public",
    notifyRequester: true,
    publicSummary: "Can you confirm the last button you selected?",
    deliveryTarget: "requester_and_subscribers",
    clientRequestId: expect.any(String),
  }));

  await user.click(screen.getByRole("button", { name: "Retry sending reporter update" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Customer reply saved for #101. Check the delivery result below.");
  expect(addComment).toHaveBeenCalledTimes(2);
  expect(addComment.mock.calls[1]).toEqual(addComment.mock.calls[0]);
  expect(screen.getByLabelText("Reporter-visible message")).toHaveValue("");
});

test("missing recipients disable the customer reply choice while keeping private notes available", async () => {
  const user = userEvent.setup();
  const detail = feedbackDetail("issue-a");
  detail.feedback.reporter = { id: null, email: null, name: null };
  detail.feedback.requesterNotificationsEnabled = false;
  vi.spyOn(api, "getFeedbackDetail").mockResolvedValue(detail);
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  const addComment = vi.spyOn(api, "addComment").mockResolvedValue({ comment: {} });
  renderIssue();

  await screen.findByText("Issue 101");
  expect(screen.getByRole("radio", { name: "Customer reply" })).toBeDisabled();
  expect(screen.getByText("Add a customer email to enable replies.")).toBeVisible();
  await openCustomerUpdate(user);
  expect(screen.getByRole("radio", { name: "Internal note" })).toBeChecked();
  expect(screen.queryByLabelText("Reporter-visible message")).not.toBeInTheDocument();
  expect(screen.getByText("Recipients")).toBeVisible();
  expect(addComment).not.toHaveBeenCalled();

  await user.click(screen.getByRole("radio", { name: "Internal note" }));
  await user.type(screen.getByLabelText("New note"), "Private investigation detail");
  await user.click(screen.getByRole("button", { name: "Save internal note" }));
  await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));
  expect(addComment).toHaveBeenCalledWith("issue-a", expect.objectContaining({
    visibility: "internal",
    notifyRequester: false,
  }));
});

test.each([false, true])("adding a customer opens and focuses the recipient form and enables the required reply (internal follower: %s)", async (internalFollower) => {
  const user = userEvent.setup();
  mockReads(true);
  const detail = strongFeedbackDetail("issue-a");
  detail.feedback.reporter = { id: null, email: null, name: null };
  const recipient = {
    id: "customer-1", email: "customer@example.test", recipientType: "external_subscriber", isActive: true,
    notifyOnStatusChange: true, notifyOnTriage: false, addedBy: null,
    createdAt: detail.feedback.createdAt, updatedAt: detail.feedback.updatedAt,
  };
  if (internalFollower) detail.feedback.subscribers = [{ ...recipient, id: "staff-1", email: "staff@example.test", recipientType: "internal_subscriber" }];
  vi.mocked(api.getFeedbackDetail).mockResolvedValue(detail);
  const saved = { ...detail, feedback: { ...detail.feedback, subscribers: [...detail.feedback.subscribers, recipient] } };
  const addRecipient = vi.spyOn(api, "addFeedbackSubscriber").mockResolvedValue(saved);
  const update = vi.spyOn(api, "updateFeedback").mockResolvedValue(saved);
  const addComment = vi.spyOn(api, "addComment").mockResolvedValue({ comment: {} });
  renderIssue();

  await user.type(await screen.findByLabelText("New note"), "Private investigation detail.");
  await user.selectOptions(screen.getByLabelText("Status"), "blocked");
  const customerReply = screen.getByRole("radio", { name: "Customer reply" });
  expect(customerReply).toBeDisabled();
  expect(customerReply).toHaveAccessibleDescription(/Add a customer email to enable replies/);
  await user.click(within(screen.getByText("Add a customer email to enable replies.")).getByRole("button", { name: "Add recipient", exact: true }));
  const form = await screen.findByRole("group", { name: "Add recipient" });
  const email = within(form).getByRole("textbox", { name: "Email" });
  await waitFor(() => expect(email).toHaveFocus());
  expect(form).toBeVisible();
  expect(within(form).getByLabelText("Recipient type")).toHaveValue("external_subscriber");
  expect(within(form).getByLabelText("Receive status updates")).toBeChecked();
  await user.type(email, "customer@example.test");
  vi.mocked(api.getFeedbackDetail).mockResolvedValue(saved);
  await user.click(within(form).getByRole("button", { name: "Add recipient" }));
  await waitFor(() => expect(customerReply).toBeEnabled());
  expect(customerReply).toBeChecked();
  expect(screen.getByLabelText("Reporter-visible message")).toHaveValue("");
  expect(addRecipient).toHaveBeenCalledWith("issue-a", expect.objectContaining({
    email: "customer@example.test", recipientType: "external_subscriber", notifyOnStatusChange: true,
  }));
  await user.selectOptions(screen.getByLabelText("Status"), "triaged");
  expect(screen.getByLabelText("New note")).toHaveValue("Private investigation detail.");
  expect(update).not.toHaveBeenCalled();
  expect(addComment).not.toHaveBeenCalled();
});

test("requester send lock and route ownership block duplicate and stale callbacks", async () => {
  const user = userEvent.setup();
  const oldSend = deferred<{ comment: unknown }>();
  mockReads();
  const addComment = vi.spyOn(api, "addComment")
    .mockImplementationOnce(() => oldSend.promise)
    .mockResolvedValueOnce({ comment: {} });
  renderIssue();

  await screen.findByText("Issue 101");
  await openCustomerUpdate(user);
  await user.type(screen.getByLabelText("Reporter-visible message"), "Issue A requester update");
  const send = screen.getByRole("button", { name: "Send customer reply" });
  fireEvent.click(send);
  fireEvent.click(send);
  await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));

  await user.click(screen.getByRole("button", { name: "Open issue B" }));
  await screen.findByText("Issue 202");
  await openCustomerUpdate(user);
  await user.type(screen.getByLabelText("Reporter-visible message"), "Issue B requester update");
  await act(async () => {
    oldSend.resolve({ comment: {} });
    await oldSend.promise;
  });
  expect(screen.getByLabelText("Reporter-visible message")).toHaveValue("Issue B requester update");
  expect(screen.queryByText(/sent for #101/i)).not.toBeInTheDocument();
});

test("route change resets recovery and prevents an old issue callback from clearing the new issue draft", async () => {
  const user = userEvent.setup();
  const oldWrite = deferred<{ comment: unknown }>();
  mockReads();
  const addComment = vi.spyOn(api, "addComment")
    .mockImplementationOnce(() => oldWrite.promise)
    .mockResolvedValueOnce({ comment: {} });
  renderIssue();

  await screen.findByText("Issue 101");
  await openIssueSection(user, "Ticket details and engineering");
  await user.type(screen.getByLabelText("New note"), "Old issue note");
  await user.click(screen.getByRole("button", { name: "Save internal note" }));
  await user.click(screen.getByRole("button", { name: "Open issue B" }));

  await screen.findByText("Issue 202");
  await user.click(screen.getByRole("radio", { name: "Internal note" }));
  expect(screen.getByLabelText("New note")).toHaveValue("");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("New note"), "New issue draft");

  await act(async () => {
    oldWrite.resolve({ comment: {} });
    await oldWrite.promise;
  });

  expect(screen.getByLabelText("New note")).toHaveValue("New issue draft");
  expect(screen.queryByText(/saved for #101/i)).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Save internal note" }));
  await waitFor(() => expect(addComment).toHaveBeenCalledTimes(2));
  expect(addComment.mock.calls[0]?.[0]).toBe("issue-a");
  expect(addComment.mock.calls[1]?.[0]).toBe("issue-b");
});

test("a stale optimistic rollback cannot overwrite newer issue A data after an A-to-B-to-A route change", async () => {
  const user = userEvent.setup();
  const oldWrite = deferred<FeedbackDetailResponse>();
  const newWrite = deferred<FeedbackDetailResponse>();
  mockReads();
  const updateFeedback = vi.spyOn(api, "updateFeedback")
    .mockImplementationOnce(() => oldWrite.promise)
    .mockImplementationOnce(() => newWrite.promise);
  const queryClient = renderIssue();
  vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

  await screen.findByText("Issue 101");
  await openIssueSection(user, "Ticket details and engineering");
  fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "high" } });
  await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(1));

  await user.click(screen.getByRole("button", { name: "Open issue B" }));
  await screen.findByText("Issue 202");
  await user.click(screen.getByRole("button", { name: "Open issue A" }));
  await screen.findByText("Issue 101");

  await openIssueSection(user, "Ticket details and engineering");
  fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "low" } });
  await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(2));

  await act(async () => {
    newWrite.resolve(feedbackDetail("issue-a"));
    await screen.findByRole("status");
  });
  expect(queryClient.getQueryData<FeedbackDetailResponse>(["feedback-detail", "issue-a"])?.feedback.severity).toBe("low");

  await act(async () => {
    oldWrite.reject(new Error("old issue A write failed"));
    await waitFor(() => expect(queryClient.getQueryData<FeedbackDetailResponse>(["feedback-detail", "issue-a"])?.feedback.severity).toBe("low"));
  });
  expect(queryClient.getQueryData<FeedbackDetailResponse>(["feedback-detail", "issue-a"])?.feedback.severity).toBe("low");
});

test("the synchronous mutex blocks a sibling mutation before pending state rerenders", async () => {
  const user = userEvent.setup();
  mockReads(true);
  const updateWrite = deferred<FeedbackDetailResponse>();
  const updateFeedback = vi.spyOn(api, "updateFeedback").mockImplementation(() => updateWrite.promise);
  const createAiCodingTask = vi.spyOn(api, "createAiCodingTask").mockResolvedValue(aiCodingTask("Fix it"));
  renderIssue();

  await screen.findByText("Issue 101");
  await openTicketWorkflow(user);
  act(() => {
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "Enter lifecycle details" }));
  });

  await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(1));
  expect(updateFeedback.mock.calls[0]?.[0]).toBe("issue-a");
  expect(createAiCodingTask).not.toHaveBeenCalled();

  await act(async () => {
    updateWrite.resolve(feedbackDetail("issue-a"));
    await updateWrite.promise;
  });
});

test("AI prompt, reporter draft, note, and lifecycle actions name their actual result", async () => {
  const user = userEvent.setup();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  const aiPrompt = deferred<FeedbackAiCodingTaskResponse>();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  mockReads(true);
  vi.spyOn(api, "createAiCodingTask").mockReturnValue(aiPrompt.promise);
  renderIssue();

  await screen.findByText("Issue 101");
  await openEngineeringTools(user);
  const promptButton = screen.getByRole("button", { name: "Open AI coding task" });
  await user.click(promptButton);
  expect(screen.getByRole("button", { name: "Preparing prompt..." })).toBeDisabled();

  await act(async () => {
    aiPrompt.resolve(aiCodingTask());
    await aiPrompt.promise;
  });
  expect(await screen.findByText("AI coding task for #101")).toBeVisible();
  expect(writeText).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Copy prompt" }));
  expect(await screen.findByRole("button", { name: "Prompt copied" })).toBeVisible();
  expect(writeText).toHaveBeenCalledWith("Fix checkout with focused tests.");

  await openIssueSection(user, "Technical details");
  await user.click(screen.getByRole("button", { name: copy.detail.askReporter }));
  expect(screen.getByLabelText("Reporter-visible message")).not.toHaveValue("");
  expect(screen.getByRole("button", { name: "Send customer reply" })).toBeVisible();
  await user.click(screen.getByRole("radio", { name: "Internal note" }));
  expect(screen.getByLabelText("New note")).toHaveValue("");

  await openEngineeringDelivery(user);
  await user.click(screen.getByRole("button", { name: "Enter lifecycle details" }));
  await waitFor(() => expect(screen.getByLabelText("Lifecycle branch name")).toHaveFocus());
  expect(screen.getByRole("button", { name: "Save lifecycle details" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove lifecycle details" })).toBeVisible();
});

test("engineering lifecycle renders every stage without inventing provider truth", async () => {
  const detail = lifecycleFeedbackDetail({
    branchName: "codex/fix-checkout",
    branchUrl: "https://github.com/example/storefront/tree/codex/fix-checkout",
    pullRequestUrl: "https://github.com/example/storefront/pull/42",
    deployUrl: "https://deploy.example.test/releases/42",
    verificationState: "deployed",
    closingOutcome: null,
  });
  vi.spyOn(api, "getFeedbackDetail").mockResolvedValue(detail);
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  renderIssue();

  const user = userEvent.setup();
  await openEngineeringDelivery(user);
  const timeline = screen.getByRole("list", { name: "Engineering lifecycle timeline" });
  expect(timeline.querySelectorAll(":scope > li")).toHaveLength(9);
  expect([...timeline.querySelectorAll(":scope > li")].map((step) => step.textContent)).toEqual(expect.arrayContaining([
    expect.stringContaining("BranchLinked"),
    expect.stringContaining("PRLinked"),
    expect.stringContaining("ChecksManual"),
    expect.stringContaining("ReviewManual"),
    expect.stringContaining("MergeManual"),
    expect.stringContaining("DeployLinked"),
    expect.stringContaining("VerifyCurrent"),
    expect.stringContaining("NotifyNot started"),
    expect.stringContaining("CloseNot started"),
  ]));
  expect(screen.getByRole("link", { name: "Open branch on github.com in a new tab" })).toHaveAttribute("target", "_blank");
  expect(screen.getByRole("link", { name: "Open pull request on github.com in a new tab" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Open deployment on deploy.example.test in a new tab" })).toBeVisible();
  expect(timeline).toHaveTextContent("No provider check status ingested");
  expect(timeline).toHaveTextContent("No provider review status ingested");
  expect(timeline).toHaveTextContent("No provider merge status ingested");
});

test("engineering lifecycle renders durable GitHub observations separately from manual records", async () => {
  const detail = lifecycleFeedbackDetail({
    branchName: "codex/fix-checkout",
    branchUrl: "https://github.com/example/storefront/tree/codex/fix-checkout",
    pullRequestUrl: "https://github.com/example/storefront/pull/42",
    deployUrl: null,
    verificationState: "blocked",
    closingOutcome: null,
  });
  detail.feedback.engineeringLifecycleHistory = [
    {
      id: "transition-1",
      provider: "github",
      source: "provider",
      stage: "check",
      state: "failure",
      externalId: "check-1",
      externalUrl: "https://github.com/example/storefront/actions/runs/1",
      label: "CI failed",
      details: { checkName: "CI" },
      observedAt: "2026-07-15T12:02:00.000Z",
      createdAt: "2026-07-15T12:02:01.000Z",
    },
    {
      id: "transition-2",
      provider: "manual",
      source: "manual",
      stage: "manual",
      state: "recorded",
      externalId: null,
      externalUrl: null,
      label: null,
      details: null,
      observedAt: "2026-07-15T12:03:00.000Z",
      createdAt: "2026-07-15T12:03:00.000Z",
    },
  ];
  vi.spyOn(api, "getFeedbackDetail").mockResolvedValue(detail);
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  renderIssue();

  await screen.findByText("Issue 101");
  const user = userEvent.setup();
  await openEngineeringDelivery(user);
  expect(document.getElementById("issue-lifecycle-step-checks")).toHaveAttribute("data-lifecycle-state", "failed");
  expect(document.getElementById("issue-lifecycle-step-checks")).toHaveTextContent("GitHub · failure");
  expect(document.getElementById("issue-lifecycle-step-checks")).toHaveTextContent("CI failed");
  const history = screen.getByRole("list", { name: "Engineering lifecycle transition history" });
  expect(history).toHaveTextContent("GitHub observed");
  expect(history).toHaveTextContent("Manual");
});

test("blocked verification is explicit while unknown stages remain manual or not started", async () => {
  const detail = lifecycleFeedbackDetail({
    branchName: "codex/fix-checkout",
    branchUrl: null,
    pullRequestUrl: "https://github.com/example/storefront/pull/42",
    deployUrl: "https://deploy.example.test/releases/42",
    verificationState: "blocked",
    closingOutcome: null,
  });
  vi.spyOn(api, "getFeedbackDetail").mockResolvedValue(detail);
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  renderIssue();

  const user = userEvent.setup();
  await screen.findByText("Issue 101");
  await openIssueSection(user, "Ticket details and engineering");
  expect(document.getElementById("issue-lifecycle-step-verify")).toHaveAttribute("data-lifecycle-state", "failed");
  expect(document.getElementById("issue-lifecycle-step-verify")).toHaveTextContent("Verification is blocked or failed");
  expect(document.getElementById("issue-lifecycle-step-checks")).toHaveAttribute("data-lifecycle-state", "manual");
  expect(document.getElementById("issue-lifecycle-step-notify")).toHaveAttribute("data-lifecycle-state", "not-started");
  expect(document.getElementById("issue-lifecycle-step-close")).toHaveAttribute("data-lifecycle-state", "not-started");
});

test("a recorded deployment does not regress to not started when its provider link is absent", async () => {
  const detail = lifecycleFeedbackDetail({
    branchName: "codex/fix-checkout",
    branchUrl: null,
    pullRequestUrl: null,
    deployUrl: null,
    verificationState: "deployed",
    closingOutcome: null,
  });
  vi.spyOn(api, "getFeedbackDetail").mockResolvedValue(detail);
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  renderIssue();

  const user = userEvent.setup();
  await screen.findByText("Issue 101");
  await openIssueSection(user, "Ticket details and engineering");
  expect(document.getElementById("issue-lifecycle-step-deploy")).toHaveAttribute("data-lifecycle-state", "manual");
  expect(document.getElementById("issue-lifecycle-step-deploy")).toHaveTextContent("Recorded");
  expect(document.getElementById("issue-lifecycle-step-deploy")).toHaveTextContent("Deployment recorded without a provider link");
  expect(document.getElementById("issue-lifecycle-step-verify")).toHaveAttribute("data-lifecycle-state", "current");
});

test("unified activity orders durable sources once with actor provenance and private visibility", async () => {
  mockReads();
  vi.spyOn(api, "getFeedbackActivity").mockResolvedValue(activityResponse([
    {
      id: "notification-failed",
      kind: "notification",
      occurredAt: "2026-07-15T14:06:00.000Z",
      actor: { label: "TraceGenie delivery", type: "system" },
      provenance: "Requester delivery",
      title: "Status Change Requester · Failed",
      summary: null,
      outcome: "failed",
      visibility: "system",
      safeDetails: ["Attempt 2"],
      retry: { notificationId: "notification-7", label: "Retry delivery" },
    },
    {
      id: "lifecycle-check",
      kind: "lifecycle",
      occurredAt: "2026-07-15T14:04:00.000Z",
      actor: { label: "GitHub", type: "provider" },
      provenance: "GitHub observed",
      title: "Check · Success",
      summary: "CI passed",
      outcome: "success",
      visibility: "system",
      safeDetails: [],
      retry: null,
    },
    {
      id: "note-private",
      kind: "note",
      occurredAt: "2026-07-15T14:02:00.000Z",
      actor: { label: "Avery Chen", type: "admin" },
      provenance: "Private internal note",
      title: "Internal note added",
      summary: "Rollback is ready if verification fails.",
      outcome: "neutral",
      visibility: "internal",
      safeDetails: [],
      retry: null,
    },
  ]));
  const replay = vi.spyOn(api, "replayNotification").mockResolvedValue({ notification: { id: "notification-7", status: "pending" } });
  renderIssue();

  await screen.findByText("Issue 101");
  await revealActivity();
  const chronology = await screen.findByRole("list", { name: "Issue activity chronology" });
  const entries = [...chronology.querySelectorAll(":scope > li")];
  expect(entries.map((entry) => entry.getAttribute("data-activity-kind"))).toEqual(["notification", "lifecycle", "note"]);
  expect(chronology).toHaveTextContent("TraceGenie delivery · Requester delivery");
  expect(chronology).toHaveTextContent("GitHub · GitHub observed");
  expect(chronology).toHaveTextContent("Private");
  expect(chronology).not.toHaveTextContent("reporter@example.test");
  expect(chronology).not.toHaveTextContent("provider-token");

  await userEvent.click(screen.getByRole("button", { name: "Retry delivery" }));
  await waitFor(() => expect(replay).toHaveBeenCalledWith("notification-7"));
});

test("unified activity loads bounded older pages without duplicating the chronology", async () => {
  mockReads();
  const event = (id: string, occurredAt: string): FeedbackActivityResponse["items"][number] => ({
    id,
    kind: "audit",
    occurredAt,
    actor: { label: "TraceGenie", type: "system" },
    provenance: "TraceGenie audit",
    title: `Audit ${id}`,
    summary: null,
    outcome: "neutral",
    visibility: "system",
    safeDetails: [],
    retry: null,
  });
  vi.spyOn(api, "getFeedbackActivity")
    .mockResolvedValueOnce(activityResponse([event("newest", "2026-07-15T14:00:00.000Z")], 1, 31))
    .mockResolvedValueOnce(activityResponse([event("oldest", "2026-07-14T14:00:00.000Z")], 2, 31));
  renderIssue();

  await screen.findByText("Issue 101");
  await revealActivity();
  await screen.findByText("Audit newest");
  const loadOlder = screen.getByRole("button", { name: "Load older activity (1 of 31)" });
  loadOlder.focus();
  await userEvent.keyboard("{Enter}");
  await screen.findByText("Audit oldest");
  const chronology = screen.getByRole("list", { name: "Issue activity chronology" });
  expect(chronology.querySelectorAll(":scope > li")).toHaveLength(2);
  expect(screen.getByText("All 31 recorded events shown.")).toBeVisible();
});

test("unified activity has truthful isolated recovery without hiding the issue", async () => {
  mockReads();
  vi.spyOn(api, "getFeedbackActivity")
    .mockRejectedValueOnce(new ApiError(503, "activity.unavailable", "Activity unavailable"))
    .mockResolvedValueOnce(activityResponse());
  renderIssue();

  await screen.findByText("Issue 101");
  expect(screen.getByText("Checkout cannot be completed.")).toBeVisible();
  await revealActivity();
  expect(await screen.findByRole("alert")).toHaveTextContent("Activity could not be loaded");
  await userEvent.click(screen.getByRole("button", { name: "Retry activity" }));
  expect(await screen.findByText("No activity recorded yet.")).toBeVisible();
});

test("unified activity preserves loaded chronology when a refresh fails", async () => {
  mockReads();
  const failedDelivery: FeedbackActivityResponse["items"][number] = {
    id: "notification-stale",
    kind: "notification",
    occurredAt: "2026-07-15T14:06:00.000Z",
    actor: { label: "TraceGenie delivery", type: "system" },
    provenance: "Requester delivery",
    title: "Status Change Requester · Failed",
    summary: null,
    outcome: "failed",
    visibility: "system",
    safeDetails: ["Attempt 2"],
    retry: { notificationId: "notification-stale", label: "Retry delivery" },
  };
  const getActivity = vi.spyOn(api, "getFeedbackActivity")
    .mockResolvedValueOnce(activityResponse([failedDelivery]))
    .mockRejectedValueOnce(new ApiError(503, "activity.unavailable", "Activity unavailable"));
  vi.spyOn(api, "replayNotification").mockResolvedValue({
    notification: { id: "notification-stale", status: "pending" },
  });
  renderIssue();

  await screen.findByText("Issue 101");
  await revealActivity();
  await screen.findByText("Status Change Requester · Failed");
  await userEvent.click(screen.getByRole("button", { name: "Retry delivery" }));
  await waitFor(() => expect(getActivity).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole("alert")).toHaveTextContent("Activity could not be refreshed");
  expect(screen.getByText("Status Change Requester · Failed")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry activity refresh" })).toBeVisible();
});

test("lifecycle editor preserves exact intent through failure and retry", async () => {
  const user = userEvent.setup();
  mockReads(true);
  const saved = lifecycleFeedbackDetail({
    branchName: "codex/fix-checkout",
    branchUrl: "https://github.com/example/storefront/tree/codex/fix-checkout",
    pullRequestUrl: null,
    deployUrl: null,
    verificationState: "in_progress",
    closingOutcome: null,
  });
  const updateFeedback = vi.spyOn(api, "updateFeedback")
    .mockRejectedValueOnce(new Error("lifecycle unavailable"))
    .mockResolvedValueOnce(saved);
  renderIssue();

  await screen.findByText("Issue 101");
  await openEngineeringDelivery(user);
  await user.click(screen.getByRole("button", { name: "Enter lifecycle details" }));
  await user.type(screen.getByLabelText("Lifecycle branch name"), "codex/fix-checkout");
  await user.type(screen.getByLabelText("Lifecycle branch URL"), "https://github.com/example/storefront/tree/codex/fix-checkout");
  await user.selectOptions(screen.getByLabelText("Lifecycle verification state"), "in_progress");
  await user.click(screen.getByRole("button", { name: "Save lifecycle details" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the engineering lifecycle for #101.");
  expect(screen.getByLabelText("Lifecycle branch name")).toHaveValue("codex/fix-checkout");
  expect(screen.getByLabelText("Lifecycle branch URL")).toHaveValue("https://github.com/example/storefront/tree/codex/fix-checkout");
  await user.click(screen.getByRole("button", { name: "Retry saving engineering lifecycle" }));

  expect(await screen.findByText("Engineering lifecycle saved for #101.")).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "Enter lifecycle details" })).toHaveFocus());
  expect(updateFeedback).toHaveBeenCalledTimes(2);
  expect(updateFeedback.mock.calls[1]).toEqual(updateFeedback.mock.calls[0]);
});

test("AI prompt failure offers a truthful retry", async () => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn() } });
  mockReads(true);
  vi.spyOn(api, "createAiCodingTask").mockRejectedValue(new Error("prompt unavailable"));
  renderIssue();

  await screen.findByText("Issue 101");
  await openEngineeringTools(user);
  await user.click(screen.getByRole("button", { name: "Open AI coding task" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't prepare the AI coding task for #101.");
  expect(screen.getByRole("button", { name: "Retry opening AI coding task" })).toBeVisible();
});

test("AI clipboard retry reuses the prepared prompt instead of generating another", async () => {
  const user = userEvent.setup();
  const writeText = vi.fn()
    .mockRejectedValueOnce(new Error("clipboard denied"))
    .mockResolvedValueOnce(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  mockReads(true);
  const createAiCodingTask = vi.spyOn(api, "createAiCodingTask").mockResolvedValue(aiCodingTask("Use the retained prompt."));
  renderIssue();

  await screen.findByText("Issue 101");
  await openEngineeringTools(user);
  await user.click(screen.getByRole("button", { name: "Open AI coding task" }));
  await screen.findByText("AI coding task for #101");
  await user.click(screen.getByRole("button", { name: "Copy prompt" }));
  expect(await screen.findByText(/could not be copied/i)).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Copy prompt" }));

  expect(await screen.findByRole("button", { name: "Prompt copied" })).toBeVisible();
  expect(createAiCodingTask).toHaveBeenCalledTimes(1);
  expect(writeText).toHaveBeenCalledTimes(2);
  expect(writeText).toHaveBeenNthCalledWith(2, "Use the retained prompt.");
});

test("closing an AI coding task discards the cached prompt before reopening", async () => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn() } });
  mockReads(true);
  const createAiCodingTask = vi.spyOn(api, "createAiCodingTask")
    .mockResolvedValueOnce(aiCodingTask("First evidence snapshot."))
    .mockResolvedValueOnce(aiCodingTask("Fresh evidence snapshot."));
  renderIssue();

  await screen.findByText("Issue 101");
  await openEngineeringTools(user);
  await user.click(screen.getByRole("button", { name: "Open AI coding task" }));
  await screen.findByText("AI coding task for #101");
  await user.click(screen.getByRole("button", { name: "Close preview" }));
  await user.click(screen.getByRole("button", { name: "Open AI coding task" }));
  await screen.findByText("AI coding task for #101");
  await user.click(screen.getByRole("button", { name: "Copy prompt" }));

  expect(createAiCodingTask).toHaveBeenCalledTimes(2);
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Fresh evidence snapshot.");
});

test("lifecycle removal recovery names removal in pending, failure, retry, and success states", async () => {
  const user = userEvent.setup();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  mockReads(true);
  const updateFeedback = vi.spyOn(api, "updateFeedback")
    .mockRejectedValueOnce(new Error("remove unavailable"))
    .mockResolvedValueOnce(feedbackDetail("issue-a"));
  renderIssue();

  await screen.findByText("Issue 101");
  await openEngineeringDelivery(user);
  await user.click(screen.getByRole("button", { name: "Enter lifecycle details" }));
  await user.click(screen.getByRole("button", { name: "Remove lifecycle details" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't remove the engineering lifecycle details for #101.",
  );
  await user.click(screen.getByRole("button", { name: "Retry removing lifecycle details" }));

  expect(await screen.findByText("Engineering lifecycle details removed for #101.")).toBeVisible();
  expect(updateFeedback).toHaveBeenCalledTimes(2);
  expect(updateFeedback.mock.calls[1]).toEqual(updateFeedback.mock.calls[0]);
});

test("copy summary blocks duplicates and retries the exact prepared payload", async () => {
  const user = userEvent.setup();
  const firstWrite = deferred<void>();
  const writeText = vi.fn()
    .mockImplementationOnce(() => firstWrite.promise)
    .mockResolvedValueOnce(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  mockReads();
  const queryClient = renderIssue();

  await screen.findByText("Issue 101");
  const copySummaryButton = screen.getByRole("button", { name: "Copy summary" });
  act(() => {
    fireEvent.click(copySummaryButton);
    fireEvent.click(copySummaryButton);
  });

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "Copying summary..." })).toBeDisabled();

  await act(async () => {
    firstWrite.reject(new Error("clipboard denied"));
    await firstWrite.promise.catch(() => undefined);
  });

  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't copy the issue summary for #101.");
  expect(screen.getByRole("alert")).not.toHaveTextContent("Your previous input is unchanged.");
  queryClient.setQueryData<FeedbackDetailResponse>(["feedback-detail", "issue-a"], (current) => current
    ? {
        ...current,
        feedback: {
          ...current.feedback,
          title: "Issue 101 changed after copy failed",
          description: "Changed cache description.",
        },
      }
    : current);
  expect(await screen.findByText("Issue 101 changed after copy failed")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Retry copying summary" }));

  expect(await screen.findByRole("button", { name: "Summary copied" })).toHaveAttribute("data-copied", "true");
  expect(screen.queryByRole("button", { name: "Retry copying summary" })).not.toBeInTheDocument();
  expect(writeText).toHaveBeenCalledTimes(2);
  expect(writeText.mock.calls[1]).toEqual(writeText.mock.calls[0]);
  expect(writeText.mock.calls[1]?.[0]).toContain("#101 Issue 101");
  expect(writeText.mock.calls[1]?.[0]).not.toContain("changed after copy failed");
});

test("a stale copy summary completion cannot update the next ticket", async () => {
  const user = userEvent.setup();
  const oldWrite = deferred<void>();
  const writeText = vi.fn()
    .mockImplementationOnce(() => oldWrite.promise)
    .mockResolvedValueOnce(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  mockReads();
  renderIssue();

  await screen.findByText("Issue 101");
  await user.click(screen.getByRole("button", { name: "Copy summary" }));
  await user.click(screen.getByRole("button", { name: "Open issue B" }));
  await screen.findByText("Issue 202");

  await act(async () => {
    oldWrite.resolve();
    await oldWrite.promise;
  });

  expect(screen.getByRole("button", { name: "Copy summary" })).toHaveAttribute("data-copied", "false");
  expect(screen.queryByText("Summary copied.")).not.toBeInTheDocument();
  expect(document.querySelector('[data-toast-scope="issue:issue-a:copy-summary"]')).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Copy summary" }));
  expect(await screen.findByRole("button", { name: "Summary copied" })).toBeVisible();
  expect(writeText).toHaveBeenCalledTimes(2);
  expect(writeText.mock.calls[1]?.[0]).toContain("#202 Issue 202");
});

test("copy and reporter-question toasts coexist with stable issue action scopes", async () => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  mockReads();
  renderIssue();

  await screen.findByText("Issue 101");
  await user.click(screen.getByRole("button", { name: "Copy summary" }));
  await screen.findByText("Summary copied.");
  await openIssueSection(user, "Ticket details and engineering");
  await openIssueSection(user, "Technical details");
  await user.click(screen.getByRole("button", { name: copy.detail.askReporter }));

  expect(document.querySelector('[data-toast-scope="issue:issue-a:copy-summary"]'))
    .toHaveTextContent("Summary copied.");
  expect(document.querySelector('[data-toast-scope="issue:issue-a:reporter-question"]'))
    .toHaveAttribute("role", "status");
});

test("a stale copy summary rejection cannot leak recovery into the next ticket", async () => {
  const user = userEvent.setup();
  const oldWrite = deferred<void>();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockImplementationOnce(() => oldWrite.promise) },
  });
  mockReads();
  renderIssue();

  await screen.findByText("Issue 101");
  await user.click(screen.getByRole("button", { name: "Copy summary" }));
  await user.click(screen.getByRole("button", { name: "Open issue B" }));
  await screen.findByText("Issue 202");

  await act(async () => {
    oldWrite.reject(new Error("clipboard denied"));
    await oldWrite.promise.catch(() => undefined);
  });

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Retry copying summary" })).not.toBeInTheDocument();
  expect(screen.queryByText(/#101/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy summary" })).toHaveAttribute("data-copied", "false");
});

test("an invalidation failure cannot make a successful write retryable", async () => {
  const user = userEvent.setup();
  mockReads();
  const addComment = vi.spyOn(api, "addComment").mockResolvedValue({ comment: {} });
  const queryClient = renderIssue();
  vi.spyOn(queryClient, "invalidateQueries").mockRejectedValue(new Error("cache refresh failed"));

  await screen.findByText("Issue 101");
  await openIssueSection(user, "Ticket details and engineering");
  await user.type(screen.getByLabelText("New note"), "Write completed.");
  await user.click(screen.getByRole("button", { name: "Save internal note" }));

  expect(await screen.findByRole("status")).toHaveTextContent("Internal note saved for #101.");
  expect(addComment).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
});

test("an anonymous issue directs internal evidence review without drafting an undeliverable question", async () => {
  const user = userEvent.setup();
  const detail = feedbackDetail("issue-a", "in_progress");
  detail.feedback.reporter = { id: null, email: null, name: null };
  detail.feedback.owner = { id: "owner-1", name: "Owner" };
  vi.spyOn(api, "getFeedbackDetail").mockResolvedValue(detail);
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  const send = vi.spyOn(api, "addComment");
  renderIssue("/issues/issue-a?tab=resolve&page=2");
  await screen.findByRole("heading", { name: "Issue 101" });
  expect(screen.queryByRole("button", { name: copy.detail.askReporter })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Review missing evidence" }));
  await waitFor(() => expect(document.getElementById("issue-evidence-quality-details")).toHaveAttribute("open"));
  expect(document.getElementById("issue-panel-investigate")).toHaveAttribute("open");
  expect(screen.getByTestId("issue-location")).toHaveTextContent("page=2");
  expect(send).not.toHaveBeenCalled();
});

test("delivery handoffs open both disclosures and do not claim unsaved verification as an outcome", async () => {
  const user = userEvent.setup();
  const detail = strongFeedbackDetail("issue-a", "in_progress");
  vi.spyOn(api, "getFeedbackDetail").mockResolvedValue(detail);
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  const update = vi.spyOn(api, "updateFeedback");
  renderIssue("/issues/issue-a?tab=resolve");
  await openEngineeringDelivery(user);
  expect(document.getElementById("issue-management-more")).toHaveAttribute("open");
  expect(document.getElementById("issue-engineering-lifecycle-disclosure")).toHaveAttribute("open");
  await user.click(screen.getByRole("button", { name: "Enter lifecycle details" }));
  await user.selectOptions(screen.getByLabelText("Lifecycle verification state"), "verified");
  expect(screen.queryByText("Verification recorded")).not.toBeInTheDocument();
  expect(update).not.toHaveBeenCalled();
});

test("reporter delivery counts exclude administrator and subscriber notifications", async () => {
  const detail = feedbackDetail("issue-a");
  const base = { integrationClient: null, createdAt: detail.feedback.createdAt, updatedAt: detail.feedback.updatedAt };
  detail.feedback.notificationHistory = [
    { ...base, id: "reporter", recipientType: "requester", eventType: "requester_confirmation", status: "sent", sentAt: detail.feedback.createdAt },
    { ...base, id: "admin", recipientType: "internal_subscriber", eventType: "new_issue_admin", status: "skipped" },
    { ...base, id: "subscriber", recipientType: "external_subscriber", eventType: "status_change_requester", status: "sent", sentAt: detail.feedback.createdAt },
  ];
  vi.spyOn(api, "getFeedbackDetail").mockResolvedValue(detail);
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  renderIssue("/issues/issue-a?tab=activity");
  await screen.findByRole("heading", { name: "Reporter updates" });
  const summary = document.getElementById("issue-requester-loop-summary")!;
  expect(within(summary).getByText("Skipped").nextElementSibling).toHaveTextContent("0");
  expect(within(summary).getByText("Sent", { exact: true }).nextElementSibling).toHaveTextContent("0");
  expect(summary).toHaveTextContent("No reporter update has been sent yet.");
  expect(summary).toHaveTextContent("Submission acknowledgement sent. Counted separately from progress updates.");
});

test("the selected workspace survives neighboring issue navigation without leaking into the queue URL", async () => {
  const user = userEvent.setup();
  mockReads(true);
  renderIssue("/issues/issue-a?page=2&pageSize=20&tab=investigate", (client) => {
    client.setQueryData(["feedback-list", "page=2&pageSize=20"], { items: [{ id: "issue-a" }, { id: "issue-b" }] });
  });
  await screen.findByRole("heading", { name: "Issue 101" });
  expect(document.getElementById("issue-panel-investigate")).toHaveAttribute("open");
  await user.click(screen.getByRole("button", { name: "Next ticket" }));
  await screen.findByText("Issue 202");
  expect(document.getElementById("issue-panel-investigate")).toHaveAttribute("open");
  expect(screen.getByTestId("issue-location")).toHaveTextContent("/issues/issue-b?page=2&pageSize=20&tab=investigate");
  expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Issues" })).toHaveAttribute("href", "/issues?page=2&pageSize=20");
});

test("opening history retains an internal draft while leaving the issue still requires a discard decision", async () => {
  const user = userEvent.setup();
  mockReads(true);
  vi.spyOn(api, "getFeedbackActivity").mockResolvedValue(activityResponse());
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);
  const router = createMemoryRouter([
    { path: "/issues/:feedbackId", element: <QueryClientProvider client={queryClient}><AdminFormExitGuardProvider><NavigationControl /><IssueDetailPage /></AdminFormExitGuardProvider></QueryClientProvider> },
  ], { initialEntries: ["/issues/issue-a?tab=investigate"] });
  render(<RouterProvider router={router} />);
  await user.click(await screen.findByLabelText("New note"));
  const note = screen.getByLabelText("New note");
  await waitFor(() => expect(note).toHaveFocus());
  await user.type(note, "Reproduced with the coupon removed.");
  await openIssueSection(user, "Activity history");
  expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "Internal note" }));
  expect(screen.getByLabelText("New note")).toHaveValue("Reproduced with the coupon removed.");
  await user.click(screen.getByRole("button", { name: "Open issue B" }));
  expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Stay" }));
  expect(screen.getByLabelText("New note")).toHaveValue("Reproduced with the coupon removed.");
});

test.each([
  { status: "closed", locked: false },
  { status: "new", locked: true },
])("$status issue with locked=$locked keeps its conversation and history available", async ({ status, locked }) => {
  const user = userEvent.setup();
  const detail = feedbackDetail("issue-a", status);
  detail.feedback.isOverageLocked = locked;
  vi.spyOn(api, "getFeedbackDetail").mockResolvedValue(detail);
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  renderIssue();
  expect(await screen.findByRole("heading", { name: "Conversation" })).toBeVisible();
  await openIssueSection(user, "Activity history");
  expect(screen.getByRole("heading", { name: "Activity" })).toBeVisible();
  if (locked) expect(screen.getByRole("button", { name: "Save internal note" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: copy.detail.askReporter })).not.toBeInTheDocument();
});

test("a reporter draft stays recoverable if its reply channel becomes unavailable", async () => {
  const user = userEvent.setup();
  mockReads(true);
  const client = renderIssue("/issues/issue-a?tab=activity");
  await openCustomerUpdate(user);
  await user.type(screen.getByLabelText("Reporter-visible message"), "Your report is being investigated.");
  const paused = strongFeedbackDetail("issue-a");
  paused.feedback.requesterNotificationsEnabled = false;
  act(() => client.setQueryData(["feedback-detail", "issue-a"], paused));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send customer reply" })).toBeDisabled());
  expect(screen.getByLabelText("Reporter-visible message")).toHaveValue("Your report is being investigated.");
  await user.click(screen.getByRole("button", { name: "Cancel draft" }));
  expect(screen.getByLabelText("Reporter-visible message")).toHaveValue("");
});

test("a known customer status change sends the public draft while keeping private findings separate", async () => {
  const user = userEvent.setup();
  mockReads(true);
  const addComment = vi.spyOn(api, "addComment").mockResolvedValue({ comment: {} });
  const update = vi.spyOn(api, "updateFeedback").mockResolvedValue(strongFeedbackDetail("issue-a"));
  renderIssue();
  await screen.findByText("Issue 101");
  await user.type(screen.getByLabelText("New note"), "Private diagnostic detail.");
  await openCustomerUpdate(user);
  expect(screen.getByLabelText("Reporter-visible message")).toHaveValue("");
  await user.type(screen.getByLabelText("Reporter-visible message"), "Your report is being investigated.");
  await openIssueSection(user, "Technical details");
  expect(screen.getByLabelText("Reporter-visible message")).toHaveValue("Your report is being investigated.");
  await user.click(screen.getByRole("radio", { name: "Internal note" }));
  expect(screen.getByLabelText("New note")).toHaveValue("Private diagnostic detail.");
  await user.selectOptions(screen.getByLabelText("Status"), "in_progress");
  await user.click(screen.getByRole("button", { name: "Save status and send reply" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith("issue-a", expect.objectContaining({
    status: "in_progress", notifyRequester: true, publicSummary: "Your report is being investigated.",
    statusNote: { body: "Your report is being investigated.", visibility: "public", clientRequestId: expect.any(String) },
  }));
  expect(addComment).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByLabelText("New note")).toHaveValue("Private diagnostic detail."));
  await openCustomerUpdate(user);
  expect(screen.getByLabelText("Reporter-visible message")).toHaveValue("");
});

test("anonymous status changes ask for a reason while keeping internal notes available", async () => {
  const user = userEvent.setup();
  mockReads(true);
  const anonymous = strongFeedbackDetail("issue-a");
  anonymous.feedback.reporter = { id: null, email: null, name: null };
  vi.mocked(api.getFeedbackDetail).mockResolvedValue(anonymous);
  renderIssue();
  const status = await screen.findByLabelText("Status");
  const privateMode = screen.getByRole("radio", { name: "Internal note" });
  expect(status.compareDocumentPosition(privateMode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await user.type(screen.getByLabelText("New note"), "Private diagnostic findings.");
  await user.selectOptions(status, "in_progress");
  expect(privateMode).toBeChecked();
  expect(screen.getByLabelText("New note")).toHaveValue("Private diagnostic findings.");
  expect(screen.getByText("Reason for status change")).toBeVisible();
  expect(screen.queryByText("A note or customer reply is required for this status change.")).not.toBeInTheDocument();
  await user.selectOptions(status, "triaged");
  expect(screen.queryByText("Reason for status change")).not.toBeInTheDocument();
});

function conversationPage(start = 0, total = 100): FeedbackConversationResponse {
  return {
    items: Array.from({ length: Math.min(20, total - start) }, (_, offset) => ({
      id: `message-${start + offset}`, body: `Message ${start + offset}`,
      visibility: offset % 2 ? "internal" : "public", createdAt: "2026-09-06T12:00:00.000Z", updatedAt: "2026-09-06T12:00:00.000Z",
      author: { id: "author-1", name: "Support engineer", email: "support@example.test" },
    })),
    pagination: { total, pageSize: 20, nextCursor: start + 20 < total ? `cursor-${start + 20}` : null },
  };
}

test("a status change locks customer reply, explains blocked switches, and restores the private draft when undone", async () => {
  const user = userEvent.setup();
  mockReads(true);
  const update = vi.spyOn(api, "updateFeedback");
  renderIssue();
  await user.type(await screen.findByLabelText("New note"), "Confidential diagnostic detail.");
  await user.selectOptions(screen.getByLabelText("Status"), "in_progress");
  expect(screen.getByRole("radio", { name: "Customer reply" })).toBeChecked();
  const internal = screen.getByRole("radio", { name: "Internal note" });
  expect(internal).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByLabelText("Reporter-visible message")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Save status and send reply" })).toBeDisabled();
  await user.click(internal);
  expect(await screen.findByRole("alert")).toHaveTextContent("The status is changing, so a customer reply is required.");
  expect(screen.getByRole("radio", { name: "Customer reply" })).toBeChecked();
  internal.focus();
  await user.keyboard(" ");
  expect(screen.getByRole("radio", { name: "Customer reply" })).toBeChecked();
  await user.selectOptions(screen.getByLabelText("Status"), "triaged");
  expect(internal).not.toHaveAttribute("aria-disabled");
  expect(internal).toBeChecked();
  expect(screen.getByLabelText("New note")).toHaveValue("Confidential diagnostic detail.");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(update).not.toHaveBeenCalled();
});

test.each([
  { recipientType: "internal_subscriber", required: false },
  { recipientType: "external_subscriber", required: true },
])("anonymous tickets with $recipientType require customer reply=$required", async ({ recipientType, required }) => {
  const user = userEvent.setup();
  mockReads(true);
  const detail = strongFeedbackDetail("issue-a");
  detail.feedback.reporter = { id: null, name: null, email: null };
  detail.feedback.subscribers = [{ id: "recipient-1", email: "follower@example.test", recipientType, isActive: true, notifyOnStatusChange: true, notifyOnTriage: false, addedBy: null, createdAt: detail.feedback.createdAt, updatedAt: detail.feedback.updatedAt }];
  vi.mocked(api.getFeedbackDetail).mockResolvedValue(detail);
  renderIssue();
  await user.selectOptions(await screen.findByLabelText("Status"), "in_progress");
  expect(screen.getByRole("radio", { name: required ? "Customer reply" : "Internal note" })).toBeChecked();
});

test("a newly associated customer requires reloading details instead of retrying a private status save", async () => {
  const user = userEvent.setup();
  mockReads(true);
  const anonymous = strongFeedbackDetail("issue-a");
  anonymous.feedback.reporter = { email: null };
  vi.mocked(api.getFeedbackDetail).mockResolvedValue(anonymous);
  const update = vi.spyOn(api, "updateFeedback").mockRejectedValueOnce(new ApiError(422, "Customer reply required", "feedback.customer_update_required"));
  renderIssue();
  await user.type(await screen.findByLabelText("New note"), "Private investigation.");
  await user.selectOptions(screen.getByLabelText("Status"), "blocked");
  await user.click(screen.getByRole("button", { name: "Save note and status" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your private draft is kept.");
  vi.mocked(api.getFeedbackDetail).mockResolvedValue(strongFeedbackDetail("issue-a"));
  await user.click(screen.getByRole("button", { name: "Reload customer details" }));
  expect(await screen.findByLabelText("Reporter-visible message")).toHaveValue("");
  expect(screen.getByRole("radio", { name: "Customer reply" })).toBeChecked();
  await user.selectOptions(screen.getByLabelText("Status"), "triaged");
  expect(screen.getByLabelText("New note")).toHaveValue("Private investigation.");
  expect(update).toHaveBeenCalledTimes(1);
});

test("100 messages stay in the main conversation and older-page retry preserves the draft and reply context", async () => {
  const user = userEvent.setup();
  mockReads(true);
  const detail = strongFeedbackDetail("issue-a");
  detail.feedback.conversationCount = 100;
  vi.mocked(api.getFeedbackDetail).mockResolvedValue(detail);
  const conversation = vi.spyOn(api, "getFeedbackConversation")
    .mockResolvedValueOnce(conversationPage())
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValueOnce(conversationPage(20))
    .mockResolvedValueOnce(conversationPage(40))
    .mockResolvedValueOnce(conversationPage(60))
    .mockResolvedValueOnce(conversationPage(80));
  renderIssue();
  const panel = await screen.findByRole("complementary", { name: "Ticket update" });
  expect(within(panel).queryByText("Latest conversation")).not.toBeInTheDocument();
  const messages = await screen.findByRole("list", { name: "Notes and customer replies" });
  expect(within(messages).getAllByRole("listitem")).toHaveLength(20);
  expect(panel.contains(messages)).toBe(false);
  expect(conversation).toHaveBeenCalledWith("issue-a", null, expect.any(AbortSignal));
  await user.click(within(messages).getAllByRole("button", { name: "Reply to this message" })[1]!);
  const context = screen.getByRole("region", { name: "Reply context" });
  expect(context).toHaveTextContent("Message 2");
  await user.type(screen.getByLabelText("Reporter-visible message"), "Reply to the selected message.");
  await user.click(screen.getByRole("button", { name: "Load older messages (20 of 100)" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your loaded messages and draft are still here.");
  await user.click(screen.getByRole("button", { name: "Retry conversation" }));
  await waitFor(() => expect(within(messages).getAllByRole("listitem")).toHaveLength(40));
  expect(conversation).toHaveBeenLastCalledWith("issue-a", "cursor-20", expect.any(AbortSignal));
  expect(context).toHaveTextContent("Message 2");
  expect(screen.getByLabelText("Reporter-visible message")).toHaveValue("Reply to the selected message.");
  for (const loaded of [40, 60, 80]) {
    await user.click(screen.getByRole("button", { name: `Load older messages (${loaded} of 100)` }));
    await waitFor(() => expect(within(messages).getAllByRole("listitem")).toHaveLength(loaded + 20));
  }
  expect(screen.getByText("All 100 messages shown.")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Load older messages/ })).not.toBeInTheDocument();
  await closeIssueSections(user);
  await user.click(screen.getByRole("radio", { name: "Internal note" }));
  expect(screen.queryByRole("region", { name: "Reply context" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("New note")).toHaveValue("");
  await openCustomerUpdate(user);
  expect(screen.getByRole("region", { name: "Reply context" })).toHaveTextContent("Message 2");
  await user.click(screen.getByRole("button", { name: "Cancel draft" }));
  vi.mocked(api.getFeedbackDetail).mockResolvedValue(strongFeedbackDetail("issue-b"));
  await user.click(screen.getByRole("button", { name: "Open issue B" }));
  await screen.findByText("Issue 202");
  expect(screen.queryByRole("region", { name: "Reply context" })).not.toBeInTheDocument();
});

test("conversation has an explicit initial failure, retry, and empty state", async () => {
  const user = userEvent.setup();
  mockReads();
  vi.spyOn(api, "getFeedbackConversation").mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ items: [], pagination: { total: 0, pageSize: 20, nextCursor: null } });
  renderIssue("/issues/issue-a?tab=conversation");
  expect(await screen.findByRole("alert")).toHaveTextContent("Conversation could not be loaded.");
  expect(screen.queryByText("No notes or replies yet.")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry conversation" }));
  expect(await screen.findByText("No notes or replies yet.")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Conversation" })).toBeVisible();
});

test("a stale status save reloads the latest ticket while retaining the note for review", async () => {
  const user = userEvent.setup();
  mockReads(true);
  const anonymous = strongFeedbackDetail("issue-a");
  anonymous.feedback.reporter = { id: null, email: null, name: null };
  vi.mocked(api.getFeedbackDetail).mockResolvedValue(anonymous);
  const update = vi.spyOn(api, "updateFeedback").mockRejectedValueOnce(new ApiError(409, "Changed", "feedback.stale_update"));
  renderIssue();
  await screen.findByText("Issue 101");
  await user.type(screen.getByLabelText("New note"), "Reproduced the issue.");
  await user.selectOptions(screen.getByLabelText("Status"), "blocked");
  await user.click(screen.getByRole("button", { name: "Save note and status" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your draft is kept.");
  const latest = strongFeedbackDetail("issue-a");
  latest.feedback.reporter = { id: null, email: null, name: null };
  latest.feedback.status = "blocked";
  latest.feedback.updatedAt = "2026-09-06T12:00:00.000Z";
  vi.mocked(api.getFeedbackDetail).mockResolvedValue(latest);
  await user.click(screen.getByRole("button", { name: "Reload latest ticket" }));
  await waitFor(() => expect(screen.getByLabelText("Status")).toHaveValue("blocked"));
  expect(screen.getByLabelText("New note")).toHaveValue("Reproduced the issue.");
  expect(update).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: /Retry saving/ })).not.toBeInTheDocument();
});

test("the status menu offers only valid transitions for a new report", async () => {
  const detail = strongFeedbackDetail("issue-a");
  detail.feedback.status = "new";
  vi.spyOn(api, "getFeedbackDetail").mockResolvedValue(detail);
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  renderIssue();
  const status = await screen.findByLabelText("Status");
  expect(within(status).getByRole("option", { name: "Triaged" })).toBeInTheDocument();
  expect(within(status).queryByRole("option", { name: "Fixed" })).not.toBeInTheDocument();
  expect(within(status).queryByRole("option", { name: "In progress" })).not.toBeInTheDocument();
  expect(within(status).queryByRole("option", { name: "Duplicate" })).not.toBeInTheDocument();
});

test("customer reply choice keeps its editor visible and shows each recipient's delivery result", async () => {
  const user = userEvent.setup();
  const detail = strongFeedbackDetail("issue-a");
  const base = { integrationClient: null, createdAt: detail.feedback.createdAt, updatedAt: detail.feedback.updatedAt, eventType: "status_change_requester" };
  detail.feedback.notificationHistory = [
    { ...base, id: "sent", recipientType: "requester", recipientEmail: "reporter@example.test", status: "sent" },
    { ...base, id: "failed", recipientType: "external_subscriber", recipientEmail: "customer@example.test", status: "failed" },
  ];
  vi.spyOn(api, "getFeedbackDetail").mockResolvedValue(detail);
  vi.spyOn(api, "getProjectEngineeringContext").mockResolvedValue(engineeringContext);
  renderIssue();
  await user.click(await screen.findByRole("radio", { name: "Customer reply" }));
  expect(screen.getByLabelText("Reporter-visible message")).toBeVisible();
  const deliveries = screen.getByRole("region", { name: "Latest customer update delivery" });
  expect(deliveries).toHaveTextContent("reporter@example.test: sent");
  expect(deliveries).toHaveTextContent("customer@example.test: failed");
  expect(within(deliveries).getByRole("button", { name: "Retry delivery to customer@example.test" })).toBeVisible();
});
