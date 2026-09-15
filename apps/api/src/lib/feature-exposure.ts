import {
featureExposureRegistry,
getFeatureRolloutStage,
isFeatureRolloutEnabled,
isFeatureMutationEnabled,
type FeatureId,
type FeatureRolloutContext,
type FeatureRolloutStage,
type FeatureRolloutStageMap,
} from "@tracegenie/shared";

import { AppError } from "./errors";

export function assertFeatureMutationEnabled(
  featureId: FeatureId,
  emergencyKillSwitches: ReadonlySet<FeatureId> = new Set(),
  rollout?: {
    stages?: FeatureRolloutStageMap;
    context?: FeatureRolloutContext;
    fallbackStage?: FeatureRolloutStage;
  },
) {
  const mutationEnabled = isFeatureMutationEnabled(featureId, emergencyKillSwitches);
  const rolloutEnabled = !rollout || isFeatureRolloutEnabled(
    featureId,
    rollout.stages,
    rollout.context,
    rollout.fallbackStage,
  );
  if (mutationEnabled && rolloutEnabled) {
    return;
  }

  const definition = featureExposureRegistry[featureId];
  const stage = rollout
    ? getFeatureRolloutStage(featureId, rollout.stages, rollout.fallbackStage)
    : definition.defaultRolloutStage;
  throw new AppError(
    503,
    "feature.kill_switched",
    "This action is temporarily unavailable.",
    {
      featureId,
      owner: definition.owner,
      readinessProof: definition.readinessProof,
      rolloutStage: stage,
      rollbackOwner: definition.rollbackOwner,
    },
  );
}
