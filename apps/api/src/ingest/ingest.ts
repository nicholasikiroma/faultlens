import { randomUUID } from "node:crypto";
import type { PostgresTransactionContext } from "@prisma/orm-postgres/runtime";
import { db, type Contract } from "#db";
import { MAX_INGEST_BODY_BYTES, type VerificationState } from "#domain";
import { sqlText, sqlTimestamp } from "#sql";
import { integrationForKey } from "./keys.ts";
import { redact } from "./redact.ts";
import { validateEventSchema, type ValidEventFields } from "./schema.ts";
import { verify } from "./verify.ts";

type Tx = PostgresTransactionContext<Contract>;

/**
 * Maximum accepted payload body size in bytes (1 MiB = 1,048,576 bytes).
 * Payloads exceeding this limit are refused before persistence.
 */
export const MAX_BODY_BYTES = MAX_INGEST_BODY_BYTES;

export type IngestResult =
  | { outcome: "unknown-token" }
  | { outcome: "oversized" }
  | {
      outcome: "schema-error";
      fieldPath: string;
      message: string;
      attemptId: string;
    }
  | { outcome: "rejected"; eventId: null; attemptId: string }
  | {
      outcome: "stored" | "duplicate" | "conflict";
      eventId: string;
      attemptId: string;
    };

const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;

interface IngestInput {
  token: string;
  rawBody: Buffer;
  headers: Readonly<Record<string, string>>;
}

interface IngestEpisodeMeta {
  episodeId?: string;
  primaryClass?: string;
  statusCode?: number;
  rootCauseSummary?: string;
  exceptions?: Array<{ name: string; message: string }>;
  downstreamCalls?: Array<{
    statusCode?: number;
    origin?: string;
    path?: string;
  }>;
}

function parseEpisodeMeta(
  headers: Readonly<Record<string, string>>,
): IngestEpisodeMeta | null {
  const raw = headerValue(headers, "x-faultlens-episode");
  if (!raw) return null;
  try {
    const jsonStr = Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/** Real traffic must authenticate with a scoped, hashed ingest key. */
export function ingest(input: IngestInput): Promise<IngestResult> {
  return ingestDelivery(input, "api-key");
}

/** Explicitly separate legacy simulation credentials from production keys. */
export function ingestSimulated(input: IngestInput): Promise<IngestResult> {
  return ingestDelivery(input, "simulated");
}

async function ingestDelivery(
  input: IngestInput,
  credential: "api-key" | "simulated",
): Promise<IngestResult> {
  if (input.rawBody.length > MAX_BODY_BYTES) {
    return { outcome: "oversized" };
  }

  const receivedAt = new Date();
  return db.transaction(async (tx) => {
    const integration =
      credential === "api-key"
        ? await integrationForKey(tx, input.token)
        : await tx.orm.public.Integration.where({
            endpointToken: input.token,
          }).first();
    if (integration === null) {
      return { outcome: "unknown-token" };
    }

    const verification = verify(
      input.rawBody,
      input.headers,
      integration.signingSecret,
    );
    switch (verification) {
      case "REJECTED": {
        const attemptId = await insertAttempt(tx, {
          eventId: null,
          integrationId: integration.id,
          workspaceId: integration.workspaceId,
          receivedAt,
          verificationState: "REJECTED",
          errorCode: null,
        });
        await insertOutbox(tx, { eventId: null, attemptId });
        return { outcome: "rejected", eventId: null, attemptId };
      }
      case "VERIFIED": {
        const validation = validateEventSchema(input.rawBody);
        if (!validation.ok) {
          const attemptId = await insertAttempt(tx, {
            eventId: null,
            integrationId: integration.id,
            workspaceId: integration.workspaceId,
            receivedAt,
            verificationState: "VERIFIED",
            httpStatus: 400,
            errorCode: "schema_error",
          });
          await insertOutbox(tx, { eventId: null, attemptId });
          return {
            outcome: "schema-error",
            fieldPath: validation.fieldPath,
            message: validation.message,
            attemptId,
          };
        }

        const { digest } = redact(input.rawBody);
        const placed = await placeEvent(tx, {
          integrationId: integration.id,
          workspaceId: integration.workspaceId,
          fields: validation.fields,
          digest,
          receivedAt,
          traceId: traceIdFrom(input.headers),
        });

        // Decode FlightRecorder SDK telemetry metadata if attached
        const episodeMeta = parseEpisodeMeta(input.headers);
        let httpStatus: number | null =
          placed.outcome === "conflict" ? 409 : 200;
        let errorCode: string | null =
          placed.outcome === "conflict" ? "conflict" : null;
        let verificationState: Exclude<VerificationState, "RECEIVED"> =
          "VERIFIED";

        if (episodeMeta) {
          if (episodeMeta.statusCode && episodeMeta.statusCode >= 400) {
            httpStatus = episodeMeta.statusCode;
          }
          if (episodeMeta.primaryClass === "RATE_LIMIT" || httpStatus === 429) {
            httpStatus = 429;
            errorCode = "rate_limit_429";
          } else if (
            episodeMeta.primaryClass === "DOWNSTREAM_TIMEOUT" ||
            episodeMeta.primaryClass === "NETWORK_TIMEOUT" ||
            httpStatus === 504
          ) {
            httpStatus = 504;
            errorCode = "timeout";
          } else if (episodeMeta.primaryClass === "INVALID_SIGNATURE") {
            verificationState = "REJECTED";
            errorCode = "invalid_signature";
          } else if (
            episodeMeta.primaryClass === "UPSTREAM_5XX" ||
            (httpStatus !== null && httpStatus >= 500)
          ) {
            errorCode = "upstream_5xx";
          } else if (episodeMeta.primaryClass === "DUPLICATE_DELIVERY") {
            errorCode = "duplicate_delivery";
          }
        }

        const attemptId = await insertAttempt(tx, {
          eventId: placed.eventId,
          integrationId: integration.id,
          workspaceId: integration.workspaceId,
          receivedAt,
          verificationState,
          httpStatus,
          errorCode,
        });

        if (
          episodeMeta &&
          episodeMeta.primaryClass &&
          episodeMeta.primaryClass !== "HEALTHY"
        ) {
          await tx.orm.public.Evidence.create({
            id: randomUUID(),
            sourceKind: "DELIVERY_ATTEMPT",
            sourceRecordId: attemptId,
            summary:
              episodeMeta.rootCauseSummary ??
              `Ingress flight incident: ${episodeMeta.primaryClass}`,
            sha256Digest: digest,
            trustTier: "A",
            workspaceId: integration.workspaceId,
          });
        }

        await insertOutbox(tx, { eventId: placed.eventId, attemptId });

        // Immediate background classification trigger for real-time dashboard visibility
        // (disabled under node --test so transactional outbox / BullMQ dedup tests stay deterministic)
        if (
          placed.eventId &&
          process.env["NODE_TEST_CONTEXT"] === undefined &&
          !process.execArgv.includes("--test") &&
          process.env["NODE_ENV"] !== "test"
        ) {
          const eventIdToClassify = placed.eventId;
          setImmediate(async () => {
            try {
              const { classifyJob } =
                await import("../../../worker/src/classify-job.ts");
              await classifyJob(eventIdToClassify);
            } catch {
              // Gracefully handled by BullMQ worker
            }
          });
        }

        return { outcome: placed.outcome, eventId: placed.eventId, attemptId };
      }
      default: {
        const unreachable: never = verification;
        return unreachable;
      }
    }
  });
}

async function placeEvent(
  tx: Tx,
  input: {
    integrationId: string;
    workspaceId: string;
    fields: ValidEventFields;
    digest: string;
    receivedAt: Date;
    traceId: string | null;
  },
): Promise<{ eventId: string; outcome: "stored" | "duplicate" | "conflict" }> {
  const eventId = randomUUID();
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
        processing_state,
        workspace_id
      )
      VALUES (
        ${eventId},
        ${input.integrationId},
        ${sqlText(input.fields.externalEventId)},
        ${sqlText(input.fields.eventType)},
        CAST(${sqlTimestamp(input.fields.occurredAt)} AS timestamptz),
        CAST(${input.receivedAt.toISOString()} AS timestamptz),
        ${sqlText(input.traceId)},
        ${input.digest},
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
    externalEventId: input.fields.externalEventId,
  })
    .forUpdate()
    .first();
  if (existing === null) {
    throw new Error(`missing event ${input.fields.externalEventId}`);
  }
  return {
    eventId: existing.id,
    outcome: existing.payloadDigest === input.digest ? "duplicate" : "conflict",
  };
}

async function insertAttempt(
  tx: Tx,
  input: {
    eventId: string | null;
    integrationId: string;
    workspaceId: string;
    receivedAt: Date;
    verificationState: Exclude<VerificationState, "RECEIVED">;
    httpStatus?: number | null;
    errorCode: string | null;
  },
): Promise<string> {
  const id = randomUUID();
  await tx.orm.public.DeliveryAttempt.create({
    id,
    eventId: input.eventId,
    integrationId: input.integrationId,
    receivedAt: input.receivedAt,
    httpStatus: input.httpStatus ?? null,
    verificationState: input.verificationState,
    handlerState: "PENDING",
    errorCode: input.errorCode,
    correlationId: randomUUID(),
    workspaceId: input.workspaceId,
  });
  return id;
}

async function insertOutbox(
  tx: Tx,
  input: { eventId: string | null; attemptId: string },
): Promise<void> {
  await tx.orm.public.Outbox.create({
    id: randomUUID(),
    eventId: input.eventId,
    attemptId: input.attemptId,
    enqueuedAt: null,
  });
}

function traceIdFrom(headers: Readonly<Record<string, string>>): string | null {
  const value = headerValue(headers, "traceparent");
  if (value === null) return null;
  const match = TRACEPARENT.exec(value.trim().toLowerCase());
  const traceId = match?.[1];
  if (traceId === undefined || traceId === "00000000000000000000000000000000")
    return null;
  return traceId;
}

function headerValue(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && value.length > 0) return value;
  }
  return null;
}
