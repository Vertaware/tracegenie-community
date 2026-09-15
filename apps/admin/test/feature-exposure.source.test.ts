import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { adminRouteFeatureIds } from "@tracegenie/shared";

async function source(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

async function applicationSource() {
  const root = new URL("../src/", import.meta.url);
  const paths = (await readdir(root, { recursive: true }))
    .filter((path) => /\.(?:ts|tsx)$/.test(path));
  return (await Promise.all(paths.map((path) => readFile(new URL(path, root), "utf8")))).join("\n");
}

test("every registered route is wired through the application shell", async () => {
  const appSource = await source("../src/app/App.tsx");

  for (const featureId of Object.values(adminRouteFeatureIds)) {
    assert.match(appSource, new RegExp(`["]${featureId.replaceAll(".", "\\.")}["]`));
  }

  assert.match(appSource, /path="\/login"/);
  assert.match(appSource, /path="\*"[\s\S]{0,250}<NotFoundPage/);
  assert.match(appSource, /recordHiddenFeatureExposure\("feature\.hidden_route_requested", featureId\)/);
});

test("quarantined sections and dangerous actions use exposure guards", async () => {
  const [appSource, adminSource, integrationsSource, projectsSource, platformSource] = await Promise.all([
    source("../src/app/App.tsx"),
    applicationSource(),
    source("../src/features/integrations/IntegrationsPage.tsx"),
    source("../src/features/projects/ProjectFormPage.tsx"),
    source("../src/features/platform/PlatformPage.tsx"),
  ]);

  for (const featureId of [
    "section.customers.segments",
    "section.customers.cohorts",
  ]) {
    assert.doesNotMatch(
      adminSource,
      new RegExp(`["]${featureId.replaceAll(".", "\\.")}["]`),
      `${featureId} is quarantined and must not have an admin route or surface`,
    );
  }

  for (const featureId of [
    "action.integration_client.create",
    "action.integration_client.rotate",
    "action.webhook_secret.create",
    "action.webhook_secret.rotate",
  ]) {
    assert.match(adminSource, new RegExp(`["]${featureId.replaceAll(".", "\\.")}["]`));
  }

  for (const featureId of [
    "action.project_widget_secret.generate",
    "action.project_widget_secret.rotate",
  ]) {
    const pattern = new RegExp(`["]${featureId.replaceAll(".", "\\.")}["]`);
    assert.match(projectsSource, pattern);
    assert.match(platformSource, pattern);
  }

  assert.match(appSource, /"section\.admin\.dogfood_widget"/);
});

test("TG75 staged routes and components use the shared rollout contract", async () => {
  const [exposureSource, appSource, ideasSource, integrationsSource, providerSource, surveysSource] = await Promise.all([
    source("../src/lib/featureExposure.ts"),
    source("../src/app/App.tsx"),
    source("../src/features/ideas/IdeasPage.tsx"),
    source("../src/features/integrations/IntegrationsPage.tsx"),
    source("../src/features/integrations/ProviderOperationsPanel.tsx"),
    source("../src/features/projects/ProductSurveyWorkflow.tsx"),
  ]);
  assert.match(exposureSource, /VITE_FEATURE_ROLLOUT_STAGES/);
  assert.match(exposureSource, /isFeatureRolloutEnabled/);
  assert.match(appSource, /currentOrganizationId \?\? undefined/);
  for (const featureId of ["action.idea_source.ingest", "section.ideas.ai_synthesis", "action.idea_suggestion.review"]) {
    assert.match(ideasSource, new RegExp(featureId.replaceAll(".", "\\.")));
  }
  assert.match(integrationsSource, /action\.alert_rule\.manage[\s\S]{0,180}organizationId/);
  assert.match(providerSource, /section\.integrations\.provider_import[\s\S]{0,180}organizationId/);
  assert.match(surveysSource, /action\.survey\.manage[\s\S]{0,180}organizationId/);
});
