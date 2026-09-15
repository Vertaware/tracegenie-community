import { afterEach, expect, test, vi } from "vitest";

import { ADMIN_SESSION_EXPIRED_EVENT, ApiError, api } from "../src/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  api.invalidateAdminSession();
  api.setActiveOrganizationId(null);
});

function unauthorizedResponse() {
  return new Response(JSON.stringify({
    error: { code: "auth.invalid_session", message: "Session expired." },
  }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

test("admin API and blob 401s emit session expiry while auth and reporter 401s stay local", async () => {
  const fetchMock = vi.fn().mockImplementation(async () => unauthorizedResponse());
  vi.stubGlobal("fetch", fetchMock);
  const expired = vi.fn();
  window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, expired);

  await expect(api.getOrganizations()).rejects.toEqual(expect.objectContaining<ApiError>({ status: 401 }));
  expect(expired).toHaveBeenCalledTimes(1);

  await expect(api.downloadOrganizationAuditExport("organization-1")).rejects.toEqual(
    expect.objectContaining<ApiError>({ status: 401 }),
  );
  expect(expired).toHaveBeenCalledTimes(2);

  await expect(api.login("admin@example.test", "wrong-password")).rejects.toEqual(
    expect.objectContaining<ApiError>({ status: 401 }),
  );
  await expect(api.getReporterTickets("expired-reporter-token")).rejects.toEqual(
    expect.objectContaining<ApiError>({ status: 401 }),
  );
  await expect(api.downloadReporterDsarExport("expired-reporter-token")).rejects.toEqual(
    expect.objectContaining<ApiError>({ status: 401 }),
  );
  expect(expired).toHaveBeenCalledTimes(2);

  window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, expired);
});

test("a late 401 from an older session generation cannot expire a fresh session", async () => {
  let resolveRequest!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
    resolveRequest = resolve;
  })));
  const expired = vi.fn();
  window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, expired);

  const staleRequest = api.getOrganizations();
  api.markAdminSessionAuthenticated();
  resolveRequest(unauthorizedResponse());

  await expect(staleRequest).rejects.toEqual(expect.objectContaining<ApiError>({ status: 401 }));
  expect(expired).not.toHaveBeenCalled();

  window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, expired);
});
