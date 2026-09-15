/** Browsers omit Origin on same-origin GETs to the self-hosted public config. */
export function publicConfigOrigin(input: {
  origin?: string;
  host?: string;
  fetchSite?: string;
  serveWeb: boolean;
  publicUrl: string;
}): string | undefined {
  // Explicit origins always pass through to the existing project allowlist.
  if (input.origin !== undefined) return input.origin;
  if (!input.serveWeb || input.fetchSite !== "same-origin") return undefined;
  const publicUrl = new URL(input.publicUrl);
  return input.host === publicUrl.host ? publicUrl.origin : undefined;
}
