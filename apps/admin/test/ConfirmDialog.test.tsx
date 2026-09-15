import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfirmDialog } from "../src/components/ui/ConfirmDialog";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  document.body.removeAttribute("data-tg-overlay-scroll-locked");
});

function createTrigger() {
  const trigger = document.createElement("button");
  trigger.textContent = "Open dialog";
  document.body.append(trigger);
  trigger.focus();
  return trigger;
}

test("confirmation dialog traps focus and restores it after Escape", async () => {
  const user = userEvent.setup();
  const onCancel = vi.fn();
  const trigger = createTrigger();

  try {
    render(
      <ConfirmDialog
        isOpen
        title="Delete project?"
        description="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
    expect(trigger).toHaveFocus();
    trigger.remove();
  }
});

test("keeps focus stable while callbacks change and invokes the latest callbacks", async () => {
  const user = userEvent.setup();
  const firstCancel = vi.fn();
  const latestCancel = vi.fn();
  const latestConfirm = vi.fn();
  const trigger = createTrigger();
  const focusSpy = vi.spyOn(trigger, "focus");
  focusSpy.mockClear();

  const view = render(
    <ConfirmDialog
      isOpen
      title="Delete project?"
      description="This cannot be undone."
      onConfirm={vi.fn()}
      onCancel={firstCancel}
    />,
  );

  await user.tab();
  const confirmButton = screen.getByRole("button", { name: "Confirm" });
  expect(confirmButton).toHaveFocus();

  view.rerender(
    <ConfirmDialog
      isOpen
      title="Delete project?"
      description="This cannot be undone."
      onConfirm={latestConfirm}
      onCancel={latestCancel}
    />,
  );

  expect(confirmButton).toHaveFocus();
  await user.click(confirmButton);
  expect(latestConfirm).toHaveBeenCalledTimes(1);
  await user.keyboard("{Escape}");
  expect(firstCancel).not.toHaveBeenCalled();
  expect(latestCancel).toHaveBeenCalledTimes(1);

  view.unmount();
  expect(focusSpy).toHaveBeenCalledTimes(1);
  trigger.remove();
});

test("contains focus that moves outside the topmost dialog", () => {
  const trigger = createTrigger();
  const outside = document.createElement("button");
  outside.textContent = "Outside";
  document.body.append(outside);

  render(
    <ConfirmDialog
      isOpen
      title="Delete project?"
      description="This cannot be undone."
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  outside.focus();
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

  cleanup();
  trigger.remove();
  outside.remove();
});

test("suppresses Escape and backdrop dismissal while pending", async () => {
  const user = userEvent.setup();
  const onCancel = vi.fn();
  const view = render(
    <ConfirmDialog
      isOpen
      isPending
      title="Delete project?"
      description="This cannot be undone."
      onConfirm={vi.fn()}
      onCancel={onCancel}
    />,
  );

  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();

  await user.keyboard("{Escape}");
  fireEvent.mouseDown(dialog.parentElement as HTMLElement);
  expect(onCancel).not.toHaveBeenCalled();

  view.rerender(
    <ConfirmDialog
      isOpen
      title="Delete project?"
      description="This cannot be undone."
      onConfirm={vi.fn()}
      onCancel={onCancel}
    />,
  );
  expect(dialog).toHaveAttribute("aria-busy", "false");
  await user.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("keeps scrolling locked when a pre-existing overlay closes first", () => {
  document.body.style.overflow = "hidden";
  const dialog = render(
    <ConfirmDialog
      isOpen
      title="Delete project?"
      description="This cannot be undone."
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  document.body.style.overflow = "";
  expect(document.body).toHaveAttribute("data-tg-overlay-scroll-locked");
  expect(getComputedStyle(document.body).overflow).toBe("hidden");

  dialog.unmount();
  expect(document.body).not.toHaveAttribute("data-tg-overlay-scroll-locked");
  expect(document.body.style.overflow).toBe("");
});

test("does not overwrite an external overlay opened after the dialog", () => {
  document.body.style.overflow = "clip";
  const first = render(
    <ConfirmDialog
      isOpen
      title="First action?"
      description="First description."
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  expect(document.body).toHaveAttribute("data-tg-overlay-scroll-locked");
  expect(getComputedStyle(document.body).overflow).toBe("hidden");

  const second = render(
    <ConfirmDialog
      isOpen
      title="Second action?"
      description="Second description."
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  document.body.style.overflow = "hidden";
  first.unmount();
  expect(document.body).toHaveAttribute("data-tg-overlay-scroll-locked");
  expect(document.body.style.overflow).toBe("hidden");
  second.unmount();
  expect(document.body).not.toHaveAttribute("data-tg-overlay-scroll-locked");
  expect(document.body.style.overflow).toBe("hidden");

  document.body.style.overflow = "clip";
  expect(document.body.style.overflow).toBe("clip");
});

test("exposes only the top dialog and restores through the stack when it closes first", () => {
  const trigger = createTrigger();
  const first = render(
    <ConfirmDialog
      isOpen
      title="First action?"
      description="First description."
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  const second = render(
    <ConfirmDialog
      isOpen
      title="Second action?"
      description="Second description."
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  const dialogs = screen.getAllByRole("dialog", { hidden: true });
  const titleIds = dialogs.map((dialog) => dialog.getAttribute("aria-labelledby"));
  const descriptionIds = dialogs.map((dialog) => dialog.getAttribute("aria-describedby"));

  expect(screen.getByRole("dialog")).toHaveAccessibleName("Second action?");
  expect(dialogs[0]).not.toHaveAttribute("aria-modal");
  expect(dialogs[0].parentElement).toHaveAttribute("aria-hidden", "true");
  expect(dialogs[0].parentElement).toHaveAttribute("inert");
  expect(dialogs[1]).toHaveAttribute("aria-modal", "true");
  expect(dialogs[1].parentElement).not.toHaveAttribute("aria-hidden");
  expect(dialogs[1].parentElement).not.toHaveAttribute("inert");
  expect(new Set(titleIds).size).toBe(2);
  expect(new Set(descriptionIds).size).toBe(2);
  expect(within(dialogs[0]).getByText("First action?")).toHaveAttribute("id", titleIds[0]);
  expect(within(dialogs[0]).getByText("First description.")).toHaveAttribute("id", descriptionIds[0]);

  second.unmount();
  expect(screen.getByRole("dialog")).toHaveAccessibleName("First action?");
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  first.unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});

test("restores the original trigger when the lower dialog closes first", () => {
  const trigger = createTrigger();
  const first = render(
    <ConfirmDialog
      isOpen
      title="First action?"
      description="First description."
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  const second = render(
    <ConfirmDialog
      isOpen
      title="Second action?"
      description="Second description."
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  const topConfirm = screen.getByRole("button", { name: "Confirm" });
  topConfirm.focus();
  first.unmount();

  expect(screen.getByRole("dialog")).toHaveAccessibleName("Second action?");
  expect(topConfirm).toHaveFocus();

  second.unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});
