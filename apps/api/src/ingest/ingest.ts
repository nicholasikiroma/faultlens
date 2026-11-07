import { randomUUID } from 'node:crypto';
import type { PostgresTransactionContext } from '@prisma/orm-postgres/runtime';
import { db, type Contract } from '#db';
import { sqlText, sqlTimestamp } from '#sql';
import { redact } from './redact.ts';
import { verify } from './verify.ts';

type Tx = PostgresTransactionContext<Contract>;

export type IngestResult =
  | { outcome: 'unknown-token' }
  | { outcome: 'rejected'; eventId: null; attemptId: string }
  | { outcome: 'stored' | 'duplicate' | 'conflict'; eventId: string; attemptId: string };

const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;

export async function ingest(input: {
  token: string;
  rawBody: Buffer;
  headers: Readonly<Record<string, string>>;
}): Promise<IngestResult> {
  const receivedAt = new Date();
  return db.transaction(async (tx) => {
    const integration = await tx.orm.public.Integration.where({ endpointToken: input.token }).first();
    if (integration === null) {
      return { outcome: 'unknown-token' };
    }

    const verification = verify(input.rawBody, input.headers, integration.signingSecret);
    switch (verification) {
      case 'REJECTED': {
        const attemptId = await insertAttempt(tx, {
          eventId: null,
          integrationId: integration.id,
          workspaceId: integration.workspaceId,
          receivedAt,
          verificationState: 'REJECTED',
          errorCode: null,
        });
        await insertOutbox(tx, { eventId: null, attemptId });
        return { outcome: 'rejected', eventId: null, attemptId };
      }
      case 'VERIFIED': {
        const { digest } = redact(input.rawBody);
        const placed = await placeEvent(tx, {
          integrationId: integration.id,
          workspaceId: integration.workspaceId,
          fields: eventFields(input.rawBody),
          digest,
          receivedAt,
          traceId: traceIdFrom(input.headers),
        });
        const attemptId = await insertAttempt(tx, {
          eventId: placed.eventId,
          integrationId: integration.id,
          workspaceId: integration.workspaceId,
          receivedAt,
          verificationState: 'VERIFIED',
          errorCode: placed.outcome === 'conflict' ? 'conflict' : null,
        });
        await insertOutbox(tx, { eventId: placed.eventId, attemptId });
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
    fields: EventFields;
    digest: string;
    receivedAt: Date;
    traceId: string | null;
  },
): Promise<{ eventId: string; outcome: 'stored' | 'duplicate' | 'conflict' }> {
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
        CAST(${'RECEIVED'} AS "ProcessingState"),
        ${input.workspaceId}
      )
      ON CONFLICT (integration_id, external_event_id) DO NOTHING
      RETURNING id
    `
      .returnsRow({ id: 'pg/text@1' })
      .build(),
  );
  const row = inserted[0];
  if (row !== undefined) {
    return { eventId: row.id, outcome: 'stored' };
  }
  if (input.fields.externalEventId === null) {
    throw new Error('event insert conflicted without an external event id');
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
    outcome: existing.payloadDigest === input.digest ? 'duplicate' : 'conflict',
  };
}

async function insertAttempt(
  tx: Tx,
  input: {
    eventId: string | null;
    integrationId: string;
    workspaceId: string;
    receivedAt: Date;
    verificationState: 'VERIFIED' | 'REJECTED';
    errorCode: string | null;
  },
): Promise<string> {
  const id = randomUUID();
  await tx.orm.public.DeliveryAttempt.create({
    id,
    eventId: input.eventId,
    integrationId: input.integrationId,
    receivedAt: input.receivedAt,
    verificationState: input.verificationState,
    handlerState: 'PENDING',
    errorCode: input.errorCode,
    correlationId: randomUUID(),
    workspaceId: input.workspaceId,
  });
  return id;
}

async function insertOutbox(tx: Tx, input: { eventId: string | null; attemptId: string }): Promise<void> {
  await tx.orm.public.Outbox.create({
    id: randomUUID(),
    eventId: input.eventId,
    attemptId: input.attemptId,
    enqueuedAt: null,
  });
}

interface EventFields {
  externalEventId: string | null;
  eventType: string | null;
  occurredAt: Date | null;
}

function eventFields(rawBody: Buffer): EventFields {
  let value: unknown;
  try {
    value = JSON.parse(rawBody.toString('utf8')) as unknown;
  } catch {
    return { externalEventId: null, eventType: null, occurredAt: null };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { externalEventId: null, eventType: null, occurredAt: null };
  }
  const record = value as Record<string, unknown>;
  return {
    externalEventId: text(record.event_id),
    eventType: text(record.type),
    occurredAt: time(record.occurred_at),
  };
}

function traceIdFrom(headers: Readonly<Record<string, string>>): string | null {
  const value = headerValue(headers, 'traceparent');
  if (value === null) return null;
  const match = TRACEPARENT.exec(value.trim().toLowerCase());
  const traceId = match?.[1];
  if (traceId === undefined || traceId === '00000000000000000000000000000000') return null;
  return traceId;
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && value.length > 0) return value;
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function time(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}
