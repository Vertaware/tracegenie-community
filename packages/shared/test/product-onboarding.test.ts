import assert from "node:assert/strict";
import test from "node:test";

import { productOnboardingCreateSchema, productOnboardingUpdateSchema } from "../src/schemas/onboarding";

test("product onboarding create requires a source only for copy setup", () => {
  assert.equal(productOnboardingCreateSchema.safeParse({
    organizationId: "org-1",
    name: "Customer portal",
    setupSource: "copy_product",
  }).success, false);

  const parsed = productOnboardingCreateSchema.parse({
    organizationId: "org-1",
    name: "Customer portal",
    setupSource: "copy_product",
    sourceProjectKey: "source-product",
  });
  assert.equal(parsed.sourceProjectKey, "source-product");
  assert.equal(parsed.website, "");
});

test("product onboarding create rejects hidden copy input for non-copy setup", () => {
  assert.equal(productOnboardingCreateSchema.safeParse({
    organizationId: "org-1",
    name: "Customer portal",
    setupSource: "fresh",
    sourceProjectKey: "source-product",
  }).success, false);
});

test("customization progress requires a complete bounded appearance contract", () => {
  const parsed = productOnboardingUpdateSchema.parse({
    step: "customize",
    expectedUpdatedAt: "2026-09-02T10:00:00.000Z",
    appearance: {},
    branding: { primaryColor: "#7c3aed" },
  });
  assert.equal(parsed.step, "customize");
  assert.equal(parsed.appearance.launcherLabel, "Report a Bug");
  assert.equal(parsed.branding.primaryColor, "#7c3aed");
  assert.equal(productOnboardingUpdateSchema.safeParse({
    ...parsed,
    appearance: { ...parsed.appearance, launcherOffsetX: 1_000 },
  }).success, false);
  assert.equal(productOnboardingUpdateSchema.safeParse({
    ...parsed,
    branding: { primaryColor: "violet" },
  }).success, false);
});

test("reports progress keeps evidence choices bounded to a plain-language preset", () => {
  const parsed = productOnboardingUpdateSchema.parse({
    step: "reports",
    expectedUpdatedAt: "2026-09-02T10:00:00.000Z",
    reportPreset: "visual",
    reporterIdentity: {},
    privacy: {},
    notificationEmails: ["product@example.com"],
    requesterEmailProductName: "Customer portal",
  });
  assert.equal(parsed.step, "reports");
  assert.equal(parsed.reportPreset, "visual");
  assert.equal(productOnboardingUpdateSchema.safeParse({ ...parsed, reportPreset: "everything" }).success, false);
});

test("team progress records the setup owner without accepting access scope from the client", () => {
  const parsed = productOnboardingUpdateSchema.parse({
    step: "team",
    expectedUpdatedAt: "2026-09-02T10:00:00.000Z",
    setupOwner: "teammate",
  });
  assert.equal(parsed.step, "team");
  assert.equal(productOnboardingUpdateSchema.safeParse({ ...parsed, projectIds: ["another-product"] }).success, false);
});

test("embedded connection accepts an origin only while hosted connection needs none", () => {
  const hosted = productOnboardingUpdateSchema.parse({
    step: "connect",
    expectedUpdatedAt: "2026-09-02T10:00:00.000Z",
    installMethod: "hosted",
  });
  assert.equal(hosted.step, "connect");
  assert.equal(hosted.origin, "");
  assert.equal(productOnboardingUpdateSchema.safeParse({
    step: "connect",
    expectedUpdatedAt: "2026-09-02T10:00:00.000Z",
    installMethod: "embedded",
    origin: "https://app.example.com/private",
  }).success, false);
});

test("verification accepts only the optimistic concurrency marker", () => {
  const parsed = productOnboardingUpdateSchema.parse({
    step: "verify",
    expectedUpdatedAt: "2026-09-02T10:00:00.000Z",
  });
  assert.equal(parsed.step, "verify");
  assert.equal(productOnboardingUpdateSchema.safeParse({
    ...parsed,
    feedbackId: "client-selected-report",
  }).success, false);
});
