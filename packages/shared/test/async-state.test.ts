import assert from "node:assert/strict";
import test from "node:test";

import { classifyMutationAsyncState, classifyQueryAsyncState } from "../src/asyncState";

const listIsEmpty = (items: string[]) => items.length === 0;

test("query async state distinguishes idle, loading, data, empty, refreshing, stale, and error", () => {
  assert.deepEqual(
    classifyQueryAsyncState({ enabled: false, isPending: true, isFetching: false, isError: false }, listIsEmpty),
    { kind: "idle" },
  );
  assert.deepEqual(
    classifyQueryAsyncState({ enabled: true, isPending: true, isFetching: true, isError: false }, listIsEmpty),
    { kind: "loading" },
  );
  assert.deepEqual(
    classifyQueryAsyncState({ enabled: true, data: ["issue-1"], isPending: false, isFetching: false, isError: false }, listIsEmpty),
    { kind: "success-data", data: ["issue-1"] },
  );
  assert.deepEqual(
    classifyQueryAsyncState({ enabled: true, data: [], isPending: false, isFetching: false, isError: false }, listIsEmpty),
    { kind: "success-empty", data: [] },
  );
  assert.deepEqual(
    classifyQueryAsyncState({ enabled: true, data: ["issue-1"], isPending: false, isFetching: true, isError: false }, listIsEmpty),
    { kind: "refreshing", data: ["issue-1"] },
  );
  assert.deepEqual(
    classifyQueryAsyncState({ enabled: true, data: ["issue-1"], isPending: false, isFetching: false, isError: true }, listIsEmpty),
    { kind: "stale", data: ["issue-1"] },
  );
  assert.deepEqual(
    classifyQueryAsyncState({ enabled: true, isPending: false, isFetching: false, isError: true }, listIsEmpty),
    { kind: "error" },
  );
});

test("mutation async state exposes retry separately from initial pending and error", () => {
  assert.deepEqual(classifyMutationAsyncState({ isPending: false, isSuccess: false, isError: false }), { kind: "idle", canRetry: false });
  assert.deepEqual(classifyMutationAsyncState({ isPending: true, isSuccess: false, isError: false }), { kind: "pending", canRetry: false });
  assert.deepEqual(classifyMutationAsyncState({ isPending: true, isSuccess: false, isError: false, failureCount: 1 }), { kind: "retry", canRetry: false });
  assert.deepEqual(classifyMutationAsyncState({ isPending: false, isSuccess: true, isError: false }), { kind: "success", canRetry: false });
  assert.deepEqual(classifyMutationAsyncState({ isPending: false, isSuccess: false, isError: true }), { kind: "error", canRetry: true });
});
