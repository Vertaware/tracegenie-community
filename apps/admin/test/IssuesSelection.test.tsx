import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

import { IssuesPage } from "../src/features/issues/IssuesPage";
import { api } from "../src/lib/api";
import { copy } from "../src/lib/copy";

const queryClients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  queryClients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

const issue = {
  id: "issue-1",
  ticketNumber: 101,
  title: "Checkout failed",
  description: "Payment confirmation did not complete.",
  project: { key: "store", name: "Store" },
  status: "new",
  severity: "high",
  issueType: "bug",
  labels: [],
  currentUrl: "https://example.test/checkout",
  reporterName: "Ada",
  reporterEmail: "ada@example.test",
  productContextSummary: null,
  customerImpactSummary: null,
  duplicateOf: null,
  duplicateCount: 0,
  releaseSignal: null,
  owner: null,
  convertedToBacklog: false,
  attachmentCount: 0,
  createdAt: "2026-07-11T12:00:00.000Z",
  updatedAt: "2026-07-11T12:00:00.000Z",
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderIssues() {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [] });
  vi.spyOn(api, "getSavedIssueViews").mockResolvedValue({ views: [] });
  vi.spyOn(api, "getFeedbackList").mockResolvedValue({
    pagination: { total: 2, page: 1, pageSize: 20, pageCount: 1 },
    assignableUsers: [],
    items: [issue, { ...issue, id: "issue-2", ticketNumber: 102, title: "Locked issue", isOverageLocked: true }],
  });

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
  queryClients.push(queryClient);

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/issues?page=1"]}>
        <IssuesPage organizationId="organization-1" />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function feedbackResponse(items: typeof issue[], page = 1, pageCount = 1) {
  return {
    pagination: { total: items.length * pageCount, page, pageSize: 20, pageCount },
    assignableUsers: [],
    items,
  };
}

test("empty Issues recovery only links users who can access product setup", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [] });
  vi.spyOn(api, "getSavedIssueViews").mockResolvedValue({ views: [] });
  vi.spyOn(api, "getFeedbackList").mockResolvedValue(feedbackResponse([]));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);

  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/issues"]}>
        <IssuesPage organizationId="organization-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByText(copy.issues.emptyTitle)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Open product setup" })).not.toBeInTheDocument();

  rerender(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/issues"]}>
        <IssuesPage organizationId="organization-1" canOpenProductSetup />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByRole("button", { name: "Open product setup" })).toBeVisible();
});

test("Issues selection isolates checkbox interaction from navigation and excludes overage rows", async () => {
  const user = userEvent.setup();
  renderIssues();

  const [selectIssue] = await screen.findAllByRole("checkbox", { name: copy.issues.selectIssue(101) });
  const [lockedIssue] = screen.getAllByRole("checkbox", { name: copy.issues.selectIssue(102) });
  const selectVisible = screen.getByRole("checkbox", { name: copy.issues.selectAllPage });
  const firstRow = selectIssue.closest("tr");

  expect(firstRow).not.toHaveAttribute("role", "button");
  expect(firstRow).toHaveAttribute("aria-selected", "false");
  expect(lockedIssue).toBeDisabled();

  await user.click(selectIssue);
  expect(selectIssue).toBeChecked();
  expect(firstRow).toHaveAttribute("aria-selected", "true");
  expect(firstRow).toHaveClass("bg-primary-light/60");
  expect(screen.getByTestId("location")).toHaveTextContent("/issues?page=1");

  selectIssue.focus();
  await user.keyboard(" ");
  expect(selectIssue).not.toBeChecked();
  expect(screen.getByTestId("location")).toHaveTextContent("/issues?page=1");

  await user.click(lockedIssue);
  expect(lockedIssue).not.toBeChecked();

  await user.click(selectVisible);
  expect(selectIssue).toBeChecked();
  expect(lockedIssue).not.toBeChecked();
  expect(selectVisible).toBeChecked();
  expect(screen.getByText(copy.issues.bulkSelected(1))).toBeVisible();

  await user.click(screen.getAllByRole("button", { name: "Open issue 101: Checkout failed" })[0]!);
  await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/issues/issue-1?page=1"));
});

test("Issues selection drops stale IDs across filter and page results, then selects only the new page eligible rows", async () => {
  const user = userEvent.setup();
  const filteredIssue = { ...issue, id: "issue-filtered", ticketNumber: 201, title: "Filtered issue" };
  const nextPageIssue = { ...issue, id: "issue-page-2", ticketNumber: 301, title: "Page two issue" };
  const nextPageLockedIssue = { ...issue, id: "issue-page-2-locked", ticketNumber: 302, title: "Page two locked issue", isOverageLocked: true };

  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [] });
  vi.spyOn(api, "getSavedIssueViews").mockResolvedValue({ views: [] });
  vi.spyOn(api, "getFeedbackList").mockImplementation(async (search) => {
    if (search.get("query") === "filtered" && search.get("page") === "2") {
      return feedbackResponse([nextPageIssue, nextPageLockedIssue], 2, 2);
    }
    if (search.get("query") === "filtered") {
      return feedbackResponse([filteredIssue], 1, 2);
    }
    return feedbackResponse([issue], 1, 1);
  });

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
  queryClients.push(queryClient);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/issues?page=1"]}>
        <IssuesPage organizationId="organization-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.click((await screen.findAllByRole("checkbox", { name: copy.issues.selectIssue(101) }))[0]!);
  expect(screen.getByText(copy.issues.bulkSelected(1))).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Search issues" }));
  const searchDialog = screen.getByRole("dialog", { name: "Search issues" });
  await user.type(within(searchDialog).getByRole("textbox", { name: "Search title, URL, ticket #" }), "filtered");
  await user.click(within(searchDialog).getByRole("button", { name: "Apply" }));

  await screen.findAllByText("Filtered issue");
  await waitFor(() => expect(screen.queryByText(copy.issues.bulkSelected(1))).not.toBeInTheDocument());

  const filteredSelectAll = screen.getByRole("checkbox", { name: copy.issues.selectAllPage });
  await user.click(filteredSelectAll);
  expect((await screen.findAllByRole("checkbox", { name: copy.issues.selectIssue(201) }))[0]).toBeChecked();
  expect(screen.getByText(copy.issues.bulkSelected(1))).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Page 2" }));
  await screen.findAllByText("Page two issue");
  await waitFor(() => expect(screen.queryByText(copy.issues.bulkSelected(1))).not.toBeInTheDocument());

  const pageTwoSelectAll = screen.getByRole("checkbox", { name: copy.issues.selectAllPage });
  const [pageTwoSelectable] = await screen.findAllByRole("checkbox", { name: copy.issues.selectIssue(301) });
  const [pageTwoLocked] = screen.getAllByRole("checkbox", { name: copy.issues.selectIssue(302) });
  await user.click(pageTwoSelectAll);

  expect(pageTwoSelectable).toBeChecked();
  expect(pageTwoLocked).toBeDisabled();
  expect(pageTwoLocked).not.toBeChecked();
  expect(screen.getByText(copy.issues.bulkSelected(1))).toBeVisible();
});

test("Issues queue keeps only actionable row data on desktop and mobile", async () => {
  const decisionIssue = {
    ...issue,
    attachmentCount: 2,
    convertedToBacklog: true,
    owner: { id: "owner-1", name: "Priya" },
    customerImpactSummary: {
      summary: "Checkout blocked for enterprise buyers",
      affectedUsers: 240,
      affectedAccounts: 12,
      revenueAtRisk: null,
      churnRisk: "high" as const,
    },
    requesterLoop: {
      canEmailRequester: true,
      lastRequesterUpdateAt: null,
      updateDue: true,
      failedCount: 0,
    },
  };

  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [] });
  vi.spyOn(api, "getSavedIssueViews").mockResolvedValue({ views: [] });
  vi.spyOn(api, "getFeedbackList").mockResolvedValue(feedbackResponse([decisionIssue]));

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
  queryClients.push(queryClient);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/issues?page=1"]}>
        <IssuesPage organizationId="organization-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await screen.findAllByText("Checkout failed");
  const desktop = document.querySelector<HTMLElement>('[data-table-contract="issues"]');
  const mobile = document.querySelector<HTMLElement>(".tg-mobile-card");
  expect(desktop).not.toBeNull();
  expect(mobile).not.toBeNull();

  expect(within(desktop!).getByRole("columnheader", { name: "Issue" })).toBeInTheDocument();
  expect(within(desktop!).getByRole("columnheader", { name: "Severity" })).toBeInTheDocument();
  expect(within(desktop!).getByRole("columnheader", { name: "Product" })).toBeInTheDocument();
  expect(within(desktop!).getByRole("columnheader", { name: "Owner" })).toBeInTheDocument();
  expect(within(desktop!).getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  expect(within(desktop!).getByRole("columnheader", { name: "Follow-up" })).toBeInTheDocument();
  expect(within(desktop!).queryByRole("columnheader", { name: "Evidence" })).not.toBeInTheDocument();
  expect(within(desktop!).queryByRole("columnheader", { name: "Impact" })).not.toBeInTheDocument();
  expect(within(desktop!).queryByRole("columnheader", { name: "Reporter" })).not.toBeInTheDocument();
  expect(within(desktop!).queryByRole("columnheader", { name: "Reported" })).not.toBeInTheDocument();
  expect(within(desktop!).queryByRole("columnheader", { name: "Next action" })).not.toBeInTheDocument();
  expect(within(desktop!).queryByLabelText("2 attachments")).not.toBeInTheDocument();
  expect(within(desktop!).getByText("240 users")).toBeInTheDocument();
  expect(within(desktop!).getByText("Reply due")).toBeInTheDocument();
  expect(within(desktop!).getByText("Priya").closest("td")).not.toHaveClass("hidden");

  expect(within(mobile!).getByText("#101")).toBeInTheDocument();
  expect(within(mobile!).getByText("Checkout failed")).toBeInTheDocument();
  expect(within(mobile!).getByText("Priya")).toBeInTheDocument();
  expect(within(mobile!).getByText("Reply due")).toBeInTheDocument();
  expect(within(mobile!).queryByText("Follow up")).not.toBeInTheDocument();
});

test("Issues queue gives Product its own column only in cross-product views", async () => {
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [{ key: "store", name: "Store" }] });
  vi.spyOn(api, "getSavedIssueViews").mockResolvedValue({ views: [] });
  vi.spyOn(api, "getFeedbackList").mockResolvedValue(feedbackResponse([issue]));

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
  queryClients.push(queryClient);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/issues?projectKey=store&page=1"]}>
        <IssuesPage organizationId="organization-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await screen.findAllByText("Checkout failed");
  const desktop = document.querySelector<HTMLElement>('[data-table-contract="issues"]');
  const mobile = document.querySelector<HTMLElement>(".tg-mobile-card");

  expect(desktop).not.toBeNull();
  expect(mobile).not.toBeNull();
  expect(within(desktop!).queryByRole("columnheader", { name: "Product" })).not.toBeInTheDocument();
  expect(within(mobile!).queryByText("Store")).not.toBeInTheDocument();
  expect(within(document.querySelector<HTMLElement>("#issues-header")!).getByText("Store")).toBeVisible();
});

test("Issues bulk bar clears selection without changing page or pagination", async () => {
  const user = userEvent.setup();
  renderIssues();

  await user.click((await screen.findAllByRole("checkbox", { name: copy.issues.selectIssue(101) }))[0]!);
  expect(screen.getByText(copy.issues.bulkSelected(1))).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Clear" }));

  expect(screen.queryByText(copy.issues.bulkSelected(1))).not.toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent("/issues?page=1");
  expect((screen.getAllByRole("checkbox", { name: copy.issues.selectIssue(101) })[0])).not.toBeChecked();
});

test("expert bulk actions return ticket-level failures and preserve failed selection for retry", async () => {
  const user = userEvent.setup();
  const secondIssue = { ...issue, id: "issue-2", ticketNumber: 102, title: "Search failed" };
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [] });
  vi.spyOn(api, "getSavedIssueViews").mockResolvedValue({ views: [] });
  const list = vi.spyOn(api, "getFeedbackList").mockResolvedValueOnce({
    pagination: { total: 2, page: 1, pageSize: 20, pageCount: 1 },
    assignableUsers: [{ id: "owner-1", name: "Priya" }],
    items: [issue, secondIssue],
  });
  list.mockResolvedValue({
    pagination: { total: 2, page: 1, pageSize: 20, pageCount: 1 },
    assignableUsers: [{ id: "owner-1", name: "Priya" }],
    items: [
      { ...issue, updatedAt: "2026-07-11T12:05:00.000Z", owner: { id: "owner-1", name: "Priya" } },
      { ...secondIssue, updatedAt: "2026-07-11T12:01:00.000Z" },
    ],
  });
  const bulk = vi.spyOn(api, "bulkUpdateFeedback")
    .mockResolvedValueOnce({
      succeeded: [{ feedbackId: issue.id, updatedAt: "2026-07-11T12:05:00.000Z", before: { status: "new", ownerId: null, labels: [] } }],
      failed: [{ feedbackId: secondIssue.id, code: "feedback.stale_update", message: "This issue changed after it was loaded." }],
    })
    .mockResolvedValueOnce({
      succeeded: [{ feedbackId: secondIssue.id, updatedAt: "2026-07-11T12:06:00.000Z", before: { status: "new", ownerId: null, labels: [] } }],
      failed: [],
    });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
  queryClients.push(queryClient);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/issues?page=1"]}>
        <IssuesPage organizationId="organization-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.click((await screen.findAllByRole("checkbox", { name: copy.issues.selectIssue(101) }))[0]!);
  await user.click(screen.getAllByRole("checkbox", { name: copy.issues.selectIssue(102) })[0]!);
  await user.selectOptions(screen.getByRole("combobox", { name: "Bulk issue action" }), "owner");
  await user.selectOptions(screen.getByRole("combobox", { name: "Bulk owner" }), "owner-1");
  await user.click(screen.getByRole("button", { name: copy.issues.bulkApply }));

  expect(await screen.findByText("1 succeeded, 1 failed")).toBeVisible();
  const result = document.querySelector<HTMLElement>("#issues-bulk-result");
  expect(result).not.toBeNull();
  expect(within(result!).getByText("#102")).toBeVisible();
  expect(within(result!).getByText(/This issue changed after it was loaded/)).toBeVisible();
  expect(bulk.mock.calls[0]?.[0].items).toEqual([
    { feedbackId: "issue-1", expectedUpdatedAt: issue.updatedAt, mutation: { ownerId: "owner-1" } },
    { feedbackId: "issue-2", expectedUpdatedAt: secondIssue.updatedAt, mutation: { ownerId: "owner-1" } },
  ]);
  expect(screen.getAllByRole("checkbox", { name: copy.issues.selectIssue(101) })[0]).not.toBeChecked();
  expect(screen.getAllByRole("checkbox", { name: copy.issues.selectIssue(102) })[0]).toBeChecked();

  await user.click(screen.getByRole("button", { name: "Retry failed" }));
  expect(await screen.findByText("1 succeeded, 0 failed")).toBeVisible();
  expect(bulk.mock.calls[1]?.[0].items).toEqual([
    { feedbackId: "issue-2", expectedUpdatedAt: "2026-07-11T12:01:00.000Z", mutation: { ownerId: "owner-1" } },
  ]);
});

test("expert label retry preserves labels added by a concurrent update", async () => {
  const user = userEvent.setup();
  const initialIssue = { ...issue, labels: ["bug"] };
  const refreshedIssue = {
    ...initialIssue,
    labels: ["bug", "ux"],
    updatedAt: "2026-07-11T12:05:00.000Z",
  };
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [] });
  vi.spyOn(api, "getSavedIssueViews").mockResolvedValue({ views: [] });
  vi.spyOn(api, "getFeedbackList")
    .mockResolvedValueOnce(feedbackResponse([initialIssue]))
    .mockResolvedValue(feedbackResponse([refreshedIssue]));
  const bulk = vi.spyOn(api, "bulkUpdateFeedback")
    .mockResolvedValueOnce({
      succeeded: [],
      failed: [{
        feedbackId: issue.id,
        code: "feedback.stale_update",
        message: "This issue changed after it was loaded.",
      }],
    })
    .mockResolvedValueOnce({
      succeeded: [{
        feedbackId: issue.id,
        updatedAt: "2026-07-11T12:06:00.000Z",
        before: { status: "new", ownerId: null, labels: ["bug", "ux"] },
      }],
      failed: [],
    });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
  queryClients.push(queryClient);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/issues?page=1"]}>
        <IssuesPage organizationId="organization-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.click((await screen.findAllByRole("checkbox", { name: copy.issues.selectIssue(101) }))[0]!);
  await user.selectOptions(screen.getByRole("combobox", { name: "Bulk issue action" }), "add-label");
  await user.selectOptions(screen.getByRole("combobox", { name: "Bulk label" }), "performance");
  await user.click(screen.getByRole("button", { name: copy.issues.bulkApply }));
  await screen.findByText("0 succeeded, 1 failed");
  await user.click(screen.getByRole("button", { name: "Retry failed" }));

  await waitFor(() => expect(bulk).toHaveBeenCalledTimes(2));
  expect(bulk.mock.calls[1]?.[0].items).toEqual([{
    feedbackId: issue.id,
    expectedUpdatedAt: refreshedIssue.updatedAt,
    mutation: { labels: ["bug", "ux", "performance"] },
  }]);
});

test("expert bulk actions restore each successful ticket with stale-safe undo", async () => {
  const user = userEvent.setup();
  renderIssues();
  const bulk = vi.spyOn(api, "bulkUpdateFeedback")
    .mockResolvedValueOnce({
      succeeded: [{ feedbackId: issue.id, updatedAt: "2026-07-11T12:05:00.000Z", before: { status: "new", ownerId: null, labels: [] } }],
      failed: [],
    })
    .mockResolvedValueOnce({
      succeeded: [{ feedbackId: issue.id, updatedAt: "2026-07-11T12:06:00.000Z", before: { status: "new", ownerId: null, labels: ["bug"] } }],
      failed: [],
    });

  await user.click((await screen.findAllByRole("checkbox", { name: copy.issues.selectIssue(101) }))[0]!);
  await user.selectOptions(screen.getByRole("combobox", { name: "Bulk issue action" }), "add-label");
  await user.selectOptions(screen.getByRole("combobox", { name: "Bulk label" }), "bug");
  await user.click(screen.getByRole("button", { name: copy.issues.bulkApply }));
  await screen.findByText("1 succeeded, 0 failed");
  await user.click(screen.getByRole("button", { name: "Undo successes" }));

  await waitFor(() => expect(bulk).toHaveBeenCalledTimes(2));
  expect(bulk.mock.calls[1]?.[0].items).toEqual([
    { feedbackId: "issue-1", expectedUpdatedAt: "2026-07-11T12:05:00.000Z", mutation: { labels: [] } },
  ]);
  expect(await screen.findByText("1 succeeded, 0 failed")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Undo successes" })).not.toBeInTheDocument();
});

test("bulk status requires a private note and retries the exact note request", async () => {
  const user = userEvent.setup();
  renderIssues();
  const bulk = vi.spyOn(api, "bulkUpdateFeedback")
    .mockResolvedValueOnce({ succeeded: [], failed: [{ feedbackId: issue.id, code: "feedback.stale_update", message: "Ticket changed." }] })
    .mockResolvedValueOnce({ succeeded: [{ feedbackId: issue.id, updatedAt: "2026-09-06T12:00:00.000Z", before: { status: "new", ownerId: null, labels: [] } }], failed: [] });
  await user.click((await screen.findAllByRole("checkbox", { name: copy.issues.selectIssue(101) }))[0]!);
  const apply = screen.getByRole("button", { name: copy.issues.bulkApply });
  expect(apply).toBeDisabled();
  await user.type(screen.getByLabelText("Bulk status note"), "Reviewed the reports and assigned investigation.");
  await user.click(apply);
  expect(await screen.findByText("0 succeeded, 1 failed")).toBeVisible();
  const firstMutation = bulk.mock.calls[0]?.[0].items[0]?.mutation;
  expect(firstMutation).toEqual({ status: "triaged", statusNote: { body: "Reviewed the reports and assigned investigation.", visibility: "internal", clientRequestId: expect.any(String) } });
  await user.click(screen.getByRole("button", { name: "Retry failed" }));
  expect(await screen.findByText("1 succeeded, 0 failed")).toBeVisible();
  expect(bulk.mock.calls[1]?.[0].items[0]?.mutation).toEqual(firstMutation);
  await user.click(screen.getAllByRole("checkbox", { name: copy.issues.selectIssue(101) })[0]!);
  expect(screen.getByLabelText("Bulk status note")).toHaveValue("");
});

test("a lost bulk status response keeps the original request for retry and does not offer an invalid undo", async () => {
  const user = userEvent.setup();
  renderIssues();
  const bulk = vi.spyOn(api, "bulkUpdateFeedback")
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValueOnce({ succeeded: [{ feedbackId: issue.id, updatedAt: "2026-09-06T12:00:00.000Z", before: { status: "new", ownerId: null, labels: [] } }], failed: [] });
  await user.click((await screen.findAllByRole("checkbox", { name: copy.issues.selectIssue(101) }))[0]!);
  await user.type(screen.getByLabelText("Bulk status note"), "Reviewed the report.");
  await user.click(screen.getByRole("button", { name: copy.issues.bulkApply }));
  expect(await screen.findByText("1 results not confirmed")).toBeVisible();
  expect(screen.getByRole("button", { name: copy.issues.bulkApply })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Retry failed" }));
  expect(await screen.findByText("1 succeeded, 0 failed")).toBeVisible();
  expect(bulk.mock.calls[1]).toEqual(bulk.mock.calls[0]);
  expect(screen.queryByRole("button", { name: "Undo successes" })).not.toBeInTheDocument();
});
