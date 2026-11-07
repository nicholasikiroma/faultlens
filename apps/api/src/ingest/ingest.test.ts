import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { db } from '#db';
import { ingest } from './ingest.ts';
import { SIGNATURE_HEADER } from './verify.ts';

const secret = 'simulator-secret';
const token = 'demo-token';
const workspaceId = 'workspace-1';

after(async () => {
  await db.close();
});

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
  await db.execute(db.raw.sql`DELETE FROM outbox`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM delivery_attempts`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM webhook_events`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM integrations`.affectedCount().build());
}

async function seed(): Promise<void> {
  await db.orm.public.Integration.create({
    id: randomUUID(),
    workspaceId,
    endpointToken: token,
    signingSecret: secret,
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
