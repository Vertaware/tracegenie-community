

import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { assertFeedbackIdempotencyIndexesReady } from "./lib/idempotency-indexes";
import { createApp } from "./app";
import { authService } from "./modules/auth/auth.service";

async function main() {
  await prisma.$connect();
  await assertFeedbackIdempotencyIndexesReady();
  if (env.AUTO_SEED_ADMIN_ON_BOOT) {
    await authService.seedDefaultAdmin();
  }

  const app = await createApp();
  const server = app.listen(env.API_PORT, env.API_HOST, () => {
    logger.info({ port: env.API_PORT }, "TraceGenie Feedback API listening");
  });

  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    logger.info({ signal }, "Shutting down API server");
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await prisma.$disconnect();
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT").then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM").then(() => process.exit(0));
  });
}

main().catch(async (error) => {
  logger.error({ event: "api.start_failed", error }, "Failed to start API");
  await prisma.$disconnect();
  process.exit(1);
});
