import { AuditActorType,Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma";

type CreateAuditEventInput = {
  feedbackItemId: string;
  projectId: string;
  actorType: AuditActorType;
  adminUserId?: string | null;
  integrationClientId?: string | null;
  eventType: string;
  beforeJson?: Prisma.InputJsonValue;
  afterJson?: Prisma.InputJsonValue;
  requestId?: string | null;
  idempotencyKey?: string | null;
};

export class FeedbackAuditService {
  async createEvent(input: CreateAuditEventInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.feedbackAuditEvent.create({
      data: {
        feedbackItemId: input.feedbackItemId,
        projectId: input.projectId,
        actorType: input.actorType,
        adminUserId: input.adminUserId ?? null,
        integrationClientId: input.integrationClientId ?? null,
        eventType: input.eventType,
        beforeJson: input.beforeJson,
        afterJson: input.afterJson,
        requestId: input.requestId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
  }

  async findIntegrationEvent(integrationClientId: string, eventType: string, idempotencyKey?: string) {
    if (!idempotencyKey) {
      return null;
    }

    return prisma.feedbackAuditEvent.findUnique({
      where: {
        integrationClientId_eventType_idempotencyKey: {
          integrationClientId,
          eventType,
          idempotencyKey,
        },
      },
    });
  }
}

export const feedbackAuditService = new FeedbackAuditService();
