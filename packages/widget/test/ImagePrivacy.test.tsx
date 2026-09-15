import { afterEach, expect, test, vi } from "vitest";

import { collectProtectedMaskRegions, normalizeRect, rectFromPoints, transformImagePixels } from "../src/lib/imagePrivacy";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

test("normalizes reverse drag coordinates and clamps regions to the image", () => {
  const dragged = rectFromPoints(0.8, 0.7, 0.2, 0.1);
  expect(dragged).toMatchObject({ x: 0.2, y: 0.1 });
  expect(dragged.width).toBeCloseTo(0.6);
  expect(dragged.height).toBeCloseTo(0.6);
  const clamped = normalizeRect({ x: -0.2, y: 0.9, width: 2, height: 0.5 });
  expect(clamped).toMatchObject({ x: 0, y: 0.9, width: 1 });
  expect(clamped.height).toBeCloseTo(0.1);
});

test("finds explicit private regions and protected credential fields", () => {
  document.body.innerHTML = `
    <main id="capture">
      <div id="private" data-tracegenie-mask>Card 4111 1111 1111 1111</div>
      <input id="username" autocomplete="username" value="private-user" />
      <input id="password" type="password" value="secret" />
      <div id="public">Public content</div>
    </main>
  `;
  const capture = document.querySelector<HTMLElement>("#capture")!;
  const privateRegion = document.querySelector<HTMLElement>("#private")!;
  const username = document.querySelector<HTMLElement>("#username")!;
  const password = document.querySelector<HTMLElement>("#password")!;
  vi.spyOn(capture, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width: 200, height: 100, right: 210, bottom: 120, x: 10, y: 20, toJSON() {} });
  vi.spyOn(privateRegion, "getBoundingClientRect").mockReturnValue({ left: 30, top: 30, width: 80, height: 20, right: 110, bottom: 50, x: 30, y: 30, toJSON() {} });
  vi.spyOn(username, "getBoundingClientRect").mockReturnValue({ left: 30, top: 60, width: 60, height: 10, right: 90, bottom: 70, x: 30, y: 60, toJSON() {} });
  vi.spyOn(password, "getBoundingClientRect").mockReturnValue({ left: 110, top: 70, width: 60, height: 20, right: 170, bottom: 90, x: 110, y: 70, toJSON() {} });
  vi.spyOn(privateRegion, "getClientRects").mockReturnValue({ 0: privateRegion.getBoundingClientRect(), length: 1, item: () => privateRegion.getBoundingClientRect(), [Symbol.iterator]: function* () { yield this[0]; } });
  vi.spyOn(username, "getClientRects").mockReturnValue({ 0: username.getBoundingClientRect(), length: 1, item: () => username.getBoundingClientRect(), [Symbol.iterator]: function* () { yield this[0]; } });
  vi.spyOn(password, "getClientRects").mockReturnValue({ 0: password.getBoundingClientRect(), length: 1, item: () => password.getBoundingClientRect(), [Symbol.iterator]: function* () { yield this[0]; } });

  expect(collectProtectedMaskRegions(capture)).toEqual([
    { x: 0.1, y: 0.1, width: 0.4, height: 0.2 },
    { x: 0.1, y: 0.4, width: 0.3, height: 0.1 },
    { x: 0.5, y: 0.5, width: 0.3, height: 0.2 },
  ]);
});

test("masks a protected capture target rather than only its descendants", () => {
  document.body.innerHTML = '<section id="capture" data-tracegenie-private>Private account panel</section>';
  const capture = document.querySelector<HTMLElement>("#capture")!;
  vi.spyOn(capture, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} });
  vi.spyOn(capture, "getClientRects").mockReturnValue({ 0: capture.getBoundingClientRect(), length: 1, item: () => capture.getBoundingClientRect(), [Symbol.iterator]: function* () { yield this[0]; } });

  expect(collectProtectedMaskRegions(capture)).toEqual([{ x: 0, y: 0, width: 1, height: 1 }]);
});

test("encodes only cropped pixels with protected and reporter redactions burned in", async () => {
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  const close = vi.fn();
  const context = { drawImage, fillRect, set fillStyle(_value: string) {} };
  const canvas = document.createElement("canvas");
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => (
    tagName === "canvas" ? canvas : document.createElement(tagName)
  )) as typeof document.createElement);
  vi.spyOn(canvas, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(canvas, "toBlob").mockImplementation((callback) => callback(new Blob(["transformed-only"], { type: "image/png" })));
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 100, height: 80, close }));

  const result = await transformImagePixels(
    new File(["ORIGINAL-SECRET-BYTES"], "source.jpg", { type: "image/jpeg" }),
    {
      crop: { x: 0.1, y: 0.25, width: 0.8, height: 0.5 },
      protectedRegions: [{ x: 0.2, y: 0.3, width: 0.2, height: 0.1 }],
      redactions: [{ x: 0.6, y: 0.4, width: 0.2, height: 0.2 }],
    },
  );

  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 10, 20, 80, 40, 0, 0, 80, 40);
  expect(fillRect).toHaveBeenCalledTimes(2);
  expect(await result.text()).toBe("transformed-only");
  expect(await result.text()).not.toContain("ORIGINAL-SECRET-BYTES");
  expect(result.name).toBe("source-protected.png");
  expect(close).toHaveBeenCalledOnce();
});

test("expands fractional redactions to both outer pixel boundaries", async () => {
  const fillRect = vi.fn();
  const canvas = document.createElement("canvas");
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => (
    tagName === "canvas" ? canvas : document.createElement(tagName)
  )) as typeof document.createElement);
  vi.spyOn(canvas, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    fillRect,
    set fillStyle(_value: string) {},
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(canvas, "toBlob").mockImplementation((callback) => callback(new Blob(["protected"], { type: "image/png" })));
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 10, height: 10, close: vi.fn() }));

  await transformImagePixels(
    new File(["source"], "source.png", { type: "image/png" }),
    { redactions: [{ x: 0.09, y: 0.09, width: 0.12, height: 0.12 }] },
  );

  expect(fillRect).toHaveBeenCalledWith(0, 0, 3, 3);
});

test("closes decoded bitmaps when canvas drawing or encoding fails", async () => {
  const close = vi.fn();
  const canvas = document.createElement("canvas");
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => (
    tagName === "canvas" ? canvas : document.createElement(tagName)
  )) as typeof document.createElement);
  vi.spyOn(canvas, "getContext").mockReturnValue({
    drawImage: vi.fn(() => { throw new DOMException("Tainted", "SecurityError"); }),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 10, height: 10, close }));

  await expect(transformImagePixels(
    new File(["source"], "source.png", { type: "image/png" }),
    {},
  )).rejects.toMatchObject({ name: "SecurityError" });
  expect(close).toHaveBeenCalledOnce();

  vi.spyOn(canvas, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    set fillStyle(_value: string) {},
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(canvas, "toBlob").mockImplementation((callback) => callback(null));
  await expect(transformImagePixels(
    new File(["source"], "source.png", { type: "image/png" }),
    {},
  )).rejects.toThrow("could not encode");
  expect(close).toHaveBeenCalledTimes(2);
});

test("revokes fallback decode URLs on success and failure", async () => {
  vi.stubGlobal("createImageBitmap", undefined);
  const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
  const decode = vi.fn().mockRejectedValueOnce(new Error("Invalid image"));
  Object.defineProperty(Image.prototype, "decode", { configurable: true, value: decode });

  await expect(transformImagePixels(
    new File(["invalid"], "invalid.png", { type: "image/png" }),
    {},
  )).rejects.toThrow("Invalid image");
  expect(decode).toHaveBeenCalledOnce();
  expect(revokeObjectURL).toHaveBeenCalledOnce();
});
