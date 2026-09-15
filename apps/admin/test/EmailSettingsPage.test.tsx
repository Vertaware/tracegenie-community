// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EmailSettingsView, ProjectSummary } from "@tracegenie/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { EmailSettingsPage } from "../src/features/settings/EmailSettingsPage";
import { api, ApiError } from "../src/lib/api";

const clients: QueryClient[] = [];
const settings: EmailSettingsView = {
  source: "settings", revision: "00000000-0000-4000-8000-000000000001", provider: "resend",
  host: "smtp.resend.com", port: 465, secure: true, user: "resend", fromName: "Community",
  fromEmail: "notifications@example.test", replyTo: "", hasCredential: true, configured: true,
  canSave: true, lastTestAt: null,
};
const project: ProjectSummary = {
  id: "project", key: "community", name: "Community", description: "", defaultEnvironment: "development",
  allowedOrigins: [], notificationEmails: [], requesterEmailProductName: "Community", widgetConfig: {},
  isActive: true, createdAt: "2026-09-14T00:00:00.000Z", updatedAt: "2026-09-14T00:00:00.000Z",
};

afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); });

function renderPage(view = settings) {
  vi.spyOn(api, "getEmailSettings").mockResolvedValue({settings: view});
  vi.spyOn(api, "getProjects").mockResolvedValue({projects:[project]});
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/projects/community/settings/email"]}>
        <Routes>
          <Route path="/projects/:projectKey/settings/email" element={<EmailSettingsPage adminEmail="admin@example.test" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("saved key stays masked, sender edits omit the key, and replacement clears the submitted value", async () => {
  const user = userEvent.setup();
  const save = vi.spyOn(api, "saveEmailSettings").mockResolvedValue({settings:{...settings,fromName:"Updated",revision:"00000000-0000-4000-8000-000000000002"}});
  renderPage();
  const credential = await screen.findByLabelText("Resend API key");
  expect(credential).toHaveAttribute("type", "password");
  expect(credential).toHaveAttribute("readonly");
  await user.clear(screen.getByLabelText("Sender name"));
  await user.type(screen.getByLabelText("Sender name"), "Updated");
  await user.click(screen.getByRole("button",{name:"Save settings",exact:true}));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0].credential).toBeUndefined();
  await user.click(screen.getByRole("button",{name:"Replace",exact:true}));
  await user.type(screen.getByLabelText("Resend API key"), "re_replacement_fixture");
  await user.click(screen.getByRole("button",{name:"Save settings",exact:true}));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][0].credential).toBe("re_replacement_fixture");
  await waitFor(() => expect(screen.getByLabelText("Resend API key")).toHaveAttribute("readonly"));
  expect(screen.getByLabelText("Resend API key")).not.toHaveValue("re_replacement_fixture");
});

test("test failure distinguishes saved settings from delivery and retries without resubmitting credentials", async () => {
  const user = userEvent.setup();
  const save = vi.spyOn(api, "saveEmailSettings").mockResolvedValue({settings});
  const send = vi.spyOn(api, "testEmailSettings").mockRejectedValueOnce(new ApiError(502,"Email authentication failed.")).mockResolvedValue({sent:true,recipient:"admin@example.test",settings:{...settings,lastTestAt:new Date().toISOString()}});
  renderPage({...settings,source:"environment",revision:null,hasCredential:false});
  await user.type(await screen.findByLabelText("Resend API key"),"re_new_fixture");
  await user.click(screen.getByRole("button",{name:"Save and send test email"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Settings saved. Email authentication failed.");
  expect(send).toHaveBeenCalledWith(settings.revision);
  expect(screen.getByLabelText("Resend API key")).toHaveAttribute("readonly");
  await user.click(screen.getByRole("button",{name:"Save and send test email"}));
  expect(await screen.findByRole("status")).toHaveTextContent("Test email sent to admin@example.test");
  expect(save).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(2);
});

test("a stale form cannot send a test email until saved settings are reloaded", async () => {
  const user=userEvent.setup();
  vi.spyOn(api,"saveEmailSettings").mockRejectedValue(new ApiError(409,"Email settings changed in another session."));
  const send=vi.spyOn(api,"testEmailSettings");
  renderPage();
  await user.type(await screen.findByLabelText("Sender name"), " edit");
  await user.click(screen.getByRole("button",{name:"Save and send test email"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Email settings changed");
  expect(screen.getByRole("button",{name:"Reload saved settings"})).toBeVisible();
  expect(screen.getByRole("button",{name:"Save and send test email"})).toBeDisabled();
  expect(send).not.toHaveBeenCalled();
});
