import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { InviteMemberPage } from "../src/features/users/InviteMemberPage";
import { api } from "../src/lib/api";

const queryClients: QueryClient[] = [];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  queryClients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

test("failed invite preserves values and retries the exact submitted mutation", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [] });
  const createInvite = vi.spyOn(api, "createInvite")
    .mockRejectedValueOnce(new Error("invite service unavailable"))
    .mockResolvedValueOnce({ invite: { acceptUrl: "https://example.test/invite/accepted" } });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InviteMemberPage organizationId="organization-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  const email = screen.getByLabelText("Email");
  await user.type(email, "developer@example.test");
  await user.click(screen.getByRole("button", { name: "Send invite" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't send the invite to developer@example.test.");
  expect(email).toHaveValue("developer@example.test");
  expect(createInvite).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Retry sending invite" }));

  expect(await screen.findByText("Invite sent to developer@example.test.")).toBeInTheDocument();
  expect(createInvite).toHaveBeenCalledTimes(2);
  expect(createInvite.mock.calls[1]).toEqual(createInvite.mock.calls[0]);
});

test("organization switching clears the draft and ignores a late invite result", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [] });
  let resolveInvite!: (value: { invite: { acceptUrl: string } }) => void;
  const createInvite = vi.spyOn(api, "createInvite").mockImplementation(() => new Promise((resolve) => {
    resolveInvite = resolve;
  }));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);

  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InviteMemberPage organizationId="organization-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  const email = screen.getByLabelText("Email");
  await user.type(email, "first-org@example.test");
  await user.click(screen.getByRole("button", { name: "Send invite" }));
  expect(createInvite).toHaveBeenCalledWith("organization-1", expect.objectContaining({
    email: "first-org@example.test",
  }));

  rerender(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InviteMemberPage organizationId="organization-2" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText("Email")).toHaveValue("");

  resolveInvite({ invite: { acceptUrl: "https://example.test/invite/old-org" } });
  await Promise.resolve();
  expect(screen.queryByText("https://example.test/invite/old-org")).not.toBeInTheDocument();
});

test("an A-B-A switch keeps an old invite result from replacing the current handoff", async () => {
  const staleInvite = deferred<{ invite: { acceptUrl: string } }>();
  const currentInvite = deferred<{ invite: { acceptUrl: string } }>();
  vi.spyOn(api, "getProjects").mockResolvedValue({ projects: [] });
  const createInvite = vi.spyOn(api, "createInvite")
    .mockReturnValueOnce(staleInvite.promise)
    .mockReturnValueOnce(currentInvite.promise);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);
  const user = userEvent.setup();
  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InviteMemberPage organizationId="organization-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.type(screen.getByLabelText("Email"), "stale@example.test");
  await user.click(screen.getByRole("button", { name: "Send invite" }));
  await waitFor(() => expect(createInvite).toHaveBeenCalledTimes(1));

  rerender(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InviteMemberPage organizationId="organization-2" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  rerender(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InviteMemberPage organizationId="organization-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.type(screen.getByLabelText("Email"), "current@example.test");
  await user.click(screen.getByRole("button", { name: "Send invite" }));
  await waitFor(() => expect(createInvite).toHaveBeenCalledTimes(2));

  await act(async () => {
    currentInvite.resolve({ invite: { acceptUrl: "https://example.test/invite/current" } });
    await currentInvite.promise;
  });
  expect(await screen.findByText("https://example.test/invite/current")).toBeVisible();

  await act(async () => {
    staleInvite.resolve({ invite: { acceptUrl: "https://example.test/invite/stale" } });
    await staleInvite.promise;
  });
  expect(screen.getByText("https://example.test/invite/current")).toBeVisible();
  expect(screen.queryByText("https://example.test/invite/stale")).not.toBeInTheDocument();
});

test("product requests use the explicit organization and late prior-tenant results stay isolated", async () => {
  const firstOrganizationProjects = deferred<{ projects: Array<{ id: string; name: string }> }>();
  const secondOrganizationProjects = deferred<{ projects: Array<{ id: string; name: string }> }>();
  const getProjects = vi.spyOn(api, "getProjects").mockImplementation((organizationId) => {
    if (organizationId === "organization-1") return firstOrganizationProjects.promise;
    if (organizationId === "organization-2") return secondOrganizationProjects.promise;
    return Promise.resolve({ projects: [] });
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);

  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InviteMemberPage organizationId="organization-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(getProjects).toHaveBeenCalledWith("organization-1"));

  rerender(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InviteMemberPage organizationId="organization-2" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(getProjects).toHaveBeenCalledWith("organization-2"));

  await act(async () => {
    secondOrganizationProjects.resolve({ projects: [{ id: "project-2", name: "Second tenant product" }] });
  });
  expect(await screen.findByText("Second tenant product")).toBeVisible();

  await act(async () => {
    firstOrganizationProjects.resolve({ projects: [{ id: "project-1", name: "First tenant product" }] });
  });
  expect(screen.queryByText("First tenant product")).not.toBeInTheDocument();
  expect(screen.getByText("Second tenant product")).toBeVisible();
});

test("effective access distinguishes no product access, selected member products, and administrator scope", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getProjects").mockResolvedValue({
    projects: [
      { id: "project-checkout", name: "Checkout" },
      { id: "project-billing", name: "Billing" },
    ],
  } as Awaited<ReturnType<typeof api.getProjects>>);
  const createInvite = vi.spyOn(api, "createInvite").mockResolvedValue({ invite: { acceptUrl: null } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClients.push(queryClient);

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InviteMemberPage organizationId="organization-1" organizationName="Northwind" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByText("This member will have no product access. Select one or more products to grant access.")).toBeVisible();
  expect(screen.getByText("Send an invite to Northwind so the member can set their own password.")).toBeVisible();
  const email = screen.getByLabelText("Email");
  await user.type(email, "member-no-products@example.test");
  await user.click(screen.getByRole("button", { name: "Send invite" }));
  await waitFor(() => expect(createInvite).toHaveBeenNthCalledWith(1, "organization-1", {
    email: "member-no-products@example.test",
    orgRole: "MEMBER",
  }));

  await user.clear(email);
  const checkout = await screen.findByRole("checkbox", { name: "Checkout" });
  await user.click(checkout);
  expect(screen.getByText("This member will have triager access to Checkout.")).toBeVisible();
  await user.type(email, "member-checkout@example.test");
  await user.click(screen.getByRole("button", { name: "Send invite" }));
  await waitFor(() => expect(createInvite).toHaveBeenNthCalledWith(2, "organization-1", {
    email: "member-checkout@example.test",
    orgRole: "MEMBER",
    projectIds: ["project-checkout"],
    projectRole: "TRIAGER",
  }));

  await user.selectOptions(screen.getByLabelText("Organization role"), "ADMIN");
  expect(screen.getByText("Administrators can manage this organization and access all current and future products. Product selections do not restrict administrator access.")).toBeVisible();
  expect(screen.getByText("All products")).toBeVisible();
  expect(checkout).not.toBeChecked();
  expect(checkout).toBeDisabled();

  await user.clear(email);
  await user.type(email, "admin@example.test");
  await user.click(screen.getByRole("button", { name: "Send invite" }));
  await waitFor(() => expect(createInvite).toHaveBeenNthCalledWith(3, "organization-1", {
    email: "admin@example.test",
    orgRole: "ADMIN",
  }));
});
