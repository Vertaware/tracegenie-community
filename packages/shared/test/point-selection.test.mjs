import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPointSelection,
  readPointSelectionFromExtraContext,
  shouldUsePointSelectionFallback,
  toDocumentSpacePoint,
  toDocumentSpaceRect,
} from "../dist/utils/pointSelection.js";

test("document capture normalization includes scroll offsets", () => {
  const clickPoint = toDocumentSpacePoint({ x: 250, y: 200 }, { x: 150, y: 300 });
  const targetRect = toDocumentSpaceRect({ left: 200, top: 180, width: 200, height: 100 }, { x: 150, y: 300 });

  const selection = buildPointSelection({
    captureBounds: { originX: 0, originY: 0, width: 2000, height: 3000 },
    clickPoint,
    targetRect,
    viewportWidth: 1440,
    viewportHeight: 900,
    tagName: "button",
    role: "button",
    label: "Save changes",
  });

  assert.equal(selection.mode, "element");
  assert.equal(selection.xPct, 20);
  assert.equal(selection.yPct, 16.6667);
  assert.deepEqual(selection.rectPct, {
    left: 17.5,
    top: 16,
    width: 10,
    height: 3.3333,
  });
});

test("oversized targets fall back to point mode", () => {
  const targetRect = { left: 0, top: 0, width: 1280, height: 820 };

  assert.equal(
    shouldUsePointSelectionFallback({
      targetRect,
      viewportWidth: 1280,
      viewportHeight: 900,
    }),
    true,
  );

  const selection = buildPointSelection({
    captureBounds: { originX: 0, originY: 0, width: 1280, height: 2400 },
    clickPoint: { x: 640, y: 400 },
    targetRect,
    viewportWidth: 1280,
    viewportHeight: 900,
  });

  assert.equal(selection.mode, "point");
  assert.equal(selection.rectPct, undefined);
});

test("malformed point selection metadata is ignored", () => {
  const selection = readPointSelectionFromExtraContext({
    pointSelection: {
      version: 1,
      mode: "element",
      xPct: "30",
      yPct: 40,
    },
  });

  assert.equal(selection, null);
});
