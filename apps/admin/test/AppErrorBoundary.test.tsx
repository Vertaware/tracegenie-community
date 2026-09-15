import { cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { AppErrorBoundary } from "../src/app/AppErrorBoundary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("renders the app when startup succeeds", () => {
  render(<AppErrorBoundary><h1>My tickets</h1></AppErrorBoundary>);
  expect(screen.getByRole("heading", { name: "My tickets" })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test.each(["render", "effect"])("a provider %s failure shows recovery without exposing diagnostic data", (phase) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  function FailingProvider() {
    useEffect(() => {
      if (phase === "effect") throw new Error("Private diagnostic details");
    }, []);
    if (phase === "render") throw new Error("Private diagnostic details");
    return <h1>My tickets</h1>;
  }

  render(<AppErrorBoundary><FailingProvider /></AppErrorBoundary>);
  expect(screen.getByRole("alert")).toHaveTextContent("TraceGenie couldn’t load");
  expect(screen.getByRole("link", { name: "Reload page" })).toHaveAttribute("href", window.location.href);
  expect(screen.queryByText("Private diagnostic details")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "My tickets" })).not.toBeInTheDocument();
});
