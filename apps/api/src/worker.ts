

import { logger } from "./lib/logger";
import { startWorker } from "./worker-runtime";

void startWorker().catch((error) => {
  logger.fatal({ event: "worker.terminated", error }, "[worker] TraceGenie background worker terminated");
  process.exitCode = 1;
});
