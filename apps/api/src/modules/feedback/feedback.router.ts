import { AuditActorType } from "@prisma/client";
import type { Request } from "express";
import { Router } from "express";
import multer from "multer";

import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { asyncHandler,getSingleParam } from "../../lib/http";
import { prisma } from "../../lib/prisma";

import { requireAdmin } from "../auth/auth.middleware";
import { assertOrgWritable,getAccessibleProjectIds,getWritableProjectIds,requireOrgAccessForUser } from "../organizations/access";
import { projectService } from "../projects/projects.service";
import { feedbackAuditService } from "./feedback-audit.service";
import { feedbackNotificationService } from "./feedback-notification.service";
import { feedbackService } from "./feedback.service";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_BYTES,
  },
});

async function assertFeedbackWritable(feedbackId: string) {
  const feedback = await prisma.feedbackItem.findUnique({
    where: { id: feedbackId },
    select: { organizationId: true },
  });
  if (feedback) {
    await assertOrgWritable(feedback.organizationId);
  }
  return feedback?.organizationId;
}

function getOrganizationId(input: unknown) {
  if (typeof input === "string" && input.trim()) {
    return input.trim();
  }

  throw new AppError(422, "saved_views.organization_required", "An organization is required for saved views.");
}

async function assertSavedViewOrgAccess(request: Request, organizationId: string) {
  if (!request.adminUser) {
    throw new AppError(401, "auth.missing_token", "Admin authentication is required.");
  }
  await requireOrgAccessForUser(request.adminUser.id, organizationId);
}

router.post(
  "/public/uploads",
  upload.single("file"),
  asyncHandler(async (request, response) => {
    const origin = request.header("origin") ?? undefined;
    const widgetSessionToken = request.header("x-tracegenie-widget-session") ?? undefined;
    const result = await feedbackService.uploadAttachment(
      {
        ...request.body,
        byteSize: request.file?.size,
        mimeType: request.file?.mimetype,
        fileName: request.file?.originalname,
      },
      request.file!,
      request.ip,
      origin,
      widgetSessionToken,
    );
    response.status(201).json(result);
  }),
);

router.post(
  "/public/feedback",
  asyncHandler(async (request, response) => {
    const projectKey = typeof request.body?.projectKey === "string" ? request.body.projectKey.trim() : "";
    const origin = request.header("origin") ?? undefined;
    const widgetSessionToken = request.header("x-tracegenie-widget-session") ?? undefined;
    await projectService.verifyWidgetSessionContext(projectKey, widgetSessionToken, origin);

    const result = await feedbackService.submitFeedback(
      request.body,
      origin,
      widgetSessionToken,
    );
    response.status(201).json(result);
  }),
);

router.get(
  "/admin/feedback",
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json(await feedbackService.listFeedback(request.query, await getAccessibleProjectIds(request)));
  }),
);

router.get(
  "/admin/feedback/customer-attribution",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const page = typeof request.query.page === "string" ? Number.parseInt(request.query.page, 10) : undefined;
    const pageSize = typeof request.query.pageSize === "string" ? Number.parseInt(request.query.pageSize, 10) : undefined;
    response.json(await feedbackService.getCustomerAttribution(
      await getAccessibleProjectIds(request),
      { page, pageSize },
    ));
  }),
);

router.get(
  "/admin/feedback/customer-attribution/accounts/:accountKey",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const page = typeof request.query.page === "string" ? Number.parseInt(request.query.page, 10) : undefined;
    const pageSize = typeof request.query.pageSize === "string" ? Number.parseInt(request.query.pageSize, 10) : undefined;
    response.json(await feedbackService.getCustomerAccountDetail(
      getSingleParam(request.params.accountKey),
      await getAccessibleProjectIds(request),
      { page, pageSize },
    ));
  }),
);

router.patch(
  "/admin/feedback/customer-attribution/:feedbackId",
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json(await feedbackService.repairCustomerAttribution(
      getSingleParam(request.params.feedbackId),
      request.body,
      request.adminUser?.id,
      await getWritableProjectIds(request),
    ));
  }),
);

router.get(
  "/admin/feedback/saved-views",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const organizationId = getOrganizationId(request.query.organizationId);
    await assertSavedViewOrgAccess(request, organizationId);
    response.json(await feedbackService.listSavedIssueViews(organizationId, request.adminUser!.id));
  }),
);

router.post(
  "/admin/feedback/saved-views",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const organizationId = getOrganizationId(request.body?.organizationId);
    await assertSavedViewOrgAccess(request, organizationId);
    response.status(201).json(await feedbackService.createSavedIssueView(request.body, request.adminUser!.id));
  }),
);

router.delete(
  "/admin/feedback/saved-views/:viewId",
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json(await feedbackService.deleteSavedIssueView(
      getSingleParam(request.params.viewId),
      request.adminUser!.id,
    ));
  }),
);

router.get(
  "/admin/attachments/:attachmentId",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const attachment = await feedbackService.getAttachmentContent(
      getSingleParam(request.params.attachmentId),
      await getAccessibleProjectIds(request),
    );
    if (attachment.feedbackItemId) {
      await feedbackAuditService.createEvent({
        feedbackItemId: attachment.feedbackItemId,
        projectId: attachment.projectId,
        actorType: AuditActorType.ADMIN_USER,
        adminUserId: request.adminUser?.id ?? null,
        eventType: "ADMIN_ATTACHMENT_READ",
        afterJson: {
          attachmentId: attachment.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          byteSize: attachment.byteSize,
        },
        requestId: request.header("x-request-id") ?? null,
      });
    }
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", attachment.mimeType);
    response.setHeader("Content-Length", String(attachment.byteSize));
    response.setHeader("Content-Disposition", `${attachment.mimeType.startsWith("image/") ? "inline" : "attachment"}; filename="${attachment.fileName.replace(/"/g, "")}"`);
    response.send(attachment.buffer);
  }),
);

router.get(
  "/admin/feedback/:feedbackId/conversation",
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json(await feedbackService.getFeedbackConversation(
      getSingleParam(request.params.feedbackId),
      await getAccessibleProjectIds(request),
      {
        cursor: typeof request.query.cursor === "string" ? request.query.cursor : undefined,
        pageSize: typeof request.query.pageSize === "string" ? Number(request.query.pageSize) : undefined,
      },
    ));
  }),
);

router.get(
  "/admin/feedback/:feedbackId/activity",
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json(await feedbackService.getFeedbackActivity(
      getSingleParam(request.params.feedbackId),
      await getAccessibleProjectIds(request),
      {
        page: typeof request.query.page === "string" ? Number(request.query.page) : undefined,
        pageSize: typeof request.query.pageSize === "string" ? Number(request.query.pageSize) : undefined,
      },
    ));
  }),
);

router.get(
  "/admin/feedback/:feedbackId",
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json(await feedbackService.getFeedback(
      getSingleParam(request.params.feedbackId),
      await getAccessibleProjectIds(request),
    ));
  }),
);

router.post(
  "/admin/feedback/:feedbackId/evidence-gate/override",
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json(await feedbackService.overrideEvidenceGate(
      getSingleParam(request.params.feedbackId),
      request.body,
      request.adminUser?.id,
      await getWritableProjectIds(request),
    ));
  }),
);

router.post(
  "/admin/feedback/notifications/:notificationId/replay",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const notification = await feedbackNotificationService.replayNotification(
      getSingleParam(request.params.notificationId),
      await getWritableProjectIds(request),
      request.adminUser?.id,
      request.header("x-request-id") ?? null,
    );

    response.json({
      notification: {
        id: notification.id,
        status: notification.status.toLowerCase(),
      },
    });
  }),
);

router.patch(
  "/admin/feedback/bulk/status",
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json(
      await feedbackService.bulkUpdateFeedbackStatus(
        request.body,
        request.adminUser?.id,
        await getWritableProjectIds(request),
      ),
    );
  }),
);

router.patch(
  "/admin/feedback/bulk",
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json(
      await feedbackService.bulkUpdateFeedback(
        request.body,
        request.adminUser?.id,
        await getWritableProjectIds(request),
      ),
    );
  }),
);

router.patch(
  "/admin/feedback/:feedbackId",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const feedbackId = getSingleParam(request.params.feedbackId);
    response.json(
      await feedbackService.updateFeedback(
        feedbackId,
        request.body,
        request.adminUser?.id,
        await getWritableProjectIds(request),
      ),
    );
  }),
);

router.patch(
  "/admin/feedback/:feedbackId/status",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const feedbackId = getSingleParam(request.params.feedbackId);
    await assertFeedbackWritable(feedbackId);
    
    response.json(
      await feedbackService.updateFeedback(
        feedbackId,
        {
          status: request.body?.status,
          publicSummary: request.body?.publicSummary,
          notifyRequester: request.body?.notifyRequester,
          statusNote: request.body?.statusNote,
          expectedUpdatedAt: request.body?.expectedUpdatedAt,
        },
        request.adminUser?.id,
        await getWritableProjectIds(request),
      ),
    );
  }),
);

router.patch(
  "/admin/feedback/:feedbackId/owner",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const feedbackId = getSingleParam(request.params.feedbackId);
    response.json(
      await feedbackService.updateFeedback(
        feedbackId,
        { ownerId: request.body?.ownerId ?? null },
        request.adminUser?.id,
        await getWritableProjectIds(request),
      ),
    );
  }),
);

router.patch(
  "/admin/feedback/:feedbackId/labels",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const feedbackId = getSingleParam(request.params.feedbackId);
    response.json(
      await feedbackService.updateFeedback(
        feedbackId,
        { labels: request.body?.labels ?? [] },
        request.adminUser?.id,
        await getWritableProjectIds(request),
      ),
    );
  }),
);

router.post(
  "/admin/feedback/:feedbackId/comments",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const feedbackId = getSingleParam(request.params.feedbackId);
    await assertFeedbackWritable(feedbackId);
    response.status(201).json(
      await feedbackService.addComment(
        feedbackId,
        request.body,
        request.adminUser?.id,
        await getWritableProjectIds(request),
      ),
    );
  }),
);

router.post(
  "/admin/feedback/:feedbackId/subscribers",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const feedbackId = getSingleParam(request.params.feedbackId);
    await assertFeedbackWritable(feedbackId);
    response.status(201).json(
      await feedbackService.addSubscriber(
        feedbackId,
        request.body,
        request.adminUser?.id,
        await getWritableProjectIds(request),
      ),
    );
  }),
);

router.patch(
  "/admin/feedback/:feedbackId/subscribers/:subscriberId",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const feedbackId = getSingleParam(request.params.feedbackId);
    await assertFeedbackWritable(feedbackId);
    response.json(
      await feedbackService.updateSubscriber(
        feedbackId,
        getSingleParam(request.params.subscriberId),
        request.body,
        request.adminUser?.id,
        await getWritableProjectIds(request),
      ),
    );
  }),
);

router.delete(
  "/admin/feedback/:feedbackId/subscribers/:subscriberId",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const feedbackId = getSingleParam(request.params.feedbackId);
    await assertFeedbackWritable(feedbackId);
    response.json(
      await feedbackService.removeSubscriber(
        feedbackId,
        getSingleParam(request.params.subscriberId),
        request.adminUser?.id,
        await getWritableProjectIds(request),
      ),
    );
  }),
);

export { router as feedbackRouter };
