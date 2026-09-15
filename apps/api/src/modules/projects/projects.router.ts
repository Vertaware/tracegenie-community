import { isFeatureMutationEnabled,projectSettingsDestinationSchema,widgetProjectConfigSchema } from "@tracegenie/shared";
import { Router } from "express";
import { z } from "zod";

import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { assertFeatureMutationEnabled } from "../../lib/feature-exposure";
import { asyncHandler,getSingleParam } from "../../lib/http";
import { prisma } from "../../lib/prisma";

import { requireAdmin } from "../auth/auth.middleware";
import { feedbackService } from "../feedback/feedback.service";
import { assertOrgWritable,getAccessibleProjectIds,requireOrgAccessForUser,requireProjectAccessForUser } from "../organizations/access";
import { projectService } from "./projects.service";

const router = Router();

const installTestReportSchema = z.object({
  origin: z.string().trim().url(),
});

const organizationScopeQuerySchema = z.object({
  organizationId: z.string().trim().min(1),
});

const INSTALL_TEST_SCREENSHOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

router.get(
  "/public/:projectKey/widget-config",
  asyncHandler(async (request, response) => {
    const config = await projectService.getPublicConfig(
      getSingleParam(request.params.projectKey),
      request.header("origin") ?? undefined,
    );
    response.json(config);
  }),
);

router.get(
  "/public/:projectKey/hosted-config",
  asyncHandler(async (request, response) => {
    response.json(await projectService.getHostedFeedbackConfig(
      getSingleParam(request.params.projectKey),
      request.header("origin") ?? undefined,
    ));
  }),
);

router.post(
  "/public/:projectKey/hosted-session",
  asyncHandler(async (request, response) => {
    response.json(await projectService.issueHostedFeedbackSession(
      getSingleParam(request.params.projectKey),
      request.body,
    ));
  }),
);

router.get(
  "/admin",
  requireAdmin,
  asyncHandler(async (request, response) => {
    response.json({ projects: await projectService.list(await getAccessibleProjectIds(request)) });
  }),
);

router.get(
  "/admin/:projectKey/install-diagnostics",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const projectKey = getSingleParam(request.params.projectKey);
    const project = await prisma.project.findUnique({
      where: { key: projectKey },
      select: { id: true },
    });
    if (project && request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireProjectAccessForUser(request.adminUser!.id, project.id, ["PROJECT_ADMIN"]);
    }

    const origin = typeof request.query.origin === "string" ? request.query.origin : undefined;
    response.json(await projectService.getInstallDiagnostics(projectKey, await getAccessibleProjectIds(request), origin));
  }),
);

router.post(
  "/admin/:projectKey/install-test-report",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const projectKey = getSingleParam(request.params.projectKey);
    const body = installTestReportSchema.parse(request.body);
    const project = await prisma.project.findUnique({
      where: { key: projectKey },
      select: { id: true, organizationId: true, name: true, defaultEnvironment: true, widgetConfig: true },
    });
    if (project) {
      await assertOrgWritable(project.organizationId);
      if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
        await requireProjectAccessForUser(request.adminUser!.id, project.id, ["PROJECT_ADMIN"]);
      }
    }

    const session = await projectService.issueAdminPreviewWidgetSession(projectKey, { origin: body.origin });
    const widgetConfig = widgetProjectConfigSchema.parse(project?.widgetConfig ?? {});
    const screenshotUpload = widgetConfig.allowScreenshot
      ? await feedbackService.uploadAttachment(
        {
          projectKey,
          fileName: "tracegenie-install-proof.png",
          mimeType: "image/png",
          byteSize: INSTALL_TEST_SCREENSHOT.length,
          width: 1,
          height: 1,
        },
        {
          originalname: "tracegenie-install-proof.png",
          mimetype: "image/png",
          size: INSTALL_TEST_SCREENSHOT.length,
          buffer: INSTALL_TEST_SCREENSHOT,
        } as Express.Multer.File,
        request.ip,
        body.origin,
        session.token,
      )
      : null;
    const submitted = await feedbackService.submitFeedback(
      {
        projectKey,
        title: "TraceGenie install test report",
        description: "This test report verifies the widget intake path from the product install checklist.",
        issueType: "bug",
        severity: "low",
        labels: ["bug"],
        route: {
          url: body.origin,
          routeName: "Install check",
          pageTitle: "TraceGenie install check",
        },
        release: {
          appName: project?.name ?? "TraceGenie install check",
          appEnvironment: project?.defaultEnvironment ?? "test",
          appVersion: "install-check",
        },
        browser: {
          userAgent: "TraceGenie install checker",
          language: "en-US",
          platform: "server",
          browserName: "TraceGenie",
          browserVersion: "install-check",
          osName: "server",
          osVersion: "install-check",
          viewportWidth: 1280,
          viewportHeight: 720,
        },
        clientTimestamp: new Date().toISOString(),
        consoleEntries: [],
        attachmentTokens: screenshotUpload?.uploadToken ? [screenshotUpload.uploadToken] : [],
        extraContext: {
          installProof: {
            source: "admin_install_check",
            simulatedOrigin: body.origin,
            screenshotUpload: Boolean(screenshotUpload),
          },
        },
      },
      body.origin,
      session.token,
    );

    response.status(201).json({
      feedback: submitted.feedback,
      installDiagnostics: await projectService.getInstallDiagnostics(projectKey, await getAccessibleProjectIds(request), body.origin),
    });
  }),
);

router.patch(
  "/admin/:projectKey/settings/:destination",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const projectKey = getSingleParam(request.params.projectKey);
    const destination = projectSettingsDestinationSchema.parse(getSingleParam(request.params.destination));
    const { organizationId } = organizationScopeQuerySchema.parse(request.query);
    const project = await prisma.project.findFirst({
      where: { key: projectKey, organizationId },
      select: { id: true, organizationId: true },
    });
    if (!project) {
      throw new AppError(404, "projects.not_found", "Project configuration was not found.");
    }
    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      await requireProjectAccessForUser(request.adminUser!.id, project.id, ["PROJECT_ADMIN"]);
    }
    await assertOrgWritable(project.organizationId);

    response.json(await projectService.patchSettings(projectKey, destination, request.body, {
      actorUserId: request.adminUser?.id ?? null,
      organizationId,
    }));
  }),
);

router.put(
  "/admin/:projectKey",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const projectKey = getSingleParam(request.params.projectKey);
    const existingProject = await prisma.project.findUnique({
      where: { key: projectKey },
      select: { id: true, organizationId: true },
    });

    if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
      if (existingProject) {
        await requireProjectAccessForUser(request.adminUser!.id, existingProject.id, ["PROJECT_ADMIN"]);
      } else {
        await requireOrgAccessForUser(request.adminUser!.id, request.body?.organizationId, ["OWNER", "ADMIN"]);
      }
    }
    await assertOrgWritable(existingProject?.organizationId ?? request.body?.organizationId);
    if (!existingProject) {
      
    }
    const result = await projectService.upsert(
      {
        ...request.body,
        key: projectKey,
        actorUserId: request.adminUser?.id,
      },
      {
        generateWidgetClientSecret: isFeatureMutationEnabled(
          "action.project_widget_secret.generate",
          env.featureKillSwitches,
        ),
      },
    );

    response.status(result.created ? 201 : 200).json({ project: result.project });
  }),
);

router.post(
  "/admin/:projectKey/widget-session",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const projectKey = getSingleParam(request.params.projectKey);
    const project = await prisma.project.findUnique({
      where: { key: projectKey },
      select: { id: true, organizationId: true },
    });
    if (project) {
      await assertOrgWritable(project.organizationId);
      if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
        await requireProjectAccessForUser(request.adminUser!.id, project.id, ["PROJECT_ADMIN"]);
      }
    }

    response.json(await projectService.issueAdminPreviewWidgetSession(projectKey, request.body));
  }),
);

router.post(
  "/admin/:projectKey/widget-secret/rotate",
  requireAdmin,
  asyncHandler(async (request, response) => {
    const projectKey = getSingleParam(request.params.projectKey);
    const project = await prisma.project.findUnique({
      where: { key: projectKey },
      select: { id: true, organizationId: true, widgetClientSecretHash: true },
    });
    if (project) {
      await assertOrgWritable(project.organizationId);
      if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
        await requireProjectAccessForUser(request.adminUser!.id, project.id, ["PROJECT_ADMIN"]);
      }
      assertFeatureMutationEnabled(
        project.widgetClientSecretHash
          ? "action.project_widget_secret.rotate"
          : "action.project_widget_secret.generate",
        env.featureKillSwitches,
      );
    }
    response.json(
      await projectService.rotateWidgetClientSecret(
        projectKey,
        await getAccessibleProjectIds(request),
        { actorUserId: request.adminUser?.id ?? null },
      ),
    );
  }),
);

router.post(
  "/server/:projectKey/widget-session",
  asyncHandler(async (request, response) => {
    response.json(
      await projectService.issueWidgetSession(
        getSingleParam(request.params.projectKey),
        request.body,
      ),
    );
  }),
);

export { router as projectsRouter };
