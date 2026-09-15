import { clsx,type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...values: ClassValue[]) {
  return twMerge(clsx(values));
}

export function dataUrlToFile(dataUrl: string, fileName: string) {
  const [header, content] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mimeType = mimeMatch?.[1] ?? "image/png";
  const bytes = atob(content);
  const array = new Uint8Array(bytes.length);

  for (let index = 0; index < bytes.length; index += 1) {
    array[index] = bytes.charCodeAt(index);
  }

  return new File([array], fileName, { type: mimeType });
}

const SENSITIVE_KEY_PATTERN =
  "access[_-]?token|api[_-]?key|auth[_-]?token|authorization|client[_-]?secret|passwd|password|pwd|refresh[_-]?token|secret|session[_-]?id|token";
const SENSITIVE_VALUE_PATTERN = "\"[^\"]{1,400}\"|'[^']{1,400}'|Bearer\\s+[A-Za-z0-9._~+/=-]{3,400}|[^\\s,;&)}\\]]{3,400}";
const SENSITIVE_KEY_VALUE_RE = new RegExp(
  `(["']?)\\b(${SENSITIVE_KEY_PATTERN})\\b\\1\\s*([:=])\\s*(${SENSITIVE_VALUE_PATTERN})`,
  "gi",
);
const SENSITIVE_QUERY_RE = new RegExp(
  `([?&](${SENSITIVE_KEY_PATTERN})=)[^&#\\s]+`,
  "gi",
);

export function redactCapturedText(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(SENSITIVE_KEY_VALUE_RE, (_match, quote: string, key: string, separator: string) => {
      const redactedValue = quote ? `${quote}[redacted]${quote}` : "[redacted]";
      return `${quote}${key}${quote}${separator}${separator === ":" ? " " : ""}${redactedValue}`;
    })
    .replace(SENSITIVE_QUERY_RE, "$1[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{3,400}/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted-token]")
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, "[redacted-token]")
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, "[redacted-token]");
}

export function formatShortcut(shortcut: string) {
  return shortcut
    .replaceAll("mod", navigator.platform.toLowerCase().includes("mac") ? "Cmd" : "Ctrl")
    .replaceAll("shift", "Shift")
    .replaceAll("alt", "Alt")
    .replaceAll("+", " + ")
    .toUpperCase();
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string) {
  const normalized = shortcut.toLowerCase();
  const parts = normalized.split("+");
  const requiredKey = parts.at(-1);
  const wantsMeta = parts.includes("mod");
  const wantsShift = parts.includes("shift");
  const wantsAlt = parts.includes("alt");

  return (
    (wantsMeta ? event.metaKey || event.ctrlKey : true) &&
    (wantsShift ? event.shiftKey : true) &&
    (wantsAlt ? event.altKey : true) &&
    event.key.toLowerCase() === requiredKey
  );
}

export function parseBrowserInfo() {
  const userAgent = navigator.userAgent;
  const platform = navigator.platform;
  const language = navigator.language;

  const browserName =
    /edg/i.test(userAgent)
      ? "Edge"
      : /chrome/i.test(userAgent)
        ? "Chrome"
        : /safari/i.test(userAgent) && !/chrome/i.test(userAgent)
          ? "Safari"
          : /firefox/i.test(userAgent)
            ? "Firefox"
            : "Unknown";

  const browserVersion = userAgent.match(/(edg|chrome|firefox|version)\/([\d.]+)/i)?.[2];
  const osName =
    /mac/i.test(platform)
      ? "macOS"
      : /win/i.test(platform)
        ? "Windows"
        : /linux/i.test(platform)
          ? "Linux"
          : /iphone|ipad/i.test(userAgent)
            ? "iOS"
            : /android/i.test(userAgent)
              ? "Android"
              : "Unknown";

  return {
    userAgent,
    language,
    platform,
    browserName,
    browserVersion,
    osName,
    osVersion: undefined,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}
