import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ScreenshotPrivacyEditor } from "../src/components/ScreenshotPrivacyEditor";
import { transformImagePixels } from "../src/lib/imagePrivacy";

vi.mock("../src/lib/imagePrivacy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/imagePrivacy")>();
  return { ...actual, transformImagePixels: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("supports a complete keyboard crop and redaction flow", async () => {
  const user = userEvent.setup();
  const source = new File(["source"], "checkout.png", { type: "image/png" });
  const protectedFile = new File(["protected"], "checkout-protected.png", { type: "image/png" });
  vi.mocked(transformImagePixels).mockResolvedValue(protectedFile);
  const onApply = vi.fn().mockResolvedValue(undefined);
  render(
    <ScreenshotPrivacyEditor
      file={source}
      previewUrl="blob:checkout"
      onApply={onApply}
      onCancel={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Crop" }));
  expect(screen.getByRole("slider", { name: "Crop left", hidden: true })).not.toBeVisible();
  await user.click(screen.getByText("Precise controls"));
  const cropLeft = screen.getByRole("slider", { name: "Crop left" });
  cropLeft.focus();
  fireEvent.change(cropLeft, { target: { value: "3" } });
  expect(cropLeft).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Redact" }));
  await user.click(screen.getByRole("button", { name: "Add redaction" }));
  await user.click(screen.getByText("Precise controls"));
  const redactionWidth = screen.getByRole("slider", { name: "Redaction width" });
  redactionWidth.focus();
  fireEvent.change(redactionWidth, { target: { value: "41" } });
  expect(redactionWidth).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Apply protection" }));

  expect(transformImagePixels).toHaveBeenCalledWith(source, {
    crop: expect.objectContaining({ x: 0.03 }),
    redactions: [expect.objectContaining({ x: 0.3, y: 0.35 })],
  });
  expect(onApply).toHaveBeenCalledWith(protectedFile);
});

test("moves and resizes an existing redaction directly on the image", async () => {
  const protectedFile = new File(["protected"], "checkout-protected.png", { type: "image/png" });
  vi.mocked(transformImagePixels).mockResolvedValue(protectedFile);
  const onApply = vi.fn().mockResolvedValue(undefined);
  render(
    <ScreenshotPrivacyEditor
      file={new File(["source"], "checkout.png", { type: "image/png" })}
      previewUrl="blob:checkout"
      onApply={onApply}
      onCancel={vi.fn()}
    />,
  );

  const stage = screen.getByAltText("Screenshot being protected").parentElement!;
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} });
  stage.setPointerCapture = vi.fn();
  fireEvent.pointerDown(stage, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 100, clientY: 60 });
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 100, clientY: 60 });

  const region = screen.getByRole("button", { name: "Redaction 1" });
  fireEvent.pointerDown(region, { button: 0, pointerId: 2, clientX: 60, clientY: 40 });
  fireEvent.pointerMove(stage, { pointerId: 2, clientX: 80, clientY: 50 });
  fireEvent.pointerUp(stage, { pointerId: 2, clientX: 80, clientY: 50 });
  await userEvent.setup().click(screen.getByText("Precise controls"));
  expect(screen.getByRole("slider", { name: "Redaction left" })).toHaveValue("20");
  expect(screen.getByRole("slider", { name: "Redaction top" })).toHaveValue("30");

  const southeastHandle = screen.getByLabelText("Resize redaction 1 from bottom right");
  fireEvent.pointerDown(southeastHandle, { button: 0, pointerId: 3, clientX: 100, clientY: 60 });
  fireEvent.pointerMove(stage, { pointerId: 3, clientX: 140, clientY: 80 });
  fireEvent.pointerUp(stage, { pointerId: 3, clientX: 140, clientY: 80 });
  expect(screen.getByRole("slider", { name: "Redaction width" })).toHaveValue("50");
  expect(screen.getByRole("slider", { name: "Redaction height" })).toHaveValue("50");

  await userEvent.setup().click(screen.getByRole("button", { name: "Apply protection" }));
  const [, transform] = vi.mocked(transformImagePixels).mock.calls[0];
  expect(transform.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  expect(transform.redactions).toHaveLength(1);
  expect(transform.redactions[0].x).toBeCloseTo(0.2);
  expect(transform.redactions[0].y).toBeCloseTo(0.3);
  expect(transform.redactions[0].width).toBeCloseTo(0.5);
  expect(transform.redactions[0].height).toBeCloseTo(0.5);
  expect(onApply).toHaveBeenCalledWith(protectedFile);
});

test("clear all removes pending redactions without mutating the source", async () => {
  const user = userEvent.setup();
  render(
    <ScreenshotPrivacyEditor
      file={new File(["source"], "checkout.png", { type: "image/png" })}
      previewUrl="blob:checkout"
      onApply={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Add redaction" }));
  expect(screen.getByText("1 redaction")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Clear all" }));
  expect(screen.getByText("0 redactions")).toBeVisible();
});

test("supports pointer redaction and reports image protection failures", async () => {
  const user = userEvent.setup();
  vi.mocked(transformImagePixels).mockRejectedValue(new Error("Tainted canvas"));
  render(
    <ScreenshotPrivacyEditor
      file={new File(["source"], "checkout.png", { type: "image/png" })}
      previewUrl="blob:checkout"
      onApply={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  const stage = screen.getByAltText("Screenshot being protected").parentElement!;
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} });
  stage.setPointerCapture = vi.fn();
  fireEvent.pointerDown(stage, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 100, clientY: 60 });
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 100, clientY: 60 });
  expect(screen.getByText("1 redaction")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Apply protection" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Tainted canvas");
  expect(screen.getByRole("button", { name: "Apply protection" })).toBeEnabled();
});
