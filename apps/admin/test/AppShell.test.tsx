import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useNavigate } from "react-router-dom";

import { AdminFormExitGuardProvider, useAdminExitActions, useAdminFormExitGuard } from "../src/components/guards/AdminFormExitGuard";
import { APP_SHELL_FOCUSABLE, AppShell } from "../src/components/layout/AppShell";
import type { OrganizationDirectoryState, OrganizationOption } from "../src/components/layout/OrganizationSwitcher";
import { copy } from "../src/lib/copy";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

function renderAppShell() {
  return render(
    <MemoryRouter initialEntries={["/analytics"]}>
      <Routes>
        <Route element={<AppShell onSignOut={vi.fn()} userName="Admin" />}>
          <Route path="/analytics" element={<div id="analytics-content">Analytics content</div>} />
          <Route path="/issues" element={<div id="issues-content">Issues content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

test("skip link is the first keyboard stop and focuses the main landmark", async () => {
  const user = userEvent.setup();
  renderAppShell();

  await user.tab();
  const skipLink = screen.getByRole("link", { name: "Skip to main content" });
  expect(skipLink).toHaveFocus();

  await user.keyboard("{Enter}");
  expect(document.getElementById("admin-main-content")).toHaveFocus();
});

const ORGANIZATION_FIXTURES: OrganizationOption[] = [
  { id: "org-alpha", name: "Alpha Studio", slug: "alpha-studio", status: "ACTIVE" },
  { id: "org-beta", name: "Beta Works", slug: "beta-works", status: "ACTIVE" },
  { id: "org-gamma", name: "Gamma Labs", slug: "gamma-labs", status: "READ_ONLY" },
];

function renderOrganizationShell(
  initialEntry = "/analytics",
  {
    organizations = ORGANIZATION_FIXTURES,
    currentOrganizationId = "org-alpha",
    organizationsState = "ready",
    onOrganizationsRetry = vi.fn(),
  }: {
    organizations?: OrganizationOption[];
    currentOrganizationId?: string;
    organizationsState?: OrganizationDirectoryState;
    onOrganizationsRetry?: () => void;
  } = {},
) {
  const onOrganizationChange = vi.fn();
  const result = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          element={(
            <AppShell
              onSignOut={vi.fn()}
              userName="Ada Lovelace"
              userRole="ADMIN"
              platformRole="GLOBAL_ADMIN"
              organizations={organizations}
              organizationsState={organizationsState}
              currentOrganizationId={currentOrganizationId}
              onOrganizationChange={onOrganizationChange}
              onOrganizationsRetry={onOrganizationsRetry}
            />
          )}
        >
          <Route path="/analytics" element={<div>Analytics content</div>} />
          <Route path="/platform" element={<div>Platform content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return { ...result, onOrganizationChange, onOrganizationsRetry };
}

function MobileDirtyOrganizationShell() {
  const [organizationId, setOrganizationId] = useState("org-alpha");
  const { requestExit } = useAdminExitActions();
  useAdminFormExitGuard({
    id: "mobile-organization-switch-dirty-form",
    isDirty: true,
    isMutationPending: false,
    onDiscard: vi.fn(),
  });

  return (
    <AppShell
      onSignOut={vi.fn()}
      userName="Ada Lovelace"
      userRole="ADMIN"
      platformRole="GLOBAL_ADMIN"
      organizations={[
        { id: "org-alpha", name: "Alpha Studio" },
        { id: "org-beta", name: "Beta Works" },
      ]}
      currentOrganizationId={organizationId}
      onOrganizationChange={(nextOrganizationId) => {
        requestExit("organization-switch", () => setOrganizationId(nextOrganizationId));
      }}
    />
  );
}

function renderMobileDirtyOrganizationShell() {
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <AdminFormExitGuardProvider>
          <MobileDirtyOrganizationShell />
        </AdminFormExitGuardProvider>
      ),
      children: [{ path: "analytics", element: <div>Analytics content</div> }],
    },
  ], { initialEntries: ["/analytics"] });
  return render(<RouterProvider router={router} />);
}

function renderDesktopAccountMenu(onSignOut = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={["/analytics"]}>
      <Routes>
        <Route
          element={(
            <AppShell
              onSignOut={onSignOut}
              userName="Ada Lovelace"
              userId="user-1"
              userRole="ADMIN"
            />
          )}
        >
          <Route path="/analytics" element={<div>Analytics content</div>} />
          <Route path="/users/:id" element={<div>Profile content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function ProgrammaticNavigationControl() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/issues")}>Programmatic route change</button>
  );
}

function renderAccountMenuWithProgrammaticNavigation() {
  return render(
    <MemoryRouter initialEntries={["/analytics"]}>
      <Routes>
        <Route element={<AppShell onSignOut={vi.fn()} userName="Ada Lovelace" />}>
          <Route path="/analytics" element={<ProgrammaticNavigationControl />} />
          <Route path="/issues" element={<div>Programmatic destination</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

async function openMobileDrawer() {
  const user = userEvent.setup();
  const opener = screen.getByRole("button", { name: copy.common.menu });
  await user.click(opener);
  return { user, opener, dialog: screen.getByRole("dialog", { name: "TraceGenie" }) };
}

test("mobile drawer locks body scroll and restores the exact prior value", async () => {
  document.body.style.overflow = "scroll";
  renderAppShell();
  const { user } = await openMobileDrawer();

  expect(document.body.style.overflow).toBe("hidden");
  await user.click(screen.getAllByRole("button", { name: copy.common.closeMenu })[1]);
  expect(document.body.style.overflow).toBe("scroll");
});

test("mobile drawer has modal semantics and initially focuses its close button", async () => {
  renderAppShell();
  const { dialog } = await openMobileDrawer();

  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(screen.getAllByRole("button", { name: copy.common.closeMenu })[1]).toHaveFocus();
});

test("mobile drawer wraps focus forward from its last control", async () => {
  renderAppShell();
  const { user, dialog } = await openMobileDrawer();
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>(APP_SHELL_FOCUSABLE));

  controls.at(-1)?.focus();
  await user.tab();
  expect(controls[0]).toHaveFocus();
});

test("mobile drawer wraps focus backward from its first control", async () => {
  renderAppShell();
  const { user, dialog } = await openMobileDrawer();
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>(APP_SHELL_FOCUSABLE));

  controls[0].focus();
  await user.tab({ shift: true });
  expect(controls.at(-1)).toHaveFocus();
});

test("Escape closes the mobile drawer", async () => {
  renderAppShell();
  const { user } = await openMobileDrawer();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("the mobile drawer scrim closes the drawer", async () => {
  renderAppShell();
  const { user } = await openMobileDrawer();
  const scrim = document.getElementById("mobile-navigation-scrim");

  expect(scrim).not.toBeNull();
  await user.click(scrim!);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("closing the mobile drawer returns focus to its opener", async () => {
  renderAppShell();
  const { user, opener } = await openMobileDrawer();

  await user.click(screen.getAllByRole("button", { name: copy.common.closeMenu })[1]);
  expect(opener).toHaveFocus();
});

test("mobile drawer redirects an outside Tab back to its first control", async () => {
  renderAppShell();
  const { user, opener, dialog } = await openMobileDrawer();
  const firstControl = dialog.querySelector<HTMLElement>(APP_SHELL_FOCUSABLE);

  opener.focus();
  await user.tab();
  expect(firstControl).toHaveFocus();
});

test("mobile navigation closes without stealing focus from destination content", async () => {
  renderAppShell();
  const { user, opener, dialog } = await openMobileDrawer();

  await user.click(within(dialog).getByRole("link", { name: copy.nav.issues }));
  expect(await screen.findByText("Issues content")).toBeInTheDocument();
  await waitFor(() => expect(document.getElementById("admin-main-content")).toHaveFocus());
  expect(opener).not.toHaveFocus();
});

test("desktop breakpoint closes an open mobile drawer and restores page interaction", async () => {
  let breakpointListener: ((event: MediaQueryListEvent) => void) | undefined;
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    media: "(min-width: 768px)",
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      breakpointListener = listener;
    },
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
  renderAppShell();
  await openMobileDrawer();

  act(() => breakpointListener?.({ matches: true } as MediaQueryListEvent));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.body.style.overflow).toBe("");
  await waitFor(() => expect(document.getElementById("admin-main-content")).toHaveFocus());
});

test("desktop account menu uses the shared non-modal menu contract", async () => {
  const user = userEvent.setup();
  renderDesktopAccountMenu();
  const trigger = screen.getByRole("button", { name: "Account menu for Ada Lovelace" });

  expect(document.querySelector("#account-menu details")).not.toBeInTheDocument();
  expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.click(trigger);
  expect(screen.getByRole("menu")).not.toHaveAttribute("aria-modal");
  expect(document.body.style.overflow).toBe("");
});

test("desktop Profile closes the account menu before navigating", async () => {
  const user = userEvent.setup();
  renderDesktopAccountMenu();

  await user.click(screen.getByRole("button", { name: "Account menu for Ada Lovelace" }));
  await user.click(screen.getByRole("menuitem", { name: "Profile" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(await screen.findByText("Profile content")).toBeInTheDocument();
  await waitFor(() => expect(document.getElementById("admin-main-content")).toHaveFocus());
});

test("programmatic route changes close the persistent desktop account menu", async () => {
  const user = userEvent.setup();
  renderAccountMenuWithProgrammaticNavigation();

  await user.click(screen.getByRole("button", { name: "Account menu for Ada Lovelace" }));
  expect(screen.getByRole("menu")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Programmatic route change" }));
  expect(await screen.findByText("Programmatic destination")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
});

test("desktop Sign out closes the account menu before invoking the action", async () => {
  const user = userEvent.setup();
  const onSignOut = vi.fn(() => {
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
  renderDesktopAccountMenu(onSignOut);

  await user.click(screen.getByRole("button", { name: "Account menu for Ada Lovelace" }));
  await user.click(screen.getByRole("menuitem", { name: copy.nav.signOut }));
  expect(onSignOut).toHaveBeenCalledOnce();
});

test("organization switcher mounts recent organizations first and supports ranked keyboard search", async () => {
  window.localStorage.setItem("tracegenie.recentOrganizationIds", JSON.stringify(["org-gamma", "org-beta"]));
  const user = userEvent.setup();
  const { onOrganizationChange } = renderOrganizationShell();

  await user.click(screen.getByRole("button", { name: /Current organization: Alpha Studio/ }));
  const search = screen.getByRole("combobox", { name: "Search organizations" });
  const options = within(screen.getByRole("listbox", { name: "Recent organizations" })).getAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual([
    expect.stringContaining("Gamma Labs"),
    expect.stringContaining("Beta Works"),
  ]);

  await user.type(search, "beta");
  await user.keyboard("{Enter}");
  expect(onOrganizationChange).toHaveBeenCalledWith("org-beta");
});

test("organization search ranks exact matches and groups duplicate names by stable identity", async () => {
  const user = userEvent.setup();
  const organizations: OrganizationOption[] = [
    { id: "org-team-alpha", name: "Team Alpha", slug: "team-alpha", status: "ACTIVE" },
    { id: "org-alpha", name: "Alpha", slug: "alpha", status: "ACTIVE" },
    { id: "org-alphabet", name: "Alphabet", slug: "alphabet", status: "READ_ONLY" },
    { id: "org-duplicate-1", name: "Integration service test", slug: "integration-test-east", status: "ACTIVE" },
    { id: "org-duplicate-2", name: "Integration service test", slug: "integration-test-west", status: "SUSPENDED" },
  ];
  const { onOrganizationChange } = renderOrganizationShell("/analytics", {
    organizations,
    currentOrganizationId: "org-alpha",
  });

  await user.click(screen.getByRole("button", { name: /Current organization: Alpha/ }));
  const search = screen.getByRole("combobox", { name: "Search organizations" });
  await user.type(search, "alpha");

  expect(within(screen.getByRole("listbox", { name: "Organization search results" }))
    .getAllByRole("option")
    .map((option) => option.getAttribute("aria-label"))).toEqual([
    expect.stringMatching(/^Alpha,/),
    expect.stringMatching(/^Alphabet,/),
    expect.stringMatching(/^Team Alpha,/),
  ]);
  expect(within(screen.getByRole("listbox", { name: "Organization search results" })).getAllByRole("option")[0])
    .toHaveAttribute("aria-selected", "true");

  await user.clear(search);
  await user.type(search, "Integration service test");
  const duplicateGroup = screen.getByRole("group", { name: "Integration service test" });
  const duplicateOptions = within(duplicateGroup).getAllByRole("option");
  expect(duplicateOptions).toHaveLength(2);
  expect(duplicateOptions[0]).toHaveTextContent("integration-test-east");
  expect(duplicateOptions[1]).toHaveTextContent("integration-test-west");
  expect(duplicateOptions[1]).toHaveAttribute("aria-disabled", "true");

  await user.click(duplicateOptions[1]);
  expect(onOrganizationChange).not.toHaveBeenCalled();
});

test("organization keyboard navigation wraps in both directions and skips unavailable rows", async () => {
  const user = userEvent.setup();
  const { onOrganizationChange } = renderOrganizationShell("/analytics", {
    organizations: [
      { id: "org-keyboard-a", name: "Keyboard A", slug: "keyboard-a", status: "ACTIVE" },
      { id: "org-keyboard-b", name: "Keyboard B", slug: "keyboard-b", status: "SUSPENDED" },
      { id: "org-keyboard-c", name: "Keyboard C", slug: "keyboard-c", status: "ACTIVE" },
    ],
    currentOrganizationId: "org-keyboard-a",
  });

  await user.click(screen.getByRole("button", { name: /Current organization: Keyboard A/ }));
  const search = screen.getByRole("combobox", { name: "Search organizations" });
  await user.type(search, "keyboard");
  await user.keyboard("{ArrowDown}{ArrowUp}{ArrowDown}{Enter}");

  expect(onOrganizationChange).toHaveBeenCalledWith("org-keyboard-c");
  expect(screen.getByRole("button", { name: /Current organization: Keyboard A/ })).toHaveFocus();
});

test("organization switcher bounds a 1,000-organization directory before and after search", async () => {
  const organizations = Array.from({ length: 1_000 }, (_, index): OrganizationOption => ({
    id: `org-${String(index).padStart(4, "0")}`,
    name: index === 999
      ? "Scale organization 0999 with a deliberately long global customer experience and product operations name"
      : `Scale organization ${String(index).padStart(4, "0")}`,
    slug: `scale-org-${String(index).padStart(4, "0")}`,
    status: "ACTIVE",
  }));
  window.localStorage.setItem(
    "tracegenie.recentOrganizationIds",
    JSON.stringify(organizations.slice(1, 8).map((organization) => organization.id)),
  );
  const user = userEvent.setup();
  renderOrganizationShell("/analytics", {
    organizations,
    currentOrganizationId: organizations[0].id,
  });

  await user.click(screen.getByRole("button", { name: /Current organization: Scale organization 0000/ }));
  expect(within(screen.getByRole("listbox", { name: "Recent organizations" })).getAllByRole("option")).toHaveLength(5);

  const searchStartedAt = performance.now();
  await user.type(screen.getByRole("combobox", { name: "Search organizations" }), "Scale organization");
  expect(performance.now() - searchStartedAt).toBeLessThan(1_000);
  const results = screen.getByRole("listbox", { name: "Organization search results" });
  expect(within(results).getAllByRole("option")).toHaveLength(20);
  expect(screen.getByText("Showing 20 of 1,000 organizations.")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Show 20 more organizations" }));
  expect(within(results).getAllByRole("option")).toHaveLength(40);

  await user.clear(screen.getByRole("combobox", { name: "Search organizations" }));
  await user.type(screen.getByRole("combobox", { name: "Search organizations" }), "deliberately long");
  expect(within(results).getByTitle(organizations[999].name)).toHaveClass("truncate");
});

test("clicking the open trigger resets search and result batching before reopening", async () => {
  const organizations = Array.from({ length: 45 }, (_, index): OrganizationOption => ({
    id: `org-reset-${index}`,
    name: `Reset organization ${index}`,
    slug: `reset-organization-${index}`,
    status: "ACTIVE",
  }));
  window.localStorage.setItem(
    "tracegenie.recentOrganizationIds",
    JSON.stringify([organizations[1].id]),
  );
  const user = userEvent.setup();
  renderOrganizationShell("/analytics", {
    organizations,
    currentOrganizationId: organizations[0].id,
  });
  const trigger = screen.getByRole("button", { name: /Current organization: Reset organization 0/ });

  await user.click(trigger);
  await user.type(screen.getByRole("combobox", { name: "Search organizations" }), "Reset organization");
  const results = screen.getByRole("listbox", { name: "Organization search results" });
  await user.click(screen.getByRole("button", { name: "Show 20 more organizations" }));
  expect(within(results).getAllByRole("option")).toHaveLength(40);

  await user.click(trigger);
  expect(screen.queryByRole("combobox", { name: "Search organizations" })).not.toBeInTheDocument();
  await user.click(trigger);

  const reopenedSearch = screen.getByRole("combobox", { name: "Search organizations" });
  expect(reopenedSearch).toHaveValue("");
  expect(within(screen.getByRole("listbox", { name: "Recent organizations" })).getAllByRole("option"))
    .toHaveLength(1);

  await user.type(reopenedSearch, "Reset organization");
  expect(within(screen.getByRole("listbox", { name: "Organization search results" })).getAllByRole("option"))
    .toHaveLength(20);
});

test("organization search controls a listbox only while that listbox exists", async () => {
  const user = userEvent.setup();
  renderOrganizationShell();
  const trigger = screen.getByRole("button", { name: /Current organization: Alpha Studio/ });

  await user.click(trigger);
  const search = screen.getByRole("combobox", { name: "Search organizations" });
  expect(search).not.toHaveAttribute("aria-controls");
  expect(trigger).not.toHaveAttribute("aria-controls");

  await user.type(search, "beta");
  const listbox = screen.getByRole("listbox", { name: "Organization search results" });
  expect(search).toHaveAttribute("aria-controls", listbox.id);
  expect(trigger).toHaveAttribute("aria-controls", listbox.id);

  await user.clear(search);
  await user.type(search, "no matching organization");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(search).not.toHaveAttribute("aria-controls");
  expect(trigger).not.toHaveAttribute("aria-controls");
});

test("keyboard navigation keeps the active organization visible in bounded results", async () => {
  const scrollIntoView = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
  const organizations = Array.from({ length: 30 }, (_, index): OrganizationOption => ({
    id: `org-scroll-${index}`,
    name: `Scroll organization ${index}`,
    slug: `scroll-organization-${index}`,
    status: "ACTIVE",
  }));
  const user = userEvent.setup();
  renderOrganizationShell("/analytics", {
    organizations,
    currentOrganizationId: organizations[0].id,
  });

  await user.click(screen.getByRole("button", { name: /Current organization: Scroll organization 0/ }));
  const search = screen.getByRole("combobox", { name: "Search organizations" });
  await user.type(search, "scroll organization");
  await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");

  await waitFor(() => expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" }));
  expect(search).toHaveAttribute("aria-activedescendant", "app-shell-org-option-org-scroll-16");
});

test("type-to-filter exposes no-results recovery and Escape restores trigger focus", async () => {
  const user = userEvent.setup();
  renderOrganizationShell();
  const trigger = screen.getByRole("button", { name: /Current organization: Alpha Studio/ });

  trigger.focus();
  await user.keyboard("z");
  const search = screen.getByRole("combobox", { name: "Search organizations" });
  expect(search).toHaveValue("z");
  expect(screen.getByRole("status")).toHaveTextContent("No organizations match");

  await user.click(screen.getByRole("button", { name: "Clear search" }));
  expect(search).toHaveValue("");
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
});

test("organization switcher announces loading and exposes retry for errors", async () => {
  const user = userEvent.setup();
  const onOrganizationsRetry = vi.fn();
  const { rerender } = renderOrganizationShell("/analytics", {
    organizations: [],
    organizationsState: "loading",
    currentOrganizationId: undefined,
    onOrganizationsRetry,
  });
  const desktopSwitcher = document.getElementById("organization-switcher")!;

  expect(within(desktopSwitcher).getByRole("status")).toHaveTextContent("Loading organizations");

  rerender(
    <MemoryRouter initialEntries={["/analytics"]}>
      <Routes>
        <Route
          element={(
            <AppShell
              onSignOut={vi.fn()}
              userName="Ada Lovelace"
              organizations={[]}
              organizationsState="error"
              onOrganizationsRetry={onOrganizationsRetry}
            />
          )}
        >
          <Route
            path="/analytics"
            element={(
              <div>
                Analytics content
              </div>
            )}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

  expect(within(document.getElementById("organization-switcher")!).getByRole("alert"))
    .toHaveTextContent("Couldn't load organizations");
  await user.click(within(document.getElementById("organization-switcher")!).getByRole("button", { name: "Retry" }));
  expect(onOrganizationsRetry).toHaveBeenCalledOnce();
});

test("organization switcher preserves empty, refreshing, and stale directory states", async () => {
  const onOrganizationsRetry = vi.fn();
  const { rerender } = renderOrganizationShell("/analytics", {
    organizations: [],
    organizationsState: "ready",
    currentOrganizationId: undefined,
    onOrganizationsRetry,
  });
  const desktopSwitcher = document.getElementById("organization-switcher")!;

  expect(within(desktopSwitcher).getByRole("status")).toHaveTextContent("No organizations available");
  expect(within(desktopSwitcher).getByRole("link", { name: /New organization/ })).toBeVisible();

  rerender(
    <MemoryRouter initialEntries={["/analytics"]}>
      <Routes>
        <Route
          element={(
            <AppShell
              onSignOut={vi.fn()}
              userName="Ada Lovelace"
              organizations={ORGANIZATION_FIXTURES}
              organizationsState="refreshing"
              currentOrganizationId="org-alpha"
              onOrganizationsRetry={onOrganizationsRetry}
            />
          )}
        >
          <Route
            path="/analytics"
            element={(
              <div>
                Analytics content
              </div>
            )}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

  expect(within(document.getElementById("organization-switcher")!).getByRole("status"))
    .toHaveTextContent("Refreshing organizations");

  rerender(
    <MemoryRouter initialEntries={["/analytics"]}>
      <Routes>
        <Route
          element={(
            <AppShell
              onSignOut={vi.fn()}
              userName="Ada Lovelace"
              organizations={ORGANIZATION_FIXTURES}
              organizationsState="stale"
              currentOrganizationId="org-alpha"
              onOrganizationsRetry={onOrganizationsRetry}
            />
          )}
        >
          <Route
            path="/analytics"
            element={(
              <div>
                Analytics content
              </div>
            )}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

  expect(within(document.getElementById("organization-switcher")!).getByRole("alert"))
    .toHaveTextContent("Directory may be out of date");
});

test("closed mobile header exposes the active organization", () => {
  renderOrganizationShell();
  expect(within(document.querySelector("header")!).getByText("Alpha Studio")).toBeInTheDocument();
});

test("mobile organization switch keeps the active organization when a dirty exit is cancelled", async () => {
  const user = userEvent.setup();
  renderMobileDirtyOrganizationShell();
  const { dialog } = await openMobileDrawer();

  await user.click(within(dialog).getByRole("button", { name: /Current organization: Alpha Studio/ }));
  await user.type(within(dialog).getByRole("combobox", { name: "Search organizations" }), "beta");
  await user.click(within(dialog).getByRole("option", { name: /^Beta Works,/ }));
  expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Stay" }));
  expect(within(dialog).getByRole("button", { name: /Current organization: Alpha Studio/ })).toBeInTheDocument();
  expect(within(document.querySelector("header")!).getByText("Alpha Studio")).toBeInTheDocument();
});

test("mobile organization search opens as a full-width command surface inside the focused sheet", async () => {
  const user = userEvent.setup();
  renderOrganizationShell();
  const { dialog } = await openMobileDrawer();

  await user.click(within(dialog).getByRole("button", { name: /Current organization: Alpha Studio/ }));
  const commandSurface = within(dialog).getByRole("search", { name: "Switch organization" });
  expect(commandSurface).toHaveClass("w-full");
  expect(within(commandSurface).getByRole("combobox", { name: "Search organizations" })).toHaveFocus();
});

test("platform context hides tenant organization controls and uses platform navigation", () => {
  renderOrganizationShell("/platform");
  expect(document.getElementById("organization-switcher")).not.toBeInTheDocument();
  expect(screen.getByText("Global context")).toBeInTheDocument();
  expect(screen.getAllByText("Platform operations").length).toBeGreaterThan(0);
  expect(screen.queryByRole("link", { name: copy.nav.analytics })).not.toBeInTheDocument();
});
