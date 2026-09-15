import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ListEmptyState, ListErrorState, ListLoadingState, ListStaleState } from "../src/components/ui/DataTable";
import { classifyAdminQueryState } from "../src/lib/queryState";

afterEach(cleanup);

test("query state keeps cached list data stale and distinguishes an unknown error from an empty result", () => {
  const stale = classifyAdminQueryState(
    { data: ["issue-1"], isPending: false, isFetching: false, isError: true },
    (items) => items.length === 0,
  );
  const failed = classifyAdminQueryState(
    { isPending: false, isFetching: false, isError: true },
    (items: string[]) => items.length === 0,
  );
  const empty = classifyAdminQueryState(
    { data: [], isPending: false, isFetching: false, isError: false },
    (items) => items.length === 0,
  );

  expect(stale.kind).toBe("stale");
  expect(failed.kind).toBe("error");
  expect(empty.kind).toBe("success-empty");
});

test("stale and failed list states announce their condition and keep retry available", async () => {
  const user = userEvent.setup();
  const retry = vi.fn();

  render(
    <div>
      <ListStaleState
        message="Showing the last loaded issues. Last updated today."
        retryLabel="Retry"
        onRetry={retry}
      />
      <ListErrorState message="Couldn't load issues." onRetry={retry} />
    </div>,
  );

  expect(screen.getByRole("status")).toHaveTextContent("Showing the last loaded issues");
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load issues.");
  await user.click(screen.getAllByRole("button", { name: "Retry" })[0]);
  expect(retry).toHaveBeenCalledTimes(1);
});

test("list state announces loading, empty, and error transitions and keeps retry available", async () => {
  const user = userEvent.setup();
  const retry = vi.fn();
  const { rerender } = render(<ListLoadingState rows={2} />);

  expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();

  rerender(
    <ListEmptyState
      icon={<span>0</span>}
      title="No issues found"
      body="Try changing your filters."
    />,
  );

  const emptyStatus = screen.getByRole("status");
  expect(emptyStatus).toHaveAttribute("aria-live", "polite");
  expect(emptyStatus).toHaveAttribute("aria-atomic", "true");
  expect(screen.getByText("0").parentElement).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByText("No issues found")).toBeInTheDocument();
  expect(screen.getByText("Try changing your filters.")).toBeInTheDocument();

  rerender(<ListErrorState message="Couldn't load issues." onRetry={retry} />);

  expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load issues.");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
});
