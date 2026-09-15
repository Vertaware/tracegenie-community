import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { Pagination } from "../src/components/ui/Pagination";

afterEach(cleanup);

test("renders the first page with a mobile range and disabled previous boundary", () => {
  render(<Pagination page={1} pageCount={5} total={50} pageSize={10} onPage={vi.fn()} />);

  expect(screen.getByText("1-10 of 50")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "Page 2" })).not.toHaveAttribute("aria-current");
});

test("renders a middle page and invokes previous, next, and numeric callbacks", async () => {
  const user = userEvent.setup();
  const onPage = vi.fn();
  render(<Pagination page={5} pageCount={10} total={100} pageSize={10} onPage={onPage} />);

  expect(screen.getByText("41-50 of 100")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Page 5" })).toHaveAttribute("aria-current", "page");

  await user.click(screen.getByRole("button", { name: "Previous page" }));
  await user.click(screen.getByRole("button", { name: "Next page" }));
  await user.click(screen.getByRole("button", { name: "Page 6" }));

  expect(onPage.mock.calls).toEqual([[4], [6], [6]]);
});

test("renders the last partial range with a disabled next boundary", async () => {
  const user = userEvent.setup();
  const onPage = vi.fn();
  render(<Pagination page={5} pageCount={5} total={47} pageSize={10} onPage={onPage} />);

  expect(screen.getByText("41-47 of 47")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(onPage).not.toHaveBeenCalled();
});

test("keeps desktop numeric navigation compact for a large page count", () => {
  render(<Pagination page={500} pageCount={1000} total={10_000} pageSize={10} onPage={vi.fn()} />);

  const navigation = screen.getByRole("navigation", { name: "Pagination" });
  expect(within(navigation).getAllByText("…")).toHaveLength(2);
  expect(within(navigation).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
    "Previous page",
    "Page 1",
    "Page 499",
    "Page 500",
    "Page 501",
    "Page 1000",
    "Next page",
  ]);
});

test("uses labeled 44px mobile targets while preserving desktop numeric structure", () => {
  render(<Pagination page={2} pageCount={4} onPage={vi.fn()} />);

  const previous = screen.getByRole("button", { name: "Previous page" });
  const next = screen.getByRole("button", { name: "Next page" });
  const numericPages = screen.getByRole("button", { name: "Page 2" }).parentElement;

  expect(previous).toHaveClass("h-11", "min-w-11", "sm:size-8", "sm:min-w-8");
  expect(next).toHaveClass("h-11", "min-w-11", "sm:size-8", "sm:min-w-8");
  expect(within(previous).getByText("Previous")).toHaveClass("sm:hidden");
  expect(within(next).getByText("Next")).toHaveClass("sm:hidden");
  expect(numericPages).toHaveClass("hidden", "sm:flex");
});

test("keeps single-page count and hide behavior stable", () => {
  const { rerender } = render(<Pagination page={1} pageCount={1} total={1} pageSize={10} onPage={vi.fn()} />);

  expect(screen.getByText("1 item")).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();

  rerender(
    <Pagination page={1} pageCount={1} total={1} pageSize={10} hideWhenSinglePage onPage={vi.fn()} />,
  );
  expect(screen.queryByText("1 item")).not.toBeInTheDocument();
});
