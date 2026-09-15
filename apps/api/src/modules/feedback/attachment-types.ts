/** Documents are served as downloads; never trust the supplied MIME type. */
export function detectDocumentAttachment(buffer: Buffer, name: string) {
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { mimeType: "application/pdf", extension: ".pdf" };
  }
  const extension = /\.(txt|log)$/i.exec(name)?.[0].toLowerCase();
  if (!extension || buffer.length === 0) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return null;
    return { mimeType: "text/plain", extension };
  } catch {
    return null;
  }
}
