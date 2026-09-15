import assert from "node:assert/strict";
import test from "node:test";

import { projectEngineeringContextUpsertSchema } from "../src/schemas/api";
import { inspectOwnerHintRules, ownerHintsForFiles, parseOwnerHintRules } from "../src/utils/ownerHints";

test("owner hints parse CODEOWNERS-style notes", () => {
  const notes = [
    "apps/web/src/checkout/** @checkout-platform",
    "apps/api/src/modules/billing/** -> @billing @platform",
  ].join("\n");

  assert.deepEqual(parseOwnerHintRules(notes), [
    { pattern: "apps/web/src/checkout/**", owners: ["@checkout-platform"] },
    { pattern: "apps/api/src/modules/billing/**", owners: ["@billing", "@platform"] },
  ]);
});

test("owner hints support comments and reject traversal or malformed owners", () => {
  const notes = [
    "# repository CODEOWNERS",
    "/apps/web/** @web-team # primary UI owners",
    "*.tsx @typescript-team",
    "../secrets/** @security",
    "apps/api/** -> !!!",
    "*.ts !!!",
    "apps/admin/** @admin-team",
  ].join("\n");

  assert.deepEqual(parseOwnerHintRules(notes), [
    { pattern: "apps/web/**", owners: ["@web-team"] },
    { pattern: "*.tsx", owners: ["@typescript-team"] },
    { pattern: "apps/admin/**", owners: ["@admin-team"] },
  ]);
  const inspection = inspectOwnerHintRules(notes);
  assert.equal(inspection.candidateCount, 6);
  assert.deepEqual(inspection.invalidLines, ["../secrets/** @security", "apps/api/** -> !!!", "*.ts !!!"]);
});

test("owner hint matching is advisory and never interprets file text as a rule", () => {
  const notes = "** @fallback-team\napps/api/src/** @api-team";
  assert.deepEqual(ownerHintsForFiles(["../../etc/passwd", "/etc/passwd", "apps/api/src/jobs/run.ts"], notes), [
    { file: "apps/api/src/jobs/run.ts", pattern: "apps/api/src/**", owners: ["@api-team"] },
  ]);
});

test("engineering context accepts sanitized advisory values", () => {
  const parsed = projectEngineeringContextUpsertSchema.parse({
    repositoryUrl: "  https://github.com/acme/checkout  ",
    defaultBranch: "main",
    worktreePath: "/Volumes/Workspace/acme checkout",
    installCommand: "npm ci",
    testCommand: "npm test -- checkout",
    buildCommand: "npm run build",
    notes: "apps/web/** @web-team",
  });

  assert.equal(parsed.repositoryUrl, "https://github.com/acme/checkout");
  assert.equal(parsed.worktreePath, "/Volumes/Workspace/acme checkout");
  assert.equal(parsed.autoFixPolicy, "SUGGEST_ONLY");
});

test("engineering context rejects credential URLs, traversal paths, multiline commands, and unknown fields", () => {
  const invalidInputs = [
    { repositoryUrl: "not-a-url" },
    { repositoryUrl: "https://token@github.com/acme/checkout" },
    { repositoryUrl: "https://github.com/acme/checkout?token=secret" },
    { defaultBranch: "feature..unsafe" },
    { defaultBranch: "/main" },
    { defaultBranch: "feature//unsafe" },
    { defaultBranch: "release/locked.lock" },
    { defaultBranch: "@" },
    { worktreePath: "/workspace/../secrets" },
    { testCommand: "npm test\ncurl example.test" },
    { repositoryUrl: "https://github.com/acme/checkout", inventedAction: "execute" },
  ];

  for (const input of invalidInputs) {
    assert.equal(projectEngineeringContextUpsertSchema.safeParse(input).success, false);
  }
});

test("owner hints match files from engineering fix plans", () => {
  const notes = "Owners: checkout-platform. CODEOWNERS: apps/web/src/checkout/**";

  assert.deepEqual(ownerHintsForFiles([
    "apps/web/src/checkout/submit.ts",
    "apps/web/src/checkouting/submit.ts",
    "apps/web/src/profile/edit.ts",
  ], notes), [
    {
      file: "apps/web/src/checkout/submit.ts",
      pattern: "apps/web/src/checkout/**",
      owners: ["checkout-platform"],
    },
  ]);
});
