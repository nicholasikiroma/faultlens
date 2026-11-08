import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { db } from '#db';
import { classifyJob } from './classify-job.ts';
import { dispatchPending } from './dispatcher.ts';
import { closeQueue, getQueue } from './queue.ts';

after(async () => {
  await closeQueue();
  await db.close();
});

test('two calls for one event leave one finding', async () => {
  await reset();
  const integrationId = randomUUID();
  const eventId = randomUUID();
  const attemptId = randomUUID();
  const evidenceId = randomUUID();
  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken: `token-${integrationId}`,
    signingSecret: 'secret',
    environment: 'production',
    endpoint: '/hooks/billing',
  });
  await db.orm.public.WebhookEvent.create({
    id: eventId,
    integrationId,
    externalEventId: 'evt-classify',
    eventType: 'invoice.paid',
    occurredAt: new Date('2026-11-07T20:00:00.000Z'),
    firstReceivedAt: new Date('2026-11-07T20:00:01.000Z'),
    traceId: null,
    payloadDigest: 'a'.repeat(64),
    processingState: 'RECEIVED',
    workspaceId: 'workspace-1',
  });
  await db.orm.public.DeliveryAttempt.create({
    id: attemptId,
    eventId,
    integrationId,
    receivedAt: new Date('2026-11-07T20:00:01.000Z'),
    httpStatus: 401,
    durationMs: null,
    verificationState: 'VERIFIED',
    handlerState: 'PENDING',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });
  await db.orm.public.Evidence.create({
    id: evidenceId,
    sourceKind: 'DELIVERY_ATTEMPT',
    sourceRecordId: attemptId,
    summary: 'HTTP 401',
    sha256Digest: 'b'.repeat(64),
    trustTier: 'A',
    workspaceId: 'workspace-1',
  });

  await classifyJob(eventId);
  await classifyJob(eventId);

  const findings = (await db.orm.public.Finding.all()).filter((row) => row.eventId === eventId);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.failureClass, 'AUTH_FAILURE');
  assert.equal(findings[0]?.certainty, 'observed');
  const incidents = await db.orm.public.Incident.all();
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0]?.eventCount, 1);
  assert.equal(incidents[0]?.status, 'OPEN');
  const runs = (await db.orm.public.InvestigationRun.all()).filter((row) => row.eventId === eventId);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.mode, 'RULES');
  const links = (await db.orm.public.FindingEvidence.all()).filter(
    (row) => row.findingId === findings[0]?.id,
  );
  assert.deepEqual(
    links.map((row) => row.evidenceId),
    [evidenceId],
  );
});

test('two events with one fingerprint share one incident', async () => {
  await reset();
  const integrationId = randomUUID();
  const firstEventId = randomUUID();
  const secondEventId = randomUUID();
  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken: `token-${integrationId}`,
    signingSecret: 'secret',
    environment: 'production',
    endpoint: '/hooks/billing',
  });
  for (const eventId of [firstEventId, secondEventId]) {
    const attemptId = randomUUID();
    await db.orm.public.WebhookEvent.create({
      id: eventId,
      integrationId,
      externalEventId: `evt-${eventId}`,
      eventType: 'invoice.paid',
      occurredAt: new Date('2026-11-07T20:00:00.000Z'),
      firstReceivedAt: new Date('2026-11-07T20:00:01.000Z'),
      traceId: null,
      payloadDigest: 'a'.repeat(64),
      processingState: 'RECEIVED',
      workspaceId: 'workspace-1',
    });
    await db.orm.public.DeliveryAttempt.create({
      id: attemptId,
      eventId,
      integrationId,
      receivedAt: new Date('2026-11-07T20:00:01.000Z'),
      httpStatus: 401,
      durationMs: null,
      verificationState: 'VERIFIED',
      handlerState: 'PENDING',
      errorCode: null,
      correlationId: randomUUID(),
      workspaceId: 'workspace-1',
    });
  }

  await classifyJob(firstEventId);
  await classifyJob(secondEventId);
  await classifyJob(firstEventId);

  const incidents = await db.orm.public.Incident.all();
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0]?.eventCount, 2);
  const findings = await db.orm.public.Finding.all();
  assert.equal(findings.length, 2);
});

test('a second dispatchPending does not enqueue the same row', async () => {
  await reset();
  const queue = getQueue();
  await queue.obliterate({ force: true });

  const integrationId = randomUUID();
  const eventId = randomUUID();
  const verifiedAttemptId = randomUUID();
  const verifiedOutboxId = randomUUID();
  const rejectedAttemptId = randomUUID();
  const rejectedOutboxId = randomUUID();

  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken: `token-${integrationId}`,
    signingSecret: 'secret',
    environment: 'production',
    endpoint: '/hooks/billing',
  });

  await db.orm.public.WebhookEvent.create({
    id: eventId,
    integrationId,
    externalEventId: 'evt-outbox',
    eventType: 'invoice.paid',
    occurredAt: new Date('2026-11-07T20:00:00.000Z'),
    firstReceivedAt: new Date('2026-11-07T20:00:01.000Z'),
    traceId: null,
    payloadDigest: 'a'.repeat(64),
    processingState: 'RECEIVED',
    workspaceId: 'workspace-1',
  });

  await db.orm.public.DeliveryAttempt.create({
    id: verifiedAttemptId,
    eventId,
    integrationId,
    receivedAt: new Date('2026-11-07T20:00:01.000Z'),
    httpStatus: 200,
    durationMs: null,
    verificationState: 'VERIFIED',
    handlerState: 'PENDING',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });

  await db.orm.public.Outbox.create({
    id: verifiedOutboxId,
    eventId,
    attemptId: verifiedAttemptId,
    enqueuedAt: null,
  });

  await db.orm.public.DeliveryAttempt.create({
    id: rejectedAttemptId,
    eventId: null,
    integrationId,
    receivedAt: new Date('2026-11-07T20:00:02.000Z'),
    httpStatus: 401,
    durationMs: null,
    verificationState: 'REJECTED',
    handlerState: 'PENDING',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });

  await db.orm.public.Outbox.create({
    id: rejectedOutboxId,
    eventId: null,
    attemptId: rejectedAttemptId,
    enqueuedAt: null,
  });

  const markedFirst = await dispatchPending();
  assert.equal(markedFirst, 2);

  const outboxRowsAfterFirst = await db.orm.public.Outbox.all();
  assert.equal(outboxRowsAfterFirst.length, 2);
  assert.ok(outboxRowsAfterFirst[0]?.enqueuedAt !== null);
  assert.ok(outboxRowsAfterFirst[1]?.enqueuedAt !== null);

  const jobs = await queue.getJobs(['waiting', 'active', 'completed', 'delayed']);
  assert.equal(jobs.length, 2);
  const jobIds = new Set(jobs.map((j) => j.id));
  assert.ok(jobIds.has(eventId));
  assert.ok(jobIds.has(rejectedAttemptId));

  const markedSecond = await dispatchPending();
  assert.equal(markedSecond, 0);

  const jobsAfterSecond = await queue.getJobs(['waiting', 'active', 'completed', 'delayed']);
  assert.equal(jobsAfterSecond.length, 2);
});

test('a failed Redis connection leaves enqueuedAt null', async () => {
  await reset();
  const integrationId = randomUUID();
  const attemptId = randomUUID();
  const outboxId = randomUUID();

  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken: `token-${integrationId}`,
    signingSecret: 'secret',
    environment: 'production',
    endpoint: '/hooks/billing',
  });

  await db.orm.public.DeliveryAttempt.create({
    id: attemptId,
    eventId: null,
    integrationId,
    receivedAt: new Date('2026-11-07T20:00:01.000Z'),
    httpStatus: 401,
    durationMs: null,
    verificationState: 'REJECTED',
    handlerState: 'PENDING',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });

  await db.orm.public.Outbox.create({
    id: outboxId,
    eventId: null,
    attemptId,
    enqueuedAt: null,
  });

  const marked = await dispatchPending({ redisUrl: 'redis://127.0.0.1:6378' });
  assert.equal(marked, 0);

  const row = await db.orm.public.Outbox.where({ id: outboxId }).first();
  assert.equal(row?.enqueuedAt, null);
});

async function reset(): Promise<void> {
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
