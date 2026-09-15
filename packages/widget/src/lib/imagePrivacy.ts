export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImagePrivacyTransform = {
  crop?: NormalizedRect;
  redactions?: NormalizedRect[];
  protectedRegions?: NormalizedRect[];
};

const PROTECTED_SELECTOR = [
  "[data-tracegenie-mask]",
  "[data-tracegenie-private]",
  "[data-private]",
  "[data-sensitive]",
  'input[type="password"]',
  '[autocomplete="current-password"]',
  '[autocomplete="new-password"]',
  '[autocomplete="one-time-code"]',
  '[autocomplete="username"]',
].join(",");

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeRect(rect: NormalizedRect): NormalizedRect {
  const x = clamp(rect.x);
  const y = clamp(rect.y);
  return {
    x,
    y,
    width: clamp(rect.width, 0, 1 - x),
    height: clamp(rect.height, 0, 1 - y),
  };
}

export function rectFromPoints(startX: number, startY: number, endX: number, endY: number): NormalizedRect {
  return normalizeRect({
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  });
}

export function collectProtectedMaskRegions(target: HTMLElement): NormalizedRect[] {
  const targetRect = target.getBoundingClientRect();
  const isDocumentCapture = target === document.body || target === document.documentElement;
  const width = Math.max(1, isDocumentCapture ? target.scrollWidth : targetRect.width);
  const height = Math.max(1, isDocumentCapture ? target.scrollHeight : targetRect.height);
  const originX = isDocumentCapture ? -window.scrollX : targetRect.left;
  const originY = isDocumentCapture ? -window.scrollY : targetRect.top;

  const protectedElements = [
    ...(target.matches(PROTECTED_SELECTOR) ? [target] : []),
    ...target.querySelectorAll<HTMLElement>(PROTECTED_SELECTOR),
  ];

  return protectedElements
    .filter((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    })
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return normalizeRect({
        x: (rect.left - originX) / width,
        y: (rect.top - originY) / height,
        width: rect.width / width,
        height: rect.height / height,
      });
    })
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

async function decodeImage(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not encode the protected screenshot."));
    }, "image/png");
  });
}

export async function transformImagePixels(file: File, transform: ImagePrivacyTransform): Promise<File> {
  const image = await decodeImage(file);
  try {
    const crop = normalizeRect(transform.crop ?? { x: 0, y: 0, width: 1, height: 1 });
    if (crop.width <= 0.01 || crop.height <= 0.01) {
      throw new Error("Crop area is too small.");
    }

    const sourceX = Math.round(crop.x * image.width);
    const sourceY = Math.round(crop.y * image.height);
    const sourceWidth = Math.max(1, Math.round(crop.width * image.width));
    const sourceHeight = Math.max(1, Math.round(crop.height * image.height));
    const canvas = document.createElement("canvas");
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas image editing is unavailable.");

    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
    context.fillStyle = "#111111";

    for (const rawRegion of [...(transform.protectedRegions ?? []), ...(transform.redactions ?? [])]) {
      const region = normalizeRect(rawRegion);
      const intersectionLeft = Math.max(region.x, crop.x);
      const intersectionTop = Math.max(region.y, crop.y);
      const intersectionRight = Math.min(region.x + region.width, crop.x + crop.width);
      const intersectionBottom = Math.min(region.y + region.height, crop.y + crop.height);
      if (intersectionRight <= intersectionLeft || intersectionBottom <= intersectionTop) continue;
      const left = Math.floor(((intersectionLeft - crop.x) / crop.width) * sourceWidth);
      const top = Math.floor(((intersectionTop - crop.y) / crop.height) * sourceHeight);
      const right = Math.ceil(((intersectionRight - crop.x) / crop.width) * sourceWidth);
      const bottom = Math.ceil(((intersectionBottom - crop.y) / crop.height) * sourceHeight);
      context.fillRect(left, top, right - left, bottom - top);
    }

    const blob = await canvasToBlob(canvas);
    const baseName = file.name.replace(/\.[^.]+$/, "") || "evidence";
    return new File([blob], `${baseName}-protected.png`, { type: "image/png", lastModified: Date.now() });
  } finally {
    if ("close" in image && typeof image.close === "function") image.close();
  }
}
