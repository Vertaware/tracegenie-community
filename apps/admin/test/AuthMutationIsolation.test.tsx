import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";

import { App, getSafeAdminReturnPath } from "../src/app/App";
import { ADMIN_SESSION_EXPIRED_EVENT, ApiError, api } from "../src/lib/api";
import { copy } from "../src/lib/copy";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

const sessionUser = {
  id: "user-1",
  email: "admin@example.test",
  name: "Admin User",
  role: "ADMIN",
  platformRole: "GLOBAL_ADMIN",
};

test("leaving an auth route aborts its pending credential request and clears feedback ownership", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getMe").mockRejectedValue(new Error("no session"));
  let loginSignal: AbortSignal | undefined;
  vi.spyOn(api, "login").mockImplementation((_email, _password, signal) => {
    loginSignal = signal;
    return new Promise(() => undefined);
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await screen.findByRole("heading", { name: "Welcome back" });
  await user.type(screen.getByLabelText("Email"), "first@example.test");
  await user.type(screen.getByLabelText("Password"), "password-1");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(loginSignal?.aborted).toBe(false);

  await user.click(screen.getByRole("link", { name: "Create an account" }));
  await screen.findByRole("heading", { name: "Create your TraceGenie account" });
  expect(loginSignal?.aborted).toBe(true);
  expect(screen.queryByText(copy.login.invalidCredentials)).not.toBeInTheDocument();
});

test("failed sign-in keeps the form as the only retry path", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getMe").mockRejectedValue(new Error("no session"));
  vi.spyOn(api, "login").mockRejectedValue(new ApiError(401, "Invalid credentials", "auth.invalid_credentials"));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await screen.findByRole("heading", { name: "Welcome back" });
  await user.type(screen.getByLabelText("Email"), "admin@example.test");
  await user.type(screen.getByLabelText("Password"), "wrong-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That email or password isn't right. Try again.",
  );
  expect(screen.queryByRole("button", { name: "Retry sign in" })).not.toBeInTheDocument();
  expect(screen.queryByText("Use at least 8 characters.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  expect(screen.getByLabelText("Email")).toHaveFocus();
});

test("service sign-in failures stay distinct from invalid credentials", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getMe").mockRejectedValue(new Error("no session"));
  vi.spyOn(api, "login").mockRejectedValue(new ApiError(503, "Unavailable", "auth.unavailable"));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await screen.findByRole("heading", { name: "Welcome back" });
  await user.type(screen.getByLabelText("Email"), "admin@example.test");
  await user.type(screen.getByLabelText("Password"), "valid-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn't sign you in right now. Try again in a moment.",
  );
  expect(screen.getByRole("alert")).not.toHaveTextContent("password isn't right");
  expect(screen.getByLabelText("Email")).toHaveValue("admin@example.test");
  expect(screen.getByLabelText("Email")).toHaveFocus();
});

test("session expiry clears cached data and returns to the exact safe route after sign-in", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem("tracegenie.currentOrganizationId", "organization-1");
  const setActiveOrganizationId = vi.spyOn(api, "setActiveOrganizationId");
  vi.spyOn(api, "getMe").mockResolvedValue({ user: sessionUser });
  vi.spyOn(api, "getOrganizations").mockResolvedValue({
    organizations: [{ id: "organization-1", name: "Northwind", slug: "northwind", role: "ADMIN" }],
  });
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [] });
  vi.spyOn(api, "login").mockResolvedValue({ user: sessionUser });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(["sensitive-stale-data"], { count: 42 });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects?status=active#project-list"]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await screen.findByRole("heading", { name: "Your products" });
  act(() => window.dispatchEvent(new Event(ADMIN_SESSION_EXPIRED_EVENT)));

  await waitFor(() => expect(screen.getByTestId("location-probe")).toHaveTextContent("/login"));
  expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  expect(screen.getByText(copy.session.expired)).toHaveAttribute("role", "status");
  expect(queryClient.getQueryData(["sensitive-stale-data"])).toBeUndefined();
  expect(window.sessionStorage.getItem("tracegenie.adminSessionReturnPath")).toBe(
    "/projects?status=active#project-list",
  );

  await user.type(screen.getByLabelText("Email"), "admin@example.test");
  await user.type(screen.getByLabelText("Password"), "valid-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  await waitFor(() => {
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/projects?status=active#project-list");
  });
  expect(screen.queryByText(copy.session.expired)).not.toBeInTheDocument();
  expect(window.sessionStorage.getItem("tracegenie.adminSessionReturnPath")).toBeNull();
  expect(setActiveOrganizationId).toHaveBeenLastCalledWith("organization-1");
});

test("session return paths reject auth, reporter, external, and protocol-relative destinations", () => {
  expect(getSafeAdminReturnPath("/issues?status=open#issue-1")).toBe("/issues?status=open#issue-1");
  expect(getSafeAdminReturnPath("/login")).toBeNull();
  expect(getSafeAdminReturnPath("/reporter")).toBeNull();
  expect(getSafeAdminReturnPath("https://evil.example/issues")).toBeNull();
  expect(getSafeAdminReturnPath("//evil.example/issues")).toBeNull();
});

test("platform bootstrap clears the retained tenant API scope", async () => {
  window.localStorage.setItem("tracegenie.currentOrganizationId", "organization-1");
  const setActiveOrganizationId = vi.spyOn(api, "setActiveOrganizationId");
  vi.spyOn(api, "getMe").mockResolvedValue({ user: sessionUser });
  vi.spyOn(api, "getOrganizations").mockResolvedValue({
    organizations: [{ id: "organization-1", name: "Northwind", slug: "northwind", role: "ADMIN" }],
  });
  vi.spyOn(api, "getPlatformOrganizations").mockResolvedValue({ organizations: [] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/platform"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByRole("heading", { name: "Platform operations" })).toBeInTheDocument();
  await waitFor(() => expect(setActiveOrganizationId).toHaveBeenLastCalledWith(null));
});

test("an initial 401 on a protected deep link opens sign-in without rendering the page empty", async () => {
  vi.spyOn(api, "getMe").mockRejectedValue(new ApiError(401, "Session expired.", "auth.invalid_session"));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/issues?severity=critical"]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  expect(screen.getByText(copy.session.expired)).toBeInTheDocument();
  expect(screen.queryByText("Queue clear")).not.toBeInTheDocument();
  expect(screen.getByTestId("location-probe")).toHaveTextContent("/login");
  expect(window.sessionStorage.getItem("tracegenie.adminSessionReturnPath")).toBe(
    "/issues?severity=critical",
  );
});

test("successful bootstrap on login resumes and clears a stored safe return path", async () => {
  window.localStorage.setItem("tracegenie.currentOrganizationId", "organization-1");
  window.sessionStorage.setItem("tracegenie.adminSessionReturnPath", "/projects?status=active");
  vi.spyOn(api, "getMe").mockResolvedValue({ user: sessionUser });
  vi.spyOn(api, "getOrganizations").mockResolvedValue({
    organizations: [{ id: "organization-1", name: "Northwind", slug: "northwind", role: "ADMIN" }],
  });
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await waitFor(() => expect(screen.getByTestId("location-probe")).toHaveTextContent("/projects?status=active"));
  expect(await screen.findByRole("heading", { name: "Your products" })).toBeInTheDocument();
  expect(screen.queryByText(copy.session.expired)).not.toBeInTheDocument();
  expect(window.sessionStorage.getItem("tracegenie.adminSessionReturnPath")).toBeNull();
});
