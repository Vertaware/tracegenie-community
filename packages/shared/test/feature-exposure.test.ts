import assert from "node:assert/strict";
import test from "node:test";

import {
  adminRouteFeatureIds,
  featureExposureRegistry,
  getFeatureRolloutStage,
  isFeatureDiscoverable,
  isFeatureMutationEnabled,
  isFeatureRolloutEnabled,
  parseFeatureIdList,
  parseFeatureRolloutStages,
  stableRolloutBucket,
} from "../src/featureExposure";

test("feature exposure registry covers every admin route", () => {
  assert.deepEqual(
    Object.values(adminRouteFeatureIds).toSorted(),
    [
      "route.accept_invite",
      "route.analytics",
      "route.customers",
      "route.forgot_password",
      "route.ideas",
      "route.integrations",
      "route.issue_detail",
      "route.issues",
      "route.login",
      "route.organization_create",
      "route.platform",
      "route.platform_org_detail",
      "route.project_create",
      "route.project_detail",
      "route.projects",
      "route.releases",
      "route.reporter",
      "route.reset_password",
      "route.settings",
      "route.signup",
      "route.user_detail",
      "route.user_invite",
      "route.users",
    ],
  );
  for (const featureId of Object.values(adminRouteFeatureIds)) {
    assert.ok(featureExposureRegistry[featureId], `Missing registry entry for ${featureId}`);
    assert.equal(featureExposureRegistry[featureId].surface, "route");
  }
});

test("feature exposure records carry rollout and kill-switch metadata", () => {
  assert.equal(
    Object.values(featureExposureRegistry).filter((definition) => definition.surface === "action").length,
    90,
  );
  assert.equal(
    Object.values(featureExposureRegistry).filter((definition) => definition.surface === "section").length,
    9,
  );
  for (const [featureId, definition] of Object.entries(featureExposureRegistry)) {
    assert.equal(definition.rolloutFlag, `tracegenie:${featureId}`);
    assert.equal(definition.killSwitch.environmentVariable, "FEATURE_KILL_SWITCHES");
    assert.equal(definition.killSwitch.defaultDisabled, definition.exposure === "KILL_SWITCHED");
    assert.ok(["INTERNAL", "GENERAL"].includes(definition.defaultRolloutStage));
  }
});

test("staged rollout parsing and cohort evaluation fail closed", () => {
  const stages = parseFeatureRolloutStages(
    "action.feedback.submit=canary,action.survey.respond=off,action.feedback.submit=CANARY",
  );
  assert.equal(getFeatureRolloutStage("action.feedback.submit", stages), "CANARY");
  assert.equal(isFeatureRolloutEnabled("action.feedback.submit", stages), false);
  assert.equal(
    isFeatureRolloutEnabled("action.feedback.submit", stages, { organizationId: "tenant-a", canaryPercent: 100 }),
    true,
  );
  assert.equal(isFeatureRolloutEnabled("action.survey.respond", stages, { internal: true }), false);
  assert.equal(isFeatureRolloutEnabled("action.feedback.submit", {}, { internal: true }), true);
  assert.equal(isFeatureRolloutEnabled("action.feedback.submit"), false);
  assert.equal(stableRolloutBucket("tenant-a"), stableRolloutBucket("tenant-a"));
  assert.ok(stableRolloutBucket("tenant-a") >= 0 && stableRolloutBucket("tenant-a") < 100);
  assert.throws(() => parseFeatureRolloutStages("route.not-real=CANARY"), /Unknown TraceGenie feature ID/);
  assert.throws(() => parseFeatureRolloutStages("route.issues=SOFT_LAUNCH"), /Unknown TraceGenie rollout stage/);
});

test("feature exposure respects role, quarantine, and kill-switch state", () => {
  for (const plan of ["FREE", "TIER_1", "TIER_2", "TIER_3"] as const) {
    assert.equal(isFeatureDiscoverable("route.issues", { role: "TRIAGER", plan }), true);
  }
  assert.equal(isFeatureDiscoverable("route.projects", { role: "TRIAGER", plan: "TIER_3" }), false);
  assert.equal(isFeatureDiscoverable("route.projects", { role: "ADMIN", plan: "TIER_3" }), true);
  assert.equal(isFeatureDiscoverable("route.platform", { role: "ADMIN", plan: "TIER_3" }), false);
  assert.equal(isFeatureDiscoverable("route.platform", { role: "GLOBAL_ADMIN", plan: "TIER_3" }), true);
  assert.equal(isFeatureDiscoverable("route.reporter", { role: "PUBLIC", plan: "FREE" }), true);
  assert.equal(isFeatureDiscoverable("route.reporter", { role: "REPORTER", plan: "FREE" }), false);
  assert.equal(
    isFeatureDiscoverable("route.reporter", { role: "PUBLIC", plan: "FREE" }, new Set(["route.reporter"])),
    false,
  );
  assert.equal(isFeatureDiscoverable("section.customers.segments", { role: "ADMIN", plan: "TIER_3" }), false);
  assert.equal(isFeatureDiscoverable("action.integration_client.rotate", { role: "ADMIN", plan: "TIER_3" }), true);
  assert.equal(isFeatureDiscoverable("action.project_widget_secret.rotate", { role: "ADMIN", plan: "TIER_3" }), true);
});

test("feature exposure preserves the current pricing plan IDs", () => {
  const currentPlans = ["FREE", "TIER_1", "TIER_2", "TIER_3"];
  for (const definition of Object.values(featureExposureRegistry)) {
    assert.deepEqual(definition.allowedPlans, currentPlans);
  }
});

test("feature mutation state allows repaired actions and rejects emergency kill switches", () => {
  assert.equal(isFeatureMutationEnabled("action.integration_client.create"), true);
  assert.equal(isFeatureMutationEnabled("action.integration_client.rotate"), true);
  assert.equal(isFeatureMutationEnabled("action.project_widget_secret.rotate"), true);
  assert.equal(
    isFeatureMutationEnabled("action.integration_client.create", new Set(["action.integration_client.create"])),
    false,
  );
  assert.equal(
    isFeatureMutationEnabled("action.project_widget_secret.rotate", new Set(["action.project_widget_secret.rotate"])),
    false,
  );
});

test("feature ID parsing is strict and deduplicated", () => {
  assert.deepEqual(
    parseFeatureIdList(" action.integration_client.rotate,route.issues,route.issues "),
    ["action.integration_client.rotate", "route.issues"],
  );
  assert.throws(
    () => parseFeatureIdList("route.issues,route.not-real"),
    /Unknown TraceGenie feature ID: route\.not-real/,
  );
});
