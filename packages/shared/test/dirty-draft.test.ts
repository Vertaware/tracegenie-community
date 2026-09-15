import assert from "node:assert/strict";
import test from "node:test";

import { resolveDirtyDraftExit } from "../src/dirtyDraft";

test("pristine admin and widget exits proceed without confirmation", () => {
  assert.deepEqual(
    resolveDirtyDraftExit({ surface: "admin-form", intent: "internal-navigation", isDirty: false, isMutationPending: false }),
    { kind: "allow" },
  );
  assert.deepEqual(
    resolveDirtyDraftExit({ surface: "widget", intent: "escape", isDirty: false, isMutationPending: false }),
    { kind: "allow" },
  );
});

test("dirty admin exits use stay or discard while widget exits use keep editing or discard", () => {
  assert.deepEqual(
    resolveDirtyDraftExit({ surface: "admin-form", intent: "organization-switch", isDirty: true, isMutationPending: false }),
    { kind: "confirm", options: ["stay", "discard"] },
  );
  assert.deepEqual(
    resolveDirtyDraftExit({ surface: "widget", intent: "scrim", isDirty: true, isMutationPending: false }),
    { kind: "confirm", options: ["keep-editing", "discard"] },
  );
});

test("browser refresh delegates to native confirmation and pending mutations block every exit", () => {
  assert.deepEqual(
    resolveDirtyDraftExit({ surface: "admin-form", intent: "browser-refresh", isDirty: true, isMutationPending: false }),
    { kind: "native-beforeunload" },
  );
  assert.deepEqual(
    resolveDirtyDraftExit({ surface: "widget", intent: "close", isDirty: true, isMutationPending: true }),
    { kind: "block-pending" },
  );
});
