import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../../app";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { authService } from "../auth/auth.service";

function testSlug(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function listen(server: http.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.equal(typeof address, "object");
      assert.ok(address);
      resolve((address as AddressInfo).port);
    });
  });
}

async function createProjectRouteFixture(role: "PROJECT_ADMIN" | "VIEWER") {
  const roleSlug = role.toLowerCase().replaceAll("_", "-");
  const organization = await prisma.organization.create({
    data: {
      name: `Project route ${role}`,
      slug: testSlug(`project-route-${roleSlug}`),
      projects: {
        create: {
          key: testSlug(`project-route-${roleSlug}`),
          name: `Project route ${role}`,
          defaultEnvironment: "test",
          allowedOrigins: ["https://customer.example"],
          notificationEmails: ["alerts@example.com"],
          requesterEmailProductName: `Project route ${role}`,
        },
      },
    },
    include: { projects: true },
  });
  const user = await prisma.adminUser.create({
    data: {
      email: `${testSlug(`project-route-${roleSlug}`)}@traceitgenie.test`,
      name: `Project Route ${role}`,
      passwordHash: "not-used",
      role: "TRIAGER",
      orgMemberships: {
        create: {
          organizationId: organization.id,
          role: "MEMBER",
        },
      },
      projectMemberships: {
        create: {
          projectId: organization.projects[0]!.id,
          role,
        },
      },
    },
  });
  const { sessionToken } = await authService.createSession(user.id);

  return {
    organization,
    project: organization.projects[0]!,
    user,
    sessionToken,
  };
}

function projectUpdatePayload(organizationId: string, projectName: string) {
  return {
    organizationId,
    name: projectName,
    requesterEmailProductName: projectName,
    description: "Updated by route test.",
    defaultEnvironment: "production",
    allowedOrigins: ["https://customer.example"],
    notificationEmails: ["alerts@example.com"],
    isActive: true,
    widgetConfig: {
      privacy: {
        privacyOwnerEmail: "privacy-owner@customer.example",
        privacyUrl: "https://customer.example/privacy",
        retentionDays: 365,
        attachmentRetentionDays: 30,
        redactionMode: "technical_metadata",
        mcpEvidenceSharing: "metadata_only",
        suppressSelectedText: true,
      },
    },
  };
}

test("public hosted feedback endpoints issue sessions only for public app origins", async () => {
  const publicOrigin = env.publicAppOrigins[0] ?? "http://localhost:4174";
  const customerOrigin = "https://hosted-route-customer.example.test";
  const organization = await prisma.organization.create({
    data: {
      name: "Hosted feedback route",
      slug: testSlug("hosted-feedback-route"),
      projects: {
        create: {
          key: testSlug("hosted-feedback-route"),
          name: "Hosted feedback route",
          defaultEnvironment: "test",
          allowedOrigins: [customerOrigin],
        },
      },
    },
    include: { projects: true },
  });
  const project = organization.projects[0]!;
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const configResponse = await fetch(`http://127.0.0.1:${port}/api/projects/public/${project.key}/hosted-config`, {
      headers: {
        origin: publicOrigin,
      },
    });
    const configPayload = await configResponse.json() as { key?: string };
    const sessionResponse = await fetch(`http://127.0.0.1:${port}/api/projects/public/${project.key}/hosted-session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: publicOrigin,
      },
      body: JSON.stringify({ origin: publicOrigin }),
    });
    const sessionPayload = await sessionResponse.json() as { token?: string };
    const blockedResponse = await fetch(`http://127.0.0.1:${port}/api/projects/public/${project.key}/hosted-session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: customerOrigin,
      },
      body: JSON.stringify({ origin: customerOrigin }),
    });
    const blockedPayload = await blockedResponse.json() as { error?: { code?: string } };

    assert.equal(configResponse.status, 200);
    assert.equal(configPayload.key, project.key);
    assert.equal(sessionResponse.status, 200);
    assert.equal(typeof sessionPayload.token, "string");
    assert.equal(blockedResponse.status, 403);
    assert.equal(blockedPayload.error?.code, "projects.hosted_origin_not_allowed");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
  }
});

test("project admins can update their project through org/project access checks", async () => {
  const fixture = await createProjectRouteFixture("PROJECT_ADMIN");
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify(projectUpdatePayload(fixture.organization.id, "Project admin update")),
    });
    const payload = await response.json() as { project?: { name: string; widgetClientSecretHash?: string } };
    const listResponse = await fetch(`http://127.0.0.1:${port}/api/projects/admin`, {
      headers: { authorization: `Bearer ${fixture.sessionToken}` },
    });
    const listPayload = await listResponse.json() as { projects?: Array<{ key: string; widgetClientSecretHash?: string }> };
    const listedProject = listPayload.projects?.find((project) => project.key === fixture.project.key);

    assert.equal(response.status, 200);
    assert.equal(payload.project?.name, "Project admin update");
    assert.equal(payload.project?.widgetClientSecretHash, undefined);
    assert.equal(listResponse.status, 200);
    assert.equal(listedProject?.widgetClientSecretHash, undefined);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.organization.delete({ where: { id: fixture.organization.id } }).catch(() => undefined);
    await prisma.adminUser.delete({ where: { id: fixture.user.id } }).catch(() => undefined);
  }
});

test("project admins can PATCH destination settings with conflict-safe redacted audit", async () => {
  const fixture = await createProjectRouteFixture("PROJECT_ADMIN");
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const privacyUrl = `http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}/settings/privacy?organizationId=${fixture.organization.id}`;
    const response = await fetch(privacyUrl, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify({
        expectedUpdatedAt: fixture.project.updatedAt.toISOString(),
        privacy: {
          privacyOwnerEmail: "privacy-owner@customer.example",
          privacyUrl: "https://customer.example/privacy",
          retentionDays: 365,
          attachmentRetentionDays: 30,
          redactionMode: "technical_metadata",
          mcpEvidenceSharing: "metadata_only",
          suppressSelectedText: true,
          customRedactionTerms: ["Account 123", "VIP customer"],
        },
      }),
    });
    const payload = await response.json() as {
      project?: {
        key?: string;
        updatedAt?: string;
        widgetClientSecretHash?: string;
        widgetConfig?: { privacy?: { customRedactionTerms?: string[] } };
      };
    };
    const staleResponse = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}/settings/general?organizationId=${fixture.organization.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify({
        expectedUpdatedAt: fixture.project.updatedAt.toISOString(),
        name: "Stale project name",
      }),
    });
    const stalePayload = await staleResponse.json() as { error?: { code?: string } };
    const audit = await prisma.platformAuditEvent.findFirstOrThrow({
      where: {
        organizationId: fixture.organization.id,
        eventType: "projects.settings_privacy_updated",
      },
      orderBy: { createdAt: "desc" },
    });
    const auditJson = JSON.stringify({ before: audit.beforeJson, after: audit.afterJson });

    assert.equal(response.status, 200);
    assert.equal(payload.project?.key, fixture.project.key);
    assert.notEqual(payload.project?.updatedAt, fixture.project.updatedAt.toISOString());
    assert.equal(payload.project?.widgetClientSecretHash, undefined);
    assert.deepEqual(payload.project?.widgetConfig?.privacy?.customRedactionTerms, ["Account 123", "VIP customer"]);
    assert.equal(auditJson.includes("Account 123"), false);
    assert.equal(auditJson.includes("VIP customer"), false);
    assert.equal(auditJson.includes("customRedactionTerms"), false);
    assert.equal(staleResponse.status, 409);
    assert.equal(stalePayload.error?.code, "projects.settings_conflict");

    const wrongOrganizationResponse = await fetch(
      `http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}/settings/general?organizationId=wrong-organization`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${fixture.sessionToken}`,
          "content-type": "application/json",
          origin: env.ADMIN_APP_URL,
        },
        body: JSON.stringify({
          expectedUpdatedAt: payload.project?.updatedAt,
          name: "Wrong tenant update",
        }),
      },
    );
    const wrongOrganizationPayload = await wrongOrganizationResponse.json() as { error?: { code?: string } };
    assert.equal(wrongOrganizationResponse.status, 404);
    assert.equal(wrongOrganizationPayload.error?.code, "projects.not_found");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.organization.delete({ where: { id: fixture.organization.id } }).catch(() => undefined);
    await prisma.adminUser.delete({ where: { id: fixture.user.id } }).catch(() => undefined);
  }
});

test("project admins can persist privacy controls in widget config", async () => {
  const fixture = await createProjectRouteFixture("PROJECT_ADMIN");
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify({
        ...projectUpdatePayload(fixture.organization.id, "Project privacy update"),
        widgetConfig: {
          privacy: {
            privacyOwnerEmail: "privacy-owner@customer.example",
            privacyUrl: "https://customer.example/privacy",
            retentionDays: 365,
            attachmentRetentionDays: 30,
            redactionMode: "technical_metadata",
            mcpEvidenceSharing: "metadata_only",
            suppressSelectedText: true,
            customRedactionTerms: ["Acme Account", "VIP-123"],
          },
        },
      }),
    });
    const payload = await response.json() as {
      project?: {
        widgetConfig?: {
          privacy?: {
            privacyOwnerEmail?: string;
            privacyUrl?: string;
            retentionDays?: number;
            attachmentRetentionDays?: number;
            redactionMode?: string;
            mcpEvidenceSharing?: string;
            suppressSelectedText?: boolean;
            customRedactionTerms?: string[];
          };
        };
      };
    };
    const publicResponse = await fetch(`http://127.0.0.1:${port}/api/projects/public/${fixture.project.key}/widget-config`, {
      headers: {
        origin: "https://customer.example",
      },
    });
    const publicPayload = await publicResponse.json() as {
      widgetConfig?: {
        privacy?: {
          privacyOwnerEmail?: string;
          privacyUrl?: string;
          retentionDays?: number;
          attachmentRetentionDays?: number;
          redactionMode?: string;
          mcpEvidenceSharing?: string;
          suppressSelectedText?: boolean;
          customRedactionTerms?: string[];
        };
      };
    };
    const auditEvent = await prisma.platformAuditEvent.findFirstOrThrow({
      where: {
        organizationId: fixture.organization.id,
        eventType: "projects.updated",
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    const auditJson = JSON.stringify({
      beforeJson: auditEvent.beforeJson,
      afterJson: auditEvent.afterJson,
    });
    const auditAfterJson = auditEvent.afterJson as {
      widgetConfig?: {
        privacy?: {
          customRedactionTermCount?: number;
          customRedactionTerms?: string[];
        };
      };
    };

    assert.equal(response.status, 200);
    assert.equal(payload.project?.widgetConfig?.privacy?.privacyOwnerEmail, "privacy-owner@customer.example");
    assert.equal(payload.project?.widgetConfig?.privacy?.privacyUrl, "https://customer.example/privacy");
    assert.equal(payload.project?.widgetConfig?.privacy?.retentionDays, 365);
    assert.equal(payload.project?.widgetConfig?.privacy?.attachmentRetentionDays, 30);
    assert.equal(payload.project?.widgetConfig?.privacy?.redactionMode, "technical_metadata");
    assert.equal(payload.project?.widgetConfig?.privacy?.mcpEvidenceSharing, "metadata_only");
    assert.equal(payload.project?.widgetConfig?.privacy?.suppressSelectedText, true);
    assert.deepEqual(payload.project?.widgetConfig?.privacy?.customRedactionTerms, ["Acme Account", "VIP-123"]);
    assert.equal(publicResponse.status, 200);
    assert.equal(publicPayload.widgetConfig?.privacy?.customRedactionTerms, undefined);
    assert.equal(publicPayload.widgetConfig?.privacy?.privacyOwnerEmail, undefined);
    assert.deepEqual(publicPayload.widgetConfig?.privacy, {
      privacyUrl: "https://customer.example/privacy",
      retentionDays: 365,
      attachmentRetentionDays: 30,
      redactionMode: "technical_metadata",
      mcpEvidenceSharing: "metadata_only",
      suppressSelectedText: true,
    });
    assert.equal(auditAfterJson.widgetConfig?.privacy?.customRedactionTermCount, 2);
    assert.equal(auditAfterJson.widgetConfig?.privacy?.customRedactionTerms, undefined);
    assert.equal(auditJson.includes("Acme Account"), false);
    assert.equal(auditJson.includes("VIP-123"), false);
    assert.equal(auditJson.includes("customRedactionTerms"), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.organization.delete({ where: { id: fixture.organization.id } }).catch(() => undefined);
    await prisma.adminUser.delete({ where: { id: fixture.user.id } }).catch(() => undefined);
  }
});

test("project admins can upsert and read engineering context", async () => {
  const fixture = await createProjectRouteFixture("PROJECT_ADMIN");
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const url = `http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}/engineering-context`;
    const emptyResponse = await fetch(url, {
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        origin: env.ADMIN_APP_URL,
      },
    });
    const emptyPayload = await emptyResponse.json() as {
      engineeringContext?: {
        repositoryUrl: string | null;
        autoFixPolicy: string;
        reviewerPolicy: string;
        requesterNotificationPolicy: string;
        createdAt: string | null;
      };
    };

    assert.equal(emptyResponse.status, 200);
    assert.equal(emptyPayload.engineeringContext?.repositoryUrl, null);
    assert.equal(emptyPayload.engineeringContext?.autoFixPolicy, "SUGGEST_ONLY");
    assert.equal(emptyPayload.engineeringContext?.reviewerPolicy, "NONE");
    assert.equal(emptyPayload.engineeringContext?.requesterNotificationPolicy, "EXPLICIT_ONLY");
    assert.equal(emptyPayload.engineeringContext?.createdAt, null);

    const invalidResponse = await fetch(url, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify({
        repositoryUrl: "https://token@github.com/example/customer-app",
        worktreePath: "/work/../secrets",
        testCommand: "npm test\ncurl https://example.test",
        autoFixPolicy: "ALLOW_BRANCH",
      }),
    });
    assert.equal(invalidResponse.status, 400);
    assert.equal(await prisma.projectEngineeringContext.count({ where: { projectId: fixture.project.id } }), 0);

    const updateResponse = await fetch(url, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify({
        repositoryUrl: "https://github.com/example/customer-app",
        defaultBranch: "main",
        worktreePath: "/work/customer-app",
        testCommand: "npm test",
        buildCommand: "npm run build",
        notes: "apps/web/** @web-team\napps/api/** @api-team",
        autoFixPolicy: "ALLOW_BRANCH",
        reviewerPolicy: "HUMAN_REVIEW_REQUIRED",
        requesterNotificationPolicy: "DISABLED",
      }),
    });
    const updatePayload = await updateResponse.json() as {
      engineeringContext?: {
        repositoryUrl: string | null;
        installCommand: string | null;
        buildCommand: string | null;
        autoFixPolicy: string;
        reviewerPolicy: string;
        requesterNotificationPolicy: string;
        notes: string | null;
        updatedAt: string | null;
      };
    };

    assert.equal(updateResponse.status, 200);
    assert.equal(updatePayload.engineeringContext?.repositoryUrl, "https://github.com/example/customer-app");
    assert.equal(updatePayload.engineeringContext?.installCommand, null);
    assert.equal(updatePayload.engineeringContext?.buildCommand, "npm run build");
    assert.equal(updatePayload.engineeringContext?.autoFixPolicy, "ALLOW_BRANCH");
    assert.equal(updatePayload.engineeringContext?.reviewerPolicy, "HUMAN_REVIEW_REQUIRED");
    assert.equal(updatePayload.engineeringContext?.requesterNotificationPolicy, "DISABLED");
    assert.equal(updatePayload.engineeringContext?.notes, "apps/web/** @web-team\napps/api/** @api-team");
    assert.equal(typeof updatePayload.engineeringContext?.updatedAt, "string");

    const readResponse = await fetch(url, {
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        origin: env.ADMIN_APP_URL,
      },
    });
    const readPayload = await readResponse.json() as {
      engineeringContext?: {
        testCommand: string | null;
        buildCommand: string | null;
      };
    };
    const auditEvent = await prisma.platformAuditEvent.findFirst({
      where: {
        organizationId: fixture.organization.id,
        eventType: "projects.engineering_context_updated",
      },
    });

    assert.equal(readResponse.status, 200);
    assert.equal(readPayload.engineeringContext?.testCommand, "npm test");
    assert.equal(readPayload.engineeringContext?.buildCommand, "npm run build");
    assert.equal(auditEvent?.actorUserId, fixture.user.id);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.platformAuditEvent.deleteMany({ where: { organizationId: fixture.organization.id } });
    await prisma.organization.delete({ where: { id: fixture.organization.id } }).catch(() => undefined);
    await prisma.adminUser.delete({ where: { id: fixture.user.id } }).catch(() => undefined);
  }
});

test("project engineering context is tenant scoped", async () => {
  const first = await createProjectRouteFixture("PROJECT_ADMIN");
  const second = await createProjectRouteFixture("PROJECT_ADMIN");
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${second.project.key}/engineering-context`, {
      headers: {
        authorization: `Bearer ${first.sessionToken}`,
        origin: env.ADMIN_APP_URL,
      },
    });
    const payload = await response.json() as { error?: { code?: string; details?: { entitlementDenial?: string; scope?: string } } };

    assert.equal(response.status, 403);
    assert.equal(payload.error?.code, "projects.access_denied");
    assert.equal(payload.error?.details?.entitlementDenial, "PRODUCT_SCOPE_DENIED");
    assert.equal(payload.error?.details?.scope, "product");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.organization.deleteMany({ where: { id: { in: [first.organization.id, second.organization.id] } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: [first.user.id, second.user.id] } } });
  }
});

test("first-run onboarding endpoints remain tenant scoped and secret-free", async () => {
  const first = await createProjectRouteFixture("PROJECT_ADMIN");
  const second = await createProjectRouteFixture("PROJECT_ADMIN");
  await prisma.project.update({
    where: { id: second.project.id },
    data: { widgetClientSecretHash: "server-only-secret-hash" },
  });
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const headers = {
      authorization: `Bearer ${first.sessionToken}`,
      origin: env.ADMIN_APP_URL,
    };
    const listResponse = await fetch(`http://127.0.0.1:${port}/api/projects/admin`, { headers });
    const listPayload = await listResponse.json() as { projects?: Array<Record<string, unknown>> };
    const diagnosticsResponse = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${second.project.key}/install-diagnostics`, { headers });
    const sessionResponse = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${second.project.key}/widget-session`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ origin: "https://customer.example" }),
    });
    const reportResponse = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${second.project.key}/install-test-report`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ origin: "https://customer.example" }),
    });

    assert.equal(listResponse.status, 200);
    assert.deepEqual(listPayload.projects?.map((entry) => entry.key), [first.project.key]);
    assert.equal(JSON.stringify(listPayload).includes("server-only-secret-hash"), false);
    assert.equal(JSON.stringify(listPayload).includes("widgetClientSecretHash"), false);
    assert.equal(diagnosticsResponse.status, 403);
    assert.equal(sessionResponse.status, 403);
    assert.equal(reportResponse.status, 403);
    assert.equal(await prisma.feedbackItem.count({ where: { projectId: second.project.id } }), 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.organization.deleteMany({ where: { id: { in: [first.organization.id, second.organization.id] } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: [first.user.id, second.user.id] } } });
  }
});

test("onboarding customization applies the chosen widget brand color", async () => {
  const fixture = await createProjectRouteFixture("PROJECT_ADMIN");
  const configured = await prisma.project.update({
    where: { id: fixture.project.id },
    data: { onboardingVersion: 1, onboardingCompletedStep: "product" },
  });
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}/onboarding`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify({
        step: "customize",
        expectedUpdatedAt: configured.updatedAt.toISOString(),
        appearance: { launcherLabel: "Share feedback" },
        branding: { primaryColor: "#7c3aed" },
      }),
    });
    const payload = await response.json() as {
      project?: { widgetConfig?: { appearance?: { launcherLabel?: string }; notificationBranding?: { primaryColor?: string } } };
    };

    assert.equal(response.status, 200);
    assert.equal(payload.project?.widgetConfig?.appearance?.launcherLabel, "Share feedback");
    assert.equal(payload.project?.widgetConfig?.notificationBranding?.primaryColor, "#7c3aed");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.platformAuditEvent.deleteMany({ where: { organizationId: fixture.organization.id } });
    await prisma.organization.delete({ where: { id: fixture.organization.id } }).catch(() => undefined);
    await prisma.adminUser.delete({ where: { id: fixture.user.id } }).catch(() => undefined);
  }
});

test("project admins can submit an install test without satisfying real browser verification", async () => {
  const fixture = await createProjectRouteFixture("PROJECT_ADMIN");
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}/install-test-report`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify({ origin: "https://customer.example" }),
    });
    const payload = await response.json() as {
      feedback?: { id: string; ticketNumber: number };
      installDiagnostics?: {
        firstReportReceivedAt: string | null;
        screenshotProofReceivedAt: string | null;
        notificationProofRecordedAt: string | null;
        proofs: Array<{ id: string; status: string }>;
      };
    };
    const persisted = await prisma.feedbackItem.findUnique({
      where: { id: payload.feedback?.id ?? "" },
      include: { statusHistory: true, notifications: true },
    });
    const attachments = await prisma.feedbackAttachment.findMany({
      where: { feedbackItemId: payload.feedback?.id },
    });

    assert.equal(response.status, 201);
    assert.equal(typeof payload.feedback?.ticketNumber, "number");
    assert.equal(persisted?.title, "TraceGenie install test report");
    assert.equal(persisted?.currentUrl, "https://customer.example/");
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0]?.fileName, "tracegenie-install-proof.png");
    assert.equal(attachments[0]?.kind, "SCREENSHOT");
    assert.ok((persisted?.statusHistory.length ?? 0) > 0);
    assert.ok((persisted?.notifications.length ?? 0) > 0);
    assert.equal(payload.installDiagnostics?.proofs.find((proof) => proof.id === "first_report")?.status, "missing");
    assert.equal(payload.installDiagnostics?.proofs.find((proof) => proof.id === "attachment")?.status, "missing");
    assert.equal(payload.installDiagnostics?.proofs.find((proof) => proof.id === "notification")?.status, "missing");
    assert.equal(payload.installDiagnostics?.firstReportReceivedAt, null);
    assert.equal(payload.installDiagnostics?.screenshotProofReceivedAt, null);
    assert.equal(payload.installDiagnostics?.notificationProofRecordedAt, null);

    const blockedResponse = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}/install-test-report`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify({ origin: "https://wrong.example.test" }),
    });
    const blockedPayload = await blockedResponse.json() as { error?: { code?: string } };

    assert.equal(blockedResponse.status, 403);
    assert.equal(blockedPayload.error?.code, "projects.origin_not_allowed");
    assert.equal(await prisma.feedbackItem.count({ where: { projectId: fixture.project.id } }), 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.organization.delete({ where: { id: fixture.organization.id } }).catch(() => undefined);
    await prisma.adminUser.delete({ where: { id: fixture.user.id } }).catch(() => undefined);
  }
});

test("project admins can delete only an inactive unused product with exact confirmation", async () => {
  const fixture = await createProjectRouteFixture("PROJECT_ADMIN");
  await prisma.project.update({
    where: { id: fixture.project.id },
    data: { isActive: false },
  });
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const url = `http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}?organizationId=${fixture.organization.id}`;
    const headers = {
      authorization: `Bearer ${fixture.sessionToken}`,
      "content-type": "application/json",
      origin: env.ADMIN_APP_URL,
    };
    const mismatch = await fetch(url, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ confirmProjectKey: "different-product" }),
    });
    const mismatchPayload = await mismatch.json() as { error?: { code?: string } };
    assert.equal(mismatch.status, 422);
    assert.equal(mismatchPayload.error?.code, "projects.delete_confirmation_mismatch");
    assert.ok(await prisma.project.findUnique({ where: { id: fixture.project.id } }));

    const response = await fetch(url, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ confirmProjectKey: fixture.project.key }),
    });
    const payload = await response.json() as { deleted?: { key?: string; name?: string } };
    assert.equal(response.status, 200);
    assert.equal(payload.deleted?.key, fixture.project.key);
    assert.equal(await prisma.project.findUnique({ where: { id: fixture.project.id } }), null);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.platformAuditEvent.deleteMany({ where: { organizationId: fixture.organization.id } });
    await prisma.organization.delete({ where: { id: fixture.organization.id } }).catch(() => undefined);
    await prisma.adminUser.delete({ where: { id: fixture.user.id } }).catch(() => undefined);
  }
});

test("hosted onboarding completes only after a real report and returns that exact issue", async () => {
  const fixture = await createProjectRouteFixture("PROJECT_ADMIN");
  const configured = await prisma.project.update({
    where: { id: fixture.project.id },
    data: {
      onboardingVersion: 1,
      onboardingCompletedStep: "team",
      onboardingInstallMethod: "hosted",
      isActive: true,
    },
  });
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const headers = {
      authorization: `Bearer ${fixture.sessionToken}`,
      "content-type": "application/json",
      origin: env.ADMIN_APP_URL,
    };
    const beforeReport = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}/onboarding`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ step: "verify", expectedUpdatedAt: configured.updatedAt.toISOString() }),
    });
    const beforePayload = await beforeReport.json() as { error?: { code?: string } };
    assert.equal(beforeReport.status, 409);
    assert.equal(beforePayload.error?.code, "projects.onboarding_real_report_required");

    const publicOrigin = env.publicAppOrigins[0] ?? "http://localhost:4174";
    const realReport = await prisma.feedbackItem.create({
      data: {
        projectId: fixture.project.id,
        organizationId: fixture.organization.id,
        issueType: "BUG",
        severity: "LOW",
        title: "Hosted onboarding verification",
        description: "A real report submitted from the hosted feedback page.",
        currentUrl: `${publicOrigin}/?mode=feedback&projectKey=${fixture.project.key}`,
        appName: fixture.project.name,
        appEnvironment: "test",
        appVersion: "1.0.0",
        browserUserAgent: "Mozilla/5.0",
        browserName: "Chrome",
        browserPlatform: "macOS",
        viewportWidth: 1280,
        viewportHeight: 720,
        clientTimestamp: new Date(),
      },
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}/onboarding`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ step: "verify", expectedUpdatedAt: configured.updatedAt.toISOString() }),
    });
    const payload = await response.json() as {
      project?: { onboardingCompletedStep?: string; onboardingCompletedAt?: string | null };
      verifiedReport?: { id: string; ticketNumber: number };
    };

    assert.equal(response.status, 200);
    assert.equal(payload.project?.onboardingCompletedStep, "connect");
    assert.equal(typeof payload.project?.onboardingCompletedAt, "string");
    assert.deepEqual(payload.verifiedReport, { id: realReport.id, ticketNumber: realReport.ticketNumber });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.organization.delete({ where: { id: fixture.organization.id } }).catch(() => undefined);
    await prisma.adminUser.delete({ where: { id: fixture.user.id } }).catch(() => undefined);
  }
});

test("project viewers cannot submit install test report proof", async () => {
  const fixture = await createProjectRouteFixture("VIEWER");
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}/install-test-report`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify({ origin: "https://customer.example" }),
    });
    const payload = await response.json() as { error?: { code?: string } };

    assert.equal(response.status, 403);
    assert.equal(payload.error?.code, "projects.insufficient_role");
    assert.equal(await prisma.feedbackItem.count({ where: { projectId: fixture.project.id } }), 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.organization.delete({ where: { id: fixture.organization.id } }).catch(() => undefined);
    await prisma.adminUser.delete({ where: { id: fixture.user.id } }).catch(() => undefined);
  }
});

test("project viewers cannot update project settings", async () => {
  const fixture = await createProjectRouteFixture("VIEWER");
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify(projectUpdatePayload(fixture.organization.id, "Viewer update")),
    });
    const payload = await response.json() as { error: { code: string } };

    const destinationResponse = await fetch(
      `http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}/settings/general?organizationId=${fixture.organization.id}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${fixture.sessionToken}`,
          "content-type": "application/json",
          origin: env.ADMIN_APP_URL,
        },
        body: JSON.stringify({
          expectedUpdatedAt: fixture.project.updatedAt.toISOString(),
          name: "Viewer destination update",
        }),
      },
    );
    const destinationPayload = await destinationResponse.json() as { error: { code: string } };

    assert.equal(response.status, 403);
    assert.equal(payload.error.code, "projects.insufficient_role");
    assert.equal(destinationResponse.status, 403);
    assert.equal(destinationPayload.error.code, "projects.insufficient_role");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.organization.delete({ where: { id: fixture.organization.id } }).catch(() => undefined);
    await prisma.adminUser.delete({ where: { id: fixture.user.id } }).catch(() => undefined);
  }
});

test("project viewers cannot read or update engineering context", async () => {
  const fixture = await createProjectRouteFixture("VIEWER");
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const url = `http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}/engineering-context`;
    const readResponse = await fetch(url, {
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        origin: env.ADMIN_APP_URL,
      },
    });
    const readPayload = await readResponse.json() as { error: { code: string } };
    const updateResponse = await fetch(url, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify({
        repositoryUrl: "https://github.com/example/customer-app",
        autoFixPolicy: "ALLOW_BRANCH",
      }),
    });
    const updatePayload = await updateResponse.json() as { error: { code: string } };

    assert.equal(readResponse.status, 403);
    assert.equal(readPayload.error.code, "projects.insufficient_role");
    assert.equal(updateResponse.status, 403);
    assert.equal(updatePayload.error.code, "projects.insufficient_role");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.organization.delete({ where: { id: fixture.organization.id } }).catch(() => undefined);
    await prisma.adminUser.delete({ where: { id: fixture.user.id } }).catch(() => undefined);
  }
});

test("configured project widget-secret rotation respects the emergency kill switch", async () => {
  const fixture = await createProjectRouteFixture("PROJECT_ADMIN");
  const originalRotatedAt = new Date("2026-01-01T00:00:00.000Z");
  await prisma.project.update({
    where: { id: fixture.project.id },
    data: {
      widgetClientSecretHash: "existing-widget-secret-hash",
      widgetClientSecretRotatedAt: originalRotatedAt,
    },
  });
  const app = await createApp();
  const server = http.createServer(app);

  try {
    env.featureKillSwitches.add("action.project_widget_secret.rotate");
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}/widget-secret/rotate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify({}),
    });
    const payload = await response.json() as { error?: { code?: string; details?: { featureId?: string } } };
    const persisted = await prisma.project.findUniqueOrThrow({ where: { id: fixture.project.id } });
    const auditCount = await prisma.platformAuditEvent.count({
      where: {
        organizationId: fixture.organization.id,
        eventType: "projects.widget_secret_rotated",
      },
    });

    assert.equal(response.status, 503);
    assert.equal(payload.error?.code, "feature.kill_switched");
    assert.equal(payload.error?.details?.featureId, "action.project_widget_secret.rotate");
    assert.equal(persisted.widgetClientSecretHash, "existing-widget-secret-hash");
    assert.equal(persisted.widgetClientSecretRotatedAt?.toISOString(), originalRotatedAt.toISOString());
    assert.equal(auditCount, 0);
  } finally {
    env.featureKillSwitches.delete("action.project_widget_secret.rotate");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.organization.delete({ where: { id: fixture.organization.id } }).catch(() => undefined);
    await prisma.adminUser.delete({ where: { id: fixture.user.id } }).catch(() => undefined);
  }
});

test("project widget-secret generation respects the emergency kill switch", async () => {
  const fixture = await createProjectRouteFixture("PROJECT_ADMIN");
  const app = await createApp();
  const server = http.createServer(app);

  try {
    env.featureKillSwitches.add("action.project_widget_secret.generate");
    const port = await listen(server);
    const saveResponse = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify(projectUpdatePayload(fixture.organization.id, "Save without implicit secret")),
    });
    const savePayload = await saveResponse.json() as {
      project?: { clientSecretConfigured?: boolean; widgetClientSecret?: string | null };
    };
    const savedProject = await prisma.project.findUniqueOrThrow({ where: { id: fixture.project.id } });
    assert.equal(saveResponse.status, 200);
    assert.equal(savePayload.project?.clientSecretConfigured, false);
    assert.equal(savePayload.project?.widgetClientSecret, null);
    assert.equal(savedProject.widgetClientSecretHash, null);

    const response = await fetch(`http://127.0.0.1:${port}/api/projects/admin/${fixture.project.key}/widget-secret/rotate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${fixture.sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify({}),
    });
    const payload = await response.json() as { error?: { code?: string; details?: { featureId?: string } } };
    const persisted = await prisma.project.findUniqueOrThrow({ where: { id: fixture.project.id } });

    assert.equal(response.status, 503);
    assert.equal(payload.error?.code, "feature.kill_switched");
    assert.equal(payload.error?.details?.featureId, "action.project_widget_secret.generate");
    assert.equal(persisted.widgetClientSecretHash, null);
  } finally {
    env.featureKillSwitches.delete("action.project_widget_secret.generate");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.organization.delete({ where: { id: fixture.organization.id } }).catch(() => undefined);
    await prisma.adminUser.delete({ where: { id: fixture.user.id } }).catch(() => undefined);
  }
});
