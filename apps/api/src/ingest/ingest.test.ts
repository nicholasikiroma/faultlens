import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { db } from '#db';
import { ingest, MAX_BODY_BYTES } from './ingest.ts';
import { SIGNATURE_HEADER } from './verify.ts';

const secret = 'simulator-secret';
const token = 'demo-token';
const workspaceId = 'workspace-1';

test('an unknown token writes no row', async () => {
  await reset();
  const result = await ingest({
    token: 'missing-token',
    rawBody: Buffer.from('{}'),
    headers: {},
  });
  assert.deepEqual(result, { outcome: 'unknown-token' });
  assert.equal(await count('webhook_events'), 0);
  assert.equal(await count('delivery_attempts'), 0);
  assert.equal(await count('outbox'), 0);
});

test('an oversized body writes no event, no attempt, and no outbox row', async () => {
  await reset();
  await seed();
  const oversizedBody = Buffer.alloc(MAX_BODY_BYTES + 1, 'x');
  const result = await ingest({
    token,
    rawBody: oversizedBody,
    headers: { [SIGNATURE_HEADER]: signature(oversizedBody) },
  });
  assert.deepEqual(result, { outcome: 'oversized' });
  assert.equal(await count('webhook_events'), 0);
  assert.equal(await count('delivery_attempts'), 0);
  assert.equal(await count('outbox'), 0);
});

test('a rejected signature stores the attempt and no event', async () => {
  await reset();
  await seed();
  const rawBody = eventBody('evt-rejected');
  const result = await ingest({ token, rawBody, headers: {} });
  assert.equal(result.outcome, 'rejected');
  if (result.outcome !== 'rejected') return;
  assert.equal(result.eventId, null);
  assert.equal(await count('webhook_events'), 0);
  const attempt = await db.orm.public.DeliveryAttempt.where({ id: result.attemptId }).first();
  assert.equal(attempt?.verificationState, 'REJECTED');
  assert.equal(attempt?.eventId, null);
  const outbox = await db.orm.public.Outbox.where({ attemptId: result.attemptId }).first();
  assert.equal(outbox?.eventId, null);
  assert.equal(outbox?.enqueuedAt, null);
});

test('a verified delivery stores one event, one attempt, and one outbox row', async () => {
  await reset();
  await seed();
  const rawBody = eventBody('evt-stored', { workspaceId: 'from-the-body', secret: 'hide-me' });
  const traceId = '0af7651916cd43dd8448eb211c80319c';
  const result = await ingest({
    token,
    rawBody,
    headers: {
      [SIGNATURE_HEADER]: signature(rawBody),
      traceparent: `00-${traceId}-b7ad6b7169203331-01`,
    },
  });
  assert.equal(result.outcome, 'stored');
  if (result.outcome !== 'stored') return;
  const event = await db.orm.public.WebhookEvent.where({ id: result.eventId }).first();
  assert.equal(event?.payloadDigest, sha256(rawBody));
  assert.equal(event?.redactedPayloadJson, null);
  assert.equal(event?.externalEventId, 'evt-stored');
  assert.equal(event?.workspaceId, workspaceId);
  assert.equal(event?.traceId, traceId);
  assert.equal(event?.processingState, 'RECEIVED');
  const attempt = await db.orm.public.DeliveryAttempt.where({ id: result.attemptId }).first();
  assert.equal(attempt?.verificationState, 'VERIFIED');
  assert.equal(attempt?.handlerState, 'PENDING');
  assert.equal(attempt?.eventId, result.eventId);
  const outbox = await db.orm.public.Outbox.where({ attemptId: result.attemptId }).first();
  assert.equal(outbox?.eventId, result.eventId);
  assert.equal(outbox?.enqueuedAt, null);
});

test('a malformed json body returns a schema error with fieldPath $ and stores an attempt with httpStatus 400', async () => {
  await reset();
  await seed();
  const malformed = Buffer.from('{not-valid-json');
  const result = await ingest({
    token,
    rawBody: malformed,
    headers: { [SIGNATURE_HEADER]: signature(malformed) },
  });
  assert.equal(result.outcome, 'schema-error');
  if (result.outcome !== 'schema-error') return;
  assert.equal(result.fieldPath, '$');
  assert.equal(await count('webhook_events'), 0);
  assert.equal(await count('delivery_attempts'), 1);
  assert.equal(await count('outbox'), 1);

  const attempt = await db.orm.public.DeliveryAttempt.where({ id: result.attemptId }).first();
  assert.equal(attempt?.verificationState, 'VERIFIED');
  assert.equal(attempt?.httpStatus, 400);
  assert.equal(attempt?.errorCode, 'schema_error');
  assert.equal(attempt?.eventId, null);

  const outbox = await db.orm.public.Outbox.where({ attemptId: result.attemptId }).first();
  assert.equal(outbox?.eventId, null);
  assert.equal(outbox?.enqueuedAt, null);
});

test('a payload missing event_id returns a schema error naming event_id and contains no secrets', async () => {
  await reset();
  await seed();
  const payloadWithSecret = Buffer.from(
    JSON.stringify({
      type: 'invoice.paid',
      secret: 'super-secret-key-12345',
      authorization: 'Bearer token-abcde',
    }),
  );
  const result = await ingest({
    token,
    rawBody: payloadWithSecret,
    headers: { [SIGNATURE_HEADER]: signature(payloadWithSecret) },
  });
  assert.equal(result.outcome, 'schema-error');
  if (result.outcome !== 'schema-error') return;
  assert.equal(result.fieldPath, 'event_id');

  // Verify result contains no secrets
  const serializedResult = JSON.stringify(result);
  assert.equal(serializedResult.includes('super-secret-key-12345'), false);
  assert.equal(serializedResult.includes('token-abcde'), false);
  assert.equal(serializedResult.includes(secret), false);

  assert.equal(await count('webhook_events'), 0);
  const attempt = await db.orm.public.DeliveryAttempt.where({ id: result.attemptId }).first();
  assert.equal(attempt?.verificationState, 'VERIFIED');
  assert.equal(attempt?.httpStatus, 400);
  assert.equal(attempt?.errorCode, 'schema_error');
  assert.equal(attempt?.eventId, null);
});

test('a payload missing type returns a schema error naming type', async () => {
  await reset();
  await seed();
  const rawBody = Buffer.from(JSON.stringify({ event_id: 'evt-missing-type' }));
  const result = await ingest({
    token,
    rawBody,
    headers: { [SIGNATURE_HEADER]: signature(rawBody) },
  });
  assert.equal(result.outcome, 'schema-error');
  if (result.outcome !== 'schema-error') return;
  assert.equal(result.fieldPath, 'type');
  assert.equal(await count('webhook_events'), 0);
});

test('a payload with invalid occurred_at returns a schema error naming occurred_at', async () => {
  await reset();
  await seed();
  const rawBody = Buffer.from(
    JSON.stringify({
      event_id: 'evt-invalid-date',
      type: 'invoice.paid',
      occurred_at: 'not-a-valid-timestamp',
    }),
  );
  const result = await ingest({
    token,
    rawBody,
    headers: { [SIGNATURE_HEADER]: signature(rawBody) },
  });
  assert.equal(result.outcome, 'schema-error');
  if (result.outcome !== 'schema-error') return;
  assert.equal(result.fieldPath, 'occurred_at');
  assert.equal(await count('webhook_events'), 0);
});

test('a payload that is not a JSON object returns a schema error with fieldPath $', async () => {
  await reset();
  await seed();
  const rawBody = Buffer.from(JSON.stringify(['an', 'array']));
  const result = await ingest({
    token,
    rawBody,
    headers: { [SIGNATURE_HEADER]: signature(rawBody) },
  });
  assert.equal(result.outcome, 'schema-error');
  if (result.outcome !== 'schema-error') return;
  assert.equal(result.fieldPath, '$');
  assert.equal(await count('webhook_events'), 0);
});

test('a second delivery of the same body is a duplicate', async () => {
  await reset();
  await seed();
  const rawBody = eventBody('evt-duplicate');
  const headers = { [SIGNATURE_HEADER]: signature(rawBody) };
  const first = await ingest({ token, rawBody, headers });
  const second = await ingest({ token, rawBody, headers });
  assert.equal(first.outcome, 'stored');
  assert.equal(second.outcome, 'duplicate');
  if (first.outcome !== 'stored' || second.outcome !== 'duplicate') return;
  assert.equal(second.eventId, first.eventId);
  assert.equal(await count('webhook_events'), 1);
  assert.equal(await count('delivery_attempts'), 2);
});

test('a different digest for the same external id is a conflict and keeps the stored digest', async () => {
  await reset();
  await seed();
  const firstBody = eventBody('evt-conflict', { amount: 1 });
  const secondBody = eventBody('evt-conflict', { amount: 2 });
  const first = await ingest({
    token,
    rawBody: firstBody,
    headers: { [SIGNATURE_HEADER]: signature(firstBody) },
  });
  const second = await ingest({
    token,
    rawBody: secondBody,
    headers: { [SIGNATURE_HEADER]: signature(secondBody) },
  });
  assert.equal(second.outcome, 'conflict');
  if (first.outcome !== 'stored' || second.outcome !== 'conflict') return;
  assert.equal(second.eventId, first.eventId);
  const event = await db.orm.public.WebhookEvent.where({ id: first.eventId }).first();
  assert.equal(event?.payloadDigest, sha256(firstBody));
  const attempt = await db.orm.public.DeliveryAttempt.where({ id: second.attemptId }).first();
  assert.equal(attempt?.errorCode, 'conflict');
  assert.equal(attempt?.verificationState, 'VERIFIED');
});

test('a forced rollback leaves events and outbox unchanged', async () => {
  await reset();
  await seed();
  const integration = await db.orm.public.Integration.where({ endpointToken: token }).first();
  assert.ok(integration);
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.orm.public.WebhookEvent.create({
        id: randomUUID(),
        integrationId: integration.id,
        externalEventId: 'evt-rollback',
        eventType: 'invoice.paid',
        occurredAt: null,
        firstReceivedAt: new Date(),
        traceId: null,
        payloadDigest: 'a'.repeat(64),
        processingState: 'RECEIVED',
        workspaceId: integration.workspaceId,
      });
      throw new Error('forced rollback');
    }),
    (error: unknown) => error instanceof Error && error.message === 'forced rollback',
  );
  assert.equal(await count('webhook_events'), 0);
  assert.equal(await count('outbox'), 0);
});

async function reset(): Promise<void> {
  await db.execute(db.raw.sql`DELETE FROM feedback`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM audit_events`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM finding_evidence`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM findings`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM incident_events`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM investigation_runs`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM incidents`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM outbox`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM delivery_attempts`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM evidence`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM webhook_events`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM integrations`.affectedCount().build());
}

async function seed(): Promise<void> {
  await db.orm.public.Integration.create({
    id: randomUUID(),
    workspaceId,
    endpointToken: token,
    signingSecret: secret,
    environment: 'production',
    endpoint: '/hooks/billing',
  });
}

function eventBody(eventId: string, extra: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      event_id: eventId,
      type: 'invoice.paid',
      occurred_at: '2026-11-07T20:00:00.000Z',
      ...extra,
    }),
  );
}

function signature(rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function sha256(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

async function count(table: 'webhook_events' | 'delivery_attempts' | 'outbox'): Promise<number> {
  switch (table) {
    case 'webhook_events':
      return (await db.orm.public.WebhookEvent.all()).length;
    case 'delivery_attempts':
      return (await db.orm.public.DeliveryAttempt.all()).length;
    case 'outbox':
      return (await db.orm.public.Outbox.all()).length;
    default: {
      const unreachable: never = table;
      return unreachable;
    }
  }
}
