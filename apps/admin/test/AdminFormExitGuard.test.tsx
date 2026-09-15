import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  createMemoryRouter,
  Link,
  RouterProvider,
  useNavigate,
} from "react-router-dom";

import {
  AdminFormExitGuardProvider,
  useAdminFormExitGuard,
} from "../src/components/guards/AdminFormExitGuard";

afterEach(cleanup);

function GuardHarness({ onDiscard = () => undefined }: { onDiscard?: () => void }) {
  const [isDirty, setIsDirty] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [organization, setOrganization] = useState("Organization A");
  const navigate = useNavigate();
  const guard = useAdminFormExitGuard({
    id: "guard-test-form",
    isDirty,
    isMutationPending: isPending,
    onDiscard: () => {
      onDiscard();
      setIsDirty(false);
      setIsPending(false);
    },
  });

  return (
    <section id="guard-test-form">
      <h1>Guard test form</h1>
      <p>{organization}</p>
      <p>{isDirty ? "Dirty" : "Pristine"}</p>
      <p>{isPending ? "Pending" : "Idle"}</p>
      <button type="button" onClick={() => setIsDirty(true)}>Edit</button>
      <button type="button" onClick={() => setIsPending(true)}>Start save</button>
      <button
        type="button"
        onClick={() => {
          setIsDirty(false);
          setIsPending(false);
        }}
      >
        Resolve clean
      </button>
      <button type="button" onClick={() => setIsPending(false)}>Resolve failed</button>
      <Link to="/next">Leave page</Link>
      <button
        type="button"
        onClick={() => guard.requestExit("organization-switch", () => setOrganization("Organization B"))}
      >
        Switch organization
      </button>
      <button type="button" onClick={() => guard.commitAndExit(() => navigate("/next"))}>
        Finish and leave
      </button>
      <button
        type="button"
        onClick={() => {
          setIsDirty(false);
          setIsPending(false);
          guard.commitAndExit(() => navigate("/saved"));
        }}
      >
        Commit save
      </button>
    </section>
  );
}

function renderGuard(onDiscard = vi.fn()) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <AdminFormExitGuardProvider>
          <GuardHarness onDiscard={onDiscard} />
        </AdminFormExitGuardProvider>
      ),
    },
    { path: "/next", element: <h1>Next route</h1> },
    { path: "/saved", element: <h1>Saved route</h1> },
  ], { initialEntries: ["/"] });
  render(<RouterProvider router={router} />);
  return { router, onDiscard };
}

test("pristine navigation leaves immediately", async () => {
  const user = userEvent.setup();
  renderGuard();

  await user.click(screen.getByRole("link", { name: "Leave page" }));

  expect(await screen.findByRole("heading", { name: "Next route" })).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("dirty route navigation stays or discards explicitly", async () => {
  const user = userEvent.setup();
  const { onDiscard } = renderGuard();
  await user.click(screen.getByRole("button", { name: "Edit" }));

  await user.click(screen.getByRole("link", { name: "Leave page" }));
  const firstDialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
  await user.click(screen.getByRole("button", { name: "Stay" }));
  expect(firstDialog).not.toBeInTheDocument();
  expect(screen.getByText("Dirty")).toBeVisible();
  expect(onDiscard).not.toHaveBeenCalled();

  await user.click(screen.getByRole("link", { name: "Leave page" }));
  await user.click(await screen.findByRole("button", { name: "Discard" }));
  expect(await screen.findByRole("heading", { name: "Next route" })).toBeVisible();
  expect(onDiscard).toHaveBeenCalledTimes(1);
});

test("organization switching cannot apply until dirty work is discarded", async () => {
  const user = userEvent.setup();
  const { onDiscard } = renderGuard();
  await user.click(screen.getByRole("button", { name: "Edit" }));

  await user.click(screen.getByRole("button", { name: "Switch organization" }));
  expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeVisible();
  expect(screen.getByText("Organization A")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Stay" }));
  expect(screen.getByText("Organization A")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Switch organization" }));
  await user.click(await screen.findByRole("button", { name: "Discard" }));
  expect(screen.getByText("Organization B")).toBeVisible();
  expect(onDiscard).toHaveBeenCalledTimes(1);
});

test("dirty and pending forms install native refresh protection", async () => {
  const user = userEvent.setup();
  renderGuard();
  const pristineEvent = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(pristineEvent);
  expect(pristineEvent.defaultPrevented).toBe(false);

  await user.click(screen.getByRole("button", { name: "Edit" }));
  const dirtyEvent = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirtyEvent);
  expect(dirtyEvent.defaultPrevented).toBe(true);

  await user.click(screen.getByRole("button", { name: "Start save" }));
  const pendingEvent = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(pendingEvent);
  expect(pendingEvent.defaultPrevented).toBe(true);
});

test("pending navigation waits for a successful save and then proceeds", async () => {
  const user = userEvent.setup();
  const { onDiscard } = renderGuard();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(screen.getByRole("button", { name: "Start save" }));
  await user.click(screen.getByRole("link", { name: "Leave page" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Guard test form" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Resolve clean" }));
  expect(await screen.findByRole("heading", { name: "Next route" })).toBeVisible();
  expect(onDiscard).not.toHaveBeenCalled();
});

test("pending navigation asks before leaving when the save fails dirty", async () => {
  const user = userEvent.setup();
  renderGuard();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(screen.getByRole("button", { name: "Start save" }));
  await user.click(screen.getByRole("link", { name: "Leave page" }));

  await user.click(screen.getByRole("button", { name: "Resolve failed" }));
  expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeVisible();
  expect(screen.getByText("Dirty")).toBeVisible();
});

test("committed navigation bypasses a stale dirty render after success", async () => {
  const user = userEvent.setup();
  renderGuard();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(screen.getByRole("button", { name: "Finish and leave" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Next route" })).toBeVisible());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("a committed save honors an exit that was already blocked", async () => {
  const user = userEvent.setup();
  renderGuard();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(screen.getByRole("button", { name: "Start save" }));
  await user.click(screen.getByRole("link", { name: "Leave page" }));

  await user.click(screen.getByRole("button", { name: "Commit save" }));

  expect(await screen.findByRole("heading", { name: "Next route" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Saved route" })).not.toBeInTheDocument();
});
