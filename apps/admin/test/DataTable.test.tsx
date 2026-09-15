import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import {
  HeaderFilterMenu,
  RowButton,
  Table,
  TableCommandBar,
  TableCommandButton,
  TableDetailAction,
  TableSelectionHeader,
  Td,
  tableColumnClass,
} from "../src/components/ui/DataTable";

afterEach(cleanup);

function HeaderFilterHarness() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const toggle = (menuKey: string) => setOpenMenu((current) => (current === menuKey ? null : menuKey));

  return (
    <div>
      <HeaderFilterMenu
        menuKey="name"
        openMenu={openMenu}
        onToggle={toggle}
        label="Filter by name"
        icon={<span aria-hidden="true">N</span>}
      >
        <input aria-label="Name contains" />
        <button type="button">Apply name</button>
      </HeaderFilterMenu>
      <HeaderFilterMenu
        menuKey="status"
        openMenu={openMenu}
        onToggle={toggle}
        label="Filter by status"
        icon={<span aria-hidden="true">S</span>}
      >
        <select aria-label="Status">
          <option>Open</option>
        </select>
        <button type="button">Apply status</button>
      </HeaderFilterMenu>
      <button type="button">Outside action</button>
    </div>
  );
}

function IndependentFilterHarness() {
  const [nameOpen, setNameOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  return (
    <div>
      <HeaderFilterMenu
        menuKey="name"
        openMenu={nameOpen ? "name" : null}
        onToggle={() => setNameOpen((current) => !current)}
        label="Filter by name"
        icon={<span aria-hidden="true">N</span>}
      >
        <input aria-label="Name contains" />
      </HeaderFilterMenu>
      <HeaderFilterMenu
        menuKey="status"
        openMenu={statusOpen ? "status" : null}
        onToggle={() => setStatusOpen((current) => !current)}
        label="Filter by status"
        icon={<span aria-hidden="true">S</span>}
      >
        <select aria-label="Status">
          <option>Open</option>
        </select>
      </HeaderFilterMenu>
      <button type="button">Outside action</button>
    </div>
  );
}

function SelectableRowsHarness({
  onActivateFirst = vi.fn(),
  onActivateLocked = vi.fn(),
}: {
  onActivateFirst?: () => void;
  onActivateLocked?: () => void;
} = {}) {
  const [selected, setSelected] = useState<string[]>([]);
  const selectableIds = ["first", "second"];
  const allSelected = selectableIds.every((id) => selected.includes(id));

  return (
    <div>
      <Table>
        <thead>
          <tr>
            <TableSelectionHeader
              checked={allSelected}
              indeterminate={selected.length > 0 && !allSelected}
              ariaLabel="Select all rows"
              onCheckedChange={(checked) => setSelected(checked ? selectableIds : [])}
            />
            <th>Issue</th>
          </tr>
        </thead>
        <tbody>
          <RowButton
            ariaLabel="First issue row"
            onActivate={onActivateFirst}
            selection={{
              checked: selected.includes("first"),
              ariaLabel: "Select first issue",
              onCheckedChange: (checked) => setSelected(checked ? ["first"] : []),
            }}
          >
            <Td>
              <button type="button" onClick={onActivateFirst}>Open first issue</button>
            </Td>
          </RowButton>
          <RowButton
            ariaLabel="Locked issue row"
            onActivate={onActivateLocked}
            selection={{
              checked: false,
              disabled: true,
              ariaLabel: "Select locked issue",
              onCheckedChange: () => setSelected(["locked"]),
            }}
          >
            <Td>Locked issue</Td>
          </RowButton>
          <RowButton
            ariaLabel="Second issue row"
            onActivate={onActivateFirst}
            selection={{
              checked: selected.includes("second"),
              ariaLabel: "Select second issue",
              onCheckedChange: (checked) => setSelected((current) => checked ? [...new Set([...current, "second"])] : current.filter((id) => id !== "second")),
            }}
          >
            <Td>Second issue</Td>
          </RowButton>
        </tbody>
      </Table>
      <output data-testid="selected-rows">{selected.join(",")}</output>
    </div>
  );
}

test("header filter links its trigger and dialog and focuses the first control on keyboard open", async () => {
  const user = userEvent.setup();
  render(<HeaderFilterHarness />);

  const trigger = screen.getByRole("button", { name: "Filter by name" });
  trigger.focus();
  await user.keyboard("{Enter}");

  const dialog = screen.getByRole("dialog", { name: "Filter by name" });
  expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(trigger).toHaveAttribute("aria-controls", dialog.id);
  expect(dialog).toHaveAttribute("aria-labelledby", screen.getByText("Filter by name").id);
  expect(screen.getByRole("textbox", { name: "Name contains" })).toHaveFocus();

  screen.getByRole("button", { name: "Apply name" }).focus();
  fireEvent.resize(window);
  expect(screen.getByRole("button", { name: "Apply name" })).toHaveFocus();
});

test("header filter is non-modal and Escape restores the trigger", async () => {
  const user = userEvent.setup();
  render(<HeaderFilterHarness />);

  const trigger = screen.getByRole("button", { name: "Filter by name" });
  await user.click(trigger);
  expect(screen.getByRole("textbox", { name: "Name contains" })).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Filter by name" })).not.toBeInTheDocument();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveFocus();
});

test("independent header filters treat another trigger as outside and focus the newly opened menu", async () => {
  const user = userEvent.setup();
  render(<IndependentFilterHarness />);

  await user.click(screen.getByRole("button", { name: "Filter by name" }));
  await user.click(screen.getByRole("button", { name: "Filter by status" }));

  expect(screen.queryByRole("dialog", { name: "Filter by name" })).not.toBeInTheDocument();
  const statusDialog = screen.getByRole("dialog", { name: "Filter by status" });
  const statusTrigger = screen.getByRole("button", { name: "Filter by status" });
  expect(statusTrigger).toHaveAttribute("aria-controls", statusDialog.id);
  expect(screen.getByRole("combobox", { name: "Status" })).toHaveFocus();

  await user.click(screen.getByRole("button", { name: "Outside action" }));
  expect(screen.queryByRole("dialog", { name: "Filter by status" })).not.toBeInTheDocument();
});

test("header filter closes when focus escapes and removes document listeners after dismissal", async () => {
  const user = userEvent.setup();
  render(<HeaderFilterHarness />);

  const trigger = screen.getByRole("button", { name: "Filter by name" });
  const outside = screen.getByRole("button", { name: "Outside action" });
  await user.click(trigger);

  outside.focus();
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "Filter by name" })).not.toBeInTheDocument();
  });
  expect(outside).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Filter by name" })).not.toBeInTheDocument();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("header filter also opens with Space", async () => {
  const user = userEvent.setup();
  render(<HeaderFilterHarness />);

  screen.getByRole("button", { name: "Filter by status" }).focus();
  await user.keyboard(" ");

  expect(screen.getByRole("dialog", { name: "Filter by status" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Status" })).toHaveFocus();
});

test("table command buttons expose visible context and panel relationships", async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();

  render(
    <TableCommandBar ariaLabel="Issue table commands">
      <TableCommandButton
        icon={<span>F</span>}
        label="Filters"
        value="2 active"
        badge={2}
        active
        expanded={false}
        controls="issue-filters"
        onClick={onClick}
      />
      <TableCommandButton
        icon={<span>C</span>}
        label="CSV"
        value="Current page"
        onClick={onClick}
      />
    </TableCommandBar>,
  );

  const commandGroup = screen.getByRole("group", { name: "Issue table commands" });
  expect(within(commandGroup).getByText("2 active")).toBeVisible();
  expect(within(commandGroup).getByText("Current page")).toBeVisible();

  const filters = within(commandGroup).getByRole("button", { name: /Filters/ });
  expect(filters).toHaveAttribute("aria-expanded", "false");
  expect(filters).toHaveAttribute("aria-controls", "issue-filters");
  expect(filters).toHaveTextContent("2", { normalizeWhitespace: true });

  const csv = within(commandGroup).getByRole("button", { name: /CSV/ });
  expect(csv).not.toHaveAttribute("aria-expanded");
  expect(csv).not.toHaveAttribute("aria-controls");
  await user.click(csv);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test("selectable rows keep native row semantics and checkbox pointer activation out of row navigation", async () => {
  const user = userEvent.setup();
  const onActivateFirst = vi.fn();
  render(<SelectableRowsHarness onActivateFirst={onActivateFirst} />);

  const row = screen.getByRole("row", { name: "First issue row" });
  const checkbox = screen.getByRole("checkbox", { name: "Select first issue" });
  expect(row).not.toHaveAttribute("role", "button");
  expect(row).toHaveAttribute("aria-selected", "false");

  await user.click(checkbox);

  expect(checkbox).toBeChecked();
  expect(row).toHaveAttribute("aria-selected", "true");
  expect(row).toHaveClass("bg-primary-light/60");
  expect(onActivateFirst).not.toHaveBeenCalled();
});

test("selectable row checkbox toggles with keyboard without activating the row", async () => {
  const user = userEvent.setup();
  const onActivateFirst = vi.fn();
  render(<SelectableRowsHarness onActivateFirst={onActivateFirst} />);

  const checkbox = screen.getByRole("checkbox", { name: "Select first issue" });
  checkbox.focus();
  await user.keyboard(" ");

  expect(checkbox).toBeChecked();
  expect(checkbox).toHaveFocus();
  expect(onActivateFirst).not.toHaveBeenCalled();
});

test("selectable rows preserve independent accessible activation and ignore nested interactive bubbling", async () => {
  const user = userEvent.setup();
  const onActivateFirst = vi.fn();
  const onActivateLocked = vi.fn();
  render(<SelectableRowsHarness onActivateFirst={onActivateFirst} onActivateLocked={onActivateLocked} />);

  const open = screen.getByRole("button", { name: "Open first issue" });
  open.focus();
  await user.keyboard("{Enter}");
  expect(onActivateFirst).toHaveBeenCalledTimes(1);

  await user.click(screen.getByText("Locked issue"));
  expect(onActivateLocked).toHaveBeenCalledTimes(1);
});

test("selection header selects only selectable rows and disabled row selection cannot change", async () => {
  const user = userEvent.setup();
  render(<SelectableRowsHarness />);

  const header = screen.getByRole("checkbox", { name: "Select all rows" });
  const locked = screen.getByRole("checkbox", { name: "Select locked issue" });
  expect(locked).toBeDisabled();

  await user.click(locked);
  expect(screen.getByTestId("selected-rows")).toHaveTextContent("");

  await user.click(header);
  expect(screen.getByTestId("selected-rows")).toHaveTextContent("first,second");
  expect(header).toBeChecked();
  expect(locked).not.toBeChecked();

  await user.click(header);
  expect(screen.getByTestId("selected-rows")).toHaveTextContent("");
  expect(header).not.toBeChecked();
});

test("selection header exposes the native mixed state for a partial eligible selection", async () => {
  const user = userEvent.setup();
  render(<SelectableRowsHarness />);

  const header = screen.getByRole("checkbox", { name: "Select all rows" });
  await user.click(screen.getByRole("checkbox", { name: "Select first issue" }));

  expect(header).not.toBeChecked();
  expect(header).toHaveAttribute("aria-checked", "mixed");
  expect((header as HTMLInputElement).indeterminate).toBe(true);
});

test("essential columns remain visible while supporting columns use the shared 1280px contract", async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  render(
    <Table>
      <thead>
        <tr>
          <th className={tableColumnClass("essential")}>Identity</th>
          <th className={tableColumnClass("supporting")}>Metadata</th>
          <th>Open</th>
        </tr>
      </thead>
      <tbody>
        <RowButton ariaLabel="Open contract row" onActivate={onOpen} activationControl>
          <Td className={tableColumnClass("essential")}>Visible identity</Td>
          <Td className={tableColumnClass("supporting")}>Hidden supporting metadata</Td>
          <Td>
            <TableDetailAction label="Open contract row details" onClick={onOpen} />
          </Td>
        </RowButton>
      </tbody>
    </Table>,
  );
  expect(screen.getByRole("columnheader", { name: "Identity" })).not.toHaveClass("hidden");
  expect(screen.getByRole("columnheader", { name: "Metadata" })).toHaveClass("hidden");
  const row = screen.getByRole("row", { name: "Open contract row" });
  expect(row).not.toHaveAttribute("role", "button");
  expect(row).not.toHaveAttribute("tabindex");
  await user.click(screen.getByRole("button", { name: "Open contract row details" }));
  expect(onOpen).toHaveBeenCalledOnce();
  await user.click(screen.getByText("Visible identity"));
  expect(onOpen).toHaveBeenCalledTimes(2);
});
