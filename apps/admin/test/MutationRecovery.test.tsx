import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  latestMutationRecoveryEntry,
  MutationRecovery,
  type MutationRecoveryEntry,
} from "../src/components/ui/MutationRecovery";

afterEach(cleanup);

function entry(overrides: Partial<MutationRecoveryEntry> = {}): MutationRecoveryEntry {
  return {
    id: "save-project",
    message: "Couldn't save Checkout.",
    successMessage: "Checkout saved.",
    retryLabel: "Retry saving Checkout",
    status: "error",
    submittedAt: 100,
    retry: vi.fn(),
    ...overrides,
  };
}

test("latest submitted workflow owns mutation recovery feedback", () => {
  const staleFailure = entry({ id: "invite", submittedAt: 100 });
  const currentFailure = entry({ id: "project", submittedAt: 200 });

  expect(latestMutationRecoveryEntry([currentFailure, staleFailure])).toBe(currentFailure);
  expect(latestMutationRecoveryEntry([entry({ submittedAt: 0 })])).toBeNull();
});

test("monotonic workflow order breaks same-millisecond submission ties", () => {
  const staleFailure = entry({ id: "invite", submittedAt: 100, workflowOrder: 10 });
  const currentFailure = entry({ id: "project", submittedAt: 100, workflowOrder: 11 });

  expect(latestMutationRecoveryEntry([currentFailure, staleFailure])).toBe(currentFailure);
});

test("a newer pending or successful workflow clears unrelated stale failure feedback", () => {
  const failed = entry({ submittedAt: 100 });
  const { rerender } = render(
    <MutationRecovery entries={[failed]} />,
  );

  expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save Checkout.");

  rerender(<MutationRecovery entries={[failed, entry({ id: "invite", status: "pending", submittedAt: 200 })]} />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  rerender(<MutationRecovery entries={[failed, entry({ id: "invite", status: "success", submittedAt: 200 })]} />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Checkout saved.");
});

test("retry is scoped, preserves input copy, and blocks duplicate activation", async () => {
  const user = userEvent.setup();
  const retry = vi.fn();

  render(
    <MutationRecovery entries={[entry({ retry })]} />,
  );

  expect(screen.getByRole("alert")).toHaveTextContent("Your previous input is unchanged.");
  const retryButton = screen.getByRole("button", { name: "Retry saving Checkout" });
  await user.dblClick(retryButton);

  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Retrying..." })).toBeDisabled();
});
