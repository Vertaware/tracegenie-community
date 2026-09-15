import assert from "node:assert/strict";
import test from "node:test";
import { publicConfigOrigin } from "./public-config-origin";

test("self-hosted config accepts browser same-origin GET metadata only on its configured host", () => {
  const request = { serveWeb: true, publicUrl: "https://feedback.example.test", host: "feedback.example.test", fetchSite: "same-origin" };
  assert.equal(publicConfigOrigin(request), "https://feedback.example.test");
  assert.equal(publicConfigOrigin({ ...request, publicUrl: "http://localhost:8088", host: "localhost:8088" }), "http://localhost:8088");
  for (const fetchSite of [undefined, "cross-site", "same-site", "none"]) {
    assert.equal(publicConfigOrigin({ ...request, fetchSite }), undefined);
  }
  assert.equal(publicConfigOrigin({ ...request, host: "foreign.example.test" }), undefined);
  assert.equal(publicConfigOrigin({ ...request, serveWeb: false }), undefined);
  assert.equal(publicConfigOrigin({ ...request, origin: "https://foreign.example.test" }), "https://foreign.example.test");
  assert.equal(publicConfigOrigin({ ...request, origin: "null" }), "null");
});
