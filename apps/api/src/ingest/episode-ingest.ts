import { createHash, randomUUID } from "node:crypto";
import type { PostgresTransactionContext } from "@prisma/orm-postgres/runtime";
import { db, type Contract } from "#db";
import {
  MAX_INGEST_BODY_BYTES,
  type HandlerState,
  type SourceKind,
  type TrustTier,
  type VerificationState,
} from "#domain";
import type { Episode } from "#sdk";
import { sqlText, sqlTimestamp } from "#sql";
import { integrationForKey } from "./keys.ts";
import { redactObject, redactText } from "./redact.ts";

type Tx = PostgresTransactionContext<Contract>;

export type EpisodeIngestResult =
  | { outcome: "unknown-token" }
  | { outcome: "oversized" }
  | {
      outcome: "schema-error";
      fieldPath: string;
      message: string;
    }
  | {
      outcome: "stored" | "duplicate" | "conflict";
      eventId: string;
      attemptId: string;
      evidenceIds: readonly string[];
    };

export interface IngestEpisodeInput {
  token: string;
  rawBody: Buffer;
}

export async function ingestEpisode(
  input: IngestEpisodeInput,
): Promise<EpisodeIngestResult> {
  if (input.rawBody.length > MAX_INGEST_BODY_BYTES) {
    return { outcome: "oversized" };
  }

  const parsed = parseEpisodePayload(input.rawBody);
  if (!parsed.ok) {
    return {
      outcome: "schema-error",
      fieldPath: parsed.fieldPath,
      message: parsed.message,
    };
  }

  const episode = parsed.value;
  const digest = createHash("sha256").update(input.rawBody).digest("hex");
  const receivedAt = new Date(
    typeof episode.socket.ingressReceivedAtMs === "number" &&
      Number.isFinite(episode.socket.ingressReceivedAtMs)
      ? episode.socket.ingressReceivedAtMs
      : Date.now(),
  );

  return db.transaction(async (tx) => {
    const integration = await integrationForKey(tx, input.token);
    if (integration === null) {
      return { outcome: "unknown-token" };
    }

    const externalEventId = episode.identity.eventId?.trim() || episode.episodeId;
    const eventType =
      episode.identity.eventType?.trim() ||
      episode.routeTemplate?.trim() ||
      `${episode.method} ${safePathname(episode.rawUrl)}`;
    const occurredAt =
      typeof episode.identity.providerCreatedAtSec === "number" &&
      Number.isFinite(episode.identity.providerCreatedAtSec)
        ? new Date(episode.identity.providerCreatedAtSec * 1000)
        : null;

    const placed = await placeEpisodeEvent(tx, {
      integrationId: integration.id,
      workspaceId: integration.workspaceId,
      externalEventId,
      eventType,
      occurredAt,
      receivedAt,
      digest,
      redactedPreview: episode.bodyTap?.previewJson
        ? redactObject(episode.bodyTap.previewJson)
        : null,
    });

    const durationMs = computeDurationMs(episode);
    const verificationState: VerificationState =
      episode.verification.state === "REJECTED"
        ? "REJECTED"
        : episode.verification.state === "VERIFIED"
          ? "VERIFIED"
          : "RECEIVED";

    const hasFailure =
      episode.exceptions.length > 0 ||
      (episode.statusCode !== undefined && episode.statusCode >= 400) ||
      (episode.decision !== undefined && episode.decision.primaryClass !== "HEALTHY") ||
      (episode.socket.closeFired && !episode.socket.writableEndedAtClose);

    const handlerState: HandlerState = hasFailure ? "FAILED" : "PROCESSED";
    const errorCode =
      episode.decision && episode.decision.primaryClass !== "HEALTHY"
        ? episode.decision.primaryClass
        : episode.exceptions[0]?.name ?? null;

    const attemptId = randomUUID();
    await tx.orm.public.DeliveryAttempt.create({
      id: attemptId,
      eventId: placed.eventId,
      integrationId: integration.id,
      receivedAt,
      httpStatus: episode.statusCode ?? null,
      durationMs,
      senderWaitMs: null,
      verificationState,
      handlerState,
      errorCode,
      correlationId: episode.episodeId,
      workspaceId: integration.workspaceId,
    });

    const evidenceIds: string[] = [];
    const safeHeaders = redactObject(episode.headers ?? {});
    const safeEpisodeSummary = {
      episodeId: episode.episodeId,
      framework: episode.framework,
      method: episode.method,
      routeTemplate: episode.routeTemplate ?? safePathname(episode.rawUrl),
      statusCode: episode.statusCode ?? null,
      headers: safeHeaders,
      verification: {
        state: episode.verification.state,
        provider: episode.verification.provider ?? null,
        reason: episode.verification.reason ? redactText(episode.verification.reason) : null,
      },
      encryption: {
        scheme: episode.encryption.scheme,
        authenticatesSender: episode.encryption.authenticatesSender,
        decryptedOk: episode.encryption.decryptedOk,
        errorCode: episode.encryption.errorCode ?? null,
      },
      identity: {
        provider: episode.identity.provider,
        eventId: episode.identity.eventId ?? null,
        eventType: episode.identity.eventType ?? null,
        resourceId: episode.identity.resourceId ?? null,
      },
      idempotency: episode.idempotency,
      isDuplicateDelivery: Boolean(episode.isDuplicateDelivery),
      isOutOfOrderDelivery: Boolean(episode.isOutOfOrderDelivery),
      decision: episode.decision
        ? {
            primaryClass: episode.decision.primaryClass,
            secondaryClasses: episode.decision.secondaryClasses,
            rootCauseSummary: redactText(episode.decision.rootCauseSummary),
            timeoutAttribution: episode.decision.timeoutAttribution ?? null,
            autoReplaySafe: episode.decision.autoReplaySafe,
            replayGateReasons: episode.decision.replayGateReasons,
          }
        : null,
    };

    const episodeEvId = await insertEvidence(tx, {
      workspaceId: integration.workspaceId,
      sourceKind: "FLIGHT_RECORDER_EPISODE",
      sourceRecordId: placed.eventId,
      summary: redactText(
        episode.decision?.rootCauseSummary ||
          `${episode.method} ${safePathname(episode.rawUrl)} (${episode.statusCode ?? "no-status"})`,
      ),
      sha256Digest: digest,
      trustTier: "B",
      recordedAt: receivedAt,
      structuredDataJson: safeEpisodeSummary,
    });
    evidenceIds.push(episodeEvId);

    const hasSocketSignal =
      episode.socket.closeFired ||
      episode.socket.committedAfterAbort ||
      episode.socket.eventLoopMaxLagMs >= 40 ||
      episode.socket.activeCpuBlockMs >= 40;

    if (hasSocketSignal) {
      const socketEvId = await insertEvidence(tx, {
        workspaceId: integration.workspaceId,
        sourceKind: "SOCKET_TIMING",
        sourceRecordId: attemptId,
        summary: `Socket close=${episode.socket.closeFired}, writableEnded=${episode.socket.writableEndedAtClose}, eventLoopLag=${episode.socket.eventLoopMaxLagMs}ms, cpuBlock=${episode.socket.activeCpuBlockMs}ms`,
        sha256Digest: sha256Json(episode.socket),
        trustTier: "B",
        recordedAt: receivedAt,
        structuredDataJson: {
          finishFired: episode.socket.finishFired,
          closeFired: episode.socket.closeFired,
          writableEndedAtClose: episode.socket.writableEndedAtClose,
          headersSentAtClose: episode.socket.headersSentAtClose,
          handlerSettled: episode.socket.handlerSettled,
          committedAfterAbort: episode.socket.committedAfterAbort,
          eventLoopMaxLagMs: episode.socket.eventLoopMaxLagMs,
          activeCpuBlockMs: episode.socket.activeCpuBlockMs,
        },
      });
      evidenceIds.push(socketEvId);
    }

    for (const span of episode.downstreamCalls) {
      const isInterestingSpan =
        (span.statusCode !== undefined && span.statusCode >= 400) ||
        span.subHttpFailureType !== undefined ||
        span.errorCode !== undefined ||
        (span.durationMs !== undefined && span.durationMs >= 100);
      if (!isInterestingSpan) continue;

      const safePath = redactText(span.path);
      const safeErr = span.errorMessage ? redactText(span.errorMessage) : null;
      const spanEvId = await insertEvidence(tx, {
        workspaceId: integration.workspaceId,
        sourceKind: "DOWNSTREAM_SPAN",
        sourceRecordId: attemptId,
        summary: `${span.method} ${span.origin}${safePath} -> ${span.statusCode ?? span.subHttpFailureType ?? span.errorCode ?? "unknown"} (${span.durationMs ?? "?"}ms)`,
        sha256Digest: sha256Json({ spanId: span.spanId, origin: span.origin, safePath }),
        trustTier: "B",
        recordedAt: new Date(span.startedAtMs),
        structuredDataJson: {
          spanId: span.spanId,
          method: span.method,
          origin: span.origin,
          path: safePath,
          durationMs: span.durationMs ?? null,
          statusCode: span.statusCode ?? null,
          errorCode: span.errorCode ?? null,
          errorMessage: safeErr,
          subHttpFailureType: span.subHttpFailureType ?? null,
        },
      });
      evidenceIds.push(spanEvId);
    }

    for (const exc of episode.exceptions) {
      const safeMessage = redactText(exc.message);
      const excEvId = await insertEvidence(tx, {
        workspaceId: integration.workspaceId,
        sourceKind: "HOST_EXCEPTION",
        sourceRecordId: attemptId,
        summary: `[${exc.layer}] ${exc.name}: ${safeMessage}${exc.escapedAfterResponse ? " (escaped after response)" : ""}`,
        sha256Digest: sha256Json({ layer: exc.layer, name: exc.name, safeMessage }),
        trustTier: "B",
        recordedAt: new Date(exc.recordedAtMs),
        structuredDataJson: {
          layer: exc.layer,
          name: exc.name,
          message: safeMessage,
          code: exc.code ?? null,
          escapedAfterResponse: exc.escapedAfterResponse,
        },
      });
      evidenceIds.push(excEvId);
    }

    await tx.orm.public.Outbox.create({
      id: randomUUID(),
      eventId: placed.eventId,
      attemptId,
      enqueuedAt: null,
    });

    return {
      outcome: placed.outcome,
      eventId: placed.eventId,
      attemptId,
      evidenceIds,
    };
  });
}

async function placeEpisodeEvent(
  tx: Tx,
  input: {
    integrationId: string;
    workspaceId: string;
    externalEventId: string;
    eventType: string;
    occurredAt: Date | null;
    receivedAt: Date;
    digest: string;
    redactedPreview: unknown | null;
  },
): Promise<{ eventId: string; outcome: "stored" | "duplicate" | "conflict" }> {
  const eventId = randomUUID();
  const previewJson = input.redactedPreview === null ? null : JSON.stringify(input.redactedPreview);
  const inserted = await tx.query(
    tx.raw.sql`
      INSERT INTO webhook_events (
        id,
        integration_id,
        external_event_id,
        event_type,
        occurred_at,
        first_received_at,
        trace_id,
        payload_digest,
        redacted_payload_json,
        processing_state,
        workspace_id
      )
      VALUES (
        ${eventId},
        ${input.integrationId},
        ${sqlText(input.externalEventId)},
        ${sqlText(input.eventType)},
        CAST(${sqlTimestamp(input.occurredAt)} AS timestamptz),
        CAST(${input.receivedAt.toISOString()} AS timestamptz),
        NULL,
        ${input.digest},
        CAST(${sqlText(previewJson)} AS jsonb),
        CAST(${"RECEIVED"} AS "ProcessingState"),
        ${input.workspaceId}
      )
      ON CONFLICT (integration_id, external_event_id) DO NOTHING
      RETURNING id
    `
      .returnsRow({ id: "pg/text@1" })
      .build(),
  );
  const row = inserted[0];
  if (row !== undefined) {
    return { eventId: row.id, outcome: "stored" };
  }
  const existing = await tx.orm.public.WebhookEvent.where({
    integrationId: input.integrationId,
    externalEventId: input.externalEventId,
  })
    .forUpdate()
    .first();
  if (existing === null) {
    throw new Error(`missing event ${input.externalEventId}`);
  }
  return {
    eventId: existing.id,
    outcome: existing.payloadDigest === input.digest ? "duplicate" : "conflict",
  };
}

async function insertEvidence(
  tx: Tx,
  input: {
    workspaceId: string;
    sourceKind: SourceKind;
    sourceRecordId: string;
    summary: string;
    sha256Digest: string;
    trustTier: TrustTier;
    recordedAt: Date;
    structuredDataJson: unknown;
  },
): Promise<string> {
  const id = randomUUID();
  const structuredJson = JSON.stringify(input.structuredDataJson);
  await tx.query(
    tx.raw.sql`
      INSERT INTO evidence (
        id,
        source_kind,
        source_record_id,
        summary,
        sha256_digest,
        trust_tier,
        workspace_id,
        recorded_at,
        structured_data_json
      )
      VALUES (
        ${id},
        CAST(${input.sourceKind} AS "SourceKind"),
        ${input.sourceRecordId},
        ${input.summary},
        ${input.sha256Digest},
        CAST(${input.trustTier} AS "TrustTier"),
        ${input.workspaceId},
        CAST(${input.recordedAt.toISOString()} AS timestamptz),
        CAST(${structuredJson} AS jsonb)
      )
    `
      .affectedCount()
      .build(),
  );
  return id;
}

function parseEpisodePayload(
  rawBody: Buffer,
): { ok: true; value: Episode } | { ok: false; fieldPath: string; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { ok: false, fieldPath: "$", message: "Invalid JSON payload" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, fieldPath: "$", message: "Episode payload must be a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj["episodeId"] !== "string" || obj["episodeId"].trim().length === 0) {
    return { ok: false, fieldPath: "episodeId", message: "episodeId must be a non-empty string" };
  }
  if (typeof obj["method"] !== "string" || obj["method"].trim().length === 0) {
    return { ok: false, fieldPath: "method", message: "method must be a non-empty string" };
  }
  if (typeof obj["rawUrl"] !== "string" || obj["rawUrl"].trim().length === 0) {
    return { ok: false, fieldPath: "rawUrl", message: "rawUrl must be a non-empty string" };
  }
  if (!isObject(obj["verification"])) {
    return { ok: false, fieldPath: "verification", message: "verification object is required" };
  }
  if (!isObject(obj["encryption"])) {
    return { ok: false, fieldPath: "encryption", message: "encryption object is required" };
  }
  if (!isObject(obj["identity"])) {
    return { ok: false, fieldPath: "identity", message: "identity object is required" };
  }
  if (!isObject(obj["socket"])) {
    return { ok: false, fieldPath: "socket", message: "socket object is required" };
  }
  if (!Array.isArray(obj["downstreamCalls"])) {
    return { ok: false, fieldPath: "downstreamCalls", message: "downstreamCalls array is required" };
  }
  if (!Array.isArray(obj["exceptions"])) {
    return { ok: false, fieldPath: "exceptions", message: "exceptions array is required" };
  }
  return { ok: true, value: parsed as Episode };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function computeDurationMs(episode: Episode): number | null {
  const start = episode.socket.ingressReceivedAtMs;
  const end =
    episode.socket.finishAtMs ??
    episode.socket.closeAtMs ??
    episode.socket.handlerSettledAtMs;
  if (typeof start !== "number" || typeof end !== "number") return null;
  const diff = Math.round(end - start);
  return diff >= 0 ? diff : null;
}

function safePathname(rawUrl: string): string {
  const withoutQuery = rawUrl.split("?")[0] ?? "/";
  return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
