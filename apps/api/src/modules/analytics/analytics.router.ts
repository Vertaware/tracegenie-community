import { Router } from "express";
import {
FEATURE_EXPOSURE_EVENT_TYPES,
featureExposureRegistry,
type FeatureId,
} from "@tracegenie/shared";
import { z } from "zod";

import { asyncHandler } from "../../lib/http";
import { requireAdmin } from "../auth/auth.middleware";
import { getAccessibleProjectIds,writePlatformAudit } from "../organizations/access";
import { analyticsService } from "./analytics.service";

const router = Router();

const featureIds = Object.keys(featureExposureRegistry) as [FeatureId, ...FeatureId[]];
const clientFeatureExposureEventTypes = FEATURE_EXPOSURE_EVENT_TYPES.filter(
  (eventType) => eventType !== "feature.kill_switch_rejected",
);
const featureExposureEventSchema = z.object({
  eventType: z.enum(clientFeatureExposureEventTypes),
  featureId: z.enum(featureIds),
  path: z.string()
    .trim()
    .min(1)
    .max(500)
    .regex(/^\/(?!\/)/, "Path must start with a single slash.")
    .transform((path) => path.split(/[?#]/, 1)[0] || "/"),
}).strict();

router.post(
  "/admin/analytics/feature-exposure-events",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const body = featureExposureEventSchema.parse(request.body);
    await writePlatformAudit({
      actorUserId: request.adminUser!.id,
      eventType: body.eventType,
      afterJson: {
        featureId: body.featureId,
        path: body.path,
      },
    });
    response.status(201).json({ recorded: true });
  }),
);

router.get(
  "/admin/analytics/summary",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const rawDays = typeof request.query.days === "string" ? Number.parseInt(request.query.days, 10) : undefined;
    response.json(await analyticsService.getSummary(await getAccessibleProjectIds(request), { days: rawDays }));
  }),
);

router.get(
  "/admin/analytics/internal-digest",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const rawDays = typeof request.query.days === "string" ? Number.parseInt(request.query.days, 10) : undefined;
    response.json(await analyticsService.getInternalDigest(await getAccessibleProjectIds(request), { days: rawDays }));
  }),
);

router.get(
  "/admin/analytics/releases",
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json(await analyticsService.getReleases(await getAccessibleProjectIds(request)));
  }),
);

router.get(
  "/admin/analytics/releases/:releaseId",
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json(await analyticsService.getReleaseDetail(
      Array.isArray(request.params.releaseId) ? request.params.releaseId[0] ?? "" : request.params.releaseId,
      await getAccessibleProjectIds(request),
    ));
  }),
);

export { router as analyticsRouter };
