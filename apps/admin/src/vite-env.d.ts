/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEATURE_KILL_SWITCHES?: string;
  readonly VITE_FEATURE_ROLLOUT_STAGES?: string;
  readonly VITE_FEATURE_ROLLOUT_INTERNAL_ORGANIZATION_IDS?: string;
  readonly VITE_FEATURE_ROLLOUT_INTERNAL_USER_IDS?: string;
  readonly VITE_FEATURE_ROLLOUT_CANARY_PERCENT?: string;
}
