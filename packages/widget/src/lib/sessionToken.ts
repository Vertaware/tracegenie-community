type WidgetSessionTokenPayload = {
  token?: unknown;
};

export async function requestWidgetSessionToken(endpoint: string): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`TraceGenie widget session request failed with HTTP ${response.status}.`);
  }

  let payload: WidgetSessionTokenPayload;
  try {
    payload = await response.json() as WidgetSessionTokenPayload;
  } catch {
    throw new Error("TraceGenie widget session response was not valid JSON.");
  }

  if (typeof payload.token !== "string" || payload.token.trim().length === 0) {
    throw new Error("TraceGenie widget session response did not include a token.");
  }

  return payload.token;
}
