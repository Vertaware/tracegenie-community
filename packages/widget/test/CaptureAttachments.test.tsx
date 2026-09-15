import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toPng } from "html-to-image";
import { FeedbackWidget, type FeedbackWidgetProps } from "../src/components/FeedbackWidget";

vi.mock("html-to-image", () => ({ toPng: vi.fn() }));
vi.mock("../src/lib/imagePrivacy", () => ({
  collectProtectedMaskRegions: () => [],
  transformImagePixels: async (file: File) => file,
}));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const props: FeedbackWidgetProps = {
  apiBaseUrl: "http://localhost:4000", projectKey: "capture-test", appName: "Capture test",
  appEnvironment: "test", appVersion: "test", fetchProjectConfig: false, currentUser: { id: "file-reporter" },
};
const reply = (data: unknown, status = 201) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
let uploads: FormData[];
let reports: Array<{ clientSubmissionId: string; attachmentTokens: string[]; extraContext: { consentSnapshot: { attachmentCount: number } } }>;
beforeEach(() => {
  uploads = []; reports = [];
  vi.mocked(toPng).mockResolvedValue(png);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:captured-image");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.stubGlobal("Image", class {
    width = 1; height = 1; onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).endsWith("/uploads")) {
      const body = init!.body as FormData; uploads.push(body);
      return reply({ uploadToken: `attachment-token-${uploads.length}`, attachment: { id: `a-${uploads.length}`, fileName: (body.get("file") as File).name } });
    }
    reports.push(JSON.parse(String(init?.body)));
    return reply({ feedback: { id: "f1", ticketNumber: 12 } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); window.localStorage.clear(); window.sessionStorage.clear(); });
async function open(config?: FeedbackWidgetProps["widgetConfig"]) {
  const user = userEvent.setup();
  const view = render(<FeedbackWidget {...props} widgetConfig={config} />);
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  return { user, ...view };
}
async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Title"), "Checkout issue");
  await user.type(screen.getByLabelText("What happened?"), "Checkout fails after applying a coupon.");
}
const textFile = (name: string, body = "Useful diagnostic details") => new File([body], name, { type: "text/plain" });

test("automatically includes the screenshot with multiple files only when Send report is clicked", async () => {
  const { user } = await open();
  expect(await screen.findByRole("button", { name: "Screenshot added" })).toBeVisible();
  expect(uploads).toHaveLength(0);
  await user.upload(screen.getByLabelText("Add files", { selector: "input" }), [textFile("trace.log"), new File(["%PDF-1.7"], "receipt.pdf", { type: "application/pdf" })]);
  expect(await screen.findByRole("button", { name: "Remove receipt.pdf" })).toBeVisible();
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Send report" }));
  expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible();
  expect(uploads).toHaveLength(3);
  expect(uploads.slice(1).map((body) => body.get("kind"))).toEqual(["file", "file"]);
  expect(reports[0].attachmentTokens).toHaveLength(3);
  expect(reports[0].extraContext.consentSnapshot.attachmentCount).toBe(3);
});

test("respects removal and counts the screenshot toward the five attachment limit", async () => {
  const { user } = await open();
  await screen.findByRole("button", { name: "Screenshot added" });
  await user.upload(screen.getByLabelText("Add files", { selector: "input" }), [1,2,3,4,5].map((i) => textFile(`file-${i}.txt`)));
  expect(await screen.findByText(/You can send up to 5 attachments/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Remove file-5.txt" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Remove file-2.txt" }));
  await user.click(screen.getByRole("button", { name: "Screenshot added" }));
  await user.click(screen.getByRole("button", { name: "Remove screenshot" }));
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await screen.findByRole("heading", { name: "Report sent" });
  expect(uploads.map((body) => (body.get("file") as File).name)).toEqual(["file-1.txt", "file-3.txt", "file-4.txt"]);
});

test("retains completed file uploads and the failed file's identity on retry", async () => {
  const { user } = await open({ autoCaptureScreenshot: false });
  const uploadIds: string[] = [];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).endsWith("/uploads")) {
      const body = init!.body as FormData; uploadIds.push(String(body.get("clientUploadId")));
      if (uploadIds.length === 2) throw new TypeError("Failed to fetch");
      return reply({ uploadToken: `attachment-token-${uploadIds.length}`, attachment: { id: "a" } });
    }
    reports.push(JSON.parse(String(init?.body))); return reply({ feedback: { id: "f1" } });
  });
  await user.upload(screen.getByLabelText("Add files", { selector: "input" }), [textFile("first.txt"), textFile("second.log")]);
  await screen.findByRole("button", { name: "Remove second.log" });
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await user.click(await screen.findByRole("button", { name: "Retry" }));
  await screen.findByRole("heading", { name: "Report sent" });
  expect(uploadIds).toHaveLength(3);
  expect(uploadIds[1]).toBe(uploadIds[2]);
  expect(uploadIds[0]).not.toBe(uploadIds[1]);
  expect(reports[0].attachmentTokens).toEqual(["attachment-token-1", "attachment-token-3"]);
});

test("restores file metadata and requires reattachment or removal after reload", async () => {
  const first = await open({ autoCaptureScreenshot: false });
  const files = [textFile("first.txt"), textFile("second.log")];
  await first.user.upload(screen.getByLabelText("Add files", { selector: "input" }), files);
  await screen.findByRole("button", { name: "Remove second.log" });
  await fill(first.user);
  await waitFor(() => expect(Object.values(window.localStorage).join("")).toContain("second.log"));
  expect(Object.values(window.localStorage).join("")).not.toContain("Useful diagnostic details");
  first.unmount();
  const { user } = await open({ autoCaptureScreenshot: false });
  await waitFor(() => expect(screen.getByRole("button", { name: "Reattach first.txt" })).toBeVisible());
  await user.click(screen.getByRole("button", { name: "Send report" }));
  expect(await screen.findByText("Reattach or remove the previous files before sending this report.")).toBeVisible();
  expect(uploads).toHaveLength(0);
  await user.upload(screen.getByLabelText("Add files", { selector: "input" }), [files[0]]);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Reattach first.txt" })).not.toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "Remove second.log" }));
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await screen.findByRole("heading", { name: "Report sent" });
  expect(uploads).toHaveLength(1);
});

test("disabled capture settings keep screenshot capture manual and remove the file picker", async () => {
  await open({ autoCaptureScreenshot: false, allowFileAttachments: false });
  await waitFor(() => expect(screen.getByRole("button", { name: "Add screenshot" })).toBeVisible());
  expect(screen.queryByRole("button", { name: "Add files" })).not.toBeInTheDocument();
  expect(toPng).not.toHaveBeenCalled();
});

test("blocks sending during automatic capture and recovers from capture failure", async () => {
  let rejectCapture!: (error: Error) => void;
  vi.mocked(toPng).mockImplementation(() => new Promise((_resolve, reject) => { rejectCapture = reject; }));
  const { user } = await open();
  await fill(user);
  for (const button of screen.getAllByRole("button", { name: /Capturing/i })) expect(button).toBeDisabled();
  expect(reports).toHaveLength(0);
  await act(async () => rejectCapture(new Error("Unavailable")));
  expect(await screen.findByRole("button", { name: "Retry screenshot" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await screen.findByRole("heading", { name: "Report sent" });
  expect(reports[0].attachmentTokens).toEqual([]);
});

test("an untouched automatic screenshot does not create a draft or a discard prompt on close", async () => {
  const { user } = await open();
  await screen.findByRole("button", { name: "Screenshot added" });
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(await screen.findByRole("button", { name: "Screenshot added" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Remove previous attachment" })).not.toBeInTheDocument();
});

test("uploads fresh files when a report is edited after an uncertain submission", async () => {
  const { user } = await open({ autoCaptureScreenshot: false });
  const ids: string[] = [];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).endsWith("/uploads")) {
      ids.push(String((init!.body as FormData).get("clientUploadId")));
      return reply({ uploadToken: `attachment-token-${ids.length}`, attachment: { id: "a" } });
    }
    reports.push(JSON.parse(String(init?.body)));
    if (reports.length === 1) throw new TypeError("Lost response");
    return reply({ feedback: { id: "f1" } });
  });
  await user.upload(screen.getByLabelText("Add files", { selector: "input" }), textFile("trace.log"));
  await screen.findByRole("button", { name: "Remove trace.log" });
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await screen.findByRole("button", { name: "Retry" });
  await user.type(screen.getByLabelText("Title"), " changed");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("heading", { name: "Report sent" });
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
  expect(reports[0].clientSubmissionId).not.toBe(reports[1].clientSubmissionId);
});

test("rejects oversized and unsupported files before attempting any upload", async () => {
  const { user } = await open({ autoCaptureScreenshot: false });
  const input = screen.getByLabelText("Add files", { selector: "input" });
  const fileUser = userEvent.setup({ applyAccept: false });
  await fileUser.upload(input, [new File(["exe"], "program.exe"), textFile("large.txt", "x".repeat(5_242_881))]);
  expect(await screen.findByText(/choose an image, PDF, text, or log file/)).toBeVisible();
  expect(screen.getByText(/choose a non-empty file up to 5 MB/)).toBeVisible();
  expect(screen.queryByRole("list", { name: "Attached files" })).not.toBeInTheDocument();
  expect(uploads).toHaveLength(0);
});

test.each([true, false])("waits for loaded product settings before automatic capture (enabled=%s)", async (enabled) => {
  let resolveConfig!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation(async (input) => String(input).includes("/widget-config")
    ? new Promise((resolve) => { resolveConfig = resolve; })
    : reply({ campaign: null }));
  const user = userEvent.setup();
  render(<FeedbackWidget {...props} fetchProjectConfig />);
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  expect(toPng).not.toHaveBeenCalled();
  await act(async () => resolveConfig(reply({ key: props.projectKey, name: props.appName, widgetConfig: { autoCaptureScreenshot: enabled } })));
  if (enabled) await screen.findByRole("button", { name: "Screenshot added" });
  else expect(screen.getByRole("button", { name: "Add screenshot" })).toBeEnabled();
  expect(toPng).toHaveBeenCalledTimes(enabled ? 1 : 0);
});

test("closing during capture ignores the late screenshot and starts fresh on reopening", async () => {
  let resolveCapture!: (value: string) => void;
  vi.mocked(toPng).mockImplementationOnce(() => new Promise((resolve) => { resolveCapture = resolve; }));
  const { user } = await open();
  await waitFor(() => expect(toPng).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("button", { name: "Close" }));
  await act(async () => resolveCapture(png));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Report a Bug" }));
  await screen.findByRole("button", { name: "Screenshot added" });
  expect(toPng).toHaveBeenCalledTimes(2);
});
