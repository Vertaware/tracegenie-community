import { useEffect,useRef } from "react";
import type { FeedbackNetworkEntries } from "@tracegenie/shared";

import { redactCapturedText } from "../lib/utils";

function redactedUrl(input: RequestInfo | URL) {
  const raw = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  const url = new URL(raw, window.location.href);
  url.search = "";
  url.hash = "";
  return url.href;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  const method = init?.method ?? (input instanceof Request ? input.method : undefined) ?? "GET";
  return method.toUpperCase().slice(0, 12);
}

function responseRequestId(response: Response) {
  return response.headers.get("x-request-id") ??
    response.headers.get("x-correlation-id") ??
    response.headers.get("x-trace-id") ??
    undefined;
}

export function useNetworkSummaryCapture(enabled: boolean, maxEntries: number, ignoredBaseUrl?: string) {
  const entriesRef = useRef<FeedbackNetworkEntries>([]);

  useEffect(() => {
    if (!enabled || maxEntries <= 0) {
      return;
    }

    const originalFetch = window.fetch;
    const ignoredBase = ignoredBaseUrl ? new URL(ignoredBaseUrl, window.location.href).href : null;

    const pushEntry = (entry: FeedbackNetworkEntries[number]) => {
      entriesRef.current = [
        ...entriesRef.current.slice(Math.max(entriesRef.current.length - maxEntries + 1, 0)),
        entry,
      ];
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const started = performance.now();
      const timestamp = new Date().toISOString();
      const url = redactedUrl(input);
      const method = requestMethod(input, init);
      const shouldIgnore = Boolean(ignoredBase && url.startsWith(ignoredBase));

      try {
        const response = await originalFetch.call(window, input, init);
        if (!shouldIgnore) {
          pushEntry({
            method,
            url,
            statusCode: response.status,
            durationMs: Math.round(performance.now() - started),
            timestamp,
            requestId: responseRequestId(response),
          });
        }
        return response;
      } catch (error) {
        if (!shouldIgnore) {
          pushEntry({
            method,
            url,
            durationMs: Math.round(performance.now() - started),
            timestamp,
            error: error instanceof Error ? redactCapturedText(error.message).slice(0, 500) : "Network request failed.",
          });
        }
        throw error;
      }
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [enabled, ignoredBaseUrl, maxEntries]);

  return entriesRef;
}
