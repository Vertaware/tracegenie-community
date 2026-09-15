import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ToastContainer, useToast } from "../src/components/ui/Toast";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function ToastHarness() {
  const { toasts, addToast, dismissToast, dismissAllToasts } = useToast();

  return (
    <div id="toast-test-harness">
      <button type="button" onClick={() => addToast("error", "Copy failed", "clipboard-token")}>Fail token copy</button>
      <button type="button" onClick={() => addToast("success", "Token copied", "clipboard-token")}>Retry token copy</button>
      <button type="button" onClick={() => addToast("info", "Endpoint ready", "clipboard-endpoint")}>Show endpoint info</button>
      <button type="button" onClick={() => addToast("success", "First unscoped")}>Show first unscoped</button>
      <button type="button" onClick={() => addToast("success", "Second unscoped")}>Show second unscoped</button>
      <button type="button" onClick={dismissAllToasts}>Clear notifications</button>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function IssueToastScopeHarness() {
  const { toasts, addToast, dismissToast } = useToast();

  return (
    <div id="issue-toast-scope-test-harness">
      <button type="button" onClick={() => addToast("error", "Labels could not be saved", "issue:issue-a:labels")}>
        Fail labels
      </button>
      <button type="button" onClick={() => addToast("success", "Labels saved", "issue:issue-a:labels")}>
        Save labels
      </button>
      <button type="button" onClick={() => addToast("error", "External links need a label and URL.", "issue:issue-a:external-refs")}>
        Fail external links
      </button>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function PendingToastHarness({ request }: { request: Promise<void> }) {
  const { toasts, addToast, dismissToast } = useToast();

  return (
    <div id="pending-toast-test-harness">
      <button
        type="button"
        onClick={() => {
          void request.then(() => addToast("success", "Late copy result", "clipboard-token"));
        }}
      >
        Start copy
      </button>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("same-scope replacement resets its timer while other scopes coexist", () => {
  vi.useFakeTimers();
  render(<ToastHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Fail token copy" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Copy failed");

  act(() => vi.advanceTimersByTime(3000));
  fireEvent.click(screen.getByRole("button", { name: "Retry token copy" }));
  fireEvent.click(screen.getByRole("button", { name: "Show endpoint info" }));

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("Token copied")).toBeInTheDocument();
  expect(screen.getByText("Endpoint ready")).toBeInTheDocument();

  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText("Token copied")).toBeInTheDocument();

  act(() => vi.advanceTimersByTime(7000));
  expect(screen.queryAllByRole("status")).toHaveLength(0);
});

test("unscoped callers remain additive and each toast has the correct live semantics", () => {
  render(<ToastHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Show first unscoped" }));
  fireEvent.click(screen.getByRole("button", { name: "Show second unscoped" }));
  fireEvent.click(screen.getByRole("button", { name: "Fail token copy" }));

  expect(screen.getByText("First unscoped")).toBeInTheDocument();
  expect(screen.getByText("Second unscoped")).toBeInTheDocument();
  expect(screen.getAllByRole("status")).toHaveLength(2);
  expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  expect(screen.getAllByRole("status")[0]).toHaveAttribute("aria-live", "polite");
});

test("issue action scopes replace only their own feedback and retain action-specific live roles", () => {
  render(<IssueToastScopeHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Fail labels" }));
  fireEvent.click(screen.getByRole("button", { name: "Save labels" }));
  fireEvent.click(screen.getByRole("button", { name: "Fail external links" }));

  expect(screen.getByText("Labels could not be saved").closest("[data-toast-scope]")).toHaveAttribute("inert");
  expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Labels saved");
  expect(screen.getByRole("alert")).toHaveTextContent("External links need a label and URL.");
  expect(screen.getByText("Labels saved").closest("[data-toast-scope]"))
    .toHaveAttribute("data-toast-scope", "issue:issue-a:labels");
  expect(screen.getByText("External links need a label and URL.").closest("[data-toast-scope]"))
    .toHaveAttribute("data-toast-scope", "issue:issue-a:external-refs");
});

test("a pending producer cannot create a toast timer after the hook unmounts", async () => {
  vi.useFakeTimers();
  const request = deferred<void>();
  const view = render(<PendingToastHarness request={request.promise} />);

  fireEvent.click(screen.getByRole("button", { name: "Start copy" }));
  view.unmount();

  await act(async () => {
    request.resolve();
    await request.promise;
  });

  expect(vi.getTimerCount()).toBe(0);
});

test("clearing all notifications removes every scope and cancels their timers", () => {
  vi.useFakeTimers();
  render(<ToastHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Fail token copy" }));
  fireEvent.click(screen.getByRole("button", { name: "Show endpoint info" }));
  expect(vi.getTimerCount()).toBe(2);

  fireEvent.click(screen.getByRole("button", { name: "Clear notifications" }));

  expect(screen.queryAllByRole("status")).toHaveLength(0);
  expect(screen.queryAllByRole("alert")).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("hovering or focusing a toast pauses auto-dismiss until the pointer and focus leave", () => {
  vi.useFakeTimers();
  render(<ToastHarness />);

  fireEvent.click(screen.getByRole("button", { name: "Fail token copy" }));
  const toast = screen.getByRole("alert");

  fireEvent.pointerEnter(toast);
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByRole("alert")).toBeInTheDocument();

  fireEvent.pointerLeave(toast);
  act(() => vi.advanceTimersByTime(7999));
  expect(screen.getByRole("alert")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Fail token copy" }));
  const nextToast = screen.getByRole("alert");
  const dismiss = screen.getByRole("button", { name: "Dismiss notification" });
  fireEvent.focusIn(dismiss);
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByRole("alert")).toBeInTheDocument();

  fireEvent.focusOut(dismiss, { relatedTarget: document.body });
  act(() => vi.advanceTimersByTime(8000));
  expect(nextToast).toHaveAttribute("inert");
  expect(nextToast).toHaveAttribute("aria-hidden", "true");
});
