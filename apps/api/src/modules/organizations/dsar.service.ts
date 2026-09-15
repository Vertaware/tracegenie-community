import { Prisma } from "@prisma/client";

import { AppError,isAppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { randomToken,sha256 } from "../../lib/security";
import { storageService } from "../storage/storage.service";
import { writePlatformAudit } from "./access";

const dsarExportRequestEvents = [
  "org.dsar_export_queued",
  "org.dsar_export_requested",
  "org.dsar_export_failed",
];

const DSAR_DELETION_STATUS_PENDING = "PENDING";
const DSAR_DELETION_STATUS_PROCESSING = "PROCESSING";
const DSAR_DELETION_STATUS_COMPLETED = "COMPLETED";
const DSAR_DELETION_STATUS_REJECTED = "REJECTED";
const DSAR_DELETION_PROCESSING_STALE_MS = 5 * 60 * 1000;
const DSAR_EXPORT_STATUS_QUEUED = "PENDING";
const DSAR_EXPORT_STATUS_PROCESSING = "PROCESSING";
const DSAR_EXPORT_STATUS_COMPLETED = "COMPLETED";
const DSAR_EXPORT_STATUS_FAILED = "FAILED";
const DSAR_EXPORT_LOCK_STALE_MS = 5 * 60 * 1000;
const MAX_DSAR_EXPORT_ATTEMPTS = 3;
const DSAR_EXPORT_DOWNLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type DsarDeletionRequestStatus = "pending" | "completed" | "rejected";
export type DsarExportRequestStatus = "queued" | "processing" | "completed" | "failed";

export type DsarExportArtifact = {
  byteSize: number;
  checksumSha256: string;
  fileName: string;
  mimeType: "application/json";
  storageProvider: string;
};

export type DsarExportFailure = {
  code: string;
  message: string;
};

export type DsarDeletionRequest = {
  id: string;
  status: DsarDeletionRequestStatus;
  subjectEmailHash: string;
  reason: string;
  source: string;
  actor: DsarRequestActor | null;
  counts: Record<string, number>;
  deleted: Record<string, number>;
  requestedAt: Date;
  resolvedAt: Date | null;
};

export type DsarExportRequest = {
  id: string;
  status: DsarExportRequestStatus;
  subjectEmailHash: string;
  reason: string;
  source: string;
  actor: DsarRequestActor | null;
  counts: Record<string, number>;
  requestedAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
  artifact: DsarExportArtifact | null;
  failure: DsarExportFailure | null;
};

export type DsarRequestActor = {
  id: string;
  name: string;
  email: string;
};

export type DsarExportArtifactContent = {
  artifact: DsarExportArtifact;
  buffer: Buffer;
};

export type DsarExportBatchOptions = {
  limit?: number;
  now?: Date;
  workerId?: string;
};

export type DsarExportBatchResult = {
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
};

export type DsarExportArtifactCleanupResult = {
  scanned: number;
  cleaned: number;
  failed: Array<{ requestId: string; error: string }>;
};

type DsarExportJobRow = {
  id: string;
  subjectEmail: string | null;
  subjectEmailHash: string;
  reason: string;
  source: string;
  actorUser?: DsarRequestActor | null;
  status: string;
  countsJson: Prisma.JsonValue | null;
  artifactJson: Prisma.JsonValue | null;
  failureJson: Prisma.JsonValue | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  requestedAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
};

type DsarDeletionRequestRow = {
  id: string;
  subjectEmailHash: string;
  reason: string;
  source: string;
  actorUser?: DsarRequestActor | null;
  status: string;
  countsJson: Prisma.JsonValue | null;
  deletedJson?: Prisma.JsonValue | null;
  requestedAt: Date;
  resolvedAt: Date | null;
  processingClaimToken?: string | null;
  processingClaimedAt?: Date | null;
  updatedAt: Date;
};

export type DsarDeletionRequestClaim = {
  request: DsarDeletionRequest;
  claimToken: string;
};

function asAuditObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function publicDsarDeletionRequest(request: DsarDeletionRequest) {
  return {
    id: request.id,
    status: request.status,
    subjectFingerprint: request.subjectEmailHash.slice(0, 12),
    reason: request.reason,
    source: request.source,
    actor: request.actor,
    counts: request.counts,
    deleted: request.deleted,
    requestedAt: request.requestedAt,
    resolvedAt: request.resolvedAt,
  };
}

export function publicDsarExportRequest(request: DsarExportRequest) {
  const expiresAt = request.completedAt
    ? new Date(request.completedAt.getTime() + DSAR_EXPORT_DOWNLOAD_TTL_MS)
    : null;
  const downloadStatus = request.status !== "completed"
    ? "unavailable"
    : !request.artifact || !expiresAt || expiresAt.getTime() <= Date.now()
      ? "expired"
      : "ready";
  return {
    id: request.id,
    status: request.status,
    subjectFingerprint: request.subjectEmailHash.slice(0, 12),
    reason: request.reason,
    source: request.source,
    actor: request.actor,
    counts: request.counts,
    requestedAt: request.requestedAt,
    completedAt: request.completedAt,
    failedAt: request.failedAt,
    artifact: request.artifact,
    failure: request.failure,
    expiresAt,
    downloadStatus,
  };
}

function formatDsarExportArtifact(value: unknown): DsarExportArtifact | null {
  const artifact = asAuditObject(value);
  if (!Object.keys(artifact).length) {
    return null;
  }

  return {
    byteSize: typeof artifact.byteSize === "number" ? artifact.byteSize : 0,
    checksumSha256: typeof artifact.checksumSha256 === "string" ? artifact.checksumSha256 : "",
    fileName: typeof artifact.fileName === "string" ? artifact.fileName : "tracegenie-dsar-export.json",
    mimeType: "application/json",
    storageProvider: typeof artifact.storageProvider === "string" ? artifact.storageProvider : "unknown",
  };
}

function formatDsarExportFailure(value: unknown): DsarExportFailure | null {
  const failure = asAuditObject(value);
  if (!Object.keys(failure).length) {
    return null;
  }

  return {
    code: typeof failure.code === "string" ? failure.code : "dsar.export_failed",
    message: typeof failure.message === "string" ? failure.message : "DSAR export artifact could not be created.",
  };
}

function publicDsarDeletionStatus(row: DsarDeletionRequestRow): DsarDeletionRequestStatus {
  if (row.status === DSAR_DELETION_STATUS_COMPLETED) {
    return "completed";
  }
  if (row.status === DSAR_DELETION_STATUS_REJECTED) {
    return "rejected";
  }
  return "pending";
}

function formatDsarDeletionRequest(row: DsarDeletionRequestRow): DsarDeletionRequest {
  return {
    id: row.id,
    status: publicDsarDeletionStatus(row),
    subjectEmailHash: row.subjectEmailHash,
    reason: row.reason,
    source: row.source,
    actor: row.actorUser ?? null,
    counts: asAuditObject(row.countsJson) as Record<string, number>,
    deleted: asAuditObject(row.deletedJson) as Record<string, number>,
    requestedAt: row.requestedAt,
    resolvedAt: row.resolvedAt,
  };
}

function publicDsarExportStatus(row: DsarExportJobRow): DsarExportRequestStatus {
  if (row.status === DSAR_EXPORT_STATUS_COMPLETED) {
    return "completed";
  }
  if (row.status === DSAR_EXPORT_STATUS_FAILED && (!row.nextAttemptAt || row.attemptCount >= MAX_DSAR_EXPORT_ATTEMPTS)) {
    return "failed";
  }
  if (row.status === DSAR_EXPORT_STATUS_PROCESSING) {
    return "processing";
  }
  return "queued";
}

function formatDsarExportJob(row: DsarExportJobRow): DsarExportRequest {
  const status = publicDsarExportStatus(row);
  return {
    id: row.id,
    status,
    subjectEmailHash: row.subjectEmailHash,
    reason: row.reason,
    source: row.source,
    actor: row.actorUser ?? null,
    counts: asAuditObject(row.countsJson) as Record<string, number>,
    requestedAt: row.requestedAt,
    completedAt: row.completedAt,
    failedAt: status === "failed" ? row.failedAt : null,
    artifact: formatDsarExportArtifact(row.artifactJson),
    failure: status === "failed" ? formatDsarExportFailure(row.failureJson) : null,
  };
}

function buildNextDsarExportAttemptAt(attemptCount: number, now = new Date()) {
  if (attemptCount >= MAX_DSAR_EXPORT_ATTEMPTS) {
    return null;
  }
  const retryMs = Math.min(60 * 60 * 1000, 5 * 60 * 1000 * 2 ** Math.max(0, attemptCount - 1));
  return new Date(now.getTime() + retryMs);
}

function buildDsarExportStorageKey(organizationId: string, requestId: string) {
  return `dsar-exports/${organizationId}/${requestId}.json`;
}

function formatDsarExportRequests(events: Array<{
  eventType: string;
  afterJson: Prisma.JsonValue | null;
  createdAt: Date;
  id: string;
}>) {
  const requests = new Map<string, DsarExportRequest>();

  for (const event of events) {
    const after = asAuditObject(event.afterJson);
    const requestId = typeof after.requestId === "string" ? after.requestId : null;
    if (!requestId) {
      continue;
    }

    const existing = requests.get(requestId);
    const request: DsarExportRequest = existing ?? {
      id: requestId,
      status: "queued",
      subjectEmailHash: typeof after.subjectEmailHash === "string" ? after.subjectEmailHash : "",
      reason: "Legacy request",
      source: typeof after.source === "string" ? after.source : "system",
      actor: null,
      counts: {},
      requestedAt: event.createdAt,
      completedAt: null,
      failedAt: null,
      artifact: null,
      failure: null,
    };

    request.subjectEmailHash = request.subjectEmailHash || (typeof after.subjectEmailHash === "string" ? after.subjectEmailHash : "");
    request.requestedAt = request.requestedAt.getTime() <= event.createdAt.getTime() ? request.requestedAt : event.createdAt;

    if (event.eventType === "org.dsar_export_queued" || after.status === "queued") {
      request.status = "queued";
      requests.set(requestId, request);
      continue;
    }

    if (event.eventType === "org.dsar_export_failed" || after.status === "failed") {
      request.status = "failed";
      request.failedAt = event.createdAt;
      request.failure = formatDsarExportFailure(after.failure) ?? {
        code: "dsar.export_failed",
        message: "DSAR export artifact could not be created.",
      };
      request.counts = asAuditObject(after.counts) as Record<string, number>;
      requests.set(requestId, request);
      continue;
    }

    if (event.eventType === "org.dsar_export_requested" || after.status === "completed") {
      request.status = "completed";
      request.counts = asAuditObject(after.counts) as Record<string, number>;
      request.completedAt = event.createdAt;
      request.artifact = formatDsarExportArtifact(after.artifact);
      request.failure = null;
      requests.set(requestId, request);
      continue;
    }

    requests.set(requestId, request);
  }

  return Array.from(requests.values()).sort((left, right) => right.requestedAt.getTime() - left.requestedAt.getTime()).slice(0, 25);
}

export async function getDsarDeletionRequests(organizationId: string) {
  const requests = await prisma.dsarDeletionRequest.findMany({
    where: {
      organizationId,
    },
    orderBy: [
      { requestedAt: "desc" },
      { id: "desc" },
    ],
    include: {
      actorUser: {
        select: { id: true, name: true, email: true },
      },
    },
    take: 25,
  });

  return requests.map(formatDsarDeletionRequest);
}

export async function getDsarExportRequests(organizationId: string) {
  const [jobs, events] = await Promise.all([
    prisma.dsarExportJob.findMany({
      where: {
        organizationId,
      },
      orderBy: [
        { requestedAt: "desc" },
        { id: "desc" },
      ],
      take: 25,
      include: {
        actorUser: {
          select: { id: true, name: true, email: true },
        },
      },
    }),
    prisma.platformAuditEvent.findMany({
      where: {
        organizationId,
        eventType: {
          in: dsarExportRequestEvents,
        },
      },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: 100,
    }),
  ]);
  const jobIds = new Set(jobs.map((job) => job.id));
  const jobRequests = jobs.map(formatDsarExportJob);
  const legacyRequests = formatDsarExportRequests(events.reverse()).filter((request) => !jobIds.has(request.id));

  return [...jobRequests, ...legacyRequests]
    .sort((left, right) => right.requestedAt.getTime() - left.requestedAt.getTime())
    .slice(0, 25);
}

export async function getPendingDsarDeletionRequest(organizationId: string, requestId: string) {
  const row = await prisma.dsarDeletionRequest.findFirst({
    where: {
      id: requestId,
      organizationId,
    },
  });
  if (!row) {
    throw new AppError(404, "dsar.request_not_found", "DSAR deletion request was not found.");
  }
  if (row.status === DSAR_DELETION_STATUS_PROCESSING) {
    const staleBefore = new Date(Date.now() - DSAR_DELETION_PROCESSING_STALE_MS);
    const claimStartedAt = row.processingClaimedAt ?? row.updatedAt;
    if (claimStartedAt <= staleBefore) {
      const released = await prisma.dsarDeletionRequest.updateMany({
        where: {
          id: requestId,
          organizationId,
          status: DSAR_DELETION_STATUS_PROCESSING,
          processingClaimToken: row.processingClaimToken,
          processingClaimedAt: row.processingClaimedAt ?? null,
        },
        data: {
          status: DSAR_DELETION_STATUS_PENDING,
          processingClaimToken: null,
          processingClaimedAt: null,
        },
      });
      if (released.count === 1) {
        return getPendingDsarDeletionRequest(organizationId, requestId);
      }
    }
    throw new AppError(409, "dsar.request_busy", "DSAR deletion request is already being resolved.");
  }
  if (row.status !== DSAR_DELETION_STATUS_PENDING) {
    throw new AppError(409, "dsar.request_already_resolved", "DSAR deletion request is already resolved.");
  }
  return formatDsarDeletionRequest(row);
}

export async function claimPendingDsarDeletionRequest(organizationId: string, requestId: string) {
  await getPendingDsarDeletionRequest(organizationId, requestId);
  const claimToken = `dsar_claim_${randomToken()}`;
  const claimedAt = new Date();
  const claimed = await prisma.dsarDeletionRequest.updateMany({
    where: {
      id: requestId,
      organizationId,
      status: DSAR_DELETION_STATUS_PENDING,
    },
    data: {
      status: DSAR_DELETION_STATUS_PROCESSING,
      processingClaimToken: claimToken,
      processingClaimedAt: claimedAt,
    },
  });
  if (claimed.count !== 1) {
    await getPendingDsarDeletionRequest(organizationId, requestId);
    return claimPendingDsarDeletionRequest(organizationId, requestId);
  }

  const row = await prisma.dsarDeletionRequest.findFirst({
    where: {
      id: requestId,
      organizationId,
    },
  });
  if (!row) {
    throw new AppError(404, "dsar.request_not_found", "DSAR deletion request was not found.");
  }
  return {
    request: formatDsarDeletionRequest(row),
    claimToken,
  } satisfies DsarDeletionRequestClaim;
}

export async function releaseDsarDeletionRequestClaim(organizationId: string, requestId: string, claimToken: string) {
  await prisma.dsarDeletionRequest.updateMany({
    where: {
      id: requestId,
      organizationId,
      status: DSAR_DELETION_STATUS_PROCESSING,
      processingClaimToken: claimToken,
    },
    data: {
      status: DSAR_DELETION_STATUS_PENDING,
      processingClaimToken: null,
      processingClaimedAt: null,
    },
  });
}

type CompleteDsarDeletionRequestInput = {
  organizationId: string;
  requestId: string;
  actorUserId?: string | null;
  reason: string;
  deleted: Record<string, number>;
  claimToken: string;
  legalHoldConfirmed: true;
};

async function completeDsarDeletionRequestWithClient(input: CompleteDsarDeletionRequestInput, tx: Prisma.TransactionClient) {
  const resolvedAt = new Date();
  const updated = await tx.dsarDeletionRequest.updateMany({
    where: {
      id: input.requestId,
      organizationId: input.organizationId,
      status: DSAR_DELETION_STATUS_PROCESSING,
      processingClaimToken: input.claimToken,
    },
    data: {
      status: DSAR_DELETION_STATUS_COMPLETED,
      deletedJson: input.deleted,
      processingClaimToken: null,
      processingClaimedAt: null,
      resolvedAt,
    },
  });
  if (updated.count !== 1) {
    throw new AppError(409, "dsar.request_claim_expired", "DSAR deletion request claim is no longer active.");
  }

  const row = await tx.dsarDeletionRequest.findFirstOrThrow({
    where: {
      id: input.requestId,
      organizationId: input.organizationId,
    },
  });

  await writePlatformAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? undefined,
    eventType: "org.dsar_deletion_approved",
    reason: input.reason,
    afterJson: {
      requestId: input.requestId,
      subjectEmailHash: row.subjectEmailHash,
      deleted: input.deleted,
      legalHoldConfirmed: input.legalHoldConfirmed,
    },
  }, tx);

  return formatDsarDeletionRequest(row);
}

export async function completeDsarDeletionRequest(input: CompleteDsarDeletionRequestInput, client?: Prisma.TransactionClient) {
  if (client) {
    return completeDsarDeletionRequestWithClient(input, client);
  }
  return prisma.$transaction((tx) => completeDsarDeletionRequestWithClient(input, tx));
}

export async function rejectPendingDsarDeletionRequest(input: {
  organizationId: string;
  requestId: string;
  actorUserId?: string | null;
  reason: string;
}) {
  const request = await getPendingDsarDeletionRequest(input.organizationId, input.requestId);
  const resolvedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.dsarDeletionRequest.updateMany({
      where: {
        id: input.requestId,
        organizationId: input.organizationId,
        status: DSAR_DELETION_STATUS_PENDING,
      },
      data: {
        status: DSAR_DELETION_STATUS_REJECTED,
        resolvedAt,
      },
    });
    if (updated.count !== 1) {
      throw new AppError(409, "dsar.request_busy", "DSAR deletion request is already being resolved.");
    }

    await writePlatformAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? undefined,
      eventType: "org.dsar_deletion_rejected",
      reason: input.reason,
      afterJson: {
        requestId: input.requestId,
        subjectEmailHash: request.subjectEmailHash,
      },
    }, tx);

    const row = await tx.dsarDeletionRequest.findFirstOrThrow({
      where: {
        id: input.requestId,
        organizationId: input.organizationId,
      },
    });

    return formatDsarDeletionRequest(row);
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function createDsarDeletionRequest(input: {
  organizationId: string;
  email: string;
  reason: string;
  actorUserId?: string | null;
  source?: "admin" | "reporter";
}) {
  const payload = await getDsarSubjectExport(input.organizationId, input.email);
  const pending = await prisma.dsarDeletionRequest.findFirst({
    where: {
      organizationId: input.organizationId,
      subjectEmailHash: payload.subject.emailHash,
      status: {
        in: [DSAR_DELETION_STATUS_PENDING, DSAR_DELETION_STATUS_PROCESSING],
      },
    },
  });
  if (pending) {
    throw new AppError(409, "dsar.request_pending", "A DSAR deletion request is already pending for this subject.");
  }

  const requestId = `dsar_${randomToken()}`;
  const source = input.source ?? "admin";
  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.dsarDeletionRequest.create({
        data: {
          id: requestId,
          organizationId: input.organizationId,
          actorUserId: input.actorUserId ?? null,
          subjectEmailHash: payload.subject.emailHash,
          reason: input.reason,
          source,
          status: DSAR_DELETION_STATUS_PENDING,
          countsJson: payload.counts,
        },
      });

      await writePlatformAudit({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? undefined,
        eventType: "org.dsar_deletion_requested",
        reason: input.reason,
        afterJson: {
          requestId,
          subjectEmailHash: payload.subject.emailHash,
          counts: payload.counts,
          source,
        },
      }, tx);

      return row;
    });

    return formatDsarDeletionRequest(created);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, "dsar.request_pending", "A DSAR deletion request is already pending for this subject.");
    }
    throw error;
  }
}

export async function createDsarExportRequest(input: {
  organizationId: string;
  email: string;
  reason: string;
  actorUserId?: string | null;
  source?: "admin" | "reporter";
}) {
  const requestId = `dsar_export_${randomToken()}`;
  const subjectEmailHash = sha256(input.email);

  const source = input.source ?? "admin";
  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.dsarExportJob.create({
      data: {
        id: requestId,
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        subjectEmail: input.email,
        subjectEmailHash,
        reason: input.reason,
        source,
        status: DSAR_EXPORT_STATUS_QUEUED,
      },
    });

    await writePlatformAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? undefined,
      eventType: "org.dsar_export_queued",
      reason: input.reason,
      afterJson: {
        requestId,
        status: "queued",
        subjectEmailHash,
        source,
      },
    }, tx);

    return created;
  });

  return formatDsarExportJob(job);
}

async function processDsarExportJob(input: {
  requestId: string;
  lockedAt: Date;
  workerId: string;
  now: Date;
}) {
  const job = await prisma.dsarExportJob.findUnique({
    where: {
      id: input.requestId,
    },
  });
  if (!job) {
    return "skipped" as const;
  }
  if (!job.subjectEmail) {
    const terminal = await prisma.dsarExportJob.updateMany({
      where: {
        id: job.id,
        status: DSAR_EXPORT_STATUS_PROCESSING,
        lockedAt: input.lockedAt,
        lockedBy: input.workerId,
      },
      data: {
        status: DSAR_EXPORT_STATUS_FAILED,
        failureJson: {
          code: "dsar.export_missing_subject",
          message: "DSAR export artifact could not be created.",
        },
        attemptCount: MAX_DSAR_EXPORT_ATTEMPTS,
        failedAt: input.now,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: null,
      },
    });
    if (terminal.count !== 1) {
      return "skipped" as const;
    }
    return "failed" as const;
  }

  let storedStorageKey: string | null = null;

  try {
    const payload = job.source === "reporter"
      ? await getReporterDsarSubjectExport(job.organizationId, job.subjectEmail)
      : await getDsarSubjectExport(job.organizationId, job.subjectEmail);
    const serialized = JSON.stringify(payload, null, 2);
    const buffer = Buffer.from(serialized, "utf8");
    const fileName = `tracegenie-dsar-${job.id}.json`;
    const stored = await storageService.store({
      buffer,
      fileName,
      mimeType: "application/json",
      byteSize: buffer.length,
      storageKey: buildDsarExportStorageKey(job.organizationId, job.id),
    });
    storedStorageKey = stored.storageKey;
    const artifact = {
      byteSize: buffer.length,
      checksumSha256: sha256(serialized),
      fileName,
      mimeType: "application/json" as const,
      storageProvider: stored.provider.toString().toLowerCase(),
    };

    const completed = await prisma.$transaction(async (tx) => {
      const updated = await tx.dsarExportJob.updateMany({
        where: {
          id: job.id,
          status: DSAR_EXPORT_STATUS_PROCESSING,
          lockedAt: input.lockedAt,
          lockedBy: input.workerId,
        },
        data: {
          status: DSAR_EXPORT_STATUS_COMPLETED,
          subjectEmail: null,
          subjectEmailHash: payload.subject.emailHash,
          countsJson: payload.counts,
          artifactJson: artifact,
          failureJson: Prisma.DbNull,
          completedAt: input.now,
          failedAt: null,
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: null,
        },
      });
      if (updated.count !== 1) {
        return false;
      }

      await writePlatformAudit({
        organizationId: job.organizationId,
        actorUserId: job.actorUserId ?? undefined,
        eventType: "org.dsar_export_requested",
        reason: job.reason,
        afterJson: {
          requestId: job.id,
          status: "completed",
          subjectEmailHash: payload.subject.emailHash,
          counts: payload.counts,
          artifact,
          source: job.source,
        },
      }, tx);

      return true;
    });
    if (!completed) {
      await storageService.remove(storedStorageKey).catch(() => undefined);
      return "skipped" as const;
    }
    return "completed" as const;
  } catch (error) {
    if (storedStorageKey) {
      await storageService.remove(storedStorageKey).catch(() => undefined);
    }
    const attemptCount = job.attemptCount + 1;
    const nextAttemptAt = buildNextDsarExportAttemptAt(attemptCount, input.now);
    const failure = {
      code: isAppError(error) ? error.code : "dsar.export_failed",
      message: "DSAR export artifact could not be created.",
    };
    const failed = await prisma.$transaction(async (tx) => {
      const updated = await tx.dsarExportJob.updateMany({
        where: {
          id: job.id,
          status: DSAR_EXPORT_STATUS_PROCESSING,
          lockedAt: input.lockedAt,
          lockedBy: input.workerId,
        },
        data: {
          status: DSAR_EXPORT_STATUS_FAILED,
          subjectEmail: nextAttemptAt ? job.subjectEmail : null,
          failureJson: failure,
          attemptCount,
          failedAt: input.now,
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt,
        },
      });
      if (updated.count !== 1) {
        return false;
      }

      if (!nextAttemptAt) {
        await writePlatformAudit({
          organizationId: job.organizationId,
          actorUserId: job.actorUserId ?? undefined,
          eventType: "org.dsar_export_failed",
          reason: job.reason,
          afterJson: {
            requestId: job.id,
            status: "failed",
            subjectEmailHash: job.subjectEmailHash,
            failure,
            source: job.source,
          },
        }, tx);
      }

      return true;
    });
    if (!failed) {
      return "skipped" as const;
    }
    return "failed" as const;
  }
}

export async function processDsarExportBatch(options: DsarExportBatchOptions = {}): Promise<DsarExportBatchResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const workerId = options.workerId ?? `dsar-export-${process.pid}`;
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - DSAR_EXPORT_LOCK_STALE_MS);

  const candidates = await prisma.dsarExportJob.findMany({
    where: {
      status: {
        in: [DSAR_EXPORT_STATUS_QUEUED, DSAR_EXPORT_STATUS_FAILED, DSAR_EXPORT_STATUS_PROCESSING],
      },
      attemptCount: {
        lt: MAX_DSAR_EXPORT_ATTEMPTS,
      },
      OR: [
        { nextAttemptAt: null },
        { nextAttemptAt: { lte: now } },
      ],
      AND: [
        {
          OR: [
            { lockedAt: null },
            { lockedAt: { lte: staleBefore } },
          ],
        },
      ],
    },
    select: {
      id: true,
      status: true,
    },
    orderBy: [
      { nextAttemptAt: "asc" },
      { createdAt: "asc" },
    ],
    take: limit,
  });

  const result: DsarExportBatchResult = {
    processed: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  };

  for (const candidate of candidates) {
    const claimed = await prisma.dsarExportJob.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        attemptCount: {
          lt: MAX_DSAR_EXPORT_ATTEMPTS,
        },
        OR: [
          { nextAttemptAt: null },
          { nextAttemptAt: { lte: now } },
        ],
        AND: [
          {
            OR: [
              { lockedAt: null },
              { lockedAt: { lte: staleBefore } },
            ],
          },
        ],
      },
      data: {
        status: DSAR_EXPORT_STATUS_PROCESSING,
        lockedAt: now,
        lockedBy: workerId,
      },
    });
    if (claimed.count !== 1) {
      continue;
    }

    const status = await processDsarExportJob({
      requestId: candidate.id,
      lockedAt: now,
      workerId,
      now,
    });
    result.processed += 1;
    result[status] += 1;
  }

  return result;
}

export async function getDsarExportArtifactContent(input: {
  organizationId: string;
  requestId: string;
  now?: Date;
}): Promise<DsarExportArtifactContent> {
  const job = await prisma.dsarExportJob.findFirst({
    where: {
      id: input.requestId,
      organizationId: input.organizationId,
    },
  });
  if (!job) {
    throw new AppError(404, "dsar.export_not_found", "DSAR export artifact was not found.");
  }
  const artifact = formatDsarExportArtifact(job.artifactJson);
  if (job.status !== DSAR_EXPORT_STATUS_COMPLETED || !job.completedAt) {
    throw new AppError(409, "dsar.export_not_ready", "DSAR export artifact is not ready for download.");
  }
  const now = input.now ?? new Date();
  if (now.getTime() - job.completedAt.getTime() > DSAR_EXPORT_DOWNLOAD_TTL_MS) {
    throw new AppError(410, "dsar.export_expired", "DSAR export artifact download has expired.");
  }
  if (!artifact) {
    throw new AppError(409, "dsar.export_not_ready", "DSAR export artifact is not ready for download.");
  }

  const buffer = await storageService.read(buildDsarExportStorageKey(input.organizationId, input.requestId));
  const checksum = sha256(buffer.toString("utf8"));
  if (checksum !== artifact.checksumSha256) {
    throw new AppError(500, "dsar.export_checksum_mismatch", "DSAR export artifact integrity check failed.");
  }

  return {
    artifact,
    buffer,
  };
}

export async function cleanupExpiredDsarExportArtifacts(options: { before?: Date; limit?: number } = {}): Promise<DsarExportArtifactCleanupResult> {
  const before = options.before ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const cutoffAt = new Date(before.getTime() - DSAR_EXPORT_DOWNLOAD_TTL_MS);
  const jobs = await prisma.dsarExportJob.findMany({
    where: {
      status: DSAR_EXPORT_STATUS_COMPLETED,
      completedAt: {
        lte: cutoffAt,
      },
      artifactJson: {
        not: Prisma.DbNull,
      },
    },
    select: {
      id: true,
      organizationId: true,
      completedAt: true,
    },
    orderBy: [
      { completedAt: "asc" },
      { id: "asc" },
    ],
    take: limit,
  });

  let cleaned = 0;
  const cleanedByOrganization = new Map<string, { scanned: number; cleaned: number }>();
  const failed: DsarExportArtifactCleanupResult["failed"] = [];

  for (const job of jobs) {
    try {
      await storageService.remove(buildDsarExportStorageKey(job.organizationId, job.id));
      const result = await prisma.dsarExportJob.updateMany({
        where: {
          id: job.id,
          status: DSAR_EXPORT_STATUS_COMPLETED,
          completedAt: {
            lte: cutoffAt,
          },
          artifactJson: {
            not: Prisma.DbNull,
          },
        },
        data: {
          artifactJson: Prisma.DbNull,
        },
      });
      cleaned += result.count;
      if (result.count > 0) {
        const current = cleanedByOrganization.get(job.organizationId) ?? { scanned: 0, cleaned: 0 };
        current.scanned += 1;
        current.cleaned += result.count;
        cleanedByOrganization.set(job.organizationId, current);
      }
    } catch (error) {
      failed.push({
        requestId: job.id,
        error: error instanceof Error ? error.message : "Unknown DSAR export artifact cleanup failure",
      });
    }
  }

  await Promise.all(Array.from(cleanedByOrganization.entries()).map(([organizationId, counts]) =>
    writePlatformAudit({
      organizationId,
      eventType: "org.dsar_export_artifacts_cleaned",
      afterJson: {
        cutoffAt: cutoffAt.toISOString(),
        scanned: counts.scanned,
        cleaned: counts.cleaned,
      },
    })
  ));

  return {
    scanned: jobs.length,
    cleaned,
    failed,
  };
}

export async function deleteDsarSubject(input: {
  organizationId: string;
  email: string;
  actorUserId?: string | null;
  reason: string;
  afterDelete?: (transaction: Prisma.TransactionClient, deleted: Record<string, number>) => Promise<void>;
}) {
  const subjectFeedback = await prisma.feedbackItem.findMany({
    where: {
      organizationId: input.organizationId,
      reporterEmail: input.email,
    },
    select: {
      id: true,
      attachments: {
        select: {
          id: true,
          storageKey: true,
        },
      },
    },
  });
  const feedbackIds = subjectFeedback.map((feedback) => feedback.id);
  const attachments = subjectFeedback.flatMap((feedback) => feedback.attachments);

  try {
    await Promise.all(attachments.map((attachment) => storageService.remove(attachment.storageKey)));
  } catch (error) {
    throw new AppError(
      503,
      "dsar.attachment_delete_failed",
      "Attachment storage could not be deleted. Subject data was not removed.",
      error,
    );
  }

  const result = await prisma.$transaction(async (transaction) => {
    const deletedAttachments = attachments.length
      ? await transaction.feedbackAttachment.deleteMany({
          where: {
            id: {
              in: attachments.map((attachment) => attachment.id),
            },
          },
        })
      : { count: 0 };
    const deletedWebhookDeliveries = { count: 0 };
    const deletedFeedback = feedbackIds.length
      ? await transaction.feedbackItem.deleteMany({
          where: {
            id: {
              in: feedbackIds,
            },
            organizationId: input.organizationId,
            reporterEmail: input.email,
          },
        })
      : { count: 0 };
    const deletedRecipients = await transaction.feedbackTicketRecipient.deleteMany({
      where: {
        email: input.email,
        feedbackItem: {
          organizationId: input.organizationId,
        },
      },
    });
    const redactedNotifications = await transaction.feedbackNotification.updateMany({
      where: {
        recipientEmail: input.email,
        feedbackItem: {
          organizationId: input.organizationId,
        },
      },
      data: {
        recipientEmail: null,
        recipientName: null,
      },
    });
    const deletedInvites = await transaction.invite.deleteMany({
      where: {
        organizationId: input.organizationId,
        email: input.email,
      },
    });

    const result = {
      deletedFeedback: deletedFeedback.count,
      deletedAttachments: deletedAttachments.count,
      deletedWebhookDeliveries: deletedWebhookDeliveries.count,
      deletedRecipients: deletedRecipients.count,
      redactedNotifications: redactedNotifications.count,
      deletedInvites: deletedInvites.count,
    };

    await writePlatformAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? undefined,
      eventType: "org.dsar_subject_deleted",
      reason: input.reason,
      afterJson: {
        subjectEmailHash: sha256(input.email),
        ...result,
      },
    }, transaction);

    if (input.afterDelete) {
      await input.afterDelete(transaction, result);
    }

    return result;
  });

  return result;
}

export async function getDsarSubjectExport(organizationId: string, email: string) {
  const [adminUsers, invites, feedbackReports, ticketRecipients, notifications] = await Promise.all([
    prisma.adminUser.findMany({
      where: {
        email,
        orgMemberships: {
          some: {
            organizationId,
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        orgMemberships: {
          where: {
            organizationId,
          },
          select: {
            role: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    }),
    prisma.invite.findMany({
      where: {
        organizationId,
        email,
      },
      select: {
        id: true,
        email: true,
        orgRole: true,
        projectRole: true,
        status: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    prisma.feedbackItem.findMany({
      where: {
        organizationId,
        reporterEmail: email,
      },
      select: {
        id: true,
        ticketNumber: true,
        title: true,
        description: true,
        currentUrl: true,
        status: true,
        issueType: true,
        severity: true,
        reporterId: true,
        reporterEmail: true,
        reporterName: true,
        reporterRole: true,
        requesterNotificationsEnabled: true,
        createdAt: true,
        updatedAt: true,
        project: {
          select: {
            key: true,
            name: true,
          },
        },
        attachments: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            byteSize: true,
            width: true,
            height: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
        subscribers: {
          where: {
            email,
          },
          select: {
            id: true,
            email: true,
            name: true,
            recipientType: true,
            isActive: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
        notifications: {
          where: {
            recipientEmail: email,
          },
          select: {
            id: true,
            eventType: true,
            recipientEmail: true,
            recipientName: true,
            recipientType: true,
            subjectSnapshot: true,
            status: true,
            skipReason: true,
            createdAt: true,
            sentAt: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    prisma.feedbackTicketRecipient.findMany({
      where: {
        email,
        feedbackItem: {
          organizationId,
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        recipientType: true,
        isActive: true,
        notifyOnTriage: true,
        notifyOnStatusChange: true,
        createdAt: true,
        feedbackItem: {
          select: {
            id: true,
            ticketNumber: true,
            project: {
              select: {
                key: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    prisma.feedbackNotification.findMany({
      where: {
        recipientEmail: email,
        feedbackItem: {
          organizationId,
        },
      },
      select: {
        id: true,
        eventType: true,
        recipientEmail: true,
        recipientName: true,
        recipientType: true,
        subjectSnapshot: true,
        status: true,
        skipReason: true,
        createdAt: true,
        sentAt: true,
        feedbackItem: {
          select: {
            id: true,
            ticketNumber: true,
            project: {
              select: {
                key: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
  ]);

  return {
    subject: {
      email,
      emailHash: sha256(email),
    },
    counts: {
      adminUsers: adminUsers.length,
      invites: invites.length,
      feedbackReports: feedbackReports.length,
      ticketRecipients: ticketRecipients.length,
      notifications: notifications.length,
    },
    adminUsers,
    invites,
    feedbackReports,
    ticketRecipients,
    notifications,
  };
}

export async function getReporterDsarSubjectExport(organizationId: string, email: string) {
  const normalizedEmail = email.toLowerCase().trim();
  const feedbackReports = await prisma.feedbackItem.findMany({
    where: {
      organizationId,
      reporterEmail: normalizedEmail,
    },
    select: {
      id: true,
      ticketNumber: true,
      title: true,
      description: true,
      currentUrl: true,
      status: true,
      issueType: true,
      severity: true,
      reporterId: true,
      reporterEmail: true,
      reporterName: true,
      reporterRole: true,
      requesterNotificationsEnabled: true,
      createdAt: true,
      updatedAt: true,
      project: {
        select: {
          key: true,
          name: true,
        },
      },
      attachments: {
        where: { visibility: "PUBLIC" },
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          byteSize: true,
          width: true,
          height: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
      comments: {
        where: { visibility: "PUBLIC" },
        select: {
          id: true,
          body: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
      notifications: {
        where: { recipientEmail: normalizedEmail },
        select: {
          id: true,
          eventType: true,
          subjectSnapshot: true,
          status: true,
          createdAt: true,
          sentAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const attachmentCount = feedbackReports.reduce((total, report) => total + report.attachments.length, 0);
  const commentCount = feedbackReports.reduce((total, report) => total + report.comments.length, 0);
  const notificationCount = feedbackReports.reduce((total, report) => total + report.notifications.length, 0);

  return {
    subject: {
      email: normalizedEmail,
      emailHash: sha256(normalizedEmail),
    },
    scope: "reporter_visible" as const,
    counts: {
      feedbackReports: feedbackReports.length,
      attachments: attachmentCount,
      publicComments: commentCount,
      notifications: notificationCount,
    },
    feedbackReports,
  };
}
