import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { AppError } from "../../lib/errors";
import { asyncHandler } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { requireAdmin } from "../auth/auth.middleware";
import { assertOrgWritable,requireOrgAccessForUser } from "../organizations/access";
import { readEmailSettings,saveEmailSettings,sendSettingsTestEmail,useEnvironmentEmailSettings } from "./email-settings.service";

export const emailSettingsRouter = Router();
emailSettingsRouter.use(requireAdmin);
emailSettingsRouter.use(asyncHandler(async (request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  const installation = await prisma.organization.findFirst({ select: { id: true } });
  if (!installation) throw new AppError(404, "email.installation_missing", "Set up the installation first.");
  await requireOrgAccessForUser(request.adminUser!.id, installation.id, ["OWNER", "ADMIN"]);
  if (request.method !== "GET") await assertOrgWritable(installation.id);
  next();
}));

emailSettingsRouter.get("/", asyncHandler(async (_request, response) => {
  response.json({ settings: await readEmailSettings() });
}));
emailSettingsRouter.put("/", asyncHandler(async (request, response) => {
  response.json({ settings: await saveEmailSettings(request.body) });
}));
emailSettingsRouter.delete("/", asyncHandler(async (request, response) => {
  const { revision } = z.object({ revision: z.string().uuid() }).strict().parse(request.body);
  response.json({ settings: await useEnvironmentEmailSettings(revision) });
}));
emailSettingsRouter.post("/test", rateLimit({
  windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: "email.test_rate_limited", message: "Too many test emails. Wait a minute before trying again." } },
}), asyncHandler(async (request, response) => {
  const { revision } = z.object({ revision: z.string().uuid().nullable() }).strict().parse(request.body);
  response.json(await sendSettingsTestEmail(request.adminUser!.email, revision));
}));
