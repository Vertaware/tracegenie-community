import test from "node:test";
import assert from "node:assert/strict";
import { detectDocumentAttachment } from "./attachment-types";

test("recognizes PDF bytes and UTF-8 text or log files", () => {
  assert.deepEqual(detectDocumentAttachment(Buffer.from("%PDF-1.7\n"), "receipt.pdf"), { mimeType: "application/pdf", extension: ".pdf" });
  for (const name of ["debug.log", "notes.TXT"]) {
    assert.equal(detectDocumentAttachment(Buffer.from("Network failure\nRetry: café ✓\t200"), name)?.mimeType, "text/plain");
  }
});
test("rejects binary, invalid UTF-8, empty files and unsupported extensions", () => {
  for (const [bytes, name] of [[Buffer.from([0,1,2]), "debug.log"], [Buffer.from([0xff]), "notes.txt"], [Buffer.alloc(0), "notes.txt"], [Buffer.from("plain"), "program.exe"], [Buffer.from("plain"), "receipt.pdf"]] as const) {
    assert.equal(detectDocumentAttachment(bytes, name), null);
  }
});
