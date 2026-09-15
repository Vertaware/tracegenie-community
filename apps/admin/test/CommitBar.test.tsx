import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { CommitBar } from "../src/components/ui/CommitBar";

afterEach(() => {
  cleanup();
});

test("renders nothing until a commit is needed", () => {
  render(
    <CommitBar
      isVisible={false}
      isPending={false}
      status="Unsaved changes"
      onDiscard={vi.fn()}
      onSave={vi.fn()}
      saveLabel="Save changes"
    />,
  );

  expect(screen.queryByRole("complementary", { name: "Unsaved changes" })).not.toBeInTheDocument();
});

test("uses paired responsive actions and prevents duplicate work while pending", async () => {
  const user = userEvent.setup();
  const onDiscard = vi.fn();
  const onSave = vi.fn();
  const { rerender } = render(
    <CommitBar
      isVisible
      isPending={false}
      status="Unsaved changes"
      onDiscard={onDiscard}
      onSave={onSave}
      saveLabel="Save changes"
    />,
  );

  await user.click(screen.getByRole("button", { name: "Discard" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(onDiscard).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledTimes(1);

  rerender(
    <CommitBar
      isVisible
      isPending
      status="Unsaved changes"
      onDiscard={onDiscard}
      onSave={onSave}
      saveLabel="Save changes"
      savingLabel="Saving..."
    />,
  );

  expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
});
