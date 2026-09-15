import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

import { failureInjectionCases, requiredFailureStatuses } from "./tg71-failure-injection-model";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

test("TG-UX-071 maps every required failure to current executable product evidence", async () => {
  const statuses = new Set(failureInjectionCases.map((entry) => entry.status));
  const surfaces = new Set(failureInjectionCases.map((entry) => entry.surface));

  for (const status of requiredFailureStatuses) {
    expect(statuses, `missing injected status ${status}`).toContain(status);
  }
  expect(surfaces).toEqual(new Set(["admin", "widget", "reporter", "integration", "billing", "governance"]));
  expect(new Set(failureInjectionCases.map((entry) => entry.id)).size).toBe(failureInjectionCases.length);

  for (const entry of failureInjectionCases) {
    expect(entry.truthfulState.length).toBeGreaterThan(20);
    expect(entry.preservedInput.length).toBeGreaterThan(20);
    expect(entry.retryContract.length).toBeGreaterThan(20);
    expect(entry.auditContract.length).toBeGreaterThan(20);
    const evidenceSource = await fs.readFile(path.join(repoRoot, entry.evidenceFile), "utf8");
    expect(evidenceSource, `${entry.id} must name an executable test`).toContain(`test(\"${entry.evidenceTest}\"`);
    const productionSource = await fs.readFile(path.join(repoRoot, entry.productionFile), "utf8");
    expect(productionSource, `${entry.id} production mapping drifted`).toContain(entry.productionPattern);
    expect(entry.evidenceFile).not.toContain("tg71-failure-injection-model");
  }
});

test("TG-UX-071 recovery claims never contain secret-shaped proof material or invented success", () => {
  const serialized = JSON.stringify(failureInjectionCases);
  expect(serialized).not.toMatch(/sk_live_|ghp_|xox[baprs]-|Bearer\s+[A-Za-z0-9._-]+/i);

  for (const entry of failureInjectionCases) {
    if (["500", "503", "offline", "abort", "capacity", "partial-delivery"].includes(entry.status)) {
      expect(`${entry.truthfulState} ${entry.auditContract}`.toLowerCase()).toMatch(/not|no |failed|blocked|paused|separate|aborted/);
    }
  }
});
