import http from "node:http";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import test from "node:test";

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

test("feature exposure events are validated and durably audited", async () => {
  const user = await prisma.adminUser.create({
    data: {
      email: `${testSlug("feature-exposure-analytics")}@traceitgenie.test`,
      name: "Feature Exposure Analytics",
      passwordHash: "not-used",
      role: "ADMIN",
    },
  });
  const { sessionToken } = await authService.createSession(user.id);
  const app = await createApp();
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const postEvent = (body: Record<string, string>) => fetch(`http://127.0.0.1:${port}/api/admin/analytics/feature-exposure-events`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
        origin: env.ADMIN_APP_URL,
      },
      body: JSON.stringify(body),
    });
    const response = await postEvent({
      eventType: "feature.hidden_route_requested",
      featureId: "route.customers",
      path: "/customers?account=private#details",
    });
    const audit = await prisma.platformAuditEvent.findFirst({
      where: { actorUserId: user.id, eventType: "feature.hidden_route_requested" },
      orderBy: { createdAt: "desc" },
    });

    assert.equal(response.status, 201);
    assert.equal((audit?.afterJson as { featureId?: string })?.featureId, "route.customers");
    assert.equal((audit?.afterJson as { path?: string })?.path, "/customers");

    const invalidFeature = await postEvent({
      eventType: "feature.hidden_route_requested",
      featureId: "route.not-real",
      path: "/not-real",
    });
    const spoofedServerEvent = await postEvent({
      eventType: "feature.kill_switch_rejected",
      featureId: "route.customers",
      path: "/customers",
    });
    const invalidPath = await postEvent({
      eventType: "feature.hidden_route_requested",
      featureId: "route.customers",
      path: "//external.example/customers",
    });

    assert.equal(invalidFeature.status, 400);
    assert.equal(spoofedServerEvent.status, 400);
    assert.equal(invalidPath.status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.platformAuditEvent.deleteMany({ where: { actorUserId: user.id } });
    await prisma.adminUser.delete({ where: { id: user.id } });
  }
});
