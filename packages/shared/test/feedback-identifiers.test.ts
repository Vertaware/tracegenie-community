import assert from "node:assert/strict";
import test from "node:test";

import {
  entityIdSchema,
  feedbackBulkExpertMutationSchema,
  feedbackBulkStatusMutationSchema,
  feedbackIdSchema,
} from "../src/index";

test("feedback references accept existing slug IDs without relaxing other entity IDs", () => {
  const legacyId = "tracegenie-ux-capture-issue";

  assert.equal(feedbackIdSchema.parse(legacyId), legacyId);
  assert.equal(entityIdSchema.safeParse(legacyId).success, false);
  assert.equal(feedbackBulkStatusMutationSchema.safeParse({ feedbackIds: [legacyId], status: "new", note: "Reviewed this report." }).success, true);
  assert.equal(feedbackBulkExpertMutationSchema.safeParse({
    items: [{
      feedbackId: legacyId,
      expectedUpdatedAt: "2026-09-04T00:00:00.000Z",
      mutation: { status: "triaged", statusNote: { body: "Reviewed this report.", visibility: "internal" } },
    }],
  }).success, true);
});

test("feedback references reject path and query delimiters", () => {
  for (const invalid of ["../feedback", "feedback/child", "feedback?admin=true", "feedback#fragment"]) {
    assert.equal(feedbackIdSchema.safeParse(invalid).success, false);
  }
});
