import { z } from "zod";

export const pointSelectionRectSchema = z.object({
  left: z.number().finite().min(0).max(100),
  top: z.number().finite().min(0).max(100),
  width: z.number().finite().min(0).max(100),
  height: z.number().finite().min(0).max(100),
});

export const pointSelectionSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["element", "point"]),
  xPct: z.number().finite().min(0).max(100),
  yPct: z.number().finite().min(0).max(100),
  rectPct: pointSelectionRectSchema.optional(),
  tagName: z.string().trim().min(1).max(40).optional(),
  role: z.string().trim().min(1).max(120).optional(),
  label: z.string().trim().min(1).max(120).optional(),
});

export type PointSelection = z.infer<typeof pointSelectionSchema>;

export type PointLike = {
  x: number;
  y: number;
};

export type RectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CaptureBounds = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toPct(value: number, total: number) {
  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.round(clamp((value / total) * 100, 0, 100) * 10_000) / 10_000;
}

function cleanText(value: string | undefined, maxLength: number) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, maxLength);
}

export function toDocumentSpacePoint(point: PointLike, scrollOffset: PointLike): PointLike {
  return {
    x: point.x + scrollOffset.x,
    y: point.y + scrollOffset.y,
  };
}

export function toDocumentSpaceRect(rect: RectLike, scrollOffset: PointLike): RectLike {
  return {
    left: rect.left + scrollOffset.x,
    top: rect.top + scrollOffset.y,
    width: rect.width,
    height: rect.height,
  };
}

export function toLocalSpacePoint(point: PointLike, containerRect: Pick<RectLike, "left" | "top">): PointLike {
  return {
    x: point.x - containerRect.left,
    y: point.y - containerRect.top,
  };
}

export function toLocalSpaceRect(rect: RectLike, containerRect: Pick<RectLike, "left" | "top">): RectLike {
  return {
    left: rect.left - containerRect.left,
    top: rect.top - containerRect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function shouldUsePointSelectionFallback(options: {
  targetRect: RectLike;
  viewportWidth: number;
  viewportHeight: number;
  forcePoint?: boolean;
}) {
  const { forcePoint = false, targetRect, viewportWidth, viewportHeight } = options;

  if (forcePoint) {
    return true;
  }

  if (
    !Number.isFinite(targetRect.width) ||
    !Number.isFinite(targetRect.height) ||
    targetRect.width <= 0 ||
    targetRect.height <= 0
  ) {
    return true;
  }

  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return true;
  }

  const viewportArea = viewportWidth * viewportHeight;
  const targetArea = targetRect.width * targetRect.height;
  return targetArea / viewportArea > 0.85;
}

export function buildPointSelection(options: {
  captureBounds: CaptureBounds;
  clickPoint: PointLike;
  targetRect: RectLike;
  viewportWidth: number;
  viewportHeight: number;
  forcePoint?: boolean;
  tagName?: string;
  role?: string;
  label?: string;
}): PointSelection {
  const {
    captureBounds,
    clickPoint,
    targetRect,
    viewportWidth,
    viewportHeight,
    forcePoint = false,
    tagName,
    role,
    label,
  } = options;

  const mode = shouldUsePointSelectionFallback({
    targetRect,
    viewportWidth,
    viewportHeight,
    forcePoint,
  })
    ? "point"
    : "element";

  return pointSelectionSchema.parse({
    version: 1,
    mode,
    xPct: toPct(clickPoint.x - captureBounds.originX, captureBounds.width),
    yPct: toPct(clickPoint.y - captureBounds.originY, captureBounds.height),
    rectPct:
      mode === "element"
        ? {
          left: toPct(targetRect.left - captureBounds.originX, captureBounds.width),
          top: toPct(targetRect.top - captureBounds.originY, captureBounds.height),
          width: toPct(targetRect.width, captureBounds.width),
          height: toPct(targetRect.height, captureBounds.height),
        }
        : undefined,
    tagName: cleanText(tagName?.toLowerCase(), 40),
    role: cleanText(role, 120),
    label: cleanText(label, 120),
  });
}

export function parsePointSelection(value: unknown): PointSelection | null {
  const result = pointSelectionSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function readPointSelectionFromExtraContext(extraContext: unknown): PointSelection | null {
  if (!extraContext || typeof extraContext !== "object" || Array.isArray(extraContext)) {
    return null;
  }

  const candidate = (extraContext as Record<string, unknown>).pointSelection;
  return parsePointSelection(candidate);
}
