import { randomUUID } from "node:crypto";
import type { PostgresTransactionContext } from "@prisma/orm-postgres/runtime";
import { db, type Contract } from "#db";
import type {
  DeliveryAttempt,
  Evidence,
  FailureClass,
  IncidentContext,
  WebhookEvent,
} from "#domain";
import { RULES, fingerprint } from "#rules";

type Tx = PostgresTransactionContext<Contract>;

export async function classifyJob(eventId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const event = await tx.orm.public.WebhookEvent.where({
      id: eventId,
    }).first();
    if (event === null) {
      throw new Error(`missing event ${eventId}`);
    }
    const integration = await tx.orm.public.Integration.where({
      id: event.integrationId,
    }).first();
    if (integration === null) {
      throw new Error(`missing integration ${event.integrationId}`);
    }
    const attemptRows = (await tx.orm.public.DeliveryAttempt.all()).filter(
      (row) => row.eventId === eventId,
    );
    const attemptIds = new Set(attemptRows.map((row) => row.id));
    const evidenceRows = (await tx.orm.public.Evidence.all()).filter(
      (row) =>
        row.workspaceId === event.workspaceId &&
        ((row.sourceKind === "WEBHOOK_EVENT" &&
          row.sourceRecordId === eventId) ||
          (row.sourceKind === "DELIVERY_ATTEMPT" &&
            attemptIds.has(row.sourceRecordId))),
    );
    const ctx: IncidentContext = {
      integrationId: event.integrationId,
      environment: integration.environment,
      event: toEvent(event),
      attempts: attemptRows.map(toAttempt),
      evidence: evidenceRows.map(toEvidence),
    };
    const seenAt = event.firstReceivedAt;
    for (const rule of RULES) {
      const matches = await rule.evaluate(ctx);
      for (const match of matches) {
        const incident = await placeIncident(tx, {
          workspaceId: event.workspaceId,
          integrationId: event.integrationId,
          environment: integration.environment,
          endpoint: integration.endpoint,
          failureClass: match.failureClass,
          ruleVersion: rule.version,
          seenAt,
        });
        const linked = await linkEvent(tx, {
          incidentId: incident.id,
          eventId,
          seenAt,
        });
        if (linked && !incident.created) {
          await countEvent(tx, { incidentId: incident.id, seenAt });
        }
        const findingId = await placeFinding(tx, {
          incidentId: incident.id,
          eventId,
          ruleId: rule.id,
          ruleVersion: rule.version,
          failureClass: match.failureClass,
          explanation: match.explanation,
          certainty: match.certainty,
          workspaceId: event.workspaceId,
        });
        for (const evidenceId of match.evidenceIds) {
          await placeFindingEvidence(tx, { findingId, evidenceId });
        }
        await placeRun(tx, {
          incidentId: incident.id,
          eventId,
          rulesetVersion: rule.version,
          seenAt,
        });
      }
    }
  });
}

async function placeIncident(
  tx: Tx,
  input: {
    workspaceId: string;
    integrationId: string;
    environment: string;
    endpoint: string;
    failureClass: FailureClass;
    ruleVersion: string;
    seenAt: Date;
  },
): Promise<{ id: string; created: boolean }> {
  const id = randomUUID();
  const key = fingerprint({
    integrationId: input.integrationId,
    environment: input.environment,
    failureClass: input.failureClass,
    endpoint: input.endpoint,
  });
  const inserted = await tx.query(
    tx.raw.sql`
      INSERT INTO incidents (
        id, workspace_id, fingerprint, integration_id, environment, failure_class,
        endpoint, rule_version, status, first_seen_at, last_seen_at, event_count
      )
      VALUES (
        ${id},
        ${input.workspaceId},
        ${key},
        ${input.integrationId},
        ${input.environment},
        CAST(${input.failureClass} AS "FailureClass"),
        ${input.endpoint},
        ${input.ruleVersion},
        CAST(${"OPEN"} AS "IncidentStatus"),
        CAST(${input.seenAt.toISOString()} AS timestamptz),
        CAST(${input.seenAt.toISOString()} AS timestamptz),
        1
      )
      ON CONFLICT (workspace_id, fingerprint, rule_version) DO NOTHING
      RETURNING id
    `
      .returnsRow({ id: "pg/text@1" })
      .build(),
  );
  const row = inserted[0];
  if (row !== undefined) return { id: row.id, created: true };
  const existing = await tx.query(
    tx.raw.sql`
      SELECT id FROM incidents
      WHERE workspace_id = ${input.workspaceId}
        AND fingerprint = ${key}
        AND rule_version = ${input.ruleVersion}
    `
      .returnsRow({ id: "pg/text@1" })
      .build(),
  );
  const found = existing[0];
  if (found === undefined) {
    throw new Error(`missing incident ${key}`);
  }
  return { id: found.id, created: false };
}

async function linkEvent(
  tx: Tx,
  input: { incidentId: string; eventId: string; seenAt: Date },
): Promise<boolean> {
  const inserted = await tx.query(
    tx.raw.sql`
      INSERT INTO incident_events (incident_id, event_id, linked_at)
      VALUES (
        ${input.incidentId},
        ${input.eventId},
        CAST(${input.seenAt.toISOString()} AS timestamptz)
      )
      ON CONFLICT (incident_id, event_id) DO NOTHING
      RETURNING incident_id
    `
      .returnsRow({ incident_id: "pg/text@1" })
      .build(),
  );
  return inserted[0] !== undefined;
}

async function countEvent(
  tx: Tx,
  input: { incidentId: string; seenAt: Date },
): Promise<void> {
  await tx.query(
    tx.raw.sql`
      UPDATE incidents
      SET event_count = event_count + 1,
          last_seen_at = CAST(${input.seenAt.toISOString()} AS timestamptz)
      WHERE id = ${input.incidentId}
    `
      .affectedCount()
      .build(),
  );
}

async function placeFinding(
  tx: Tx,
  input: {
    incidentId: string;
    eventId: string;
    ruleId: string;
    ruleVersion: string;
    failureClass: FailureClass;
    explanation: string;
    certainty: "observed" | "inferred";
    workspaceId: string;
  },
): Promise<string> {
  const id = randomUUID();
  const inserted = await tx.query(
    tx.raw.sql`
      INSERT INTO findings (
        id, incident_id, event_id, rule_id, rule_version, failure_class,
        explanation, certainty, workspace_id
      )
      VALUES (
        ${id},
        ${input.incidentId},
        ${input.eventId},
        ${input.ruleId},
        ${input.ruleVersion},
        CAST(${input.failureClass} AS "FailureClass"),
        ${input.explanation},
        ${input.certainty},
        ${input.workspaceId}
      )
      ON CONFLICT (event_id, rule_id, rule_version) DO NOTHING
      RETURNING id
    `
      .returnsRow({ id: "pg/text@1" })
      .build(),
  );
  const row = inserted[0];
  if (row !== undefined) return row.id;
  const existing = await tx.query(
    tx.raw.sql`
      SELECT id FROM findings
      WHERE event_id = ${input.eventId}
        AND rule_id = ${input.ruleId}
        AND rule_version = ${input.ruleVersion}
    `
      .returnsRow({ id: "pg/text@1" })
      .build(),
  );
  const found = existing[0];
  if (found === undefined) {
    throw new Error(`missing finding ${input.eventId} ${input.ruleId}`);
  }
  return found.id;
}

async function placeFindingEvidence(
  tx: Tx,
  input: { findingId: string; evidenceId: string },
): Promise<void> {
  await tx.query(
    tx.raw.sql`
      INSERT INTO finding_evidence (finding_id, evidence_id)
      VALUES (${input.findingId}, ${input.evidenceId})
      ON CONFLICT (finding_id, evidence_id) DO NOTHING
    `
      .affectedCount()
      .build(),
  );
}

async function placeRun(
  tx: Tx,
  input: {
    incidentId: string;
    eventId: string;
    rulesetVersion: string;
    seenAt: Date;
  },
): Promise<void> {
  await tx.query(
    tx.raw.sql`
      INSERT INTO investigation_runs (
        id, incident_id, event_id, mode, state, ruleset_version, started_at, ended_at
      )
      VALUES (
        ${randomUUID()},
        ${input.incidentId},
        ${input.eventId},
        CAST(${"RULES"} AS "RunMode"),
        CAST(${"COMPLETED"} AS "RunState"),
        ${input.rulesetVersion},
        CAST(${input.seenAt.toISOString()} AS timestamptz),
        CAST(${input.seenAt.toISOString()} AS timestamptz)
      )
      ON CONFLICT (event_id, incident_id, mode, ruleset_version) DO NOTHING
    `
      .affectedCount()
      .build(),
  );
}

function toEvent(row: {
  id: string;
  integrationId: string;
  externalEventId: string | null;
  eventType: string | null;
  occurredAt: Date | null;
  firstReceivedAt: Date;
  traceId: string | null;
  payloadDigest: string;
  redactedPayloadJson: unknown;
  processingState: WebhookEvent["processingState"];
}): WebhookEvent {
  return {
    id: row.id,
    integrationId: row.integrationId,
    externalEventId: row.externalEventId,
    eventType: row.eventType,
    occurredAt: row.occurredAt,
    firstReceivedAt: row.firstReceivedAt,
    traceId: row.traceId,
    payloadDigest: row.payloadDigest,
    redactedPayloadJson: row.redactedPayloadJson,
    processingState: row.processingState,
  };
}

function toAttempt(row: {
  id: string;
  eventId: string | null;
  integrationId: string;
  receivedAt: Date;
  httpStatus: number | null;
  durationMs: number | null;
  senderWaitMs: number | null;
  verificationState: DeliveryAttempt["verificationState"];
  handlerState: DeliveryAttempt["handlerState"];
  errorCode: string | null;
  correlationId: string;
}): DeliveryAttempt {
  return {
    id: row.id,
    eventId: row.eventId,
    integrationId: row.integrationId,
    receivedAt: row.receivedAt,
    httpStatus: row.httpStatus,
    durationMs: row.durationMs,
    senderWaitMs: row.senderWaitMs,
    verificationState: row.verificationState,
    handlerState: row.handlerState,
    errorCode: row.errorCode,
    correlationId: row.correlationId,
  };
}

function toEvidence(row: {
  id: string;
  sourceKind: Evidence["sourceKind"];
  sourceRecordId: string;
  summary: string;
  sha256Digest: string;
  trustTier: Evidence["trustTier"];
}): Evidence {
  return {
    id: row.id,
    sourceKind: row.sourceKind,
    sourceRecordId: row.sourceRecordId,
    summary: row.summary,
    sha256Digest: row.sha256Digest,
    trustTier: row.trustTier,
  };
}
