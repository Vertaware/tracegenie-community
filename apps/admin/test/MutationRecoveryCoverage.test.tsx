import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

const mutationSurfaceFiles = new Map([
  ["src/app/App.tsx", 2],
  ["src/features/integrations/IntegrationConnectionDetailPage.tsx", 6],
  ["src/features/integrations/IntegrationsPage.tsx", 6],
  ["src/features/issues/IssueDetailPage.tsx", 8],
  ["src/features/platform/PlatformPage.tsx", 5],
  ["src/features/projects/ProjectFormPage.tsx", 5],
  ["src/features/settings/OrgSettingsPage.tsx", 4],
  ["src/features/users/InviteMemberPage.tsx", 1],
  ["src/features/users/UserFormPage.tsx", 2],
]);

const bespokeRecoverySurfaces = new Set([
  "src/app/App.tsx:loginMutation",
]);

test("every admin mutation owns recovery feedback and pending-state duplicate prevention", async () => {
  let mutationCount = 0;

  for (const [relativePath, expectedCount] of mutationSurfaceFiles) {
    const source = await fs.readFile(path.resolve(import.meta.dirname, "..", relativePath), "utf8");
    const mutationNames = [...source.matchAll(/const\s+(\w+)\s*=\s*useMutation\s*\(/g)].map((match) => match[1]);
    mutationCount += mutationNames.length;
    expect(mutationNames, `${relativePath} mutation inventory drifted`).toHaveLength(expectedCount);

    for (const mutationName of mutationNames) {
      const mutationKey = `${relativePath}:${mutationName}`;
      if (bespokeRecoverySurfaces.has(mutationKey)) {
        expect(source, `${mutationKey} must expose its bespoke error state`).toContain(`${mutationName}.isError`);
        expect(source, `${mutationKey} must expose a stable error region`).toContain('id="login-mutation-recovery"');
      } else {
        expect(source, `${mutationKey} must expose recovery`).toContain(`mutationRecoveryEntry(${mutationName},`);
      }
      const ownsPendingState = source.includes(`${mutationName}.isPending`)
        || source.includes(`isCurrentMutationPending(${mutationName})`);
      expect(ownsPendingState, `${relativePath}:${mutationName} must own pending state`).toBe(true);
    }
  }

  expect(mutationCount).toBe(39);
});
