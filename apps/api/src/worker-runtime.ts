import { writeFile,rm } from "node:fs/promises";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { feedbackNotificationService } from "./modules/feedback/feedback-notification.service";
import { feedbackService } from "./modules/feedback/feedback.service";

import { cleanupExpiredDsarExportArtifacts,processDsarExportBatch } from "./modules/organizations/dsar.service";

type WorkerOperationResult = {
  name: string;
  ok: boolean;
  result?: unknown;
};

type OutboxOperationOptions = {
  limit: number;
  workerId: string;
};

export type WorkerOutboxOperations = {
  notification: (options: OutboxOperationOptions) => Promise<unknown>;
  
  
  dsarExport: (options: OutboxOperationOptions) => Promise<unknown>;
};

const defaultOutboxOperations: WorkerOutboxOperations = {
  notification: (options) => feedbackNotificationService.processOutboxBatch(options),
  ...{},
  ...{},
  dsarExport: (options) => processDsarExportBatch(options),
};

export function resultFailureCount(result: unknown) {
  if (!result || typeof result !== "object" || !("failed" in result)) return 0;
  const failed = result.failed;
  if (typeof failed === "number") return failed;
  return Array.isArray(failed) ? failed.length : 0;
}

async function runOperation(name: string, operation: () => Promise<unknown>): Promise<WorkerOperationResult> {
  try {
    const result = await operation();
    const failureCount = resultFailureCount(result);
    if (failureCount > 0) {
      logger.error({ event: "worker.operation_item_failures", operation: name, failureCount, result }, "[worker] Operation reported item failures");
    }
    return { name, ok: failureCount === 0, result };
  } catch (error) {
    logger.error({ event: "worker.operation_failed", operation: name, error }, "[worker] Operation failed");
    return { name, ok: false };
  }
}

export async function runOutboxCycle(
  workerId = process.env.HOSTNAME ?? `tracegenie-worker-${process.pid}`,
  operations: WorkerOutboxOperations = defaultOutboxOperations,
) {
  const results = await Promise.all([
    runOperation("notification_outbox", () => operations.notification({
      limit: env.NOTIFICATION_OUTBOX_BATCH_SIZE,
      workerId: `${workerId}-notifications`,
    })),
    ...[],
    ...[],
    runOperation("dsar_export_outbox", () => operations.dsarExport({
      limit: env.DSAR_EXPORT_BATCH_SIZE,
      workerId: `${workerId}-dsar-export`,
    })),
  ]);

  return {
    ok: results.every((result) => result.ok),
    results,
  };
}

export async function runCleanupCycle() {
  const results = await Promise.all([
    runOperation("expired_upload_cleanup", () => feedbackService.cleanupExpiredUploads({
      limit: env.UPLOAD_CLEANUP_LIMIT,
    })),
    runOperation("retained_feedback_cleanup", () => feedbackService.cleanupRetainedFeedback({
      limit: env.FEEDBACK_RETENTION_CLEANUP_LIMIT,
    })),
    ...[],
    runOperation("expired_dsar_artifact_cleanup", () => cleanupExpiredDsarExportArtifacts({
      limit: env.DSAR_EXPORT_CLEANUP_LIMIT,
    })),
  ]);

  return {
    ok: results.every((result) => result.ok),
    results,
  };
}

export async function startWorker() {
  let stopping = false;
  let wake: (() => void) | null = null;
  let nextCleanupAt = 0;
  let nextHeartbeatAt = 0;

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "[worker] Graceful shutdown requested");
    wake?.();
  };

  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));

  logger.info({
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    cleanupIntervalMs: env.WORKER_CLEANUP_INTERVAL_MS,
    heartbeatIntervalMs: env.WORKER_HEARTBEAT_INTERVAL_MS,
  }, "[worker] TraceGenie background worker started");

  try {
    while (!stopping) {
      const cycleStartedAt = Date.now();
      const outbox = await runOutboxCycle();
      let cleanup: Awaited<ReturnType<typeof runCleanupCycle>> | undefined;

      if (cycleStartedAt >= nextCleanupAt) {
        cleanup = await runCleanupCycle();
        nextCleanupAt = Date.now() + env.WORKER_CLEANUP_INTERVAL_MS;
      }

      if (cycleStartedAt >= nextHeartbeatAt) {
        logger.info({
          event: "worker.heartbeat",
          outbox,
          cleanup,
          cycleDurationMs: Date.now() - cycleStartedAt,
        }, "[worker] Heartbeat");
        nextHeartbeatAt = Date.now() + env.WORKER_HEARTBEAT_INTERVAL_MS;
      }

      if (env.SERVE_WEB) {
        await prisma.$queryRaw`SELECT 1`;
        await writeFile("/tmp/tracegenie-worker-ready", String(Date.now()), { mode: 0o600 });
      }
      if (stopping) break;
      const delay = Math.max(0, env.WORKER_POLL_INTERVAL_MS - (Date.now() - cycleStartedAt));
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wake = null;
          resolve();
        }, delay);
        wake = () => {
          clearTimeout(timer);
          wake = null;
          resolve();
        };
      });
    }
  } finally {
    if (env.SERVE_WEB) await rm("/tmp/tracegenie-worker-ready", { force: true });
    await prisma.$disconnect();
    logger.info("[worker] TraceGenie background worker stopped");
  }
}
