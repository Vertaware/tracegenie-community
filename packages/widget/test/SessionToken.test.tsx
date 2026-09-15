import { afterEach, expect, test, vi } from "vitest";

import { requestWidgetSessionToken } from "../src/lib/sessionToken";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("returns a validated widget session token", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "session-token" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(requestWidgetSessionToken("https://customer.example/session")).resolves.toBe("session-token");
  expect(fetchMock).toHaveBeenCalledWith("https://customer.example/session", {
    method: "POST",
    credentials: "include",
  });
});

test("rejects failed, malformed, and tokenless session responses", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  fetchMock.mockResolvedValueOnce(new Response("denied", { status: 403 }));
  await expect(requestWidgetSessionToken("https://customer.example/session")).rejects.toThrow("HTTP 403");

  fetchMock.mockResolvedValueOnce(new Response("not-json", { status: 200 }));
  await expect(requestWidgetSessionToken("https://customer.example/session")).rejects.toThrow("not valid JSON");

  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ token: "   " }), { status: 200 }));
  await expect(requestWidgetSessionToken("https://customer.example/session")).rejects.toThrow("did not include a token");
});
