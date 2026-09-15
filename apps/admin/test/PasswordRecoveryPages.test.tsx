import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";

import type { AdminSession } from "@tracegenie/shared";

import { ForgotPasswordPage } from "../src/features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../src/features/auth/ResetPasswordPage";
import { api } from "../src/lib/api";

vi.mock("../src/lib/api", () => ({
  api: {
    requestPasswordReset: vi.fn(),
    confirmPasswordReset: vi.fn(),
  },
}));

const validToken = "reset-token-at-least-20-characters";
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
  vi.mocked(api.requestPasswordReset).mockReset();
  vi.mocked(api.confirmPasswordReset).mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForgotPassword() {
  render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

function renderResetPassword(
  token = validToken,
  onReset = vi.fn(),
) {
  render(
    <MemoryRouter initialEntries={[`/reset-password?token=${encodeURIComponent(token)}`]}>
      <ResetPasswordPage onReset={onReset} />
    </MemoryRouter>,
  );
  return onReset;
}

async function enterMatchingPasswords(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("New password"), "password123");
  await user.type(screen.getByLabelText("Confirm new password"), "password123");
}

test("renders password recovery inside the canonical auth shell", () => {
  renderForgotPassword();

  const region = screen.getByRole("region", { name: "Reset your password" });
  expect(region).toHaveAttribute("id", "forgot-password-card");
  expect(region).toHaveAttribute("aria-labelledby", "forgot-password-title");
  expect(region).toHaveAttribute("aria-describedby", "forgot-password-description");
  expect(document.querySelector("#forgot-password-body")).toContainElement(
    document.querySelector("#forgot-password-form"),
  );
  expect(document.querySelector("#forgot-password-footer")).toContainElement(
    screen.getByRole("link", { name: "Sign in" }),
  );
});

test("renders password reset and invalid-link recovery inside the canonical auth shell", () => {
  const view = render(
    <MemoryRouter initialEntries={[`/reset-password?token=${encodeURIComponent(validToken)}`]}>
      <ResetPasswordPage onReset={vi.fn()} />
    </MemoryRouter>,
  );

  const region = screen.getByRole("region", { name: "Choose a new password" });
  expect(region).toHaveAttribute("id", "reset-password-card");
  expect(region).toHaveAttribute("aria-describedby", "reset-password-description");
  expect(document.querySelector("#reset-password-body")).toContainElement(
    document.querySelector("#reset-password-form"),
  );
  expect(document.querySelector("#reset-password-footer")).toContainElement(
    screen.getByRole("link", { name: "Sign in" }),
  );

  view.unmount();
  renderResetPassword("too-short");
  expect(document.querySelector("#reset-password-body")).toContainElement(
    document.querySelector("#reset-password-invalid-state"),
  );
});

test("validates forgot-password email without native bubbles and focuses the field", async () => {
  const user = userEvent.setup();
  renderForgotPassword();
  const email = screen.getByLabelText("Email");

  expect(email.closest("form")).toHaveAttribute("novalidate");
  expect(email).not.toBeRequired();
  await user.click(screen.getByRole("button", { name: "Send reset link" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid work email.");
  expect(email).toHaveFocus();
  expect(email).toHaveAttribute("aria-invalid", "true");
  expect(email).toHaveAttribute("aria-describedby", "forgot-password-email-error");
  expect(api.requestPasswordReset).not.toHaveBeenCalled();
});

test("synchronously blocks duplicate reset-link requests while pending", async () => {
  const user = userEvent.setup();
  let resolveRequest!: (value: { ok: boolean }) => void;
  vi.mocked(api.requestPasswordReset).mockImplementation(() => new Promise((resolve) => {
    resolveRequest = resolve;
  }));
  renderForgotPassword();
  const email = screen.getByLabelText("Email");
  await user.type(email, "ada@example.test");
  const form = email.closest("form");

  fireEvent.submit(form!);
  fireEvent.submit(form!);

  await waitFor(() => expect(api.requestPasswordReset).toHaveBeenCalledTimes(1));
  expect(api.requestPasswordReset).toHaveBeenCalledWith("ada@example.test");
  expect(email).toBeDisabled();
  expect(screen.getByRole("button", { name: "Sending reset link…" })).toBeDisabled();

  resolveRequest({ ok: true });
  expect(await screen.findByRole("status")).toHaveTextContent(
    "If an account exists, a reset link has been sent.",
  );
});

test("enters a focused anti-enumeration completed state and prevents repeats", async () => {
  const user = userEvent.setup();
  vi.mocked(api.requestPasswordReset).mockResolvedValue({ ok: true });
  renderForgotPassword();
  await user.type(screen.getByLabelText("Email"), "ada@example.test");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));

  const success = await screen.findByRole("status");
  expect(success).toHaveTextContent("If an account exists, a reset link has been sent.");
  expect(success).toHaveAttribute("aria-live", "polite");
  expect(success).toHaveFocus();
  expect(screen.getByLabelText("Email")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reset link sent" })).toBeDisabled();

  fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
  expect(api.requestPasswordReset).toHaveBeenCalledTimes(1);
});

test("announces forgot-password failures and preserves input for an exact retry", async () => {
  const user = userEvent.setup();
  vi.mocked(api.requestPasswordReset)
    .mockRejectedValueOnce(new Error("Password recovery is temporarily unavailable."))
    .mockResolvedValueOnce({ ok: true });
  renderForgotPassword();
  const email = screen.getByLabelText("Email");
  await user.type(email, "ada@example.test");

  await user.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Password recovery is temporarily unavailable.");
  expect(email).toHaveValue("ada@example.test");
  expect(screen.getByRole("button", { name: "Send reset link" })).toBeEnabled();
  expect(email).toHaveFocus();

  await user.click(screen.getByRole("button", { name: "Send reset link" }));
  await waitFor(() => expect(api.requestPasswordReset).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.requestPasswordReset).mock.calls[1]).toEqual(
    vi.mocked(api.requestPasswordReset).mock.calls[0],
  );
});

test.each(["", "too-short", `  ${"x".repeat(19)}  `])(
  "renders one explicit recovery action without a password form for invalid token %j",
  (token) => {
    renderResetPassword(token);

    expect(screen.getByRole("alert")).toHaveTextContent("invalid or incomplete");
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Confirm new password")).not.toBeInTheDocument();
    expect(document.querySelector("#reset-password-form")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new reset link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(document.querySelector("#reset-password-footer")).not.toBeInTheDocument();
    expect(api.confirmPasswordReset).not.toHaveBeenCalled();
  },
);

test("validates reset fields without native bubbles and focuses the first invalid field", async () => {
  const user = userEvent.setup();
  renderResetPassword();
  const password = screen.getByLabelText("New password");

  expect(password.closest("form")).toHaveAttribute("novalidate");
  expect(password).not.toBeRequired();
  await user.click(screen.getByRole("button", { name: "Set password" }));

  expect(await screen.findByText("Password must be at least 8 characters.")).toHaveAttribute("role", "alert");
  expect(screen.getByText("Confirm your new password.")).toHaveAttribute("role", "alert");
  expect(password).toHaveFocus();
  expect(password).toHaveAttribute("aria-invalid", "true");
  expect(api.confirmPasswordReset).not.toHaveBeenCalled();
});

test("blocks mismatched passwords and focuses confirmation feedback", async () => {
  const user = userEvent.setup();
  renderResetPassword();
  await user.type(screen.getByLabelText("New password"), "password123");
  await user.type(screen.getByLabelText("Confirm new password"), "different123");
  await user.click(screen.getByRole("button", { name: "Set password" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Passwords do not match.");
  expect(screen.getByLabelText("Confirm new password")).toHaveFocus();
  expect(api.confirmPasswordReset).not.toHaveBeenCalled();
});

test("reveals each reset password independently without changing either value", async () => {
  const user = userEvent.setup();
  renderResetPassword();
  const password = screen.getByLabelText("New password");
  const confirmation = screen.getByLabelText("Confirm new password");
  await user.type(password, "password123");
  await user.type(confirmation, "password123");

  await user.click(screen.getByRole("button", { name: "Show new password" }));
  expect(password).toHaveAttribute("type", "text");
  expect(password).toHaveValue("password123");
  expect(confirmation).toHaveAttribute("type", "password");

  await user.click(screen.getByRole("button", { name: "Show confirmed password" }));
  expect(confirmation).toHaveAttribute("type", "text");
  expect(confirmation).toHaveValue("password123");
  expect(screen.getByRole("button", { name: "Hide new password" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Hide confirmed password" })).toHaveAttribute("aria-pressed", "true");
});

test("trims the valid token, preserves the API payload, and blocks duplicate reset submits", async () => {
  const user = userEvent.setup();
  let resolveReset!: (value: AdminSession) => void;
  vi.mocked(api.confirmPasswordReset).mockImplementation(() => new Promise((resolve) => {
    resolveReset = resolve;
  }));
  const onReset = renderResetPassword(`  ${validToken}  `);
  await enterMatchingPasswords(user);
  const form = screen.getByLabelText("New password").closest("form");

  fireEvent.submit(form!);
  fireEvent.submit(form!);

  await waitFor(() => expect(api.confirmPasswordReset).toHaveBeenCalledTimes(1));
  expect(api.confirmPasswordReset).toHaveBeenCalledWith(validToken, "password123");
  expect(screen.getByLabelText("New password")).toBeDisabled();
  expect(screen.getByLabelText("Confirm new password")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Show new password" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Show confirmed password" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Setting password…" })).toBeDisabled();

  resolveReset(session);
  await waitFor(() => expect(onReset).toHaveBeenCalledWith(session));
});

test("announces recoverable reset failures and preserves valid input for an exact retry", async () => {
  const user = userEvent.setup();
  vi.mocked(api.confirmPasswordReset)
    .mockRejectedValueOnce(new Error("Password update is temporarily unavailable."))
    .mockResolvedValueOnce(session);
  const onReset = renderResetPassword();
  await enterMatchingPasswords(user);

  await user.click(screen.getByRole("button", { name: "Set password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Password update is temporarily unavailable.");
  expect(screen.getByLabelText("New password")).toHaveValue("password123");
  expect(screen.getByLabelText("Confirm new password")).toHaveValue("password123");
  expect(screen.getByRole("button", { name: "Set password" })).toBeEnabled();
  expect(screen.getByLabelText("New password")).toHaveFocus();

  await user.click(screen.getByRole("button", { name: "Set password" }));
  await waitFor(() => expect(api.confirmPasswordReset).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.confirmPasswordReset).mock.calls[1]).toEqual(
    vi.mocked(api.confirmPasswordReset).mock.calls[0],
  );
  expect(onReset).toHaveBeenCalledWith(session);
});

test("server-expired reset links clear credentials and expose one recovery action", async () => {
  const user = userEvent.setup();
  vi.mocked(api.confirmPasswordReset).mockRejectedValue(Object.assign(
    new Error("This password reset link is invalid or expired."),
    { code: "auth.invalid_password_reset" },
  ));
  renderResetPassword();
  await enterMatchingPasswords(user);

  await user.click(screen.getByRole("button", { name: "Set password" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("This password reset link is invalid or expired.");
  expect(alert).toHaveFocus();
  expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Confirm new password")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "Request a new reset link" })).toHaveAttribute(
    "href",
    "/forgot-password",
  );
});
