import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { InstallationEntry } from "../src/features/auth/InstallationEntry";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(complete = vi.fn()) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><InstallationEntry login={<p>Existing sign in</p>} onComplete={complete} /></QueryClientProvider>);
  return complete;
}
function reply(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
test("an initialized installation keeps its existing sign-in screen", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ required: false })));
  mount();
  expect(await screen.findByText("Existing sign in")).toBeTruthy();
  expect(screen.queryByLabelText("Setup code")).toBeNull();
});
test("setup submits the owner and project with credentials then enters the existing product", async () => {
  const owner = { id: "owner", name: "Owner", email: "owner@example.test", role: "ADMIN" };
  const fetcher = vi.fn().mockResolvedValueOnce(reply({ required: true })).mockResolvedValueOnce(reply({ user: owner }, 201));
  vi.stubGlobal("fetch", fetcher);
  const completed = mount();
  fireEvent.change(await screen.findByLabelText("Setup code"), { target: { value: "a".repeat(64) } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Owner" } });
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: owner.email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long-fixture-password" } });
  fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "My project" } });
  fireEvent.submit(document.getElementById("community-setup-form")!);
  await waitFor(() => expect(completed).toHaveBeenCalledWith(owner));
  expect(fetcher.mock.calls[1][1].credentials).toBe("include");
  expect(JSON.parse(fetcher.mock.calls[1][1].body).projectName).toBe("My project");
});
test("a failed setup retains fields and allows retry without exposing the code", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply({ required: true })).mockResolvedValueOnce(reply({ error: { message: "Enter the setup code shown by the installer." } }, 403)));
  const completed = mount();
  fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Retained owner" } });
  fireEvent.submit(document.getElementById("community-setup-form")!);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Enter the setup code shown by the installer.");
  expect(screen.getByLabelText("Your name")).toHaveProperty("value", "Retained owner");
  expect(screen.getByLabelText("Setup code")).toHaveProperty("type", "password");
  expect(completed).not.toHaveBeenCalled();
});
