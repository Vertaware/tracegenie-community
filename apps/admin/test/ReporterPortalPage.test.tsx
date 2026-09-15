import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ReporterPortalPage } from "../src/features/reporter/ReporterPortalPage";
import { reporterSelfServiceApi } from "../src/features/reporter/reporterSelfServiceApi";
import { ApiError, api } from "../src/lib/api";

beforeEach(() => {
  vi.spyOn(reporterSelfServiceApi, "getPrivacyStatus").mockResolvedValue({ exports: [], deletions: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/reporter");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type ReporterComment = {
  id: string;
  body: string;
  createdAt: string;
};

function ticket(id: string, ticketNumber: number, title: string, comments: ReporterComment[] = []) {
  return {
    id,
    ticketNumber,
    title,
    description: `${title} details`,
    status: "open",
    isOverageLocked: false,
    requesterNotificationsEnabled: true,
    resolutionFeedback: null as {
      state: "awaiting_confirmation" | "confirmed_fixed" | "still_happening" | "closed";
      respondedAt: string | null;
    } | null,
    project: {
      name: "Checkout",
      organizationName: "Acme",
    },
    comments,
    attachments: [],
    statusHistory: [],
    notificationHistory: [],
  };
}

test("reporter resolution closes a fixed report and keeps the result visible", async () => {
  const fixedTicket = {
    ...ticket("ticket-fixed", 103, "Checkout fix ready"),
    status: "fixed",
    resolutionFeedback: { state: "awaiting_confirmation" as const, respondedAt: null },
  };
  const confirmedTicket = {
    ...fixedTicket,
    status: "closed",
    resolutionFeedback: { state: "confirmed_fixed" as const, respondedAt: "2026-07-15T14:30:00.000Z" },
  };
  const confirmFixed = vi.spyOn(api, "confirmReporterFixed").mockResolvedValue({ ticket: confirmedTicket });
  const user = await openReporterTickets([fixedTicket]);
  const report = document.querySelector<HTMLElement>("#reporter-ticket-ticket-fixed")!;

  expect(within(report).getByRole("heading", { name: "Did this fix the problem?" })).toBeVisible();
  const context = within(report).getByLabelText("Reply to the team");
  await user.type(context, "Verified after retrying checkout.");
  await user.click(within(report).getByRole("button", { name: "Confirm fixed" }));

  await waitFor(() => expect(confirmFixed).toHaveBeenCalledWith(
    "reporter-token",
    "ticket-fixed",
    "Verified after retrying checkout.",
    expect.stringMatching(/^reporter-confirm:/),
  ));
  expect(await within(report).findByRole("heading", { name: "You confirmed this fix" })).toBeVisible();
  expect(within(report).getByLabelText("Reply to the team")).toHaveValue("");
  expect(within(report).getByRole("button", { name: "Still having this issue?" })).toBeVisible();
});

test("capacity-locked reports stay visible and disable processing actions", async () => {
  const lockedTicket = {
    ...ticket("ticket-locked", 105, "Capacity locked report"),
    status: "fixed",
    isOverageLocked: true,
    resolutionFeedback: { state: "awaiting_confirmation" as const, respondedAt: null },
  };
  await openReporterTickets([lockedTicket]);
  const report = document.querySelector<HTMLElement>("#reporter-ticket-ticket-locked")!;

  expect(within(report).getByRole("status")).toHaveTextContent("Processing paused");
  expect(within(report).getByRole("status")).toHaveTextContent("no data was lost");
  expect(within(report).getByLabelText("Reply to the team")).toBeDisabled();
  expect(within(report).getByRole("button", { name: "Confirm fixed" })).toBeDisabled();
  expect(within(report).getByRole("button", { name: "Still having this issue?" })).toBeDisabled();
  expect(within(report).getByLabelText("Add image attachment")).toBeDisabled();
  expect(within(report).getByRole("button", { name: "Send reply" })).toBeDisabled();
  expect(within(report).queryByRole("button", { name: "Stop updates" })).not.toBeInTheDocument();
});

test("failed reporter resolution retries the immutable response without erasing a newer draft", async () => {
  const retryWrite = deferred<{ ticket: ReturnType<typeof ticket> }>();
  const fixedTicket = {
    ...ticket("ticket-retry", 104, "Receipt fix ready"),
    status: "fixed",
    resolutionFeedback: { state: "awaiting_confirmation" as const, respondedAt: null },
  };
  const markStillHappening = vi.spyOn(api, "markReporterStillHappening")
    .mockRejectedValueOnce(new Error("Network offline"))
    .mockImplementationOnce(() => retryWrite.promise);
  const user = await openReporterTickets([fixedTicket]);
  const report = document.querySelector<HTMLElement>("#reporter-ticket-ticket-retry")!;
  const context = within(report).getByLabelText("Reply to the team");

  await user.type(context, "Still broken after refresh.");
  await user.click(within(report).getByRole("button", { name: "Still having this issue?" }));
  expect(await within(report).findByRole("alert")).toHaveTextContent("Your response was not saved. Network offline");
  await user.clear(context);
  await user.type(context, "New detail not submitted yet.");
  await user.click(within(report).getByRole("button", { name: "Retry response" }));

  expect(markStillHappening).toHaveBeenCalledTimes(2);
  expect(markStillHappening.mock.calls[1]).toEqual(markStillHappening.mock.calls[0]);
  await act(async () => {
    retryWrite.resolve({
      ticket: {
        ...fixedTicket,
        status: "in_progress",
        resolutionFeedback: { state: "still_happening", respondedAt: "2026-07-15T14:35:00.000Z" },
      },
    });
    await retryWrite.promise;
  });

  expect(await within(report).findByRole("heading", { name: "You told the team it is still happening" })).toBeVisible();
  expect(context).toHaveValue("New detail not submitted yet.");
});

async function openReporterTickets(ticketList: ReturnType<typeof ticket>[], openFirst = true) {
  const user = userEvent.setup();
  vi.spyOn(api, "requestReporterOtp").mockResolvedValue({ ok: true });
  vi.spyOn(api, "verifyReporterOtp").mockResolvedValue({ token: "reporter-token" });
  vi.spyOn(api, "getReporterTickets").mockResolvedValue({ tickets: ticketList });

  render(<ReporterPortalPage />);
  await user.type(screen.getByLabelText("Report email"), "reporter@example.test");
  await user.click(screen.getByRole("button", { name: "Send access code" }));
  await user.type(screen.getByLabelText("Access code"), "123456");
  await user.click(screen.getByRole("button", { name: "Open tickets" }));
  if (!new URLSearchParams(window.location.search).has("ticket")) await screen.findByRole("link", { name: ticketList[0].title });
  if (openFirst) await user.click(screen.getByRole("link", { name: ticketList[0].title }));
  return user;
}

test("new reporter actions clear stale success and lock every ticket action", async () => {
  const user = userEvent.setup();
  const pendingVerify = deferred<{ token: string }>();
  const pendingComment = deferred<{ comment: { id: string; body: string; createdAt: string } }>();
  vi.spyOn(api, "requestReporterOtp").mockResolvedValue({ ok: true });
  vi.spyOn(api, "verifyReporterOtp").mockReturnValue(pendingVerify.promise);
  vi.spyOn(api, "getReporterTickets").mockResolvedValue({
    tickets: [ticket("ticket-1", 101, "Checkout fails"), ticket("ticket-2", 102, "Receipt missing")],
  });
  vi.spyOn(reporterSelfServiceApi, "addComment").mockReturnValue(pendingComment.promise);

  render(<ReporterPortalPage />);
  expect(screen.getByRole("img", { name: "TraceGenie" })).toHaveAttribute("data-tracegenie-logo", "full");
  await user.type(screen.getByLabelText("Report email"), "reporter@example.test");
  await user.click(screen.getByRole("button", { name: "Send access code" }));
  expect(await screen.findByText("If this email has reports, a six-digit code is on its way.")).toBeInTheDocument();

  await user.type(screen.getByLabelText("Access code"), "123456");
  await user.click(screen.getByRole("button", { name: "Open tickets" }));
  expect(screen.queryByText("If this email has reports, a six-digit code is on its way.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Opening tickets..." })).toBeDisabled();

  await act(async () => {
    pendingVerify.resolve({ token: "reporter-token" });
    await pendingVerify.promise;
  });
  await user.click(await screen.findByRole("link", { name: "Checkout fails" }));
  await user.type(screen.getByLabelText("Reply to the team"), "This happens after checkout.");
  const form = document.querySelector("#reporter-ticket-comment-form-ticket-1")!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(reporterSelfServiceApi.addComment).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled();
  await user.click(screen.getByRole("link", { name: "My tickets" }));
  await user.click(screen.getByRole("link", { name: "Receipt missing" }));
  await user.type(screen.getByLabelText("Reply to the team"), "Sibling draft");
  expect(screen.getByRole("button", { name: "Send reply" })).toBeDisabled();
  fireEvent.submit(document.querySelector("#reporter-ticket-comment-form-ticket-2")!);
  expect(reporterSelfServiceApi.addComment).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("link", { name: "My tickets" }));
  await user.click(screen.getByRole("link", { name: "Checkout fails" }));
  await act(async () => {
    pendingComment.resolve({
      comment: { id: "comment-1", body: "This happens after checkout.", createdAt: "2026-07-11T00:00:00.000Z" },
    });
    await pendingComment.promise;
  });

  const firstTicket = document.querySelector<HTMLElement>("#reporter-ticket-ticket-1")!;
  await waitFor(() => expect(within(firstTicket).getByRole("status")).toHaveTextContent("Your update was added."));
  expect(document.querySelector("#reporter-status-message")).not.toBeInTheDocument();
});

test("failed reporter update retries its immutable ticket payload without erasing a newer draft", async () => {
  const firstWrite = deferred<{ comment: { id: string; body: string; createdAt: string } }>();
  const retryWrite = deferred<{ comment: { id: string; body: string; createdAt: string } }>();
  const addComment = vi.spyOn(reporterSelfServiceApi, "addComment")
    .mockImplementationOnce(() => firstWrite.promise)
    .mockImplementationOnce(() => retryWrite.promise);
  const user = await openReporterTickets([
    ticket("ticket-1", 101, "Checkout fails", [
      {
        id: "comment-1",
        body: "Original failed update",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
    ]),
    ticket("ticket-2", 102, "Receipt missing"),
  ]);
  const firstTicket = document.querySelector<HTMLElement>("#reporter-ticket-ticket-1")!;
  const firstDraft = within(firstTicket).getByLabelText("Reply to the team");

  await user.type(firstDraft, "Original failed update");
  fireEvent.submit(document.querySelector("#reporter-ticket-comment-form-ticket-1")!);
  await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));
  await user.clear(firstDraft);
  await user.type(firstDraft, "Newer unsent draft");

  act(() => firstWrite.reject(new Error("Network offline")));

  const recovery = await within(firstTicket).findByRole("alert");
  expect(recovery).toHaveTextContent("Could not add your update. Network offline");
  expect(document.querySelector("#reporter-ticket-ticket-2")).not.toBeInTheDocument();
  expect(document.querySelector("#reporter-error-message")).not.toBeInTheDocument();
  expect(firstDraft).toHaveValue("Newer unsent draft");

  const retryButton = within(firstTicket).getByRole("button", { name: "Retry adding update" });
  act(() => {
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);
  });

  expect(addComment).toHaveBeenCalledTimes(2);
  expect(addComment.mock.calls[1]).toEqual(addComment.mock.calls[0]);
  expect(within(firstTicket).getByRole("button", { name: "Retrying update..." })).toBeDisabled();

  await act(async () => {
    retryWrite.resolve({
      comment: {
        id: "comment-1",
        body: "Original failed update",
        createdAt: "2026-07-11T00:00:00.000Z",
      },
    });
    await retryWrite.promise;
  });

  await waitFor(() => expect(within(firstTicket).queryByRole("alert")).not.toBeInTheDocument());
  expect(firstDraft).toHaveValue("Newer unsent draft");
  expect(within(firstTicket).getAllByText("Original failed update")).toHaveLength(1);
});

test("ticket navigation preserves drafts and keeps recovery scoped to its ticket", async () => {
  vi.spyOn(reporterSelfServiceApi, "addComment").mockRejectedValue(new Error("Update unavailable"));
  const user = await openReporterTickets([ticket("ticket-1", 101, "Checkout fails"), ticket("ticket-2", 102, "Receipt missing")]);
  await user.type(screen.getByLabelText("Reply to the team"), "Failed update");
  await user.click(screen.getByRole("button", { name: "Send reply" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Update unavailable");
  await user.click(screen.getByRole("link", { name: "My tickets" }));
  await user.click(screen.getByRole("link", { name: "Receipt missing" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Reply to the team"), "Receipt draft");
  await user.click(screen.getByRole("link", { name: "My tickets" }));
  await user.click(screen.getByRole("link", { name: "Checkout fails" }));
  expect(screen.getByLabelText("Reply to the team")).toHaveValue("Failed update");
  expect(screen.getByRole("alert")).toHaveTextContent("Update unavailable");
});

test("empty reporter updates replace stale ticket success and recovery with scoped validation", async () => {
  const addComment = vi.spyOn(reporterSelfServiceApi, "addComment")
    .mockResolvedValueOnce({
      comment: {
        id: "comment-success",
        body: "First update",
        createdAt: "2026-07-11T00:00:00.000Z",
      },
    })
    .mockRejectedValueOnce(new Error("Network offline"));
  const user = await openReporterTickets([ticket("ticket-1", 101, "Checkout fails")]);
  const firstTicket = document.querySelector<HTMLElement>("#reporter-ticket-ticket-1")!;
  const draft = within(firstTicket).getByLabelText("Reply to the team");
  const submit = within(firstTicket).getByRole("button", { name: "Send reply" });

  await user.type(draft, "First update");
  await user.click(submit);
  expect(await within(firstTicket).findByRole("status")).toHaveTextContent("Your update was added.");

  await user.click(submit);
  expect(within(firstTicket).queryByRole("status")).not.toBeInTheDocument();
  expect(within(firstTicket).getByRole("alert")).toHaveTextContent("Enter an update before submitting.");
  expect(document.querySelector("#reporter-status-message")).not.toBeInTheDocument();

  await user.type(draft, "Update that fails");
  await user.click(submit);
  expect(await within(firstTicket).findByRole("button", { name: "Retry adding update" })).toBeInTheDocument();
  expect(within(firstTicket).getByRole("alert")).toHaveTextContent("Could not add your update. Network offline");

  await user.clear(draft);
  await user.click(submit);
  expect(within(firstTicket).queryByRole("button", { name: "Retry adding update" })).not.toBeInTheDocument();
  expect(within(firstTicket).getByRole("alert")).toHaveTextContent("Enter an update before submitting.");
  expect(document.querySelector("#reporter-error-message")).not.toBeInTheDocument();
  expect(addComment).toHaveBeenCalledTimes(2);
});

test("secure receipt bridge verifies safe context and opens only the linked report", async () => {
  const bridgeToken = "bridge-token-with-enough-opaque-characters";
  window.history.replaceState({}, "", `/reporter#bridge=${bridgeToken}`);
  const getBridge = vi.spyOn(api, "getReporterBridge").mockResolvedValue({
    bridge: { ticketNumber: 742, organizationName: "Acme", projectName: "Checkout" },
  });
  const requestOtp = vi.spyOn(api, "requestReporterOtp").mockResolvedValue({ ok: true });
  const verifyOtp = vi.spyOn(api, "verifyReporterOtp").mockResolvedValue({ token: "bridged-session" });
  vi.spyOn(api, "getReporterTickets").mockResolvedValue({ tickets: [ticket("linked-ticket", 742, "Checkout stalls")] });
  const user = userEvent.setup();

  render(<ReporterPortalPage />);
  expect(screen.getByRole("status")).toHaveTextContent("Checking your secure report link");
  expect(await screen.findByRole("heading", { name: "Updates on issue #742" })).toBeInTheDocument();
  expect(screen.getByText("Acme · Verify your email to view this report.")).toBeInTheDocument();
  expect(window.location.search).toBe("");
  expect(window.location.hash).toBe("");
  expect(window.sessionStorage.getItem("tracegenie:reporter-bridge")).toBe(bridgeToken);
  expect(getBridge).toHaveBeenCalledWith(bridgeToken, expect.any(AbortSignal));

  await user.type(screen.getByLabelText("Report email"), "mina@example.test");
  await user.click(screen.getByRole("button", { name: "Send access code" }));
  expect(requestOtp).toHaveBeenCalledWith("mina@example.test", bridgeToken);
  await user.type(screen.getByLabelText("Access code"), "123456");
  await user.click(screen.getByRole("button", { name: "Open tickets" }));
  expect(verifyOtp).toHaveBeenCalledWith("mina@example.test", "123456", { bridgeToken });
  expect(await screen.findByRole("heading", { name: "Checkout stalls" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "My tickets" })).toHaveAttribute("href", "/reporter?view=all");
  expect(screen.getByRole("link", { name: "Close view" })).toHaveAttribute("href", "/reporter?view=all");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Download my data" })).not.toBeInTheDocument();
  expect(window.sessionStorage.getItem("tracegenie:reporter-bridge")).toBeNull();
});

test("view all tickets clears an unfinished single-ticket sign-in", async () => {
  window.sessionStorage.setItem("tracegenie:reporter-bridge", "unfinished-single-ticket-bridge");
  window.history.replaceState({}, "", "/reporter?view=all");
  const getBridge = vi.spyOn(api, "getReporterBridge");
  const requestOtp = vi.spyOn(api, "requestReporterOtp").mockResolvedValue({ ok: true });
  const user = userEvent.setup();

  render(<ReporterPortalPage />);
  expect(screen.getByRole("heading", { name: "My tickets" })).toBeVisible();
  expect(getBridge).not.toHaveBeenCalled();
  expect(window.sessionStorage.getItem("tracegenie:reporter-bridge")).toBeNull();
  await user.type(screen.getByLabelText("Report email"), "reporter@example.test");
  await user.click(screen.getByRole("button", { name: "Send access code" }));
  expect(requestOtp).toHaveBeenCalledWith("reporter@example.test", undefined);
});

test("query-string bridge capabilities are discarded instead of authenticated", () => {
  const bridgeToken = "query-bridge-token-that-must-not-be-used";
  window.history.replaceState({}, "", `/reporter?source=email&bridge=${bridgeToken}`);
  const getBridge = vi.spyOn(api, "getReporterBridge");

  render(<ReporterPortalPage />);

  expect(window.location.search).toBe("?source=email");
  expect(window.sessionStorage.getItem("tracegenie:reporter-bridge")).toBeNull();
  expect(getBridge).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "My tickets" })).toBeInTheDocument();
});

test("reporter entry keeps the sign-in instructions without redundant access explanations", () => {
  render(<ReporterPortalPage />);

  expect(screen.getByRole("heading", { name: "My tickets" })).toBeInTheDocument();
  expect(screen.getByText(/one-time access code/i)).toBeVisible();
  expect(screen.queryByText(/only public updates and files shared with you/i)).not.toBeInTheDocument();
  expect(screen.queryByText("Organization-scoped access")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Report email")).toHaveAttribute("autocomplete", "email");
  expect(screen.getByRole("button", { name: "Send access code" })).toBeEnabled();
  expect(screen.queryByText("How reporter access works")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Access boundary")).not.toBeInTheDocument();
});

test("invalid and offline bridge states stay truthful without sending an unverified capability", async () => {
  const bridgeToken = "invalid-bridge-token-with-enough-characters";
  window.history.replaceState({}, "", `/reporter#bridge=${bridgeToken}`);
  vi.spyOn(api, "getReporterBridge").mockRejectedValue(new ApiError(410, "This report link has expired.", "reporter.bridge_expired"));
  const requestOtp = vi.spyOn(api, "requestReporterOtp").mockResolvedValue({ ok: true });
  const user = userEvent.setup();

  render(<ReporterPortalPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("This report link has expired.");
  await user.type(screen.getByLabelText("Report email"), "mina@example.test");
  await user.click(screen.getByRole("button", { name: "Send access code" }));
  expect(requestOtp).toHaveBeenCalledWith("mina@example.test", undefined);

  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", `/reporter#bridge=${bridgeToken}`);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
  vi.spyOn(api, "getReporterBridge");
  render(<ReporterPortalPage />);
  expect(screen.getByRole("status")).toHaveTextContent("You are offline.");
  expect(screen.getByRole("button", { name: "Send access code" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Open tickets" })).not.toBeInTheDocument();
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
});

test("staged OTP flow freezes the submitted email and supports change-email recovery", async () => {
  const requestOtp = vi.spyOn(api, "requestReporterOtp").mockResolvedValue({
    ok: true,
    retryAfterSeconds: 45,
    expiresInSeconds: 480,
  } as { ok: true });
  const user = userEvent.setup();

  render(<ReporterPortalPage />);
  expect(screen.queryByLabelText("Access code")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Report email"), "Reporter@Example.Test ");
  await user.click(screen.getByRole("button", { name: "Send access code" }));

  expect(requestOtp).toHaveBeenCalledWith("reporter@example.test", undefined);
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  expect(screen.getByText("reporter@example.test")).toBeInTheDocument();
  expect(screen.getByLabelText("Access code")).toHaveFocus();
  expect(screen.getByRole("button", { name: "Resend in 45s" })).toBeDisabled();
  expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Access code")).toHaveAttribute("aria-describedby", "reporter-code-help");
  expect(screen.getByRole("button", { name: "Change email" }).parentElement).toContainElement(
    screen.getByText("reporter@example.test"),
  );

  await user.click(screen.getByRole("button", { name: "Change email" }));
  expect(screen.getByLabelText("Report email")).toHaveValue("Reporter@Example.Test");
  expect(screen.queryByLabelText("Access code")).not.toBeInTheDocument();
});

test("code expiry appears only when resend is available and expired codes cannot be submitted", async () => {
  vi.useFakeTimers();
  const resend = deferred<{ ok: true; retryAfterSeconds: number; expiresInSeconds: number }>();
  vi.spyOn(api, "requestReporterOtp")
    .mockResolvedValueOnce({ ok: true, retryAfterSeconds: 2, expiresInSeconds: 5 })
    .mockReturnValueOnce(resend.promise);
  const verifyOtp = vi.spyOn(api, "verifyReporterOtp");

  render(<ReporterPortalPage />);
  fireEvent.change(screen.getByLabelText("Report email"), { target: { value: "reporter@example.test" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send access code" }));
  });
  expect(screen.getByRole("button", { name: "Resend in 2s" })).toBeDisabled();
  expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  expect(screen.getByRole("timer")).toHaveTextContent("Code expires in 0:03.");
  expect(screen.getByLabelText("Access code")).toHaveAttribute("aria-describedby", "reporter-code-help reporter-code-expiry");

  fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
  expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled();
  await act(async () => { resend.resolve({ ok: true, retryAfterSeconds: 2, expiresInSeconds: 3 }); });
  expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Access code"), { target: { value: "123456" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(document.querySelector("#reporter-code-expiry")).toHaveTextContent("This code has expired. Request a new one.");
  expect(screen.getByRole("button", { name: "Open tickets" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  expect(verifyOtp).not.toHaveBeenCalled();
});

test("invalid reporter email stays adjacent, announced, focused, and off the API", async () => {
  const requestOtp = vi.spyOn(api, "requestReporterOtp").mockResolvedValue({ ok: true });
  const user = userEvent.setup();

  render(<ReporterPortalPage />);
  const email = screen.getByLabelText("Report email");
  await user.type(email, "not-an-email");
  await user.click(screen.getByRole("button", { name: "Send access code" }));

  expect(requestOtp).not.toHaveBeenCalled();
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid report email.");
  expect(email).toHaveAttribute("aria-invalid", "true");
  expect(email).toHaveAttribute("aria-describedby", "reporter-email-help reporter-email-error");
  expect(document.querySelector("#reporter-email-error")).toHaveTextContent("Enter a valid report email.");
  expect(email).toHaveFocus();
});

test("delivery and rate-limit failures stay recoverable without exposing account existence", async () => {
  const requestOtp = vi.spyOn(api, "requestReporterOtp")
    .mockRejectedValueOnce(new Error("Email delivery is temporarily unavailable."))
    .mockRejectedValueOnce(new ApiError(429, "Too many requests"));
  const user = userEvent.setup();

  render(<ReporterPortalPage />);
  const email = screen.getByLabelText("Report email");
  await user.type(email, "missing@example.test");
  await user.click(screen.getByRole("button", { name: "Send access code" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Email delivery is temporarily unavailable.");
  expect(screen.queryByLabelText("Access code")).not.toBeInTheDocument();
  expect(email).toHaveValue("missing@example.test");
  expect(email).toHaveAttribute("aria-invalid", "true");
  expect(email).toHaveAttribute("aria-describedby", "reporter-email-help reporter-email-error");
  expect(document.querySelector("#reporter-email-error")).toHaveTextContent(
    "Email delivery is temporarily unavailable.",
  );
  expect(email).toHaveFocus();

  await user.click(screen.getByRole("button", { name: "Send access code" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts. Wait a minute, then try again.");
  expect(requestOtp).toHaveBeenCalledTimes(2);
});

test("invalid code remains on the code step and authenticated loading can recover then sign out", async () => {
  const pendingTickets = deferred<{ tickets: ReturnType<typeof ticket>[] }>();
  vi.spyOn(api, "requestReporterOtp").mockResolvedValue({ ok: true });
  vi.spyOn(api, "verifyReporterOtp")
    .mockRejectedValueOnce(new ApiError(401, "The code is invalid or expired.", "reporter.invalid_otp"))
    .mockResolvedValueOnce({ token: "reporter-token" });
  vi.spyOn(api, "getReporterTickets").mockReturnValue(pendingTickets.promise);
  const user = userEvent.setup();

  render(<ReporterPortalPage />);
  await user.type(screen.getByLabelText("Report email"), "reporter@example.test");
  await user.click(screen.getByRole("button", { name: "Send access code" }));
  await user.type(screen.getByLabelText("Access code"), "111111");
  await user.click(screen.getByRole("button", { name: "Open tickets" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The code is invalid or expired.");
  expect(screen.getByLabelText("Access code")).toHaveValue("111111");
  expect(screen.getByLabelText("Access code")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Access code")).toHaveAttribute(
    "aria-describedby",
    "reporter-code-help reporter-code-error",
  );
  expect(document.querySelector("#reporter-code-error")).toHaveTextContent(
    "The code is invalid or expired.",
  );
  expect(screen.getByLabelText("Access code")).toHaveFocus();

  await user.clear(screen.getByLabelText("Access code"));
  await user.type(screen.getByLabelText("Access code"), "123456");
  await user.click(screen.getByRole("button", { name: "Open tickets" }));
  expect(await screen.findByText("Loading your tickets...")).toBeInTheDocument();

  await act(async () => {
    pendingTickets.resolve({ tickets: [ticket("ticket-1", 101, "Checkout fails")] });
    await pendingTickets.promise;
  });
  await user.click(await screen.findByRole("link", { name: "Checkout fails" }));
  expect(screen.getByRole("heading", { name: "Checkout fails" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  expect(screen.getByLabelText("Report email")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Checkout fails" })).not.toBeInTheDocument();
  expect(screen.getByText("You have signed out on this device.")).toBeInTheDocument();
});


test("three tickets start in a compact table with one detail at a time and no unrelated controls", async () => {
  const user = await openReporterTickets([
    ticket("ticket-1", 101, "Checkout fails"),
    ticket("ticket-2", 102, "Receipt missing"),
    ticket("ticket-3", 103, "Address not saved"),
  ], false);
  expect(screen.getAllByRole("row")).toHaveLength(4);
  expect(screen.getByLabelText("Signed in as reporter@example.test")).toBeVisible();
  expect(screen.queryByLabelText("Reply to the team")).not.toBeInTheDocument();
  expect(screen.queryByText("Checkout fails details")).not.toBeInTheDocument();
  for (const label of ["Privacy requests", "Request deletion", "Request data export", "Stop updates"]) {
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  }
  expect(reporterSelfServiceApi.getPrivacyStatus).not.toHaveBeenCalled();
  await user.click(screen.getByRole("link", { name: "Receipt missing" }));
  expect(screen.getByRole("heading", { name: "Receipt missing" })).toBeVisible();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(window.location.search).toContain("ticket=ticket-2");
  expect(screen.getByRole("heading", { name: "Receipt missing" })).toHaveFocus();
  const summary = document.querySelector<HTMLElement>("#reporter-ticket-summary")!;
  expect(within(summary).getByText("Ticket")).toBeVisible();
  expect(within(summary).getByText("#102")).toBeVisible();
  expect(within(summary).getByText("Product")).toBeVisible();
  expect(within(summary).getByText("Checkout")).toBeVisible();
  expect(within(summary).getByText("Status")).toBeVisible();
  expect(within(summary).getByText("New")).toBeVisible();
  await user.click(screen.getByText("Your original report"));
  expect(screen.getByText("Receipt missing details")).toBeVisible();
  await user.type(screen.getByLabelText("Reply to the team"), "Unsent reply");
  await user.click(screen.getByRole("link", { name: "Close view" }));
  expect(screen.getByRole("link", { name: "Receipt missing" })).toHaveFocus();
  act(() => {
    window.history.replaceState({}, "", "/reporter?ticket=ticket-2");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(screen.getByRole("heading", { name: "Receipt missing" })).toBeVisible();
  expect(screen.getByLabelText("Reply to the team")).toHaveValue("Unsent reply");
  expect(document.querySelector("#reporter-summary-status")).toHaveTextContent("New");
});

test("conversation shows known senders and only recent messages until expanded", async () => {
  const comments = Array.from({ length: 6 }, (_, index) => ({ id: `c-${index}`, body: `Message ${index}`, createdAt: "2026-09-14T10:00:00Z", author: index % 2 ? "reporter" as const : "team" as const }));
  const user = await openReporterTickets([ticket("ticket-1", 101, "Checkout fails", comments)]);
  expect(screen.queryByText("Message 0")).not.toBeInTheDocument();
  expect(screen.getAllByText("You")).toHaveLength(2);
  expect(screen.getAllByText("Checkout team")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Show 2 earlier updates" }));
  expect(screen.getByText("Message 0")).toBeVisible();
});

test("a copied ticket link fetches the scoped detail without adding it to the list", async () => {
  window.history.replaceState({}, "", "/reporter?ticket=ticket-deep");
  const fetchDetail = vi.spyOn(api, "getReporterTicket").mockResolvedValue({ ticket: ticket("ticket-deep", 120, "Older issue") });
  const user = await openReporterTickets([ticket("ticket-1", 101, "Checkout fails")], false);
  // A deep link skips the list after verification.
  expect(await screen.findByRole("heading", { name: "Older issue" })).toBeVisible();
  expect(fetchDetail).toHaveBeenCalledWith("reporter-token", "ticket-deep");
  await user.click(screen.getByRole("link", { name: "My tickets" }));
  expect(screen.getByRole("link", { name: "Checkout fails" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "Older issue" })).not.toBeInTheDocument();
});
