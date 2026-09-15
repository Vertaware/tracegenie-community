import test from "node:test";
import assert from "node:assert/strict";

import {
  feedbackIdempotencyIndexes,
  type FeedbackIdempotencyIndexState,
  invalidFeedbackIdempotencyIndexes,
} from "./idempotency-indexes";

function validRows(): FeedbackIdempotencyIndexState[] {
  return feedbackIdempotencyIndexes.map((index) => ({
    name: index.name,
    schemaName: "public",
    tableName: index.table,
    tableSchema: "public",
    isValid: true,
    isReady: true,
    isUnique: true,
    isNotPartial: true,
    columns: [...index.columns],
  }));
}

test("feedback idempotency index validation requires exact schema table uniqueness predicate and column order", () => {
  assert.deepEqual(invalidFeedbackIdempotencyIndexes(validRows(), "public"), []);

  const corruptions: Array<(row: FeedbackIdempotencyIndexState) => void> = [
    (row) => { row.schemaName = "shadow"; },
    (row) => { row.tableSchema = "shadow"; },
    (row) => { row.tableName = "wrong_table"; },
    (row) => { row.isValid = false; },
    (row) => { row.isReady = false; },
    (row) => { row.isUnique = false; },
    (row) => { row.isNotPartial = false; },
    (row) => { row.columns.reverse(); },
    (row) => { row.columns.push("unexpected_column"); },
  ];

  for (const corrupt of corruptions) {
    const rows = validRows();
    corrupt(rows[0]!);
    assert.deepEqual(invalidFeedbackIdempotencyIndexes(rows, "public"), [feedbackIdempotencyIndexes[0].name]);
  }
});
