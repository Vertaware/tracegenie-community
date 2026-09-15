import assert from "node:assert/strict";
import test from "node:test";

import { resultFailureCount, runOutboxCycle } from "./worker-runtime";

test("worker result failure detection handles outbox and cleanup result shapes", () => {
  assert.equal(resultFailureCount({ processed: 3, failed: 2 }), 2);
  assert.equal(resultFailureCount({ scanned: 3, failed: [{ id: "one" }] }), 1);
  assert.equal(resultFailureCount({ processed: 3, failed: [] }), 0);
  assert.equal(resultFailureCount({ processed: 3 }), 0);
  assert.equal(resultFailureCount(null), 0);
});

test("outbox cycle drains every durable queue and reports partial item failures", async () => {
  const workerIds: string[] = [];
  const cycle = await runOutboxCycle("worker-proof", {
    notification: async (options) => {
      workerIds.push(options.workerId);
      return { processed: 1, sent: 1, failed: 0, skipped: 0 };
    },
    webhook: async (options) => {
      workerIds.push(options.workerId);
      return { processed: 1, sent: 0, failed: 1, skipped: 0 };
    },
    providerSync: async (options) => {
      workerIds.push(options.workerId);
      return { processed: 1, succeeded: 1, failed: 0, skipped: 0 };
    },
    dsarExport: async (options) => {
      workerIds.push(options.workerId);
      return { processed: 1, completed: 1, failed: 0, skipped: 0 };
    },
  });

  assert.equal(cycle.ok, false);
  assert.deepEqual(cycle.results.map((result) => result.name), [
    "notification_outbox",
    "webhook_outbox",
    "provider_sync_outbox",
    "dsar_export_outbox",
  ]);
  assert.deepEqual(workerIds.sort(), [
    "worker-proof-dsar-export",
    "worker-proof-notifications",
    "worker-proof-provider-sync",
    "worker-proof-webhooks",
  ]);
});
