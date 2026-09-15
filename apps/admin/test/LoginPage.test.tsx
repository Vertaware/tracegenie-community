import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";

import { LoginPage } from "../src/features/auth/LoginPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type LoginRenderOptions = {
  feedback?: ReactNode;
  sessionNotice?: string | null;
};

function renderLogin(
  onLogin = vi.fn(async () => {}),
  loading = false,
  options: LoginRenderOptions = {},
) {
  render(
    <MemoryRouter>
      <LoginPage
        onLogin={onLogin}
        loading={loading}
        feedback={options.feedback}
        sessionNotice={options.sessionNotice}
      />
    </MemoryRouter>,
  );
  return onLogin;
}

async function enterValidLogin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "Ada.Lovelace+Test@Example.TEST");
  await user.type(screen.getByLabelText("Password"), "password123");
}

test("renders the canonical auth shell identity, structure, and footer actions", () => {
  renderLogin();

  const region = screen.getByRole("region", { name: "Welcome back" });
  const form = document.querySelector("#login-form");
  const footer = document.querySelector("#admin-login-footer");

  expect(document.querySelector("#admin-login-page")).toContainElement(region);
  expect(region).toHaveAttribute("id", "admin-login-card");
  expect(region).toHaveAttribute("aria-labelledby", "admin-login-title");
  expect(screen.getByRole("heading", { name: "Welcome back", level: 1 })).toHaveAttribute(
    "id",
    "admin-login-title",
  );
  expect(screen.getByRole("heading", { name: "Welcome back", level: 1 })).toHaveClass("text-display");
  expect(screen.getByText("Sign in to continue to TraceGenie.")).toBeVisible();
  expect(screen.getByAltText("TraceGenie")).toHaveAttribute("data-tracegenie-logo", "full");
  expect(screen.getByAltText("TraceGenie")).toHaveAttribute("width", "122");
  expect(document.querySelector("#admin-login-trust-bar")).not.toHaveTextContent("Organization-scoped access");
  expect(document.querySelector("#admin-login-trust")).not.toBeInTheDocument();
  expect(document.querySelector("#admin-login-body")).toContainElement(form);
  expect(form).toContainElement(screen.getByRole("link", { name: "Forgot password?" }));
  expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
    "href",
    "/forgot-password",
  );
  expect(footer).toContainElement(screen.getByRole("link", { name: "Create an account" }));
  expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
    "href",
    "/signup",
  );
  expect(screen.getByLabelText("Email")).toHaveFocus();
  expect(footer).not.toHaveTextContent("TraceGenie by Vertaware");
});

test("keeps session recovery and mutation feedback inside the shared shell body", () => {
  renderLogin(vi.fn(async () => {}), false, {
    feedback: <p role="alert">Unable to sign in right now.</p>,
    sessionNotice: "Your session expired. Sign in again.",
  });

  const body = document.querySelector("#admin-login-body");

  expect(body).toContainElement(screen.getByRole("status"));
  expect(screen.getByRole("status")).toHaveTextContent("Your session expired. Sign in again.");
  expect(body).toContainElement(screen.getByRole("alert"));
  expect(document.querySelector("#login-mutation-feedback")).toHaveTextContent(
    "Unable to sign in right now.",
  );
  expect(screen.getByLabelText("Email")).toHaveFocus();
});

test("validates login fields without native validation and focuses the first invalid field", async () => {
  const user = userEvent.setup();
  const onLogin = renderLogin();
  const email = screen.getByLabelText("Email");

  expect(email.closest("form")).toHaveAttribute("novalidate");
  expect(email).not.toBeRequired();
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findAllByRole("alert")).toHaveLength(2);
  expect(email).toHaveFocus();
  expect(email).toHaveAttribute("aria-invalid", "true");
  expect(email).toHaveAttribute("aria-describedby", "login-email-error");
  expect(screen.getByLabelText("Password")).toHaveAttribute(
    "aria-describedby",
    "login-password-error",
  );
  expect(screen.getByText("Enter your password.")).toBeVisible();
  expect(screen.queryByText("Use at least 8 characters.")).not.toBeInTheDocument();
  expect(onLogin).not.toHaveBeenCalled();
});

test("rejects malformed email but permits existing accounts with short passwords", async () => {
  const user = userEvent.setup();
  const onLogin = renderLogin();

  await user.type(screen.getByLabelText("Email"), "not-an-email");
  await user.type(screen.getByLabelText("Password"), "short");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findByText("Enter a valid work email.")).toBeVisible();
  expect(onLogin).not.toHaveBeenCalled();

  await user.clear(screen.getByLabelText("Email"));
  await user.type(screen.getByLabelText("Email"), "existing@example.test");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(onLogin).toHaveBeenCalledWith({
    email: "existing@example.test",
    password: "short",
  });
});

test("shows and hides the password without changing its value", async () => {
  const user = userEvent.setup();
  renderLogin();
  const password = screen.getByLabelText("Password");

  await user.type(password, "password123");
  expect(password).toHaveAttribute("type", "password");
  const show = screen.getByRole("button", { name: "Show password" });
  expect(show).toHaveAttribute("aria-pressed", "false");

  await user.click(show);
  expect(password).toHaveAttribute("type", "text");
  expect(password).toHaveValue("password123");
  const hide = screen.getByRole("button", { name: "Hide password" });
  expect(hide).toHaveAttribute("aria-pressed", "true");

  await user.click(hide);
  expect(password).toHaveAttribute("type", "password");
  expect(password).toHaveValue("password123");
});

test("synchronously blocks duplicate submits and disables form controls while pending", async () => {
  const user = userEvent.setup();
  let resolveLogin!: () => void;
  const onLogin = vi.fn(() => new Promise<void>((resolve) => {
    resolveLogin = resolve;
  }));
  renderLogin(onLogin);
  await enterValidLogin(user);
  const form = screen.getByLabelText("Email").closest("form");

  fireEvent.submit(form!);
  fireEvent.submit(form!);

  await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
  expect(onLogin).toHaveBeenCalledWith({
    email: "Ada.Lovelace+Test@Example.TEST",
    password: "password123",
  });
  expect(screen.getByLabelText("Email")).toBeDisabled();
  expect(screen.getByLabelText("Password")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Show password" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();

  resolveLogin();
  await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled());
});

test("honors parent pending state across every form control", () => {
  renderLogin(vi.fn(async () => {}), true);

  expect(screen.getByLabelText("Email")).toBeDisabled();
  expect(screen.getByLabelText("Password")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Show password" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
});

test("preserves rejected credentials exactly and permits an exact retry", async () => {
  const user = userEvent.setup();
  const onLogin = vi.fn()
    .mockRejectedValueOnce(new Error("login unavailable"))
    .mockResolvedValueOnce(undefined);
  renderLogin(onLogin);
  await enterValidLogin(user);

  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled());
  expect(screen.getByLabelText("Email")).toHaveValue("Ada.Lovelace+Test@Example.TEST");
  expect(screen.getByLabelText("Password")).toHaveValue("password123");

  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(2));
  expect(onLogin.mock.calls[1]).toEqual(onLogin.mock.calls[0]);
});
