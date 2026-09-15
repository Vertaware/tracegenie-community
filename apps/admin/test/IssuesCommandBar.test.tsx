import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { SavedIssueViewSummary } from "@tracegenie/shared";

import { IssuesPage } from "../src/features/issues/IssuesPage";
import { api, ApiError } from "../src/lib/api";
import { copy } from "../src/lib/copy";

const { exportIssuesMock } = vi.hoisted(() => ({ exportIssuesMock: vi.fn() }));

vi.mock("../src/lib/export-issues", () => ({ exportIssuesToCSV: exportIssuesMock }));

const queryClients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  queryClients.splice(0).forEach((client) => client.clear());
  exportIssuesMock.mockReset();
  vi.restoreAllMocks();
});

const issueItem = {
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function renderIssues(
  initialEntry: string,
  itemsOrOptions: typeof issueItem[] | {
    items?: typeof issueItem[];
    savedViewsRequest?: Promise<{ views: SavedIssueViewSummary[] }>;
    organizationId?: string;
    canOpenProductSetup?: boolean;
    feedbackRequest?: Promise<{
      pagination: { total: number; page: number; pageSize: number; pageCount: number };
      assignableUsers: never[];
      items: typeof issueItem[];
    }>;
  } = [],
  legacyFeedbackRequest?: Promise<{
    pagination: { total: number; page: number; pageSize: number; pageCount: number };
    assignableUsers: never[];
    items: typeof issueItem[];
  }>,
) {
  const options = Array.isArray(itemsOrOptions)
    ? { items: itemsOrOptions, feedbackRequest: legacyFeedbackRequest }
    : itemsOrOptions;
  const items = options.items ?? [];
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [] });
  vi.spyOn(api, "getSavedIssueViews").mockImplementation(() => options.savedViewsRequest ?? Promise.resolve({ views: [] }));
  vi.spyOn(api, "getFeedbackList").mockImplementation(() => options.feedbackRequest ?? Promise.resolve({
    pagination: { total: items.length, page: 1, pageSize: 20, pageCount: items.length ? 1 : 0 },
    assignableUsers: [],
    items,
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
  queryClients.push(queryClient);
  const renderTree = (organizationId: string) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <IssuesPage organizationId={organizationId} canOpenProductSetup={options.canOpenProductSetup} />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(renderTree(options.organizationId ?? "organization-1"));
  return Object.assign(view, {
    queryClient,
    rerenderOrganization(nextOrganizationId: string) {
      view.rerender(renderTree(nextOrganizationId));
    },
  });
}

test("product issues retain the product sections and scoped queue", async () => {
  renderIssues("/issues?projectKey=store", { items: [issueItem], canOpenProductSetup: true });
  await screen.findAllByText("Checkout failed");

  const navigation = within(screen.getByRole("navigation", { name: "Product sections" }));
  expect(navigation.getByRole("link", { name: "Issues" })).toHaveAttribute("aria-current", "page");
  expect(navigation.getByRole("link", { name: "Issues" })).toHaveAttribute("href", "/issues?projectKey=store");
  expect(navigation.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/projects/store/settings");
  expect(navigation.getByRole("link", { name: "Integrations" })).toHaveAttribute("href", "/projects/store/integrations");
  expect(navigation.queryByRole("link", { name: "Overview" })).not.toBeInTheDocument();
  expect(navigation.queryByRole("link", { name: "Setup" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("store");
  expect(vi.mocked(api.getFeedbackList).mock.calls.at(-1)?.[0]?.get("projectKey")).toBe("store");
});

test("product-filtered issues do not expose product settings to operators without setup access", async () => {
  renderIssues("/issues?projectKey=store", [issueItem]);
  await screen.findAllByText("Checkout failed");
  expect(screen.queryByRole("navigation", { name: "Product sections" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Issues");
});

test("issues shows save-view intent only when the queue has a decision context", async () => {
  renderIssues("/issues?severity=high", [issueItem]);
  await screen.findAllByText("Checkout failed");

  const header = within(document.querySelector<HTMLElement>("#issues-header")!);
  expect(header.getByRole("button", { name: "Filters, 1 active" })).toBeVisible();
  expect(header.getByRole("button", { name: "Save current view" })).toBeVisible();
  expect(header.getByRole("button", { name: "Export" })).toBeVisible();
  expect(document.querySelector("#issues-command-tools")).not.toBeInTheDocument();
});

test("issues hides saved views when there is nothing to save or reopen", async () => {
  renderIssues("/issues", [issueItem]);
  await screen.findAllByText("Checkout failed");

  const header = within(document.querySelector<HTMLElement>("#issues-header")!);
  expect(header.queryByRole("button", { name: /saved view|save current view/i })).not.toBeInTheDocument();
});

test("saved views preserve queue filters and refetch after saving the current decision context", async () => {
  const user = userEvent.setup();
  const savedViewsResponse = {
    views: [{
      id: "view-1",
      name: "Anonymous checkout",
      filters: { severity: "critical", requesterIdentity: "anonymous" },
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    }],
  };
  const createSavedView = vi.spyOn(api, "createSavedIssueView").mockResolvedValue({
    view: {
      id: "view-2",
      name: "High priority",
      filters: { severity: "high", requesterIdentity: "identified" },
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    },
  });
  renderIssues("/issues?severity=high&requesterIdentity=identified&page=4", {
    items: [issueItem],
    savedViewsRequest: Promise.resolve(savedViewsResponse),
  });
  const savedViews = vi.mocked(api.getSavedIssueViews);
  await screen.findAllByText("Checkout failed");

  await user.click(await screen.findByRole("button", { name: "Saved views: 1 saved view" }));
  await user.click(screen.getByRole("button", { name: copy.issues.applySavedView("Anonymous checkout") }));
  await waitFor(() => expect(screen.getByTestId("location-search")).toHaveTextContent("severity=critical"));
  expect(screen.getByTestId("location-search")).toHaveTextContent("requesterIdentity=anonymous");
  expect(screen.getByTestId("location-search")).toHaveTextContent("page=1");

  await user.click(screen.getByRole("button", { name: "Saved views: 1 saved view" }));
  await user.type(screen.getByPlaceholderText(copy.issues.savedViewNamePlaceholder), "High priority");
  await user.click(screen.getByRole("button", { name: copy.issues.savedViewSave }));

  await waitFor(() => expect(createSavedView).toHaveBeenCalledTimes(1));
  expect(createSavedView).toHaveBeenCalledWith({
    organizationId: "organization-1",
    name: "High priority",
    filters: { severity: "critical", requesterIdentity: "anonymous" },
  });
  expect(savedViews).toHaveBeenCalledTimes(2);
});

test("desktop columns and mobile cards share the same issue queue", async () => {
  renderIssues("/issues", [issueItem]);
  await screen.findAllByText("Checkout failed");

  expect(document.querySelector('[data-table-contract="issues"]')).toHaveClass("hidden", "min-[1180px]:block");
  expect(document.querySelector(".tg-mobile-card")?.parentElement).toHaveClass("min-[1180px]:hidden");
  expect(screen.getByRole("columnheader", { name: "Issue" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Severity" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Product" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Owner" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Follow-up" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Reported" })).not.toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Next action" })).not.toBeInTheDocument();
});

test("header export invokes once, reports progress, and recovers", async () => {
  const request = deferred<number>();
  exportIssuesMock.mockReturnValue(request.promise);
  renderIssues("/issues", [issueItem]);
  await screen.findAllByText("Checkout failed");

  const exportButton = screen.getByRole("button", { name: "Export" });
  fireEvent.click(exportButton);
  fireEvent.click(exportButton);
  expect(exportIssuesMock).toHaveBeenCalledTimes(1);
  expect(exportButton).toBeDisabled();

  const progress = exportIssuesMock.mock.calls[0]?.[1] as ((done: number, total: number) => void) | undefined;
  act(() => progress?.(0, 1));
  expect(screen.getByRole("button", { name: /Preparing CSV 0\/1/ })).toBeDisabled();

  await act(async () => request.resolve(1));
  expect(within(await screen.findByLabelText("Notifications")).getByRole("status")).toHaveTextContent(copy.issues.exported(1, false));
  expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
});

test("header export reports a failure and can be retried", async () => {
  exportIssuesMock.mockRejectedValueOnce(new Error("download failed")).mockResolvedValueOnce(1);
  renderIssues("/issues?severity=high", [issueItem]);
  await screen.findAllByText("Checkout failed");
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: "Export" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(copy.issues.exportFailed);
  await user.click(screen.getByRole("button", { name: "Export" }));
  expect(exportIssuesMock).toHaveBeenCalledTimes(2);
});

test("A-B-A tenant switches suppress an old export settlement without unlocking the current export", async () => {
  const firstExport = deferred<number>();
  const currentExport = deferred<number>();
  exportIssuesMock.mockReturnValueOnce(firstExport.promise).mockReturnValueOnce(currentExport.promise);
  const view = renderIssues("/issues", { items: [issueItem] });
  await screen.findAllByText("Checkout failed");

  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  view.rerenderOrganization("organization-2");
  view.rerenderOrganization("organization-1");
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  expect(exportIssuesMock).toHaveBeenCalledTimes(2);

  await act(async () => {
    currentExport.resolve(1);
    await currentExport.promise;
  });
  expect(within(await screen.findByLabelText("Notifications")).getByRole("status")).toHaveTextContent(copy.issues.exported(1, false));

  await act(async () => {
    firstExport.reject(new Error("stale export failed"));
    await firstExport.promise.catch(() => undefined);
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
});

test("saved-view deletion keeps one mutex and target-keyed feedback", async () => {
  const user = userEvent.setup();
  const pendingDelete = deferred<void>();
  const views: SavedIssueViewSummary[] = [
    { id: "view-a", name: "Checkout failures", filters: {}, createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z" },
    { id: "view-b", name: "Payment retries", filters: {}, createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z" },
  ];
  vi.spyOn(api, "deleteSavedIssueView").mockReturnValue(pendingDelete.promise);
  renderIssues("/issues", { savedViewsRequest: Promise.resolve({ views }) });

  await user.click(await screen.findByRole("button", { name: "Saved views: 2 saved views" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete view: Checkout failures" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete: Checkout failures" }));

  expect(api.deleteSavedIssueView).toHaveBeenCalledTimes(1);
  expect(api.deleteSavedIssueView).toHaveBeenCalledWith("view-a");
  expect(screen.getByRole("button", { name: "Delete view: Checkout failures" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Delete view: Payment retries" })).toBeDisabled();

  await act(async () => {
    pendingDelete.resolve();
    await pendingDelete.promise;
  });
  expect(within(await screen.findByLabelText("Notifications")).getByRole("status"))
    .toHaveAttribute("data-toast-scope", "issues:organization-1:saved-view-delete:view-a");
});

test("mobile-accessible filters preserve search requester sort and reset pagination", async () => {
  renderIssues("/issues?page=4");
  const user = userEvent.setup();
  const filters = screen.getByRole("button", { name: "Filters" });

  expect(document.querySelector("#issue-filters")).toBeNull();
  await user.click(filters);
  const panel = within(document.querySelector<HTMLElement>("#issue-filters")!);
  expect(panel.getByRole("textbox", { name: "Search issues" })).toBeVisible();
  await user.click(panel.getByText("More filters"));
  expect(panel.getByRole("combobox", { name: "Filter by reporter" })).toBeVisible();
  expect(panel.getByRole("combobox", { name: "Sort issues" })).toBeVisible();
  await user.type(panel.getByRole("textbox", { name: "Search issues" }), "payment");
  await user.selectOptions(panel.getByRole("combobox", { name: "Filter by reporter" }), "anonymous");
  await user.selectOptions(panel.getByRole("combobox", { name: "Sort issues" }), "severity:asc");
  await user.selectOptions(screen.getByRole("combobox", { name: "Filter by severity" }), "critical");
  await waitFor(() => expect(screen.getByTestId("location-search")).toHaveTextContent("query=payment"));
  expect(screen.getByTestId("location-search")).toHaveTextContent("requesterIdentity=anonymous");
  expect(screen.getByTestId("location-search")).toHaveTextContent("sortBy=severity");
  expect(screen.getByTestId("location-search")).toHaveTextContent("sortDir=asc");
  expect(screen.getByTestId("location-search")).toHaveTextContent("severity=critical");
  expect(new URLSearchParams(screen.getByTestId("location-search").textContent ?? "").get("page")).toBe("1");
});

test("the filters trigger closes its open panel", async () => {
  renderIssues("/issues", [issueItem]);
  const user = userEvent.setup();
  const filters = await screen.findByRole("button", { name: "Filters" });

  await user.click(filters);
  expect(document.querySelector("#issue-filters")).toBeInTheDocument();
  await user.click(filters);
  expect(document.querySelector("#issue-filters")).not.toBeInTheDocument();
});

test("issue search plus consolidated filters and sort update the queue URL", async () => {
  renderIssues("/issues?page=4", [issueItem]);
  await screen.findAllByText("Checkout failed");
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: "Search issues" }));
  await user.type(screen.getByRole("textbox", { name: /Search title, URL, ticket/ }), "payment");
  await user.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(screen.getByTestId("location-search")).toHaveTextContent("query=payment"));

  await user.click(screen.getByRole("button", { name: "Filters" }));
  const filters = within(document.querySelector<HTMLElement>("#issue-filters")!);
  await user.selectOptions(filters.getByRole("combobox", { name: "Filter by status" }), "triaged");
  await waitFor(() => expect(screen.getByTestId("location-search")).toHaveTextContent("status=triaged"));

  await user.click(filters.getByText("More filters"));
  await user.selectOptions(filters.getByRole("combobox", { name: "Filter by reporter" }), "anonymous");
  await waitFor(() => expect(screen.getByTestId("location-search")).toHaveTextContent("requesterIdentity=anonymous"));

  await user.selectOptions(filters.getByRole("combobox", { name: "Sort issues" }), "severity:desc");
  await waitFor(() => expect(screen.getByTestId("location-search")).toHaveTextContent("sortBy=severity"));
  expect(screen.getByTestId("location-search")).toHaveTextContent("sortDir=desc");
});

test("regression-only empty results keep the contextual exit", async () => {
  renderIssues("/issues?releaseRegression=true");
  await screen.findByText(copy.issues.emptyFilteredTitle);
  expect(screen.getByRole("button", { name: copy.issues.clearReleaseRegressionFilter })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Clear all filters" })).not.toBeInTheDocument();
});

test("issues permission denial is explicit and does not expose a retry loop", async () => {
  renderIssues(
    "/issues",
    [],
    Promise.reject(new ApiError(403, "Forbidden", "auth.project_access_denied")),
  );

  const permission = await screen.findByRole("alert");
  expect(permission).toHaveTextContent("Issue queue access required");
  expect(permission).toHaveTextContent("Ask an organization owner or admin for access to these customer reports.");
  expect(within(permission).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
});

test("permission revocation hides cached issue rows instead of presenting them as stale", async () => {
  const view = renderIssues("/issues", [issueItem]);
  await screen.findAllByText("Checkout failed");
  vi.mocked(api.getFeedbackList).mockRejectedValueOnce(new ApiError(403, "Forbidden", "auth.project_access_denied"));

  await act(async () => {
    await view.queryClient.invalidateQueries({ queryKey: ["feedback-list", "organization-1"] });
  });

  expect(await screen.findByRole("alert")).toHaveTextContent("Issue queue access required");
  expect(screen.queryByText("Checkout failed")).not.toBeInTheDocument();
  expect(document.querySelector("#issues-list-stale-state")).not.toBeInTheDocument();
});
