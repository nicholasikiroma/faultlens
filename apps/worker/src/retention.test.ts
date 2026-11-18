import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { db } from '#db';
import { ensureProductSchema } from '../../api/src/seed/seed.ts';
import { purgeExpiredData } from './retention.ts';

after(async () => {
  await db.close();
});

test('purgeExpiredData scrubs expired redacted payloads and prunes resolved incidents past metadata retention', async () => {
  await ensureProductSchema();
  await reset();

  const integrationId = randomUUID();
  const oldEventId = randomUUID();
  const recentEventId = randomUUID();
  const oldAttemptId = randomUUID();
  const oldIncidentId = randomUUID();
  const now = new Date('2026-11-17T12:00:00.000Z');
  const tenDaysAgo = new Date(now.getTime() - 10 * 86_400_000);
  const fortyDaysAgo = new Date(now.getTime() - 40 * 86_400_000);

  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken: `tok-${integrationId}`,
    signingSecret: 'secret',
    environment: 'production',
    endpoint: '/hooks/retention',
  });

  await db.orm.public.WebhookEvent.create({
    id: oldEventId,
    integrationId,
    externalEventId: 'evt-old',
    eventType: 'test.old',
    occurredAt: fortyDaysAgo,
    firstReceivedAt: fortyDaysAgo,
    traceId: null,
    payloadDigest: 'a'.repeat(64),
    redactedPayloadJson: { hello: 'old' },
    processingState: 'PROCESSED',
    workspaceId: 'workspace-1',
  });

  await db.orm.public.WebhookEvent.create({
    id: recentEventId,
    integrationId,
    externalEventId: 'evt-recent-payload',
    eventType: 'test.recent',
    occurredAt: tenDaysAgo,
    firstReceivedAt: tenDaysAgo,
    traceId: null,
    payloadDigest: 'b'.repeat(64),
    redactedPayloadJson: { hello: 'scrub_me' },
    processingState: 'PROCESSED',
    workspaceId: 'workspace-1',
  });

  await db.orm.public.DeliveryAttempt.create({
    id: oldAttemptId,
    eventId: oldEventId,
    integrationId,
    receivedAt: fortyDaysAgo,
    httpStatus: 200,
    durationMs: 10,
    verificationState: 'VERIFIED',
    handlerState: 'PROCESSED',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });

  await db.orm.public.Incident.create({
    id: oldIncidentId,
    workspaceId: 'workspace-1',
    fingerprint: 'fp-old',
    integrationId,
    environment: 'production',
    failureClass: 'RATE_LIMIT',
    endpoint: '/hooks/retention',
    ruleVersion: '0',
    status: 'RESOLVED',
    firstSeenAt: fortyDaysAgo,
    lastSeenAt: fortyDaysAgo,
    eventCount: 1,
  });

  await db.orm.public.IncidentEvent.create({
    incidentId: oldIncidentId,
    eventId: oldEventId,
    linkedAt: fortyDaysAgo,
  });

  const res = await purgeExpiredData({ now, payloadDays: 7, metadataDays: 30 });
  assert.equal(res.scrubbedPayloads, 2);
  assert.equal(res.prunedIncidents, 1);
  assert.equal(res.prunedEvents, 1);

  const recent = await db.orm.public.WebhookEvent.where({ id: recentEventId }).first();
  assert.ok(recent);
  assert.equal(recent.redactedPayloadJson, null);
});

async function reset(): Promise<void> {
  await db.execute(db.raw.sql`DELETE FROM incident_questions`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM hypotheses`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM tool_calls`.affectedCount().build());
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
