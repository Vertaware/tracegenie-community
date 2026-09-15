/** Default to the installation serving the script, including cross-origin embeds. */
export function resolveEmbedOrigin(scriptSource: string | undefined, pageOrigin: string): string {
  if (!scriptSource) return pageOrigin;
  const source = new URL(scriptSource, pageOrigin);
  return source.protocol === "http:" || source.protocol === "https:" ? source.origin : pageOrigin;
}
