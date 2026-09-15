import { isFeatureDiscoverable,type FeatureId,type FeaturePlan,type FeatureRole } from "@tracegenie/shared";

// Community has no hosted rollout cohorts, plans, or platform administration.
const excluded = /(?:signup|organization_create|project_create|platform|billing|integrations|webhook|surveys|ideas|customers|releases|analytics|engineering|mcp|dogfood|alert_rules)/;
export function getFeatureRole(userRole?: string, _platformRole?: string): FeatureRole {
  return userRole === "ADMIN" ? "ADMIN" : "TRIAGER";
}
export function isAdminFeatureDiscoverable(featureId: FeatureId, userRole = "ADMIN", _platformRole = "USER", _plan?: FeaturePlan, _organizationId?: string, _userId?: string) {
  return !excluded.test(featureId) && isFeatureDiscoverable(featureId, { role: getFeatureRole(userRole) });
}
export function isPublicFeatureDiscoverable(featureId: FeatureId) {
  return !excluded.test(featureId) && isFeatureDiscoverable(featureId, { role: "PUBLIC" });
}
export function recordHiddenFeatureExposure(_eventType: string, _featureId: FeatureId, _path?: string) {}
