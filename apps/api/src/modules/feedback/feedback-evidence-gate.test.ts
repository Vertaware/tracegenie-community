import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateFeedbackEvidenceQuality,
  mergeEvidenceGateOverride,
  readEvidenceGateOverride,
} from "./feedback-evidence-gate";
import type { EvidenceGateOverride } from "./feedback-evidence-gate";

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    attachments: [],
    currentUrl: "https://example.test/checkout",
    consoleEntries: null,
    clientErrorContext: null,
    stepsToReproduce: null,
    expectedResult: null,
    actualResult: null,
    appVersion: "1.0.0",
    buildNumber: null,
    releaseChannel: null,
    reporterEmail: "reporter@example.test",
    reporterName: "Reporter",
    extraContext: null,
    ...overrides,
  };
}

test("weak evidence is blocked with deterministic missing dimensions", () => {
  const quality = calculateFeedbackEvidenceQuality(evidence());

  assert.equal(quality.score, 38);
  assert.equal(quality.ready, false);
  assert.deepEqual(quality.missing, ["screenshot", "console-error", "steps", "account", "repro-confidence"]);
  assert.equal(calculateFeedbackEvidenceQuality(evidence({
    extraContext: { productContext: { account: { name: 42 } } },
  })).score, 38);
});

test("six of eight evidence dimensions opens the engineering gate", () => {
  const quality = calculateFeedbackEvidenceQuality(evidence({
    stepsToReproduce: "Select Pay now.",
    actualResult: "Payment fails.",
    consoleEntries: [{ level: "error", message: "Payment failed" }],
  }));

  assert.equal(quality.score, 75);
  assert.equal(quality.ready, true);
});

test("evidence override parsing rejects malformed state and preserves unrelated context", () => {
  const override: EvidenceGateOverride = {
    reason: "Production impact requires immediate engineering investigation.",
    evidenceScore: 38,
    missing: ["screenshot", "console-error", "steps", "account", "repro-confidence"],
    createdAt: "2026-07-11T12:05:00.000Z",
  };
  const merged = mergeEvidenceGateOverride({ supportCaseId: "case-123" }, override);

  assert.equal(merged.supportCaseId, "case-123");
  assert.deepEqual(readEvidenceGateOverride(merged), override);
  assert.equal(readEvidenceGateOverride({ evidenceGateOverride: { reason: "short" } }), null);
});
