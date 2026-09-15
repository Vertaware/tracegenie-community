import assert from "node:assert/strict";
import test from "node:test";

import {
  projectEvidenceSettingsPatchSchema,
  projectGeneralSettingsPatchSchema,
  projectInstallationSettingsPatchSchema,
  projectNotificationsSettingsPatchSchema,
  projectPrivacySettingsPatchSchema,
  projectWidgetSettingsPatchSchema,
} from "../src/schemas/widget";

const expectedUpdatedAt = "2026-07-16T12:00:00.000Z";

test("project settings PATCH schemas accept only their destination-owned fields", () => {
  assert.deepEqual(projectGeneralSettingsPatchSchema.parse({ expectedUpdatedAt, name: "Checkout" }), {
    expectedUpdatedAt,
    name: "Checkout",
  });
  assert.deepEqual(projectInstallationSettingsPatchSchema.parse({
    expectedUpdatedAt,
    allowedOrigins: ["https://app.example.test"],
  }), {
    expectedUpdatedAt,
    allowedOrigins: ["https://app.example.test"],
  });
  assert.equal(projectWidgetSettingsPatchSchema.safeParse({
    expectedUpdatedAt,
    appearance: { launcherLabel: "Send feedback" },
  }).success, true);
  assert.equal(projectEvidenceSettingsPatchSchema.safeParse({
    expectedUpdatedAt,
    allowScreenshot: false,
    fields: { description: { enabled: true, required: true } },
    surveyPrompt: { enabled: true, question: "How was checkout?" },
  }).success, true);
  assert.equal(projectNotificationsSettingsPatchSchema.safeParse({
    expectedUpdatedAt,
    notificationEmails: ["alerts@example.test"],
    requesterEmailProductName: "Checkout Support",
    notificationBranding: { brandName: "Checkout" },
  }).success, true);
  assert.equal(projectPrivacySettingsPatchSchema.safeParse({
    expectedUpdatedAt,
    privacy: { redactionMode: "strict", customRedactionTerms: ["Account 123"] },
  }).success, true);

  for (const schema of [
    projectGeneralSettingsPatchSchema,
    projectInstallationSettingsPatchSchema,
    projectWidgetSettingsPatchSchema,
    projectEvidenceSettingsPatchSchema,
    projectNotificationsSettingsPatchSchema,
    projectPrivacySettingsPatchSchema,
  ]) {
    assert.equal(schema.safeParse({ expectedUpdatedAt, key: "renamed-project" }).success, false);
  }

  assert.equal(projectGeneralSettingsPatchSchema.safeParse({ expectedUpdatedAt, allowedOrigins: [] }).success, false);
  assert.equal(projectInstallationSettingsPatchSchema.safeParse({ expectedUpdatedAt, name: "Wrong owner" }).success, false);
  assert.equal(projectWidgetSettingsPatchSchema.safeParse({ expectedUpdatedAt, allowScreenshot: false }).success, false);
  assert.equal(projectWidgetSettingsPatchSchema.safeParse({
    expectedUpdatedAt,
    surveyPrompt: { enabled: true },
  }).success, false);
  assert.equal(projectEvidenceSettingsPatchSchema.safeParse({ expectedUpdatedAt, appearance: {} }).success, false);
  assert.equal(projectNotificationsSettingsPatchSchema.safeParse({ expectedUpdatedAt, privacy: {} }).success, false);
  assert.equal(projectGeneralSettingsPatchSchema.safeParse({
    expectedUpdatedAt,
    requesterEmailProductName: "Wrong owner",
  }).success, false);
  assert.equal(projectEvidenceSettingsPatchSchema.safeParse({
    expectedUpdatedAt,
    notificationBranding: { brandName: "Wrong owner" },
  }).success, false);
  assert.equal(projectPrivacySettingsPatchSchema.safeParse({ expectedUpdatedAt, notificationEmails: [] }).success, false);
});

test("project settings PATCH schemas require a current version and a mutation", () => {
  assert.equal(projectGeneralSettingsPatchSchema.safeParse({ name: "Checkout" }).success, false);
  assert.equal(projectGeneralSettingsPatchSchema.safeParse({ expectedUpdatedAt }).success, false);
});

test("widget colors accept partial branding without claiming email-only fields", () => {
  const patch = { expectedUpdatedAt, notificationBranding: { primaryColor: "#6754D7" } };
  assert.deepEqual(projectWidgetSettingsPatchSchema.parse(patch), patch);
  assert.equal(projectWidgetSettingsPatchSchema.safeParse({
    expectedUpdatedAt, notificationBranding: { primaryColor: "#123", accentColor: "red" },
  }).success, false);
  for (const field of ["brandName", "logoUrl", "emailFooterText"]) {
    assert.equal(projectWidgetSettingsPatchSchema.safeParse({
      expectedUpdatedAt, notificationBranding: { primaryColor: "#6754d7", [field]: "unowned" },
    }).success, false);
  }
  assert.equal(projectWidgetSettingsPatchSchema.safeParse({
    ...patch, notificationEmails: ["alerts@example.test"],
  }).success, false);
});

test("capture settings persist automatic screenshots and multiple attachments independently", () => {
  for (const enabled of [true, false]) {
    const patch = { expectedUpdatedAt, autoCaptureScreenshot: enabled, allowFileAttachments: enabled };
    assert.deepEqual(projectEvidenceSettingsPatchSchema.parse(patch), patch);
  }
  assert.equal(projectWidgetSettingsPatchSchema.safeParse({ expectedUpdatedAt, autoCaptureScreenshot: true }).success, false);
});
