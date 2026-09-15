import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SavedIssueViewSummary } from "@tracegenie/shared";

import { applySavedViewFilters, SavedViewsPanel } from "../src/features/issues/IssuesPage";

afterEach(cleanup);

const legacyView: SavedIssueViewSummary = {
  id: "view-legacy",
  organizationId: "vertaware-org",
  name: "Legacy inbox",
  filters: {
    status: "new",
    labels: ["bug", "blocker"],
    sortBy: "severity",
    sortDir: "asc",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

test("saved view apply button dispatches the legacy view and resets matching filters", async () => {
  const user = userEvent.setup();
  const onApply = vi.fn();

  render(
    <SavedViewsPanel
      id="saved-views-test"
      views={[legacyView]}
      isLoading={false}
      isError={false}
      organizationId="vertaware-org"
      nameDraft=""
      canSave={false}
      isSaving={false}
      deletingViewId={null}
      onNameDraftChange={vi.fn()}
      onSave={vi.fn()}
      onApply={onApply}
      onDelete={vi.fn()}
      onRetry={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Apply Legacy inbox" }));
  expect(onApply).toHaveBeenCalledWith(legacyView);

  const applied = applySavedViewFilters(new URLSearchParams("status=closed&page=4&query=stale"), legacyView.filters);
  expect(applied.get("status")).toBe("new");
  expect(applied.getAll("labels")).toEqual(["bug", "blocker"]);
  expect(applied.get("sortBy")).toBe("severity");
  expect(applied.get("sortDir")).toBe("asc");
  expect(applied.get("query")).toBeNull();
  expect(applied.get("page")).toBe("1");
});

test("saved view form submits the current named view exactly once", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();

  render(
    <SavedViewsPanel
      id="saved-views-create"
      views={[]}
      isLoading={false}
      isError={false}
      organizationId="vertaware-org"
      nameDraft="Checkout failures"
      canSave
      isSaving={false}
      deletingViewId={null}
      onNameDraftChange={vi.fn()}
      onSave={onSave}
      onApply={vi.fn()}
      onDelete={vi.fn()}
      onRetry={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Save view" }));
  expect(onSave).toHaveBeenCalledTimes(1);
});

test("saved view load failure exposes one working Retry action", async () => {
  const user = userEvent.setup();
  const onRetry = vi.fn();

  render(
    <SavedViewsPanel
      id="saved-views-retry"
      views={[]}
      isLoading={false}
      isError
      organizationId="vertaware-org"
      nameDraft=""
      canSave={false}
      isSaving={false}
      deletingViewId={null}
      onNameDraftChange={vi.fn()}
      onSave={vi.fn()}
      onApply={vi.fn()}
      onDelete={vi.fn()}
      onRetry={onRetry}
    />,
  );

  expect(screen.getByText("Couldn't load saved views.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
