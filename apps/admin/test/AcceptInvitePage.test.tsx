import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { AdminSession } from "@tracegenie/shared";

import { AcceptInvitePage } from "../src/features/auth/AcceptInvitePage";
import { api, type InviteTrustContext } from "../src/lib/api";

vi.mock("../src/lib/api", () => ({
  api: {
    acceptInvite: vi.fn(),
    getInviteContext: vi.fn(),
  },
}));

const validToken = "invite-token-at-least-20-characters";
const expiresAt = "2026-07-18T19:30:00.000Z";
const scopedContext: InviteTrustContext = {
  organization: {
    name: "internal-organization-key",
    displayName: "Acme Support",
  },
  inviter: {
    displayName: "Grace Hopper",
  },
  organizationRole: "MEMBER",
  products: [
    { name: "Checkout", productRole: "PROJECT_ADMIN" },
    { name: "Mobile App", productRole: "TRIAGER" },
    { name: "Reports", productRole: "VIEWER" },
  ],
  effectiveAccess: {
    productScope: "SCOPED",
    summary: "Organization member with access to 3 selected products with the listed roles.",
  },
  status: "PENDING",
  expiresAt,
};
const session: AdminSession = {
  token: "admin-session-token",
  user: {
    id: "user-1",
    email: "ada@example.test",
    name: "Ada Lovelace",
    role: "ADMIN",
  },
};

beforeEach(() => {
  window.history.pushState({}, "", `/accept-invite?token=${validToken}`);
  vi.mocked(api.acceptInvite).mockReset();
  vi.mocked(api.getInviteContext).mockReset();
  vi.mocked(api.getInviteContext).mockResolvedValue({ context: scopedContext });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderAcceptInvite(onAccepted = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[`/accept-invite?token=${validToken}`]}>
      <Routes>
        <Route path="/accept-invite" element={<AcceptInvitePage onAccepted={onAccepted} />} />
        <Route path="/" element={<p>Workspace destination</p>} />
        <Route path="/login" element={<p>Sign-in destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return onAccepted;
}

async function waitForInviteContext() {
  return screen.findByRole("heading", { name: "Invite details" });
}

async function enterValidInvite(user: ReturnType<typeof userEvent.setup>) {
  await waitForInviteContext();
  await user.type(screen.getByLabelText("Name"), "  Ada Lovelace  ");
  await user.type(screen.getByLabelText("Password"), "password123");
}

test("renders the shared wide auth shell and preserves sign-in recovery navigation", async () => {
  const user = userEvent.setup();
  renderAcceptInvite();

  const shell = screen.getByRole("region", { name: "Accept your invite" });
  expect(shell).toHaveAttribute("id", "accept-invite-card");
  expect(shell).toHaveClass("max-w-xl");
  expect(shell).toHaveAttribute("aria-labelledby", "accept-invite-title");
  expect(shell).toHaveAttribute("aria-describedby", "accept-invite-description");
  expect(screen.getByAltText("TraceGenie")).toHaveAttribute("data-tracegenie-logo", "full");
  expect(document.querySelector("#accept-invite-body")).toContainElement(
    document.querySelector("#accept-invite-content"),
  );
  expect(document.querySelector("#accept-invite-footer")).toContainElement(
    screen.getByRole("link", { name: "Sign in" }),
  );

  await user.click(screen.getByRole("link", { name: "Sign in" }));
  expect(screen.getByText("Sign-in destination")).toBeVisible();
});

test("truthfully shows invite context loading and blocks acceptance", () => {
  vi.mocked(api.getInviteContext).mockReturnValue(new Promise(() => undefined));
  renderAcceptInvite();

  expect(screen.getByRole("status")).toHaveTextContent("Loading invite details...");
  expect(screen.getByText("Verifying the organization and access you were offered.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Accept invite" })).toBeDisabled();
  expect(screen.queryByRole("heading", { name: "Invite details" })).not.toBeInTheDocument();
  expect(api.getInviteContext).toHaveBeenCalledWith(validToken);
  fireEvent.submit(screen.getByLabelText("Name").closest("form")!);
  expect(api.acceptInvite).not.toHaveBeenCalled();
});

test("renders the complete trust context without exposing canonical names, email, token, or IDs", async () => {
  renderAcceptInvite();

  const details = (await waitForInviteContext()).closest("section");
  expect(details).not.toBeNull();
  expect(within(details!).getByText("Grace Hopper invited you to Acme Support.")).toBeVisible();
  expect(within(details!).getByText("Member")).toBeVisible();
  expect(within(details!).getByText(scopedContext.effectiveAccess.summary)).toBeVisible();
  expect(within(details!).getByText((_, element) => element?.tagName === "TIME")).toHaveAttribute("datetime", expiresAt);
  expect(screen.getByRole("button", { name: "Accept invite" })).toBeEnabled();

  expect(screen.queryByText("internal-organization-key")).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent("ada@example.test");
  expect(document.body).not.toHaveTextContent(validToken);
  expect(document.body).not.toHaveTextContent("user-1");
});

test("renders a member invite with no product access", async () => {
  vi.mocked(api.getInviteContext).mockResolvedValue({
    context: {
      ...scopedContext,
      products: [],
      effectiveAccess: {
        productScope: "NONE",
        summary: "Organization member with no product access.",
      },
    },
  });
  renderAcceptInvite();
  await waitForInviteContext();

  expect(screen.getByText("No product access")).toBeVisible();
  expect(screen.getByText("Organization member with no product access.")).toBeVisible();
  expect(screen.queryByRole("list", { name: "Products and roles" })).not.toBeInTheDocument();
});

test("renders an administrator invite with access to all products", async () => {
  vi.mocked(api.getInviteContext).mockResolvedValue({
    context: {
      ...scopedContext,
      organizationRole: "ADMIN",
      products: [],
      effectiveAccess: {
        productScope: "ALL",
        summary: "Can manage the organization and access all current and future products.",
      },
    },
  });
  renderAcceptInvite();
  await waitForInviteContext();

  expect(screen.getByText("Administrator")).toBeVisible();
  expect(screen.getByText("All current and future products")).toBeVisible();
  expect(screen.getByText("Can manage the organization and access all current and future products.")).toBeVisible();
  expect(screen.queryByRole("list", { name: "Products and roles" })).not.toBeInTheDocument();
});

test("renders every scoped product with its exact product role", async () => {
  renderAcceptInvite();
  await waitForInviteContext();

  const products = screen.getByRole("list", { name: "Products and roles" });
  expect(within(products).getByText("Checkout")).toBeVisible();
  expect(within(products).getByText("Product administrator")).toBeVisible();
  expect(within(products).getByText("Mobile App")).toBeVisible();
  expect(within(products).getByText("Triager")).toBeVisible();
  expect(within(products).getByText("Reports")).toBeVisible();
  expect(within(products).getByText("Viewer")).toBeVisible();
});

test("announces context failure, preserves form values, and safely retries before acceptance", async () => {
  const user = userEvent.setup();
  let resolveRetry!: (value: { context: InviteTrustContext }) => void;
  vi.mocked(api.getInviteContext)
    .mockRejectedValueOnce(new Error("Invite verification is temporarily unavailable."))
    .mockImplementationOnce(() => new Promise((resolve) => {
      resolveRetry = resolve;
    }));
  renderAcceptInvite();

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Could not load invite details.");
  expect(alert).toHaveTextContent("Invite verification is temporarily unavailable.");
  expect(screen.getByRole("button", { name: "Accept invite" })).toBeDisabled();
  await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
  await user.type(screen.getByLabelText("Password"), "password123");
  fireEvent.submit(screen.getByLabelText("Name").closest("form")!);
  expect(api.acceptInvite).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByRole("status")).toHaveTextContent("Loading invite details...");
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Accept invite" })).toBeDisabled();
  expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
  expect(screen.getByLabelText("Password")).toHaveValue("password123");
  expect(api.getInviteContext).toHaveBeenCalledTimes(2);

  resolveRetry({ context: scopedContext });
  await waitForInviteContext();
  expect(screen.getByRole("button", { name: "Accept invite" })).toBeEnabled();
  expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
  expect(screen.getByLabelText("Password")).toHaveValue("password123");
  expect(api.acceptInvite).not.toHaveBeenCalled();
});

test("terminal context errors remove retry and credential entry", async () => {
  vi.mocked(api.getInviteContext).mockRejectedValue(Object.assign(
    new Error("This invite has expired."),
    { code: "invites.expired" },
  ));
  renderAcceptInvite();

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Invite unavailable.");
  expect(alert).toHaveTextContent("This invite has expired.");
  expect(alert).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
});

test.each([
  ["invites.expired", "This invite has expired.", "Ask an administrator for a new invite."],
  ["invites.already_accepted", "This invite was already accepted.", "Sign in with the account that accepted this invite."],
  ["billing.org_read_only", "This organization is read-only.", "Ask an organization administrator to resolve billing, then open this invite again."],
  ["org.unavailable", "This organization is unavailable.", "Contact an organization administrator about access."],
])("gives truthful terminal recovery for %s", async (code, message, recovery) => {
  vi.mocked(api.getInviteContext).mockRejectedValue(Object.assign(new Error(message), { code }));
  renderAcceptInvite();

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(message);
  expect(alert).toHaveTextContent(recovery);
});

test("blocks an invalid invite token without requesting context and announces recovery guidance", () => {
  window.history.pushState({}, "", "/accept-invite?token=too-short");
  renderAcceptInvite();

  expect(screen.getByRole("alert")).toHaveTextContent("invalid or incomplete");
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Accept invite" })).not.toBeInTheDocument();
  expect(api.getInviteContext).not.toHaveBeenCalled();
  expect(api.acceptInvite).not.toHaveBeenCalled();
});

test("validates fields without native validation and focuses the first invalid field", async () => {
  const user = userEvent.setup();
  renderAcceptInvite();
  await waitForInviteContext();
  const name = screen.getByLabelText("Name");

  expect(name.closest("form")).toHaveAttribute("novalidate");
  expect(name).not.toBeRequired();
  await user.click(screen.getByRole("button", { name: "Accept invite" }));

  expect(await screen.findAllByRole("alert")).toHaveLength(2);
  expect(name).toHaveFocus();
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAttribute("aria-describedby", "accept-invite-name-error");
  expect(screen.getByLabelText("Password")).toHaveAttribute(
    "aria-describedby",
    "accept-invite-password-requirement accept-invite-password-error",
  );
  expect(screen.getByText("Use at least 8 characters.")).toBeVisible();
  expect(api.acceptInvite).not.toHaveBeenCalled();
});

test("rejects an overlong name and short password", async () => {
  const user = userEvent.setup();
  renderAcceptInvite();
  await waitForInviteContext();
  await user.type(screen.getByLabelText("Name"), "A".repeat(101));
  await user.type(screen.getByLabelText("Password"), "short");
  await user.click(screen.getByRole("button", { name: "Accept invite" }));

  expect(await screen.findByText("Name must be 100 characters or fewer.")).toBeVisible();
  expect(screen.getByText("Password must be at least 8 characters.")).toBeVisible();
  expect(api.acceptInvite).not.toHaveBeenCalled();
});

test("shows and hides the password without changing its value", async () => {
  const user = userEvent.setup();
  renderAcceptInvite();
  const password = screen.getByLabelText("Password");
  await user.type(password, "password123");

  expect(password).toHaveAttribute("type", "password");
  await user.click(screen.getByRole("button", { name: "Show password" }));
  expect(password).toHaveAttribute("type", "text");
  expect(password).toHaveValue("password123");
  await user.click(screen.getByRole("button", { name: "Hide password" }));
  expect(password).toHaveAttribute("type", "password");
  expect(password).toHaveValue("password123");
});

test("normalizes the exact request and synchronously blocks duplicate submits", async () => {
  const user = userEvent.setup();
  let resolveAccept!: (value: typeof session) => void;
  vi.mocked(api.acceptInvite).mockImplementation(() => new Promise((resolve) => {
    resolveAccept = resolve;
  }));
  const onAccepted = renderAcceptInvite();
  await enterValidInvite(user);
  const form = screen.getByLabelText("Name").closest("form");

  fireEvent.submit(form!);
  fireEvent.submit(form!);

  await waitFor(() => expect(api.acceptInvite).toHaveBeenCalledTimes(1));
  expect(api.acceptInvite).toHaveBeenCalledWith({
    token: validToken,
    name: "Ada Lovelace",
    password: "password123",
  });
  expect(screen.getByRole("button", { name: "Accepting invite..." })).toBeDisabled();

  resolveAccept(session);
  await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(session));
  expect(await screen.findByText("Workspace destination")).toBeVisible();
});

test("announces recoverable acceptance feedback, preserves rejected values, and permits an exact retry", async () => {
  const user = userEvent.setup();
  vi.mocked(api.acceptInvite)
    .mockRejectedValueOnce(new Error("Invite acceptance is temporarily unavailable."))
    .mockResolvedValueOnce(session);
  const onAccepted = renderAcceptInvite();
  await enterValidInvite(user);

  await user.click(screen.getByRole("button", { name: "Accept invite" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invite acceptance is temporarily unavailable.");
  expect(screen.getByLabelText("Name")).toHaveValue("  Ada Lovelace  ");
  expect(screen.getByLabelText("Password")).toHaveValue("password123");
  expect(screen.getByRole("button", { name: "Accept invite" })).toBeEnabled();
  expect(screen.getByLabelText("Name")).toHaveFocus();

  await user.click(screen.getByRole("button", { name: "Accept invite" }));
  await waitFor(() => expect(api.acceptInvite).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.acceptInvite).mock.calls[1]).toEqual(vi.mocked(api.acceptInvite).mock.calls[0]);
  expect(onAccepted).toHaveBeenCalledWith(session);
});

test("terminal acceptance errors clear credentials and remove retry", async () => {
  const user = userEvent.setup();
  vi.mocked(api.acceptInvite).mockRejectedValue(Object.assign(
    new Error("This invite was revoked."),
    { code: "invites.revoked" },
  ));
  renderAcceptInvite();
  await enterValidInvite(user);

  await user.click(screen.getByRole("button", { name: "Accept invite" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Invite unavailable.");
  expect(screen.getByRole("alert")).toHaveTextContent("This invite was revoked.");
  expect(screen.getByRole("alert")).toHaveFocus();
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
});
