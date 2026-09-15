import "dotenv/config";

import { z } from "zod";
import { parseFeatureIdList,parseFeatureRolloutStages } from "@tracegenie/shared";

const PLACEHOLDER_SECRET = "replace-with-a-long-random-secret";
const PLACEHOLDER_ADMIN_PASSWORD = "ChangeMe123!";

function isLocalUrl(value: string) {
  const hostname = new URL(value).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

const booleanEnv = z
  .union([z.boolean(), z.string()])
  .transform((val) =>
    typeof val === "boolean" ? val : ["true", "1", "yes"].includes(val.toLowerCase()),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    COMMUNITY_SETUP_TOKEN: z.string().min(32).optional(),
    SERVE_WEB: booleanEnv.default(false),
    PORT: z.coerce.number().int().positive().optional(),
    API_HOST: z.string().default("127.0.0.1"),
    API_PORT: z.coerce.number().int().positive().default(4000),
    API_BASE_URL: z.string().url().default("http://localhost:4000"),
    ...{},
    ADMIN_APP_URL: z.string().url().default("http://localhost:4173"),
    DEMO_APP_URL: z.string().url().default("http://localhost:4174"),
    JWT_SECRET: z.string().min(24),
    ...{},
    ...{},
    ...{},
    ADMIN_SEED_EMAIL: z.string().email().optional(),
    ADMIN_SEED_PASSWORD: z.string().min(8).optional(),
    ADMIN_SEED_NAME: z.string().min(1).optional(),
    AUTO_SEED_ADMIN_ON_BOOT: booleanEnv.default(false),
    CORS_ORIGINS: z.string().default("http://localhost:4173,http://localhost:4174"),
    PUBLIC_APP_ORIGINS: z.string().default("http://localhost:4174"),
    STORAGE_DRIVER: z.literal("local").default("local"),
    STORAGE_LOCAL_ROOT: z.string().default(".local/uploads"),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5_242_880),
    ...{},
    ...{},
    ...{},
    ...{},
    ALLOW_INSECURE_PUBLIC_SUBMISSIONS: booleanEnv.default(false),
    WIDGET_SESSION_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    EMAIL_SETTINGS_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: booleanEnv.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().default("TraceGenie <notifications@example.com>"),
    REQUESTER_EMAIL_FROM_NAME: z.string().default("TraceGenie"),
    REQUESTER_EMAIL_FROM_EMAIL: z.string().email().default("updates@example.com"),
    REQUESTER_EMAIL_REPLY_TO: z.string().email().default("support@example.com"),
    EMAIL_NOTIFY_ON_NEW_ISSUE: booleanEnv.default(true),
    EMAIL_NOTIFY_REQUESTER_ON_TRIAGE: booleanEnv.default(true),
    EMAIL_NOTIFY_REQUESTER_ON_STATUS: booleanEnv.default(true),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).max(300_000).default(5_000),
    WORKER_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(3_600_000),
    WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(300_000),
    NOTIFICATION_OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
    ...{},
    ...{},
    DSAR_EXPORT_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
    UPLOAD_CLEANUP_LIMIT: z.coerce.number().int().min(1).max(500).default(100),
    FEEDBACK_RETENTION_CLEANUP_LIMIT: z.coerce.number().int().min(1).max(250).default(50),
    DSAR_EXPORT_CLEANUP_LIMIT: z.coerce.number().int().min(1).max(500).default(100),
    FEATURE_KILL_SWITCHES: z.string().default(""),
    FEATURE_ROLLOUT_STAGES: z.string().default(""),
    FEATURE_ROLLOUT_INTERNAL_ORGANIZATION_IDS: z.string().default(""),
    FEATURE_ROLLOUT_INTERNAL_USER_IDS: z.string().default(""),
    FEATURE_ROLLOUT_CANARY_PERCENT: z.coerce.number().min(0).max(100).default(0),
    GLOBAL_ADMIN_EMAILS: z.string().default(""),
    ...{},
    ...{},
    ...{},
    ...{},
    ...{},
    ...{},
    ...{},
    ...{},
  })
  .superRefine((value, context) => {
    

    

    

    if (value.AUTO_SEED_ADMIN_ON_BOOT) {
      if (!value.ADMIN_SEED_EMAIL) {
        context.addIssue({
          code: "custom",
          message: "ADMIN_SEED_EMAIL is required when AUTO_SEED_ADMIN_ON_BOOT=true.",
          path: ["ADMIN_SEED_EMAIL"],
        });
      }
      if (!value.ADMIN_SEED_PASSWORD) {
        context.addIssue({
          code: "custom",
          message: "ADMIN_SEED_PASSWORD is required when AUTO_SEED_ADMIN_ON_BOOT=true.",
          path: ["ADMIN_SEED_PASSWORD"],
        });
      }
    }

    if (value.NODE_ENV === "production") {
      for (const key of ["API_BASE_URL", "ADMIN_APP_URL", "DEMO_APP_URL", ...[]] as const) {
        const valueForKey = value[key];
        if (isLocalUrl(valueForKey) && !value.SERVE_WEB) {
          context.addIssue({
            code: "custom",
            message: `${key} must not point to localhost in production.`,
            path: [key],
          });
        }
      }

      if (value.JWT_SECRET === PLACEHOLDER_SECRET) {
        context.addIssue({
          code: "custom",
          message: "JWT_SECRET must be replaced with a unique production secret.",
          path: ["JWT_SECRET"],
        });
      }

      if (value.AUTO_SEED_ADMIN_ON_BOOT) {
        context.addIssue({
          code: "custom",
          message: "AUTO_SEED_ADMIN_ON_BOOT must be false in production.",
          path: ["AUTO_SEED_ADMIN_ON_BOOT"],
        });
      }

      if (value.ALLOW_INSECURE_PUBLIC_SUBMISSIONS) {
        context.addIssue({
          code: "custom",
          message: "ALLOW_INSECURE_PUBLIC_SUBMISSIONS must be false in production.",
          path: ["ALLOW_INSECURE_PUBLIC_SUBMISSIONS"],
        });
      }

      if (value.ADMIN_SEED_PASSWORD === PLACEHOLDER_ADMIN_PASSWORD) {
        context.addIssue({
          code: "custom",
          message: "ADMIN_SEED_PASSWORD must not use the development placeholder password.",
          path: ["ADMIN_SEED_PASSWORD"],
        });
      }

      
    }
  });

const parsed = envSchema.parse(process.env);

export const env = {
  ...parsed,
  API_PORT: parsed.PORT ?? parsed.API_PORT,
  ...{},
  ...{},
  ...{},
  ...{},
  corsOrigins: parsed.CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean),
  publicAppOrigins: parsed.PUBLIC_APP_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean),
  featureKillSwitches: new Set(parseFeatureIdList(parsed.FEATURE_KILL_SWITCHES)),
  featureRolloutStages: parseFeatureRolloutStages(parsed.FEATURE_ROLLOUT_STAGES),
  featureRolloutInternalOrganizationIds: new Set(
    parsed.FEATURE_ROLLOUT_INTERNAL_ORGANIZATION_IDS.split(",").map((value) => value.trim()).filter(Boolean),
  ),
  featureRolloutInternalUserIds: new Set(
    parsed.FEATURE_ROLLOUT_INTERNAL_USER_IDS.split(",").map((value) => value.trim()).filter(Boolean),
  ),
  featureRolloutCanaryPercent: parsed.FEATURE_ROLLOUT_CANARY_PERCENT,
  GLOBAL_ADMIN_EMAILS: parsed.GLOBAL_ADMIN_EMAILS.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
};
