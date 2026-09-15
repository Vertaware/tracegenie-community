import fs from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import pinoHttp from "pino-http";
import { ZodError } from "zod";

import { env } from "./config/env";
import { AppError,isAppError } from "./lib/errors";
import { asyncHandler } from "./lib/http";
import { assertFeedbackIdempotencyIndexesReady } from "./lib/idempotency-indexes";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";

import { analyticsRouter } from "./modules/analytics/analytics.router";

import { emailSettingsRouter } from "./modules/email/email-settings.router";

import { installationRouter } from "./modules/installation/installation.router";

import { authRouter } from "./modules/auth/auth.router";

import { feedbackRouter } from "./modules/feedback/feedback.router";

import { organizationsRouter } from "./modules/organizations/organizations.router";

import { projectsRouter } from "./modules/projects/projects.router";
import { reporterRouter } from "./modules/reporter/reporter.router";

import { usersRouter } from "./modules/admin/users.router";
import { storageService } from "./modules/storage/storage.service";

function isZodLikeError(error: unknown): error is ZodError {
  return (
    error instanceof ZodError ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "ZodError" &&
      "flatten" in error &&
      typeof (error as { flatten?: unknown }).flatten === "function")
  );
}

export function requestLogProperties(request: Pick<express.Request, "ip">) {
  return { clientIp: request.ip };
}

export async function createApp() {
  await fs.mkdir(path.resolve(env.STORAGE_LOCAL_ROOT), { recursive: true });

  const app = express();
  const restrictedCors = cors({
    origin: (origin, callback) => {
      if (!origin || env.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new AppError(403, "cors.origin_denied", "Origin is not allowed."));
    },
    credentials: true,
  });
  const publicCors = cors({ origin: true });

  app.set("trust proxy", env.TRUST_PROXY_HOPS);
  app.use(
    pinoHttp({
      logger,
      customProps: (request) => requestLogProperties(request as express.Request),
      redact: [
        "req.body.credential",
        "req.body.token",
        "req.body.password",
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.stripe-signature",
        "req.headers.x-tracegenie-client-secret",
        "req.headers.x-tracegenie-widget-session",
      ],
    }),
  );
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: env.SERVE_WEB ? { directives: { "upgrade-insecure-requests": new URL(env.ADMIN_APP_URL).protocol === "https:" ? [] : null, "img-src": ["'self'", "data:", "blob:"], "script-src": ["'self'"] } } : undefined,
    }),
  );
  app.use(
    ((request, response, next) => {
      if (request.path.startsWith("/api/public") || request.path.startsWith("/api/projects/public") || request.path.startsWith("/widget")) {
        publicCors(request, response, next);
        return;
      }

      restrictedCors(request, response, next);
    }) as express.RequestHandler,
  );
  
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use(
    "/api/public",
    rateLimit({
      windowMs: 60_000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    "/api/auth/login",
    rateLimit({
      windowMs: 60_000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    "/api/auth/signup",
    rateLimit({
      windowMs: 60_000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    "/api/auth/password-reset",
    rateLimit({
      windowMs: 60_000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    "/api/reporter/otp",
    rateLimit({
      windowMs: 60_000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    "/api/projects/public",
    rateLimit({
      windowMs: 60_000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    "/api/projects/server",
    rateLimit({
      windowMs: 60_000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    "/api/orgs/invites/context",
    rateLimit({
      windowMs: 60_000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    "/api/orgs/invites/accept",
    rateLimit({
      windowMs: 60_000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    "/api/admin",
    rateLimit({
      windowMs: 60_000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "tracegenie-feedback-api" });
  });

  app.get("/ready", asyncHandler(async (_request, response) => {
    await prisma.$queryRaw`SELECT 1`;
    await assertFeedbackIdempotencyIndexesReady();
    await storageService.checkReadiness();
    response.json({ status: "ready" });
  }));

  // ── Serve the standalone widget embed script ──
  // GET /widget/embed.js — publicly accessible, CDN-friendly caching
  app.get("/widget/embed.js", publicCors, (_request, response) => {
    const widgetDistPath = path.resolve(__dirname, "../../../packages/widget/dist/embed.js");
    response.setHeader("Content-Type", "application/javascript; charset=utf-8");
    response.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.sendFile(widgetDistPath, (error) => {
      if (error) {
        logger.warn({ error }, "Widget embed.js not found");
        response.status(404).json({ error: { code: "widget.not_found", message: "Widget script not available." } });
      }
    });
  });

  app.use("/api/installation", installationRouter);
  app.use("/api/auth", authRouter);
  
  app.use("/api/orgs", organizationsRouter);
  
  app.use("/api/reporter", reporterRouter);
  app.use("/api/admin/users", usersRouter);
  app.use("/api/admin/settings/email", emailSettingsRouter);
  app.use("/api/projects", projectsRouter);
  
  app.use("/api", feedbackRouter);

  app.use("/api", analyticsRouter);

  if (env.SERVE_WEB) {
    const adminDist = path.resolve(__dirname, "../../admin/dist");
    const demoDist = path.resolve(__dirname, "../../demo/dist");
    const webOptions = { index: false, setHeaders: (res: express.Response, file: string) => {
      res.setHeader("Cache-Control", file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
    } };
    app.use("/feedback", express.static(demoDist, webOptions));
    app.use(express.static(adminDist, webOptions));
    app.get(/^(?!\/(?:api|widget|assets)(?:\/|$)).*/, (request, response, next) => {
      if (path.extname(request.path) || !request.accepts("html")) return next();
      response.setHeader("Cache-Control", "no-store");
      response.sendFile(path.join(/^\/feedback(?:\/|$)/.test(request.path) ? demoDist : adminDist, "index.html"));
    });
  }

  app.use((_request, _response, next) => {
    next(new AppError(404, "http.not_found", "Route not found."));
  });

  app.use(async (error: unknown, request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (isZodLikeError(error)) {
      const details = typeof error.flatten === "function" ? error.flatten() : { message: error.message };
      response.status(400).json({
        error: {
          code: "validation.invalid_request",
          message: "The request payload failed validation.",
          details,
        },
      });
      return;
    }

    if (error instanceof multer.MulterError) {
      const statusCode = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      const code = error.code === "LIMIT_FILE_SIZE" ? "uploads.file_too_large" : "uploads.invalid_upload";
      const message = error.code === "LIMIT_FILE_SIZE"
        ? `Uploaded file exceeds max size of ${env.MAX_UPLOAD_BYTES} bytes.`
        : "The uploaded file payload is invalid.";
      response.status(statusCode).json({
        error: {
          code,
          message,
        },
      });
      return;
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "type" in error &&
      (error as { type?: unknown }).type === "entity.parse.failed"
    ) {
      response.status(400).json({
        error: {
          code: "validation.invalid_json",
          message: "The request body contains invalid JSON.",
        },
      });
      return;
    }

    if (
      typeof error === "object" &&
      error !== null &&
      (
        ("type" in error && (error as { type?: unknown }).type === "entity.too.large") ||
        ("status" in error && (error as { status?: unknown }).status === 413)
      )
    ) {
      response.status(413).json({
        error: {
          code: "http.payload_too_large",
          message: "The request payload exceeds the allowed size limit.",
        },
      });
      return;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        response.status(409).json({
          error: {
            code: "db.unique_conflict",
            message: "A record with the same unique value already exists.",
          },
        });
        return;
      }
      if (error.code === "P2003") {
        response.status(422).json({
          error: {
            code: "db.invalid_reference",
            message: "The request references a related record that does not exist.",
          },
        });
        return;
      }
      if (error.code === "P2025") {
        response.status(404).json({
          error: {
            code: "db.record_not_found",
            message: "The requested record was not found.",
          },
        });
        return;
      }
    }

    if (isAppError(error)) {
      

      response.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
      return;
    }

    logger.error({ error }, "Unexpected API error");
    response.status(500).json({
      error: {
        code: "internal.unexpected_error",
        message: "An unexpected error occurred.",
      },
    });
  });

  return app;
}
