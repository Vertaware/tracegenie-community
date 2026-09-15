import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { widgetProjectConfigSchema } from "@tracegenie/shared";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/errors";
import { asyncHandler } from "../../lib/http";
import { authService } from "../auth/auth.service";
import { ADMIN_SESSION_COOKIE_NAME,buildAdminSessionCookieOptions } from "../auth/auth.session";

export const installationInputSchema = z.object({
  token: z.string().min(32).max(128),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(72).refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Use at most 72 bytes for the password."),
  projectName: z.string().trim().min(1).max(100),
}).strict();

export function validSetupToken(provided: string, expected: string | undefined) {
  if (!expected) return false;
  const digest = (value: string) => crypto.createHash("sha256").update(value).digest();
  return crypto.timingSafeEqual(digest(provided), digest(expected));
}

export const installationRouter = Router();
installationRouter.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
installationRouter.get("/status", asyncHandler(async (_request, response) => {
  const [organizations, users] = await Promise.all([prisma.organization.count(), prisma.adminUser.count()]);
  response.json({ required: Boolean(env.COMMUNITY_SETUP_TOKEN) && organizations === 0 && users === 0 });
}));
installationRouter.post("/complete", rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false }), asyncHandler(async (request, response) => {
  if (request.header("origin") !== new URL(env.ADMIN_APP_URL).origin) {
    throw new AppError(403, "setup.invalid_origin", "Open setup from this installation's address.");
  }
  const input = installationInputSchema.parse(request.body);
  if (!validSetupToken(input.token, env.COMMUNITY_SETUP_TOKEN)) {
    throw new AppError(403, "setup.invalid_token", "Enter the setup code shown by the installer.");
  }
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.$transaction(async (tx) => {
    // Serialize all first-run claims. Existing installations can never be claimed again.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(724193611)`;
    if (await tx.organization.count() || await tx.adminUser.count() || await tx.project.count()) {
      throw new AppError(409, "setup.complete", "Setup is already complete. Sign in with your administrator account.");
    }
    const organization = await tx.organization.create({ data: { name: input.projectName, slug: "community" } });
    const admin = await tx.adminUser.create({ data: { name: input.name, email: input.email, passwordHash, role: "ADMIN" } });
    const secret = crypto.randomBytes(32).toString("hex");
    const project = await tx.project.create({ data: {
      organizationId: organization.id, key: "community", name: input.projectName,
      defaultEnvironment: "production", allowedOrigins: [new URL(env.DEMO_APP_URL).origin],
      notificationEmails: [input.email],
      widgetClientSecretHash: crypto.createHash("sha256").update(secret).digest("hex"),
      widgetClientSecretRotatedAt: new Date(),
      widgetConfig: widgetProjectConfigSchema.parse({ surveyPrompt: { enabled: false } }),
    } });
    await tx.orgMembership.create({ data: { organizationId: organization.id, userId: admin.id, role: "OWNER" } });
    await tx.projectMembership.create({ data: { projectId: project.id, userId: admin.id, role: "PROJECT_ADMIN" } });
    return admin;
  });
  const session = await authService.createSession(user.id);
  response.cookie(ADMIN_SESSION_COOKIE_NAME, session.sessionToken, buildAdminSessionCookieOptions());
  response.status(201).json({ user: session.user });
}));
