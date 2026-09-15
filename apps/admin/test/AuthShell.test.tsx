import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import "@testing-library/jest-dom/vitest";

import { AuthShell } from "../src/features/auth/AuthShell";

afterEach(cleanup);

test("renders the canonical TraceGenie identity and body slot", () => {
  render(
    <AuthShell idPrefix="login" title="Welcome back">
      <form aria-label="Credentials">
        <button type="submit">Sign in</button>
      </form>
    </AuthShell>,
  );

  expect(screen.getByAltText("TraceGenie")).toHaveAttribute("data-tracegenie-logo", "full");
  expect(screen.getByAltText("TraceGenie")).toHaveAttribute("width", "122");
  expect(document.querySelector("#login-trust-bar")).toHaveTextContent("Organization-scoped access");
  expect(document.querySelector("#login-trust")).toHaveTextContent(
    "TraceGenie separates reports by organization and product access.",
  );
  expect(screen.getByRole("main")).toHaveAttribute("id", "login-page");
  expect(screen.getByRole("form", { name: "Credentials" })).toHaveTextContent("Sign in");
  expect(document.querySelector("#login-body")).toContainElement(screen.getByRole("form"));
});

test("links the auth region to its heading and description", () => {
  render(
    <AuthShell
      idPrefix="forgot-password"
      title="Reset your password"
      description="Enter your work email to receive a reset link."
    >
      <div>Reset form</div>
    </AuthShell>,
  );

  const region = screen.getByRole("region", { name: "Reset your password" });
  expect(region).toHaveAttribute("aria-labelledby", "forgot-password-title");
  expect(region).toHaveAttribute("aria-describedby", "forgot-password-description");
  expect(screen.getByRole("heading", { name: "Reset your password", level: 1 })).toHaveAttribute(
    "id",
    "forgot-password-title",
  );
  expect(screen.getByText("Enter your work email to receive a reset link.")).toHaveAttribute(
    "id",
    "forgot-password-description",
  );
});

test("renders the optional footer only when supplied", () => {
  const view = render(
    <AuthShell idPrefix="signup" title="Create your account">
      <div>Signup form</div>
    </AuthShell>,
  );

  expect(document.querySelector("#signup-footer")).not.toBeInTheDocument();

  view.rerender(
    <AuthShell
      idPrefix="signup"
      title="Create your account"
      footer={<a href="/login">Sign in</a>}
    >
      <div>Signup form</div>
    </AuthShell>,
  );

  expect(document.querySelector("#signup-footer")).toContainElement(screen.getByRole("link", { name: "Sign in" }));
});

test("supports the constrained standard and wide variants", () => {
  const view = render(
    <AuthShell idPrefix="accept-invite" title="Accept your invite">
      <div>Invite context</div>
    </AuthShell>,
  );

  expect(document.querySelector("#accept-invite-card")).toHaveClass("w-full", "max-w-md");

  view.rerender(
    <AuthShell idPrefix="accept-invite" title="Accept your invite" width="wide">
      <div>Invite context</div>
    </AuthShell>,
  );

  expect(document.querySelector("#accept-invite-card")).toHaveClass("w-full", "max-w-xl");
  expect(document.querySelector("#accept-invite-card")).not.toHaveClass("max-w-md");
});

test("supports a simple sign-in variant without repeated access boundaries", () => {
  render(
    <AuthShell idPrefix="simple-login" title="Welcome back" variant="simple">
      <form aria-label="Credentials">
        <button type="submit">Sign in</button>
      </form>
    </AuthShell>,
  );

  expect(document.querySelector("#simple-login-trust-bar")).not.toHaveTextContent(
    "Organization-scoped access",
  );
  expect(document.querySelector("#simple-login-trust")).not.toBeInTheDocument();
  expect(document.querySelector("#simple-login-header")).toHaveClass("text-center");
  expect(screen.getByRole("main")).toHaveClass("items-center");
});

test("supports stable external selectors without renaming internal shell regions", () => {
  render(
    <AuthShell
      idPrefix="internal-auth"
      pageId="established-page"
      cardId="established-card"
      title="Stable selectors"
    >
      <p>Body</p>
    </AuthShell>,
  );

  const region = screen.getByRole("region", { name: "Stable selectors" });
  expect(document.querySelector("#established-page")).toContainElement(region);
  expect(region).toHaveAttribute("id", "established-card");
  expect(region).toHaveAttribute("aria-labelledby", "internal-auth-title");
  expect(document.querySelector("#internal-auth-body")).toContainElement(screen.getByText("Body"));
});
