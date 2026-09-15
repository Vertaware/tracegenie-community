import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "./errors";
import { assertFeatureMutationEnabled } from "./feature-exposure";

test("feature exposure guard allows active mutations", () => {
  assert.doesNotThrow(() => assertFeatureMutationEnabled("action.integration_client.create"));
  assert.doesNotThrow(() => assertFeatureMutationEnabled("action.integration_client.rotate"));
  assert.doesNotThrow(() => assertFeatureMutationEnabled("action.project_widget_secret.rotate"));
});

test("feature exposure guard rejects emergency kill switches", () => {
  assert.throws(
    () => assertFeatureMutationEnabled(
      "action.integration_client.rotate",
      new Set(["action.integration_client.rotate"]),
    ),
    (error) => error instanceof AppError
      && error.statusCode === 503
      && error.code === "feature.kill_switched",
  );

  assert.throws(
    () => assertFeatureMutationEnabled(
      "action.project_widget_secret.rotate",
      new Set(["action.project_widget_secret.rotate"]),
    ),
    (error) => error instanceof AppError
      && error.statusCode === 503
      && error.code === "feature.kill_switched",
  );

  assert.throws(
    () => assertFeatureMutationEnabled(
      "action.integration_client.create",
      new Set(["action.integration_client.create"]),
    ),
    (error) => error instanceof AppError
      && error.statusCode === 503
      && error.code === "feature.kill_switched",
  );
});

test("feature exposure guard enforces server rollout stages", () => {
  assert.throws(
    () => assertFeatureMutationEnabled("action.feedback.submit", new Set(), {
      stages: { "action.feedback.submit": "CANARY" },
      context: { organizationId: "tenant-a", canaryPercent: 0 },
    }),
    (error) => error instanceof AppError
      && error.statusCode === 503
      && error.code === "feature.kill_switched"
      && (error.details as { rolloutStage?: string }).rolloutStage === "CANARY",
  );
  assert.doesNotThrow(() => assertFeatureMutationEnabled("action.feedback.submit", new Set(), {
    stages: { "action.feedback.submit": "CANARY" },
    context: { organizationId: "tenant-a", canaryPercent: 100 },
  }));
  assert.doesNotThrow(() => assertFeatureMutationEnabled("action.feedback.submit", new Set(), {
    stages: { "action.feedback.submit": "INTERNAL" },
    context: { internal: true },
  }));
});
