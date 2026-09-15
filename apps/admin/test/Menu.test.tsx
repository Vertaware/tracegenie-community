import { StrictMode, useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Menu, MenuContent, MenuItem, MenuTrigger } from "../src/components/ui/Menu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderMenu(onFirstSelect = vi.fn()) {
  return render(
    <div id="menu-test-page">
      <button type="button">Before</button>
      <Menu id="test-menu">
        <MenuTrigger>Account</MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={onFirstSelect}>Profile</MenuItem>
          <MenuItem>Preferences</MenuItem>
          <MenuItem>Sign out</MenuItem>
        </MenuContent>
      </Menu>
      <button type="button">After</button>
    </div>,
  );
}

function SelectionDismissKeyMenu() {
  const [dismissKey, setDismissKey] = useState("initial");
  return (
    <Menu id="dismiss-key-menu" dismissKey={dismissKey}>
      <MenuTrigger>Dismiss-key account</MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => setDismissKey("selected")}>Change route key</MenuItem>
      </MenuContent>
    </Menu>
  );
}

test("connects a uniquely identified trigger and menu with non-modal ARIA", async () => {
  const user = userEvent.setup();
  render(
    <div id="unique-menu-page">
      <Menu id="first-menu">
        <MenuTrigger>First account</MenuTrigger>
        <MenuContent>
          <MenuItem>First action</MenuItem>
        </MenuContent>
      </Menu>
      <Menu id="second-menu">
        <MenuTrigger>Second account</MenuTrigger>
        <MenuContent>
          <MenuItem>Second action</MenuItem>
        </MenuContent>
      </Menu>
    </div>,
  );

  const firstTrigger = screen.getByRole("button", { name: "First account" });
  const secondTrigger = screen.getByRole("button", { name: "Second account" });
  expect(firstTrigger).toHaveAttribute("aria-haspopup", "menu");
  expect(firstTrigger).toHaveAttribute("aria-expanded", "false");
  expect(firstTrigger.id).not.toBe(secondTrigger.id);
  expect(firstTrigger.getAttribute("aria-controls")).not.toBe(secondTrigger.getAttribute("aria-controls"));

  await user.click(firstTrigger);
  const menu = screen.getByRole("menu");
  expect(firstTrigger).toHaveAttribute("aria-expanded", "true");
  expect(menu).toHaveAttribute("id", firstTrigger.getAttribute("aria-controls"));
  expect(menu).toHaveAttribute("aria-labelledby", firstTrigger.id);
  expect(menu).not.toHaveAttribute("aria-modal");
  expect(document.body.style.overflow).toBe("");
  expect(document.querySelector("[data-scrim]")).not.toBeInTheDocument();
});

test.each(["{Enter}", " "])("opens from the trigger with %s and focuses the first item", async (key) => {
  const user = userEvent.setup();
  renderMenu();
  const trigger = screen.getByRole("button", { name: "Account" });

  trigger.focus();
  await user.keyboard(key);
  expect(screen.getByRole("menu")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("menuitem", { name: "Profile" })).toHaveFocus());
});

test("opens with ArrowDown or ArrowUp and focuses the requested edge item", async () => {
  const user = userEvent.setup();
  renderMenu();
  const trigger = screen.getByRole("button", { name: "Account" });

  trigger.focus();
  await user.keyboard("{ArrowDown}");
  await waitFor(() => expect(screen.getByRole("menuitem", { name: "Profile" })).toHaveFocus());
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());

  await user.keyboard("{ArrowUp}");
  await waitFor(() => expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus());
});

test("wraps arrows and supports Home and End", async () => {
  const user = userEvent.setup();
  renderMenu();
  const trigger = screen.getByRole("button", { name: "Account" });

  trigger.focus();
  await user.keyboard("{ArrowDown}{ArrowUp}");
  expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Profile" })).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
  await user.keyboard("{Home}");
  expect(screen.getByRole("menuitem", { name: "Profile" })).toHaveFocus();
});

test("Escape closes and restores trigger focus", async () => {
  const user = userEvent.setup();
  renderMenu();
  const trigger = screen.getByRole("button", { name: "Account" });

  await user.click(trigger);
  await user.keyboard("{ArrowDown}{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("Escape also closes when click-opening leaves focus on the trigger", async () => {
  const user = userEvent.setup();
  renderMenu();
  const trigger = screen.getByRole("button", { name: "Account" });

  await user.click(trigger);
  expect(trigger).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("outside pointer and focus dismiss without stealing destination focus", async () => {
  const user = userEvent.setup();
  renderMenu();
  const trigger = screen.getByRole("button", { name: "Account" });
  const after = screen.getByRole("button", { name: "After" });

  await user.click(trigger);
  await user.click(after);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(after).toHaveFocus();

  await user.click(trigger);
  after.focus();
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  expect(after).toHaveFocus();
});

test("Tab dismisses and preserves natural forward and backward destinations", async () => {
  const user = userEvent.setup();
  renderMenu();
  const before = screen.getByRole("button", { name: "Before" });
  const trigger = screen.getByRole("button", { name: "Account" });
  const after = screen.getByRole("button", { name: "After" });

  await user.click(trigger);
  await user.tab();
  expect(after).toHaveFocus();
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

  await user.click(trigger);
  await user.tab({ shift: true });
  expect(before).toHaveFocus();
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
});

test("Tab from a focused menu item dismisses without trapping focus", async () => {
  const user = userEvent.setup();
  renderMenu();
  const trigger = screen.getByRole("button", { name: "Account" });
  const after = screen.getByRole("button", { name: "After" });

  trigger.focus();
  await user.keyboard("{ArrowDown}");
  await waitFor(() => expect(screen.getByRole("menuitem", { name: "Profile" })).toHaveFocus());
  await user.tab();
  expect(after).toHaveFocus();
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
});

test("closes before invoking a selected action", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn(() => {
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
  renderMenu(onSelect);

  await user.click(screen.getByRole("button", { name: "Account" }));
  await user.click(screen.getByRole("menuitem", { name: "Profile" }));
  expect(onSelect).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.getByRole("button", { name: "Account" })).toHaveFocus());
});

test("does not steal focus when a selected action focuses its destination", async () => {
  const destination = document.createElement("button");
  destination.type = "button";
  destination.textContent = "Destination";
  document.body.append(destination);
  const user = userEvent.setup();
  renderMenu(() => destination.focus());

  await user.click(screen.getByRole("button", { name: "Account" }));
  await user.click(screen.getByRole("menuitem", { name: "Profile" }));
  await waitFor(() => expect(destination).toHaveFocus());
  destination.remove();
});

test("selection-driven dismiss-key changes preserve the trigger fallback", async () => {
  const user = userEvent.setup();
  render(<SelectionDismissKeyMenu />);

  const trigger = screen.getByRole("button", { name: "Dismiss-key account" });
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "Change route key" }));
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("keeps disabled items in arrow navigation but blocks keyboard and pointer activation", async () => {
  const onDisabledSelect = vi.fn();
  const user = userEvent.setup();
  render(
    <Menu id="disabled-menu">
      <MenuTrigger>Actions</MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={vi.fn()}>Enabled</MenuItem>
        <MenuItem disabled onSelect={onDisabledSelect}>Native disabled input</MenuItem>
        <MenuItem aria-disabled="true" onSelect={onDisabledSelect}>ARIA disabled input</MenuItem>
      </MenuContent>
    </Menu>,
  );

  const trigger = screen.getByRole("button", { name: "Actions" });
  trigger.focus();
  await user.keyboard("{ArrowDown}{ArrowDown}");
  const nativeDisabled = screen.getByRole("menuitem", { name: "Native disabled input" });
  expect(nativeDisabled).toHaveFocus();
  expect(nativeDisabled).toHaveAttribute("aria-disabled", "true");
  expect(nativeDisabled).not.toHaveAttribute("disabled");
  await user.keyboard("{Enter}{ArrowDown} ");
  const ariaDisabled = screen.getByRole("menuitem", { name: "ARIA disabled input" });
  expect(ariaDisabled).toHaveFocus();
  await user.click(ariaDisabled);
  expect(onDisabledSelect).not.toHaveBeenCalled();
  expect(screen.getByRole("menu")).toBeInTheDocument();
});

test("opening a second menu closes the first without restoring first-trigger focus", async () => {
  const user = userEvent.setup();
  render(
    <div id="exclusive-menu-page">
      <Menu id="exclusive-first">
        <MenuTrigger>First</MenuTrigger>
        <MenuContent><MenuItem>First action</MenuItem></MenuContent>
      </Menu>
      <Menu id="exclusive-second">
        <MenuTrigger>Second</MenuTrigger>
        <MenuContent><MenuItem>Second action</MenuItem></MenuContent>
      </Menu>
    </div>,
  );

  await user.click(screen.getByRole("button", { name: "First" }));
  await user.click(screen.getByRole("button", { name: "Second" }));
  expect(screen.queryByRole("menuitem", { name: "First action" })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Second action" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Second" })).toHaveFocus();
});

test("StrictMode cleanup removes listeners and cancels pending focus restoration", async () => {
  let nextFrameId = 1;
  const pendingFrames = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const frameId = nextFrameId;
    nextFrameId += 1;
    pendingFrames.set(frameId, callback);
    return frameId;
  });
  const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frameId) => {
    pendingFrames.delete(frameId);
  });
  const addEventListener = vi.spyOn(document, "addEventListener");
  const removeEventListener = vi.spyOn(document, "removeEventListener");
  const user = userEvent.setup();
  const view = render(
    <StrictMode>
      <Menu id="strict-menu">
        <MenuTrigger>Strict account</MenuTrigger>
        <MenuContent><MenuItem>Strict action</MenuItem></MenuContent>
      </Menu>
    </StrictMode>,
  );

  const trigger = screen.getByRole("button", { name: "Strict account" });
  trigger.focus();
  const listenerCallStart = addEventListener.mock.calls.length;
  await user.keyboard("{ArrowDown}{Escape}");

  const pendingFrameIds = [...pendingFrames.keys()];
  expect(pendingFrameIds).toHaveLength(1);
  const pendingFrameId = pendingFrameIds[0];
  const menuListenerAdds = addEventListener.mock.calls
    .slice(listenerCallStart)
    .filter(([type]) => type === "pointerdown" || type === "focusin" || type === "keydown");

  expect(menuListenerAdds.map(([type]) => type).sort()).toEqual(["focusin", "keydown", "pointerdown"]);
  view.unmount();
  expect(cancelAnimationFrame).toHaveBeenCalledWith(pendingFrameId);
  expect(pendingFrames).toHaveLength(0);
  for (const [type, listener, options] of menuListenerAdds) {
    if (options === undefined) {
      expect(removeEventListener).toHaveBeenCalledWith(type, listener);
    } else {
      expect(removeEventListener).toHaveBeenCalledWith(type, listener, options);
    }
  }

  renderMenu();
  await user.click(screen.getByRole("button", { name: "Account" }));
  await user.click(screen.getByRole("button", { name: "After" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
